"""[إضافة، قرار «و»] إدارة حسابات المرضى للأدمن: القائمة، الإيقاف، وإعادة التفعيل.

Auth تملك الحساب وحالته، فالقائمة والإيقاف هنا. اسم المريض يملكه patient-service
(ملفه الشخصي)، فتُسأل عنه عند كل صفحة ولا يُنسخ إلى هذه القاعدة.

الإيقاف يمنع الدخول: الحالة SUSPENDED مع سبب مكتوب، وكل جلسات المستخدم تُلغى في
نفس الـ transaction. رمز الوصول الذي بيده يبقى صالحًا حتى ينتهي (دقائق،
JWT_ACCESS_TOKEN_MINUTES) لأن الخدمات تتحقق منه محليًا بلا سؤال Auth؛ بعدها لا
تجديد ولا دخول. صاحب الحساب يرى السبب حين يحاول الدخول بكلمة مروره الصحيحة.

صيدليات المنصة لا تُوقف من هنا: لها دورة حالتها في pharmacy-service (إيقاف الصيدلية
مع سبب وإشعار)، وصاحبها يبقى قادرًا على الدخول ليرى السبب.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import func, or_, select

from app.models import OutboxEvent, User
from app.db import transaction
from app.repositories import OutboxRepository, RefreshSessionRepository, UserRepository
from medplat.web import Conflict, DependencyUnavailable, NotFound
from medplat.internal import InternalClient
from medplat.security import Principal
from medplat.util import to_iso_utc

MANAGED_ROLE = "PATIENT"
STATUSES = ("ACTIVE", "SUSPENDED", "DEACTIVATED")
LOOKUP_MAX = 100


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: datetime | None) -> str | None:
    return to_iso_utc(value) if value is not None else None


def view(user: User, *, full_name: str | None) -> dict[str, Any]:
    """ما يراه الأدمن عن مريض: بيانات الحساب واسمه فقط — لا أدوية ولا جرعات ولا طلبات."""
    return {
        "id": user.public_id,
        "full_name": full_name,
        "email": user.email,
        "phone": user.phone,
        "status": user.status,
        "status_reason": user.status_reason,
        "status_changed_at": _iso(user.status_changed_at),
        "created_at": _iso(user.created_at),
    }


def _names(refs: list[str]) -> dict[str, str] | None:
    """أسماء المرضى من patient-service. None إن لم ترد: الحساب وحالته لا يتوقفان على الاسم."""
    if not refs:
        return {}
    try:
        response = InternalClient("patient").post("/internal/v1/patients/lookup", json={"user_refs": refs})
    except DependencyUnavailable:
        return None
    if not response.ok:
        return None
    return {item["user_ref"]: item["full_name"] for item in (response.data or {}).get("items", [])}


def _refs_named(query: str) -> list[str] | None:
    """مراجع من يطابق اسمهم النص. None إن لم ترد patient-service (يبقى البحث بالبريد والهاتف)."""
    try:
        response = InternalClient("patient").post("/internal/v1/patients/search-refs", json={"q": query})
    except DependencyUnavailable:
        return None
    if not response.ok:
        return None
    return list((response.data or {}).get("user_refs", []))


def _with_name(account: dict[str, Any]) -> dict[str, Any]:
    names = _names([account["id"]])
    return {**account, "full_name": (names or {}).get(account["id"])}


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def summary() -> dict[str, int]:
    with transaction() as session:
        rows = session.execute(
            select(User.status, func.count()).where(User.role == MANAGED_ROLE).group_by(User.status)
        ).all()
    counts = {status: 0 for status in STATUSES}
    counts.update({status: int(count) for status, count in rows})
    return counts


def list_patients(*, status: str | None, query: str | None, limit: int, offset: int) -> tuple[list[dict[str, Any]], int, bool]:
    """حسابات المرضى، الأحدث تسجيلًا أولًا. البحث في البريد والهاتف والاسم.

    القيمة الثالثة: هل وصلت الأسماء من patient-service. إن لم تصل تُعرض الحسابات بلا
    أسماء ويقتصر البحث على البريد والهاتف، والواجهة تقول ذلك.
    """
    names_available = True
    conditions = [User.role == MANAGED_ROLE]
    if status:
        conditions.append(User.status == status)
    if query:
        contains = f"%{_escape_like(query)}%"
        matches = [User.email.like(contains, escape="\\"), User.phone.like(contains, escape="\\")]
        named = _refs_named(query)
        if named is None:
            names_available = False
        elif named:
            matches.append(User.public_id.in_(named))
        conditions.append(or_(*matches))
    with transaction() as session:
        total = session.scalar(select(func.count()).select_from(User).where(*conditions)) or 0
        users = session.scalars(
            select(User).where(*conditions).order_by(User.created_at.desc(), User.id.desc()).limit(limit).offset(offset)
        ).all()
        accounts = [view(user, full_name=None) for user in users]
    # خارج الـ transaction: لا اتصال بالقاعدة مفتوح أثناء سؤال خدمة أخرى.
    names = _names([account["id"] for account in accounts])
    if names is None:
        return accounts, int(total), False
    return [{**account, "full_name": names.get(account["id"])} for account in accounts], int(total), names_available


def _event(session, *, user: User, event_type: str, payload: dict[str, Any], principal: Principal, correlation_id: str | None, now: datetime) -> None:
    OutboxRepository(session).add(
        OutboxEvent(
            event_id=str(uuid4()),
            aggregate_type="USER",
            aggregate_id=user.public_id,
            event_type=event_type,
            version=1,
            correlation_id=correlation_id,
            causation_id=None,
            payload={"user_ref": user.public_id, "role": user.role, **payload, "actor": {"ref": principal.user_ref, "role": principal.role}},
            status="PENDING",
            attempts=0,
            occurred_at=now,
        )
    )


def _managed_for_update(session, public_id: str) -> User:
    # القفل نفسه الذي يأخذه Login: إيقاف ودخول متزامنان لا ينتهيان بجلسة جديدة لحساب موقوف.
    user = UserRepository(session).get_by_public_id_for_update(public_id)
    if user is None or user.role != MANAGED_ROLE:
        raise NotFound("Patient account not found.", code="ACCOUNT_NOT_FOUND")
    return user


def suspend(public_id: str, *, reason: str, principal: Principal, correlation_id: str | None) -> dict[str, Any]:
    now = _utc_now()
    with transaction() as session:
        user = _managed_for_update(session, public_id)
        if user.status != "ACTIVE":
            raise Conflict(
                f"Cannot suspend an account whose status is {user.status}.",
                code="ACCOUNT_STATUS_CONFLICT",
                details={"status": user.status},
            )
        user.status = "SUSPENDED"
        user.status_reason = reason
        user.status_changed_at = now
        RefreshSessionRepository(session).revoke_user(user.id, reason="ACCOUNT_SUSPENDED")
        _event(session, user=user, event_type="UserSuspended", payload={"reason": reason}, principal=principal, correlation_id=correlation_id, now=now)
        session.flush()
        account = view(user, full_name=None)
    # الاسم بعد اكتمال الإيقاف وتحرير قفل الصف: تعطل patient-service لا يمنع الإيقاف.
    return _with_name(account)


def reactivate(public_id: str, *, principal: Principal, correlation_id: str | None) -> dict[str, Any]:
    now = _utc_now()
    with transaction() as session:
        user = _managed_for_update(session, public_id)
        if user.status != "SUSPENDED":
            raise Conflict(
                f"Cannot reactivate an account whose status is {user.status}.",
                code="ACCOUNT_STATUS_CONFLICT",
                details={"status": user.status},
            )
        user.status = "ACTIVE"
        user.status_reason = None
        user.status_changed_at = now
        _event(session, user=user, event_type="UserReactivated", payload={}, principal=principal, correlation_id=correlation_id, now=now)
        session.flush()
        account = view(user, full_name=None)
    return _with_name(account)


def contacts(refs: list[str]) -> list[dict[str, Any]]:
    """بريد وهاتف أصحاب حسابات — للخدمات الأخرى (pharmacy: صاحب الصيدلية في صفحة الأدمن)."""
    if not refs:
        return []
    with transaction() as session:
        users = session.scalars(select(User).where(User.public_id.in_(refs))).all()
        return [
            {"user_ref": user.public_id, "email": user.email, "phone": user.phone, "role": user.role, "status": user.status}
            for user in users
        ]
