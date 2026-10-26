"""الأحداث بين الخدمات عبر RabbitMQ: شكل الحدث وطوابيره، الـ Outbox (حفظ الحدث مع العملية ثم نشره)، والـ Inbox (استقباله مرة واحدة).
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

import pika
from pika.exceptions import AMQPError, NackError, UnroutableError
from sqlalchemy import CheckConstraint, Index, JSON, select, Text, text, UniqueConstraint
from sqlalchemy.dialects.mysql import BIGINT, CHAR, DATETIME, INTEGER, VARCHAR
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Mapped, mapped_column, Session

from medplat.config import platform_settings
from medplat.db import Database, is_duplicate_key, is_unavailable, mysql_error_code
from medplat.util import to_iso_utc, to_jsonable, utc_now
from medplat.web import current_request_id


# ======== شكل الحدث وطوبولوجيا RabbitMQ
# شكل الحدث على الـ broker وطوبولوجيا RabbitMQ.
#
# exchange واحد من نوع topic. مفتاح التوجيه `<المصدر>.<نوع الحدث>`، مثل
# `order.OrderDispensed`. كل خدمة مستهلكة تملك queue واحدة مربوطة بالمفاتيح
# التي تهمها، ومعها dead-letter queue للرسائل التي فشلت معالجتها نهائيًا.

EXCHANGE = "medplat.events"
DEAD_LETTER_EXCHANGE = "medplat.events.dlx"

# مساحة أسماء ثابتة لتوليد معرّفات أحداث حتمية (uuid5): نفس الحدث
# المجدول يولّد نفس event_id في كل مرة، فيمنع UNIQUE تكراره.
_EVENT_NAMESPACE = uuid.UUID("6f1d8c3e-2b5a-4f0e-9c7d-3a2b1c0d9e8f")


# مصدر الحقيقة الوحيد لمن يستمع لماذا. الـ publisher يعلن كل هذه الـ
# queues عند إقلاعه، فلا يضيع حدث نُشر قبل أن يقلع المستهلك: الرسالة
# تنتظر في queue الخاصة به حتى يعمل.
CONSUMER_TOPOLOGY: dict[str, list[str]] = {
    "health.events": ["order.OrderDispensed", "order.OrderItemDosePlanned"],
    "notification.events": [
        "auth.UserRegistered",
        "auth.UserSuspended",
        "auth.UserReactivated",
        "order.*",
        "pharmacy.PharmacyStatusChanged",
        "inventory.InventoryLowStock",
        "health.DoseDue",
        "health.MedicationRunningLow",
        "health.DoseScheduleProposed",
        "ai.AIInsightCreated",
        "medication.MedicationRequestAnswered",
    ],
    "ai.events": ["health.AdherencePeriodClosed"],
}

def _topic_matches(pattern: list[str], key: list[str]) -> bool:
    """مطابقة مفتاح توجيه بنمط topic كما يفعل RabbitMQ: `*` كلمة واحدة، `#` أي عدد من الكلمات."""
    if not pattern:
        return not key
    head, rest = pattern[0], pattern[1:]
    if head == "#":
        return any(_topic_matches(rest, key[index:]) for index in range(len(key) + 1))
    return bool(key) and head in ("*", key[0]) and _topic_matches(rest, key[1:])


def has_subscriber(key: str) -> bool:
    """هل يستمع مستهلك لهذا المفتاح؟ من CONSUMER_TOPOLOGY نفسها التي يعلنها الناشر.

    أحداث كثيرة بلا مستمع: تُنشر إلى الـ exchange ولا يستلمها أحد، وهذا سليم. الناشر يطلب تأكيد التوجيه فقط لما له مستمع.
    """
    words = key.split(".")
    return any(_topic_matches(pattern.split("."), words) for patterns in CONSUMER_TOPOLOGY.values() for pattern in patterns)


def stable_event_id(*parts: object) -> str:
    return str(uuid.uuid5(_EVENT_NAMESPACE, ":".join(str(part) for part in parts)))


def routing_key(source: str, event_type: str) -> str:
    return f"{source}.{event_type}"


@dataclass(frozen=True, slots=True)
class EventEnvelope:
    event_id: str
    event_type: str
    version: int
    source: str
    aggregate_type: str
    aggregate_id: str
    occurred_at: str
    correlation_id: str | None
    causation_id: str | None
    payload: dict[str, Any]

    def to_bytes(self) -> bytes:
        return json.dumps(asdict(self), ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    @classmethod
    def from_bytes(cls, body: bytes) -> "EventEnvelope":
        data = json.loads(body.decode("utf-8"))
        return cls(
            event_id=str(data["event_id"]),
            event_type=str(data["event_type"]),
            version=int(data.get("version", 1)),
            source=str(data["source"]),
            aggregate_type=str(data.get("aggregate_type", "")),
            aggregate_id=str(data.get("aggregate_id", "")),
            occurred_at=str(data["occurred_at"]),
            correlation_id=data.get("correlation_id"),
            causation_id=data.get("causation_id"),
            payload=dict(data.get("payload") or {}),
        )


def declare_exchanges(channel) -> None:
    channel.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    # direct لا topic: كل queue ترسل رسائلها الميتة بمفتاح باسمها هي، فلا
    # تصل رسالة فشلت في notification إلى dead-letter queue خدمة أخرى.
    channel.exchange_declare(exchange=DEAD_LETTER_EXCHANGE, exchange_type="direct", durable=True)


def declare_consumer_queue(channel, queue: str, binding_keys: list[str]) -> None:
    declare_exchanges(channel)
    dead_letter_queue = f"{queue}.dlq"
    channel.queue_declare(queue=dead_letter_queue, durable=True)
    channel.queue_bind(queue=dead_letter_queue, exchange=DEAD_LETTER_EXCHANGE, routing_key=queue)
    channel.queue_declare(
        queue=queue,
        durable=True,
        arguments={
            "x-dead-letter-exchange": DEAD_LETTER_EXCHANGE,
            "x-dead-letter-routing-key": queue,
        },
    )
    for key in binding_keys:
        channel.queue_bind(queue=queue, exchange=EXCHANGE, routing_key=key)


def declare_full_topology(channel) -> None:
    for queue, keys in CONSUMER_TOPOLOGY.items():
        declare_consumer_queue(channel, queue, keys)


TOPOLOGY_CONFLICT_HINT = (
    "RabbitMQ already has a queue or exchange with one of this platform's names but different "
    "settings (left by another copy of the project). Nothing is published or consumed until it is "
    "removed. Run: python scripts/dev.py reset-broker"
)


def is_topology_conflict(error: BaseException) -> bool:
    """406 PRECONDITION_FAILED: الاسم موجود في الـ broker بإعدادات غير التي نعلنها."""
    return getattr(error, "reply_code", None) == 406


def delete_topology(channel) -> list[str]:
    """يحذف queues و exchanges المنصة من الـ broker (ومعها رسائلها غير المستهلكة).

    للتشغيل المحلي حين تبقى من نسخة أخرى بإعدادات مختلفة. الأحداث غير المنشورة
    لا تضيع: هي في جداول outbox، والعمال يعيدون إعلان كل شيء عند اتصالهم التالي.
    """
    removed = []
    for queue in CONSUMER_TOPOLOGY:
        for name in (queue, f"{queue}.dlq"):
            channel.queue_delete(queue=name)
            removed.append(name)
    for exchange in (EXCHANGE, DEAD_LETTER_EXCHANGE):
        channel.exchange_delete(exchange=exchange)
        removed.append(exchange)
    return removed


# ======== الـ Outbox: النشر
# Transactional Outbox (BR-022، NFR-RELIAB-01، §12.1).
#
# 1. الحالة التجارية وصف الحدث يُكتبان في نفس الـ transaction.
# 2. worker منفصل يقرأ الصفوف PENDING وينشرها إلى RabbitMQ.
# 3. التسليم "مرة على الأقل": قد تصل رسالة مرتين (مثلاً نُشرت ثم انقطع
#    الاتصال قبل تعليم الصف PUBLISHED)، والـ Inbox عند المستهلك يمنع أثرها
#    المزدوج (BR-023).
#
# عند انقطاع الـ broker **لا تُحسب المحاولات**: الصفوف تبقى PENDING وتُنشر
# عند عودته، مهما طال الانقطاع. المحاولات تُحسب فقط لأخطاء خاصة برسالة
# بعينها، وبعد 10 منها تصبح FAILED وتحتاج تدخلاً.

logger = logging.getLogger(__name__)

_UUID = CHAR(36, charset="ascii", collation="ascii_bin")


def define_outbox_model(base: type, prefix: str) -> type:
    """ينشئ نموذج outbox_events لخدمة ما — نفس الشكل في كل القواعد.

    `prefix` يدخل في أسماء القيود فقط، لأن أسماء القيود في MySQL فريدة
    على مستوى القاعدة وقد تُقرأ في رسائل الأخطاء.
    """

    class OutboxEvent(base):  # type: ignore[misc, valid-type]
        __tablename__ = "outbox_events"

        id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
        event_id: Mapped[str] = mapped_column(_UUID, nullable=False)
        aggregate_type: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
        aggregate_id: Mapped[str] = mapped_column(_UUID, nullable=False)
        event_type: Mapped[str] = mapped_column(VARCHAR(128), nullable=False)
        version: Mapped[int] = mapped_column(
            INTEGER(unsigned=True), nullable=False, server_default=text("1")
        )
        correlation_id: Mapped[str | None] = mapped_column(_UUID, nullable=True)
        causation_id: Mapped[str | None] = mapped_column(_UUID, nullable=True)
        payload: Mapped[dict] = mapped_column(JSON, nullable=False)
        status: Mapped[str] = mapped_column(
            VARCHAR(16), nullable=False, server_default=text("'PENDING'")
        )
        attempts: Mapped[int] = mapped_column(
            INTEGER(unsigned=True), nullable=False, server_default=text("0")
        )
        last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
        occurred_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
        published_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)

        __table_args__ = (
            UniqueConstraint("event_id", name=f"uq_{prefix}_outbox_event_id"),
            Index(f"idx_{prefix}_outbox_status_id", "status", "id"),
            CheckConstraint(
                "status IN ('PENDING', 'PUBLISHED', 'FAILED')", name=f"chk_{prefix}_outbox_status"
            ),
            CheckConstraint("version >= 1", name=f"chk_{prefix}_outbox_version"),
            CheckConstraint(
                "CHAR_LENGTH(TRIM(event_type)) > 0", name=f"chk_{prefix}_outbox_event_type"
            ),
            CheckConstraint(
                "(status = 'PUBLISHED' AND published_at IS NOT NULL) OR "
                "(status <> 'PUBLISHED' AND published_at IS NULL)",
                name=f"chk_{prefix}_outbox_publish_state",
            ),
            CheckConstraint(
                "status <> 'FAILED' OR (last_error IS NOT NULL AND CHAR_LENGTH(TRIM(last_error)) > 0)",
                name=f"chk_{prefix}_outbox_failed_error",
            ),
        )

    OutboxEvent.__name__ = "OutboxEvent"
    OutboxEvent.__qualname__ = "OutboxEvent"
    return OutboxEvent


def record_event(
    session: Session,
    model: type,
    *,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str,
    payload: dict[str, Any],
    correlation_id: str | None = None,
    causation_id: str | None = None,
    event_id: str | None = None,
    occurred_at: datetime | None = None,
    version: int = 1,
) -> Any:
    """يضيف حدثًا إلى الـ outbox داخل الـ transaction الجارية."""
    event = model(
        event_id=event_id or str(uuid.uuid4()),
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        event_type=event_type,
        version=version,
        correlation_id=correlation_id or current_request_id(),
        causation_id=causation_id,
        payload=to_jsonable(payload),
        status="PENDING",
        attempts=0,
        occurred_at=occurred_at or utc_now(),
    )
    session.add(event)
    return event


class OutboxPublisher:
    MAX_ATTEMPTS = 10

    def __init__(
        self,
        *,
        database: Database,
        model: type,
        source: str,
        batch_size: int = 50,
        poll_interval: float = 1.0,
    ) -> None:
        self.database = database
        self.model = model
        self.source = source
        self.batch_size = batch_size
        self.poll_interval = poll_interval
        self._connection: pika.BlockingConnection | None = None
        self._channel = None

    # ------------------------------------------------------------ connection

    def _ensure_channel(self) -> None:
        if self._channel is not None and self._channel.is_open:
            return
        self._close()
        params = pika.URLParameters(platform_settings().rabbitmq_url)
        params.heartbeat = 30
        self._connection = pika.BlockingConnection(params)
        channel = self._connection.channel()
        declare_full_topology(channel)
        channel.confirm_delivery()
        self._channel = channel
        logger.info("Outbox publisher connected to RabbitMQ.")

    def _close(self) -> None:
        try:
            if self._connection is not None and self._connection.is_open:
                self._connection.close()
        except Exception:
            pass
        self._connection = None
        self._channel = None

    # ------------------------------------------------------------ publishing

    def _envelope(self, row: Any) -> EventEnvelope:
        return EventEnvelope(
            event_id=row.event_id,
            event_type=row.event_type,
            version=row.version,
            source=self.source,
            aggregate_type=row.aggregate_type,
            aggregate_id=row.aggregate_id,
            occurred_at=to_iso_utc(row.occurred_at),
            correlation_id=row.correlation_id,
            causation_id=row.causation_id,
            payload=row.payload or {},
        )

    def publish_batch(self) -> int:
        model = self.model
        with self.database.transaction() as session:
            rows = session.scalars(
                select(model)
                .where(model.status == "PENDING")
                .order_by(model.id)
                .limit(self.batch_size)
                # عاملان يعملان بالخطأ معًا لن ينشرا نفس الصف.
                .with_for_update(skip_locked=True)
            ).all()

            for row in rows:
                envelope = self._envelope(row)
                key = routing_key(self.source, row.event_type)
                try:
                    self._channel.basic_publish(
                        exchange=EXCHANGE,
                        routing_key=key,
                        body=envelope.to_bytes(),
                        properties=pika.BasicProperties(
                            content_type="application/json",
                            delivery_mode=pika.DeliveryMode.Persistent,
                            message_id=row.event_id,
                            type=row.event_type,
                            correlation_id=row.correlation_id,
                        ),
                        # حدث له مستمع ولم يجد طابوره = طوبولوجيا مكسورة، فيُعاد ثم يُعلَّم FAILED.
                        # حدث بلا مستمع أصلًا يُنشر ويُعدّ منشورًا: لا أحد ينتظره.
                        mandatory=has_subscriber(key),
                    )
                except (UnroutableError, NackError) as exc:
                    # خطأ خاص بهذه الرسالة: يُحسب ويُسجل ثم نتابع الباقي.
                    row.attempts += 1
                    row.last_error = f"{type(exc).__name__}: {exc}"[:2000]
                    if row.attempts >= self.MAX_ATTEMPTS:
                        row.status = "FAILED"
                        logger.error("Outbox event %s marked FAILED: %s", row.event_id, row.last_error)
                    continue

                row.status = "PUBLISHED"
                row.published_at = utc_now()
            return len(rows)

    def run(self, stop: threading.Event) -> None:
        backoff = 1.0
        broker_down_logged = False
        while not stop.is_set():
            try:
                self._ensure_channel()
                broker_down_logged = False
                backoff = 1.0
                published = self.publish_batch()
                if published == 0:
                    # sleep الخاص بـ pika يخدم الـ heartbeats أثناء الانتظار. مع
                    # stop.wait العادي يبقى الاتصال صامتًا، فيغلقه RabbitMQ بعد
                    # دقيقة خمول ("connection reset").
                    self._connection.sleep(self.poll_interval)
            except AMQPError as exc:
                # الـ broker غائب: لا نلمس المحاولات. الصفوف تنتظر عودته.
                if not broker_down_logged:
                    if is_topology_conflict(exc):
                        logger.error("%s (%s)", TOPOLOGY_CONFLICT_HINT, exc)
                    else:
                        logger.warning("RabbitMQ unavailable, outbox events stay PENDING: %s", exc)
                    broker_down_logged = True
                self._close()
                stop.wait(backoff)
                backoff = min(backoff * 2, 15.0)
            except OperationalError as exc:
                logger.warning("Database unavailable for outbox publisher: %s", exc.orig)
                stop.wait(5.0)
            except Exception:
                logger.exception("Unexpected outbox publisher error")
                self._close()
                stop.wait(5.0)
        self._close()


# ======== الـ Inbox: الاستقبال
# Inbox: استهلاك الأحداث مرة واحدة فعليًا (BR-023، NFR-RELIAB-02، §12.2).
#
# صف الـ inbox وأثر الحدث يُكتبان في نفس الـ transaction. إن وصل الحدث
# مرة ثانية يصطدم إدخال الـ inbox بقيد UNIQUE على event_id، فيُعرف أنه
# عولج ويُؤكد استلامه دون أي أثر. وإن فشل الأثر يُلغى صف الـ inbox معه،
# فيُعاد المحاولة لاحقًا كأن الحدث لم يصل.


Handler = Callable[[Session, EventEnvelope], None]


def define_inbox_model(base: type, prefix: str) -> type:
    class InboxEvent(base):  # type: ignore[misc, valid-type]
        __tablename__ = "inbox_events"

        id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
        event_id: Mapped[str] = mapped_column(
            CHAR(36, charset="ascii", collation="ascii_bin"), nullable=False
        )
        event_type: Mapped[str] = mapped_column(VARCHAR(128), nullable=False)
        source: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
        received_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
        processed_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)

        __table_args__ = (UniqueConstraint("event_id", name=f"uq_{prefix}_inbox_event_id"),)

    InboxEvent.__name__ = "InboxEvent"
    InboxEvent.__qualname__ = "InboxEvent"
    return InboxEvent


class EventConsumer:
    def __init__(
        self,
        *,
        database: Database,
        inbox_model: type,
        inbox_constraint: str,
        queue: str,
        handlers: dict[str, Handler],
        fallback: Handler | None = None,
        prefetch: int = 10,
        heartbeat: int = 30,
    ) -> None:
        if queue not in CONSUMER_TOPOLOGY:
            raise ValueError(f"Queue {queue} is not declared in CONSUMER_TOPOLOGY.")
        self.database = database
        self.inbox_model = inbox_model
        self.inbox_constraint = inbox_constraint
        self.queue = queue
        self.handlers = handlers
        self.fallback = fallback
        self.prefetch = prefetch
        # معالج يستغرق أطول من هذه المدة تقريبًا (نموذج لغوي يكتب ملخصًا) يجعل RabbitMQ يقطع
        # الاتصال، فتعود الرسالة وتُعالَج من جديد. المستهلك الذي يعرف أن معالجه بطيء يرفعها.
        self.heartbeat = heartbeat

    def process(self, envelope: EventEnvelope) -> str:
        """يعالج حدثًا واحدًا. يرجع processed أو duplicate أو ignored.

        منفصلة عن الـ broker عمدًا حتى تُختبر مباشرة.
        """
        handler = self.handlers.get(f"{envelope.source}.{envelope.event_type}") or self.fallback
        if handler is None:
            return "ignored"

        for attempt in (1, 2):
            now = utc_now()
            try:
                with self.database.transaction() as session:
                    session.add(
                        self.inbox_model(
                            event_id=envelope.event_id,
                            event_type=envelope.event_type,
                            source=envelope.source,
                            received_at=now,
                            processed_at=now,
                        )
                    )
                    session.flush()
                    handler(session, envelope)
            except IntegrityError as exc:
                if is_duplicate_key(exc, self.inbox_constraint):
                    return "duplicate"
                # تعارض قيد فريد آخر في أثر الحدث = سباق مع مستهلك ثانٍ أنشأ نفس
                # الصف للتو (مثل أول صرف لنفس الدواء). المحاولة الثانية ترى صفه
                # فتزيده بدل أن تنشئه؛ بدونها كان الحدث يذهب للـ DLQ ويضيع أثره.
                if attempt == 1 and mysql_error_code(exc) == 1062:
                    continue
                raise
            return "processed"
        raise RuntimeError("unreachable")  # pragma: no cover

    def _on_message(self, channel, method, body: bytes) -> None:
        try:
            envelope = EventEnvelope.from_bytes(body)
        except Exception:
            logger.exception("Malformed event body on %s; sending to DLQ", self.queue)
            channel.basic_nack(method.delivery_tag, requeue=False)
            return

        for attempt in range(1, 4):
            try:
                outcome = self.process(envelope)
                channel.basic_ack(method.delivery_tag)
                if outcome != "ignored":
                    logger.info("%s %s %s", outcome, envelope.event_type, envelope.event_id)
                return
            except OperationalError as exc:
                if not is_unavailable(exc):
                    # خطأ دائم (CHECK، صلاحية): إعادة المحاولة لن تغيّر شيئًا، وكانت
                    # تعيد الرسالة للـ queue إلى الأبد وتوقف المستهلك الوحيد.
                    logger.exception("Permanent DB error for %s %s; sending to DLQ", envelope.event_type, envelope.event_id)
                    channel.basic_nack(method.delivery_tag, requeue=False)
                    return
                # قاعدة البيانات مؤقتًا غير متاحة: ليست رسالة سامة. ننتظر
                # ونعيدها إلى الـ queue بدل أن نرسلها للـ DLQ.
                logger.warning("DB error handling %s (attempt %s): %s", envelope.event_id, attempt, exc.orig)
                time.sleep(2.0 * attempt)
            except Exception:
                logger.exception("Handler failed for %s %s; sending to DLQ", envelope.event_type, envelope.event_id)
                channel.basic_nack(method.delivery_tag, requeue=False)
                return

        channel.basic_nack(method.delivery_tag, requeue=True)

    def run(self, stop: threading.Event) -> None:
        backoff = 1.0
        while not stop.is_set():
            connection = None
            try:
                params = pika.URLParameters(platform_settings().rabbitmq_url)
                params.heartbeat = self.heartbeat
                connection = pika.BlockingConnection(params)
                channel = connection.channel()
                declare_consumer_queue(channel, self.queue, CONSUMER_TOPOLOGY[self.queue])
                channel.basic_qos(prefetch_count=self.prefetch)
                logger.info("Consuming %s", self.queue)
                backoff = 1.0
                for method, _properties, body in channel.consume(self.queue, inactivity_timeout=1.0):
                    if stop.is_set():
                        break
                    if method is None:
                        continue
                    self._on_message(channel, method, body)
                channel.cancel()
            except AMQPError as exc:
                if is_topology_conflict(exc):
                    if backoff == 1.0:  # مرة عند أول فشل، لا كل 15 ثانية
                        logger.error("%s (%s)", TOPOLOGY_CONFLICT_HINT, exc)
                else:
                    logger.warning("RabbitMQ unavailable for %s: %s", self.queue, exc)
                stop.wait(backoff)
                backoff = min(backoff * 2, 15.0)
            except Exception:
                logger.exception("Unexpected consumer error on %s", self.queue)
                stop.wait(5.0)
            finally:
                try:
                    if connection is not None and connection.is_open:
                        connection.close()
                except Exception:
                    pass
