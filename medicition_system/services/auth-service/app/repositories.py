"""الاستعلامات على auth_db: صنف لكل جدول، وكل SELECT و UPDATE هنا لا في منطق العمل.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.db import transaction
from app.models import OutboxEvent, RefreshSession, User


# ======== المستخدمون

class UserRepository:
    """Persistence operations for Auth user records."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_id(self, user_id: int) -> User | None:
        statement = select(User).where(User.id == user_id)
        return self._session.scalar(statement)

    def get_by_id_for_update(self, user_id: int) -> User | None:
        statement = select(User).where(User.id == user_id).with_for_update()
        return self._session.scalar(statement)

    def get_by_public_id_for_update(self, public_id: str) -> User | None:
        statement = select(User).where(User.public_id == public_id).with_for_update()
        return self._session.scalar(statement)

    def get_by_email(self, email: str) -> User | None:
        statement = select(User).where(User.email == email)
        return self._session.scalar(statement)

    def get_by_phone(self, phone: str) -> User | None:
        statement = select(User).where(User.phone == phone)
        return self._session.scalar(statement)


    def get_by_email_for_update(self, email: str) -> User | None:
        statement = select(User).where(User.email == email).with_for_update()
        return self._session.scalar(statement)

    def get_by_phone_for_update(self, phone: str) -> User | None:
        statement = select(User).where(User.phone == phone).with_for_update()
        return self._session.scalar(statement)
    def add(self, user: User) -> User:
        self._session.add(user)
        return user


# ======== جلسات الدخول (refresh)

class RefreshSessionRepository:
    """Persistence operations for refresh-token sessions."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_token_hash_for_update(self, token_hash: str) -> RefreshSession | None:
        statement = (
            select(RefreshSession)
            .where(RefreshSession.token_hash == token_hash)
            .with_for_update()
        )
        return self._session.scalar(statement)

    def owner_of_token_hash(self, token_hash: str) -> int | None:
        """صاحب الجلسة بقراءة بلا قفل — لأخذ قفل المستخدم أولًا (ترتيب الأقفال)."""
        return self._session.scalar(select(RefreshSession.user_id).where(RefreshSession.token_hash == token_hash))

    def add(self, refresh_session: RefreshSession) -> RefreshSession:
        self._session.add(refresh_session)
        return refresh_session

    # ------------------------------------------------------------------
    # الإلغاء الجماعي يستخدم وقت قاعدة البيانات لا وقت التطبيق.
    #
    # طلبا refresh متزامنان بنفس الـ token: الأول يدوّر وينشئ جلسة جديدة.
    # لو حسب الثاني `now` قبل أن ينتظر القفل، لختم الجلسة الجديدة حين يلغي
    # العائلة كلها بـ revoked_at أقدم من created_at الخاص بها، فيخرق
    # chk_refresh_sessions_revoked ويرجع 500.
    #
    # UTC_TIMESTAMP(6) يُحسب لحظة تنفيذ العبارة، أي بعد أن تكون أي جلسة
    # منافسة قد أُدخلت — فالقيد يتحقق دائمًا.
    # ------------------------------------------------------------------

    def revoke_family(self, family_id: str, *, reason: str) -> int:
        """يلغي كل جلسة فعّالة في هذه العائلة بعبارة واحدة."""
        statement = (
            update(RefreshSession)
            .where(
                RefreshSession.family_id == family_id,
                RefreshSession.revoked_at.is_(None),
            )
            .values(revoked_at=func.utc_timestamp(6), revoked_reason=reason)
            .execution_options(synchronize_session="fetch")
        )
        result = self._session.execute(statement)
        return int(result.rowcount or 0)

    def revoke_user(self, user_id: int, *, reason: str) -> int:
        """يلغي كل جلسة فعّالة لهذا المستخدم بعبارة واحدة."""
        statement = (
            update(RefreshSession)
            .where(
                RefreshSession.user_id == user_id,
                RefreshSession.revoked_at.is_(None),
            )
            .values(revoked_at=func.utc_timestamp(6), revoked_reason=reason)
            .execution_options(synchronize_session="fetch")
        )
        result = self._session.execute(statement)
        return int(result.rowcount or 0)


# ======== حدود المحاولات

class RateLimitRepository:
    """نافذة ثابتة للحد من المحاولات، مخزّنة في MySQL.

    الذرّية تأتي من `UNIQUE (scope, key_hash)`: العبارة الواحدة
    `INSERT ... ON DUPLICATE KEY UPDATE` إما تنشئ النافذة أو تزيد عدّادها،
    ولا يوجد بينهما فجوة يتسلل منها طلب متزامن. وقفل الصف الذي تأخذه
    العبارة يُمسك حتى نهاية الـ transaction، فالقراءة التالية ترى قيمة
    هذا الطلب لا قيمة طلب آخر.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def consume(
        self,
        *,
        scope: str,
        key_hash: str,
        limit: int,
        window_seconds: int,
        now: datetime,
    ) -> bool:
        """يسجّل محاولة واحدة ويرجع True إذا كانت ضمن الحد المسموح."""
        expires_at = now + timedelta(seconds=window_seconds)

        self._session.execute(
            text(
                """
                INSERT INTO auth_rate_limits
                    (public_id, scope, key_hash, window_started_at,
                     request_count, request_limit, window_seconds, expires_at)
                VALUES
                    (:public_id, :scope, :key_hash, :now,
                     1, :request_limit, :window_seconds, :expires_at)
                ON DUPLICATE KEY UPDATE
                    window_started_at = IF(expires_at <= :now, :now, window_started_at),
                    request_count     = IF(expires_at <= :now, 1, request_count + 1),
                    request_limit     = :request_limit,
                    window_seconds    = :window_seconds,
                    expires_at        = IF(expires_at <= :now, :expires_at, expires_at)
                """
            ),
            {
                "public_id": str(uuid4()),
                "scope": scope,
                "key_hash": key_hash,
                "now": now,
                "request_limit": limit,
                "window_seconds": window_seconds,
                "expires_at": expires_at,
            },
        )

        current = self._session.execute(
            text(
                "SELECT request_count FROM auth_rate_limits "
                "WHERE scope = :scope AND key_hash = :key_hash"
            ),
            {"scope": scope, "key_hash": key_hash},
        ).scalar_one()

        return int(current) <= limit


def consume_rate_limit(
    *,
    scope: str,
    key_hash: str,
    limit: int,
    window_seconds: int,
    now: datetime,
) -> bool:
    """يستهلك محاولة داخل transaction خاصة بها.

    transaction منفصلة عمدًا: العدّاد يجب أن يبقى محفوظًا حتى لو فشلت
    العملية التي استدعته. لو شارك transaction التسجيل مثلاً، لكانت كل
    محاولة فاشلة تُلغي أثرها على العدّاد، وهذا يُفرغ الحماية من معناها.
    """
    with transaction() as session:
        return RateLimitRepository(session).consume(
            scope=scope,
            key_hash=key_hash,
            limit=limit,
            window_seconds=window_seconds,
            now=now,
        )


# ======== الـ outbox

class OutboxRepository:
    """Persistence operations for transactional outbox records."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, event: OutboxEvent) -> OutboxEvent:
        self._session.add(event)
        return event
