"""منطق الكتالوج: البحث، الإضافة، التعديل، والاستعلام الداخلي."""

from __future__ import annotations

from typing import Any

from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import database, Medication, OutboxEvent
from medplat.db import is_duplicate_key
from medplat.web import Conflict, NotFound
from medplat.util import plain_decimal
from medplat.events import record_event
from medplat.security import Principal, actor_of

CREATE_FIELDS = (
    "brand_name",
    "generic_name",
    "strength",
    "dosage_form",
    "category",
    "manufacturer",
    "pack_size",
    "pack_unit",
    "description",
)
EDITABLE_FIELDS = (*CREATE_FIELDS, "is_active")


def to_view(medication: Medication, *, include_status: bool = False) -> dict[str, Any]:
    view: dict[str, Any] = {
        "id": medication.public_id,
        "brand_name": medication.brand_name,
        "generic_name": medication.generic_name,
        "strength": medication.strength,
        "dosage_form": medication.dosage_form,
        "category": medication.category,
        "manufacturer": medication.manufacturer,
        "pack_size": plain_decimal(medication.pack_size),
        "pack_unit": medication.pack_unit,
        "description": medication.description,
    }
    if include_status:
        view["is_active"] = medication.is_active
        view["created_at"] = medication.created_at
        view["updated_at"] = medication.updated_at
    return view


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search(
    *,
    query: str | None,
    dosage_form: str | None,
    include_inactive: bool,
    limit: int,
    offset: int,
    category: str | None = None,
) -> tuple[list[Medication], int]:
    conditions = []
    if not include_inactive:
        conditions.append(Medication.is_active.is_(True))
    if dosage_form:
        conditions.append(Medication.dosage_form == dosage_form)
    if category:
        conditions.append(Medication.category == category)

    order = [Medication.brand_name, Medication.strength]
    if query:
        term = _escape_like(query)
        contains = f"%{term}%"
        conditions.append(
            or_(
                Medication.brand_name.like(contains, escape="\\"),
                Medication.generic_name.like(contains, escape="\\"),
                # اسم الشركة المصنّعة أيضًا: «يونيفارما» تعرض أدويتها.
                Medication.manufacturer.like(contains, escape="\\"),
            )
        )
        # ما يبدأ بالكلمة المطلوبة يظهر قبل ما يحتويها في وسطه.
        starts = case(
            (
                or_(
                    Medication.brand_name.like(f"{term}%", escape="\\"),
                    Medication.generic_name.like(f"{term}%", escape="\\"),
                ),
                0,
            ),
            else_=1,
        )
        order.insert(0, starts)

    with database.transaction() as session:
        total = session.scalar(select(func.count()).select_from(Medication).where(*conditions)) or 0
        items = session.scalars(
            # id في النهاية: مفتاح ترتيب فريد، وإلا تبدّل ترتيب الصفوف المتعادلة بين
            # الصفحات فيظهر دواء مرتين أو لا يظهر أبدًا.
            select(Medication).where(*conditions).order_by(*order, Medication.id).limit(limit).offset(offset)
        ).all()
    return list(items), int(total)


def category_counts() -> dict[str, int]:
    """عدد الأدوية النشطة في كل تصنيف (التصنيف الفارغ لا يظهر)."""
    with database.transaction() as session:
        rows = session.execute(
            select(Medication.category, func.count()).where(Medication.is_active.is_(True)).group_by(Medication.category)
        ).all()
    return {category: int(count) for category, count in rows}


def get(public_id: str, *, include_inactive: bool) -> Medication:
    with database.transaction() as session:
        medication = session.scalar(select(Medication).where(Medication.public_id == public_id))
    if medication is None or (not medication.is_active and not include_inactive):
        raise NotFound("Medication not found.", code="MEDICATION_NOT_FOUND")
    return medication


def alternatives_of(session: Session, medications: list[Medication]) -> dict[str, list[Medication]]:
    """[قرار المستخدم] بدائل كل دواء: الأدوية **النشطة** بنفس بصمة التركيبة (composition.py)، غيره هو.

    نفس المواد ونفس كمية كل مادة ونفس الشكل؛ الاسم والشركة وحجم العلبة لا تهم. استعلام واحد
    لكل القائمة عبر الفهرس (is_active, composition_key).
    """
    keys = {m.composition_key for m in medications}
    if not keys:
        return {}
    rows = session.scalars(
        select(Medication)
        .where(Medication.is_active.is_(True), Medication.composition_key.in_(keys))
        .order_by(Medication.brand_name, Medication.strength, Medication.id)
    ).all()
    return {
        m.public_id: [row for row in rows if row.composition_key == m.composition_key and row.id != m.id]
        for m in medications
    }


def alternatives(public_id: str, *, include_inactive: bool) -> tuple[Medication, list[Medication]]:
    medication = get(public_id, include_inactive=include_inactive)
    with database.transaction() as session:
        found = alternatives_of(session, [medication])
    return medication, found[medication.public_id]


def _duplicate() -> Conflict:
    return Conflict(
        "A medication with the same brand name, strength and dosage form already exists.",
        code="MEDICATION_ALREADY_EXISTS",
    )


def create(data: dict[str, Any], principal: Principal) -> Medication:
    medication = Medication(**data)
    try:
        with database.transaction() as session:
            session.add(medication)
            session.flush()
            record_event(
                session,
                OutboxEvent,
                event_type="MedicationCreated",
                aggregate_type="MEDICATION",
                aggregate_id=medication.public_id,
                payload={
                    "medication_ref": medication.public_id,
                    "brand_name": medication.brand_name,
                    "generic_name": medication.generic_name,
                    "strength": medication.strength,
                    "dosage_form": medication.dosage_form,
                    "actor": actor_of(principal),
                },
            )
    except IntegrityError as exc:
        if is_duplicate_key(exc, "uq_medications_identity"):
            raise _duplicate() from exc
        raise
    # القيم الافتراضية من الخادم (is_active، created_at) تُقرأ بعد الحفظ.
    return get(medication.public_id, include_inactive=True)


def update(public_id: str, changes: dict[str, Any], principal: Principal) -> Medication:
    try:
        with database.transaction() as session:
            medication = session.scalar(
                select(Medication).where(Medication.public_id == public_id).with_for_update()
            )
            if medication is None:
                raise NotFound("Medication not found.", code="MEDICATION_NOT_FOUND")

            changed = [field for field, value in changes.items() if getattr(medication, field) != value]
            for field in changed:
                setattr(medication, field, changes[field])

            if changed:
                session.flush()
                record_event(
                    session,
                    OutboxEvent,
                    event_type="MedicationUpdated",
                    aggregate_type="MEDICATION",
                    aggregate_id=medication.public_id,
                    payload={
                        "medication_ref": medication.public_id,
                        "changed_fields": changed,
                        "is_active": medication.is_active,
                        "actor": actor_of(principal),
                    },
                )
    except IntegrityError as exc:
        if is_duplicate_key(exc, "uq_medications_identity"):
            raise _duplicate() from exc
        raise
    return get(public_id, include_inactive=True)


def lookup(session: Session, public_ids: list[str]) -> list[Medication]:
    """للخدمات الأخرى: يرجع الموجود فقط، والمتصل يقرر معنى الغياب."""
    if not public_ids:
        return []
    return list(session.scalars(select(Medication).where(Medication.public_id.in_(public_ids))).all())
