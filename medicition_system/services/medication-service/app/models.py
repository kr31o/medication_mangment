"""قاعدة medication_db: الاتصال بها، وجداولها كأصناف Python (كل صنف جدول، وكل خاصية عمود).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, event, ForeignKey, Index, text, UniqueConstraint
from sqlalchemy.dialects.mysql import BIGINT, CHAR, DECIMAL, VARCHAR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from medplat.config import database_settings
from medplat.db import created_at_column, Database, id_column, public_id_column, ref_column, updated_at_column, utc_datetime
from medplat.events import define_outbox_model

from app.composition import composition_key


# ======== الاتصال بالقاعدة، وجدولا الأحداث (outbox / inbox)
# قاعدة بيانات medication-service وجدول الـ outbox الخاص بها.

class Base(DeclarativeBase):
    pass


database = Database(database_settings("MEDICATION"))
OutboxEvent = define_outbox_model(Base, "medication")


# ======== جداول الخدمة
# medication_db: كتالوج الأدوية (FR-MED-01..06).
#
# الكتالوج يصف الدواء فقط. كم علبة منه في صيدلية ما وبكم تُباع فهذا
# ملك inventory-service (BR-007). لذلك لا يوجد هنا أي عمود كمية أو سعر.

DOSAGE_FORMS = (
    "TABLET",
    "CAPSULE",
    "SYRUP",
    "SUSPENSION",
    "INJECTION",
    "CREAM",
    "OINTMENT",
    "GEL",
    "DROPS",
    "INHALER",
    "SUPPOSITORY",
    "PATCH",
    "SACHET",
    "OTHER",
)

# [إضافة] التصنيف العلاجي: قائمة ثابتة يختار منها الأدمن تصنيف كل دواء. يصف الفئة
# فقط (كما في الوصف)، لا دواعي استعمال ولا نصيحة. المخزون لا يخزّنه: الصنف في مخزون
# صيدلية يأخذ تصنيفه من دواء الكتالوج، فتبقى الصيدليات كلها على تصنيف واحد.
CATEGORIES = (
    "ANALGESIC",
    "ANTIBIOTIC",
    "CARDIOVASCULAR",
    "DIABETES",
    "RESPIRATORY",
    "GASTROINTESTINAL",
    "ALLERGY",
    "VITAMINS",
    "DERMATOLOGY",
    "NEUROLOGY",
    "HORMONAL",
    "EYE_ENT",
    "MUSCULOSKELETAL",
    "OTHER",
)

# [إضافة] وحدة العدّ داخل العلبة. المخزون يُعدّ بالعلب، أما سجل المريض
# في health-service فيُعدّ بالوحدات (أقراص، مل...) حتى يعرف متى تنفد
# الكمية. بدون pack_size لا يمكن تحويل "علبتين" إلى "40 قرصًا".
PACK_UNITS = ("TABLET", "CAPSULE", "ML", "G", "DOSE", "PIECE")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class Medication(Base):
    __tablename__ = "medications"

    id: Mapped[int] = id_column()
    public_id: Mapped[str] = public_id_column()
    brand_name: Mapped[str] = mapped_column(VARCHAR(150), nullable=False)
    generic_name: Mapped[str] = mapped_column(VARCHAR(150), nullable=False)
    strength: Mapped[str] = mapped_column(VARCHAR(50), nullable=False)
    dosage_form: Mapped[str] = mapped_column(VARCHAR(24), nullable=False)
    category: Mapped[str] = mapped_column(VARCHAR(24), nullable=False, server_default=text("'OTHER'"))
    # [إضافة، قرار «هـ»] الشركة المصنّعة كما تُكتب على العلبة (كتالوج الأدوية السورية).
    # للعرض والبحث فقط؛ ليست جزءًا من هوية الدواء (الاسم والتركيز والشكل).
    manufacturer: Mapped[str | None] = mapped_column(VARCHAR(120), nullable=True)
    pack_size: Mapped[Decimal] = mapped_column(DECIMAL(10, 2), nullable=False)
    pack_unit: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    description: Mapped[str | None] = mapped_column(VARCHAR(2000), nullable=True)
    # [قرار المستخدم] بصمة التركيبة (composition.py): المادة أو المواد، كمية كل منها، والشكل ونوع التحرر.
    # دواءان بنفس البصمة بديلان لبعضهما. تُحسب هنا عند كل حفظ، لا يكتبها أحد بيده.
    composition_key: Mapped[str] = mapped_column(CHAR(40, charset="ascii", collation="ascii_bin"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    __table_args__ = (
        UniqueConstraint("public_id", name="uq_medications_public_id"),
        # نفس الاسم التجاري والتركيز والشكل = نفس الدواء. الـ collation
        # الافتراضي (utf8mb4_0900_ai_ci) يجعل المقارنة غير حساسة لحالة
        # الأحرف، فـ "Panadol" و "PANADOL" لا يصبحان دواءين.
        UniqueConstraint("brand_name", "strength", "dosage_form", name="uq_medications_identity"),
        Index("idx_medications_active_brand", "is_active", "brand_name"),
        Index("idx_medications_active_generic", "is_active", "generic_name"),
        Index("idx_medications_active_category", "is_active", "category"),
        Index("idx_medications_active_composition", "is_active", "composition_key"),
        CheckConstraint(_in("dosage_form", DOSAGE_FORMS), name="chk_medications_dosage_form"),
        CheckConstraint(_in("category", CATEGORIES), name="chk_medications_category"),
        CheckConstraint(_in("pack_unit", PACK_UNITS), name="chk_medications_pack_unit"),
        CheckConstraint("pack_size > 0", name="chk_medications_pack_size"),
        CheckConstraint("CHAR_LENGTH(TRIM(brand_name)) > 0", name="chk_medications_brand_name"),
        CheckConstraint("CHAR_LENGTH(TRIM(generic_name)) > 0", name="chk_medications_generic_name"),
        CheckConstraint("CHAR_LENGTH(TRIM(strength)) > 0", name="chk_medications_strength"),
    )



# [قرار المستخدم] طلبات للإدارة من المرضى والصيدليات.
REQUEST_TYPES = ("SHORTAGE", "NEW_MEDICATION")
REQUEST_STATUSES = ("OPEN", "RESOLVED", "REJECTED")
REQUESTER_ROLES = ("PATIENT", "PHARMACY")


class MedicationRequest(Base):
    """طلب للإدارة: دواء من الكتالوج ناقص في السوق (SHORTAGE)، أو دواء غير موجود في الكتالوج
    (NEW_MEDICATION). الأدمن يرد مرة واحدة: RESOLVED أو REJECTED بسبب، ويصل الرد صاحبه إشعارًا.

    اسم صاحب الطلب يُحفظ لحظة الإرسال (اسم المريض أو الصيدلية) لتعرضه قائمة الأدمن بلا سؤال
    خدمتين أخريين عن كل سطر.
    """

    __tablename__ = "medication_requests"

    id: Mapped[int] = id_column()
    public_id: Mapped[str] = public_id_column()
    request_type: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    requester_user_ref: Mapped[str] = ref_column()
    requester_role: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    requester_name: Mapped[str] = mapped_column(VARCHAR(150), nullable=False)
    medication_id: Mapped[int | None] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("medications.id", name="fk_medication_requests_medication", ondelete="RESTRICT"),
        nullable=True,
    )
    medication_name: Mapped[str | None] = mapped_column(VARCHAR(150), nullable=True)
    details: Mapped[str | None] = mapped_column(VARCHAR(300), nullable=True)
    note: Mapped[str | None] = mapped_column(VARCHAR(500), nullable=True)
    status: Mapped[str] = mapped_column(VARCHAR(16), nullable=False, server_default=text("'OPEN'"))
    admin_reply: Mapped[str | None] = mapped_column(VARCHAR(500), nullable=True)
    answered_by_ref: Mapped[str | None] = ref_column(nullable=True)
    answered_at: Mapped[datetime | None] = utc_datetime()
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    __table_args__ = (
        UniqueConstraint("public_id", name="uq_medication_requests_public_id"),
        Index("idx_medication_requests_requester", "requester_user_ref", "id"),
        Index("idx_medication_requests_status", "status", "id"),
        CheckConstraint(_in("request_type", REQUEST_TYPES), name="chk_medication_requests_type"),
        CheckConstraint(_in("status", REQUEST_STATUSES), name="chk_medication_requests_status"),
        CheckConstraint(_in("requester_role", REQUESTER_ROLES), name="chk_medication_requests_role"),
        CheckConstraint(
            "(request_type = 'SHORTAGE' AND medication_id IS NOT NULL AND medication_name IS NULL) OR "
            "(request_type = 'NEW_MEDICATION' AND medication_id IS NULL AND medication_name IS NOT NULL "
            "AND CHAR_LENGTH(TRIM(medication_name)) > 0)",
            name="chk_medication_requests_subject",
        ),
        CheckConstraint(
            "(status = 'OPEN' AND answered_at IS NULL AND answered_by_ref IS NULL) OR "
            "(status <> 'OPEN' AND answered_at IS NOT NULL AND answered_by_ref IS NOT NULL)",
            name="chk_medication_requests_answer",
        ),
        CheckConstraint(
            "status <> 'REJECTED' OR (admin_reply IS NOT NULL AND CHAR_LENGTH(TRIM(admin_reply)) > 0)",
            name="chk_medication_requests_reject_reason",
        ),
    )


@event.listens_for(Medication, "before_insert")
@event.listens_for(Medication, "before_update")
def _set_composition_key(_mapper, _connection, medication: Medication) -> None:
    """البصمة تتبع التركيبة دائمًا: إضافة، أو تعديل المادة أو الكمية أو الشكل."""
    medication.composition_key = composition_key(
        medication.generic_name, medication.strength, medication.dosage_form, medication.brand_name
    )
