"""[قرار المستخدم] طلبات للإدارة من المرضى والصيدليات، ورد الأدمن عليها.

نوعان:
- SHORTAGE: دواء موجود في الكتالوج لا يجده صاحب الطلب في الصيدليات (أو لا تجده الصيدلية عند
  الموردين). مرتبط بدواء الكتالوج نفسه.
- NEW_MEDICATION: دواء غير موجود في الكتالوج، باسمه كما كتبه صاحب الطلب وتفاصيل اختيارية.

الأدمن يرد مرة واحدة: RESOLVED («تمت المعالجة»، رد اختياري) أو REJECTED («مرفوض»، سبب إلزامي).
الرد يُنشر حدثًا (MedicationRequestAnswered)، فيصل صاحب الطلب إشعارًا من notification-service.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import catalog
from app.models import database, Medication, MedicationRequest, OutboxEvent
from medplat.events import record_event
from medplat.internal import InternalClient
from medplat.security import Principal, actor_of, resolve_pharmacy_tenant
from medplat.util import utc_now
from medplat.web import Conflict, DependencyUnavailable, NotFound, ValidationFailed

SHORTAGE, NEW_MEDICATION = "SHORTAGE", "NEW_MEDICATION"
OPEN, RESOLVED, REJECTED = "OPEN", "RESOLVED", "REJECTED"
# حد للطلبات المفتوحة لكل حساب: يمنع إغراق الأدمن بطلبات متكررة.
MAX_OPEN_PER_USER = 20


def requester_name(principal: Principal) -> str:
    """اسم صاحب الطلب لحظة الإرسال: الصيدلية (معتمدة فقط) أو المريض (بعد إكمال ملفه)."""
    if principal.is_pharmacy:
        return resolve_pharmacy_tenant(principal).name
    response = InternalClient("patient").get(f"/internal/v1/patients/by-user/{principal.user_ref}")
    if response.status == 404:
        raise Conflict("Complete your patient profile first.", code="PATIENT_PROFILE_REQUIRED")
    if not response.ok:
        raise DependencyUnavailable("The patient service is unavailable.")
    return response.data["full_name"]


def view(request: MedicationRequest, medication: Medication | None, *, for_admin: bool = False) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": request.public_id,
        "request_type": request.request_type,
        "status": request.status,
        "medication": catalog.to_view(medication) if medication is not None else None,
        "medication_name": request.medication_name,
        "details": request.details,
        "note": request.note,
        "admin_reply": request.admin_reply,
        "answered_at": request.answered_at,
        "created_at": request.created_at,
    }
    if for_admin:
        data["requester"] = {
            "user_ref": request.requester_user_ref,
            "role": request.requester_role,
            "name": request.requester_name,
        }
    return data


def subject_of(request: MedicationRequest, medication: Medication | None) -> str:
    """ما يدور عنه الطلب بكلمات قليلة (لنص الإشعار)."""
    if medication is not None:
        return f"{medication.brand_name} {medication.strength}"
    return request.medication_name or ""


def create(principal: Principal, data: dict[str, Any]) -> dict[str, Any]:
    name = requester_name(principal)
    with database.transaction() as session:
        open_count = session.scalar(
            select(func.count())
            .select_from(MedicationRequest)
            .where(MedicationRequest.requester_user_ref == principal.user_ref, MedicationRequest.status == OPEN)
        )
        if open_count >= MAX_OPEN_PER_USER:
            raise Conflict(
                f"You already have {MAX_OPEN_PER_USER} open requests. Wait for the administrator to answer them.",
                code="TOO_MANY_OPEN_REQUESTS",
            )

        medication = None
        if data["request_type"] == SHORTAGE:
            # القفل على صف الدواء: طلبان متزامنان للدواء نفسه من الحساب نفسه لا يمرّان معًا.
            medication = session.scalar(
                select(Medication)
                .where(Medication.public_id == data["medication_id"], Medication.is_active.is_(True))
                .with_for_update()
            )
            if medication is None:
                raise ValidationFailed("Request validation failed.", details={"medication_id": "Unknown medication."})
            duplicate = session.scalar(
                select(MedicationRequest.id).where(
                    MedicationRequest.requester_user_ref == principal.user_ref,
                    MedicationRequest.medication_id == medication.id,
                    MedicationRequest.status == OPEN,
                )
            )
            if duplicate:
                raise Conflict("You already have an open request for this medication.", code="REQUEST_ALREADY_OPEN")

        request = MedicationRequest(
            request_type=data["request_type"],
            requester_user_ref=principal.user_ref,
            requester_role=principal.role,
            requester_name=name,
            medication_id=medication.id if medication is not None else None,
            medication_name=data.get("medication_name") if medication is None else None,
            details=data.get("details") if medication is None else None,
            note=data.get("note"),
        )
        session.add(request)
        session.flush()
        session.refresh(request)
        record_event(
            session,
            OutboxEvent,
            event_type="MedicationRequestCreated",
            aggregate_type="MEDICATION_REQUEST",
            aggregate_id=request.public_id,
            payload={
                "request_ref": request.public_id,
                "request_type": request.request_type,
                "requester_role": request.requester_role,
                "subject": subject_of(request, medication),
                "actor": actor_of(principal),
            },
        )
        return view(request, medication)


def _query(session: Session, conditions: list, *, limit: int, offset: int) -> tuple[list[tuple[MedicationRequest, Medication | None]], int]:
    total = session.scalar(select(func.count()).select_from(MedicationRequest).where(*conditions)) or 0
    rows = session.execute(
        select(MedicationRequest, Medication)
        .outerjoin(Medication, Medication.id == MedicationRequest.medication_id)
        .where(*conditions)
        .order_by(MedicationRequest.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [(request, medication) for request, medication in rows], int(total)


def list_own(principal: Principal, *, status: str | None, limit: int, offset: int) -> tuple[list[dict[str, Any]], int]:
    conditions = [MedicationRequest.requester_user_ref == principal.user_ref]
    if status:
        conditions.append(MedicationRequest.status == status)
    with database.transaction() as session:
        rows, total = _query(session, conditions, limit=limit, offset=offset)
        return [view(request, medication) for request, medication in rows], total


def list_all(*, status: str | None, request_type: str | None, limit: int, offset: int) -> tuple[list[dict[str, Any]], int]:
    conditions = []
    if status:
        conditions.append(MedicationRequest.status == status)
    if request_type:
        conditions.append(MedicationRequest.request_type == request_type)
    with database.transaction() as session:
        rows, total = _query(session, conditions, limit=limit, offset=offset)
        return [view(request, medication, for_admin=True) for request, medication in rows], total


def summary() -> dict[str, int]:
    """عدد الطلبات في كل حالة (للأدمن: تبويبات الصفحة وبطاقة اللوحة)."""
    with database.transaction() as session:
        rows = session.execute(
            select(MedicationRequest.status, func.count()).group_by(MedicationRequest.status)
        ).all()
    counts = {OPEN: 0, RESOLVED: 0, REJECTED: 0}
    counts.update({status: int(n) for status, n in rows})
    return counts


def answer(public_id: str, status: str, reply: str | None, principal: Principal) -> dict[str, Any]:
    """رد الأدمن: مرة واحدة فقط، من OPEN إلى RESOLVED أو REJECTED."""
    with database.transaction() as session:
        request = session.scalar(
            select(MedicationRequest).where(MedicationRequest.public_id == public_id).with_for_update()
        )
        if request is None:
            raise NotFound("Request not found.", code="REQUEST_NOT_FOUND")
        if request.status != OPEN:
            raise Conflict("This request has already been answered.", code="REQUEST_ALREADY_ANSWERED")
        medication = session.get(Medication, request.medication_id) if request.medication_id else None
        request.status = status
        request.admin_reply = reply
        request.answered_by_ref = principal.user_ref
        request.answered_at = utc_now()
        session.flush()
        session.refresh(request)
        record_event(
            session,
            OutboxEvent,
            event_type="MedicationRequestAnswered",
            aggregate_type="MEDICATION_REQUEST",
            aggregate_id=request.public_id,
            payload={
                "request_ref": request.public_id,
                "request_type": request.request_type,
                "requester_user_ref": request.requester_user_ref,
                "requester_role": request.requester_role,
                "status": request.status,
                "admin_reply": request.admin_reply,
                "subject": subject_of(request, medication),
                "actor": actor_of(principal),
            },
        )
        return view(request, medication, for_admin=True)
