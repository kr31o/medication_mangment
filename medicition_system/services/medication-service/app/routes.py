"""واجهات medication-service.

    GET   /api/v1/medications                 بحث بالاسم والتصنيف (كل الأدوار الموثقة)   FR-MED-02
                                              with_alternatives=true: ومع كل نتيجة بدائلها [قرار المستخدم]
    GET   /api/v1/medications/categories      التصنيفات وعدد الأدوية النشطة في كل منها
    GET   /api/v1/medications/<id>            تفاصيل دواء                 FR-MED-03/04
    GET   /api/v1/medications/<id>/alternatives  بدائله: نفس التركيبة والشكل، اسم أو شركة أخرى  [قرار المستخدم]
    POST  /api/v1/admin/medications           إضافة (ADMIN)              FR-MED-01
    PATCH /api/v1/admin/medications/<id>      تعديل/تعطيل (ADMIN)        FR-MED-05

[قرار المستخدم] طلبات للإدارة (medication_requests.py):
    POST  /api/v1/medication-requests                 مريض أو صيدلية: دواء ناقص أو دواء جديد
    GET   /api/v1/medication-requests                 طلباتي وردود الإدارة عليها
    GET   /api/v1/admin/medication-requests           كل الطلبات (ADMIN)، بالحالة والنوع
    GET   /api/v1/admin/medication-requests/summary   عددها في كل حالة
    POST  /api/v1/admin/medication-requests/<id>/resolve   «تمت المعالجة»، برد اختياري
    POST  /api/v1/admin/medication-requests/<id>/reject    «مرفوض»، بسبب إلزامي

    POST  /internal/v1/medications/lookup     للخدمات الأخرى: بيانات أدوية بالمعرّفات
    POST  /internal/v1/medications/search-ids للخدمات الأخرى: معرّفات أدوية تطابق نصًا أو تصنيفًا
    POST  /internal/v1/medications/alternatives  للخدمات الأخرى: بدائل دواء، أو بدائل ما يطابق نصًا
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from flask import Blueprint, request

from app import catalog, medication_requests
from app.models import CATEGORIES, database, DOSAGE_FORMS, PACK_UNITS, REQUEST_STATUSES, REQUEST_TYPES
from medplat.web import created, Forbidden, ok, page, ValidationFailed
from medplat.internal import require_internal
from medplat.security import current_principal, require_auth
from medplat.validation import Fields, json_body, page_params

public = Blueprint("medications", __name__, url_prefix="/api/v1/medications")
admin = Blueprint("medications_admin", __name__, url_prefix="/api/v1/admin/medications")
internal = Blueprint("medications_internal", __name__, url_prefix="/internal/v1/medications")
requests_public = Blueprint("medication_requests", __name__, url_prefix="/api/v1/medication-requests")
requests_admin = Blueprint("medication_requests_admin", __name__, url_prefix="/api/v1/admin/medication-requests")

_SEARCH_PARAMS = ("q", "dosage_form", "category", "include_inactive", "with_alternatives", "limit", "offset")
_MAX_PACK_SIZE = Decimal("100000")


def _read_fields(fields: Fields, *, required: bool) -> dict[str, Any]:
    return {
        "brand_name": fields.string("brand_name", required=required, max_len=150, collapse_spaces=True),
        "generic_name": fields.string("generic_name", required=required, max_len=150, collapse_spaces=True),
        "strength": fields.string("strength", required=required, max_len=50, collapse_spaces=True),
        "dosage_form": fields.choice("dosage_form", DOSAGE_FORMS, required=required),
        # اختياري عند الإضافة: دواء بلا تصنيف يدخل «أخرى» (والواجهة تطلب اختياره).
        "category": fields.choice("category", CATEGORIES, required=False, default="OTHER" if required else None),
        "manufacturer": fields.string("manufacturer", required=False, max_len=120, collapse_spaces=True),
        "pack_size": fields.decimal(
            "pack_size", required=required, minimum=Decimal("0.01"), maximum=_MAX_PACK_SIZE
        ),
        "pack_unit": fields.choice("pack_unit", PACK_UNITS, required=required),
        "description": fields.string("description", required=False, max_len=2000),
    }


@public.get("")
@require_auth()
def search_medications():
    principal = current_principal()
    fields = Fields(request.args, allowed=_SEARCH_PARAMS)
    query = fields.string("q", required=False, max_len=100)
    dosage_form = fields.choice("dosage_form", DOSAGE_FORMS, required=False)
    category = fields.choice("category", CATEGORIES, required=False)
    include_inactive = fields.boolean("include_inactive", required=False, default=False)
    # [قرار المستخدم] مع كل نتيجة بدائلها بنفس التركيبة (النشطة)، لتُعرض تحتها في القائمة.
    with_alternatives = fields.boolean("with_alternatives", required=False, default=False)
    fields.raise_if_invalid()
    if include_inactive and not principal.is_admin:
        raise Forbidden("Only administrators can list inactive medications.")

    limit, offset = page_params()
    items, total = catalog.search(
        query=query,
        dosage_form=dosage_form,
        category=category,
        include_inactive=bool(include_inactive),
        limit=limit,
        offset=offset,
    )
    views = [catalog.to_view(m, include_status=principal.is_admin) for m in items]
    if with_alternatives:
        with database.transaction() as session:
            found = catalog.alternatives_of(session, items)
        for view, medication in zip(views, items):
            view["alternatives"] = [catalog.to_view(m) for m in found.get(medication.public_id, [])]
    return page(views, total=total, limit=limit, offset=offset)


@public.get("/categories")
@require_auth()
def list_categories():
    """التصنيفات بترتيبها الثابت، مع عدد الأدوية النشطة في كل منها."""
    counts = catalog.category_counts()
    return ok([{"category": category, "medications": counts.get(category, 0)} for category in CATEGORIES])


@public.get("/<uuid:medication_id>")
@require_auth()
def get_medication(medication_id):
    principal = current_principal()
    medication = catalog.get(str(medication_id), include_inactive=principal.is_admin)
    return ok(catalog.to_view(medication, include_status=principal.is_admin))


@public.get("/<uuid:medication_id>/alternatives")
@require_auth()
def get_alternatives(medication_id):
    """بدائل دواء بنفس التركيبة (النشطة فقط). أين تتوفر قريبًا: pharmacy-service."""
    principal = current_principal()
    medication, found = catalog.alternatives(str(medication_id), include_inactive=principal.is_admin)
    return ok(
        {
            "medication": catalog.to_view(medication, include_status=principal.is_admin),
            "items": [catalog.to_view(m) for m in found],
        }
    )


@admin.post("")
@require_auth("ADMIN")
def create_medication():
    fields = Fields(json_body(), allowed=catalog.CREATE_FIELDS)
    data = _read_fields(fields, required=True)
    fields.raise_if_invalid()
    medication = catalog.create(data, current_principal())
    return created(catalog.to_view(medication, include_status=True))


@admin.patch("/<uuid:medication_id>")
@require_auth("ADMIN")
def update_medication(medication_id):
    body = json_body()
    fields = Fields(body, allowed=catalog.EDITABLE_FIELDS)
    values = _read_fields(fields, required=False)
    values["is_active"] = fields.boolean("is_active", required=False)
    fields.raise_if_invalid()

    changes = {key: value for key, value in values.items() if key in body and value is not None}
    # الحقلان الاختياريان يُمسحان بإرسالهما فارغين أو null.
    for optional in ("description", "manufacturer"):
        if optional in body and (body[optional] is None or (isinstance(body[optional], str) and not body[optional].strip())):
            changes[optional] = None
    if not changes:
        raise ValidationFailed("Request validation failed.", details={"body": "No changes supplied."})
    medication = catalog.update(str(medication_id), changes, current_principal())
    return ok(catalog.to_view(medication, include_status=True))


@internal.post("/lookup")
@require_internal
def lookup_medications():
    fields = Fields(json_body(), allowed=("ids",))
    raw_ids = fields.items("ids", max_items=100)
    ids: list[str] = []
    for index, raw in enumerate(raw_ids):
        child = Fields({"id": raw}, prefix=f"ids[{index}].")
        value = child.uuid("id")
        fields.absorb(child)
        if value:
            ids.append(value)
    fields.raise_if_invalid()

    with database.transaction() as session:
        found = catalog.lookup(session, ids)
    return ok({"items": [catalog.to_view(m, include_status=True) for m in found]})


# كم دواءً يطابق النص نبحث عن بدائله (صفحة صيدلية لا تعرض ما كتبه المريض).
_ALTERNATIVES_FOR_TEXT = 5


@internal.post("/alternatives")
@require_internal
def internal_alternatives():
    """بدائل دواء بمعرّفه، أو بدائل أول الأدوية التي تطابق نصًا.

    الجواب: {"items": [{"medication": ..., "alternatives": [...]}]} — دواء واحد بالمعرّف، أو حتى
    خمسة بالنص (النشطة فقط، بترتيب البحث نفسه). المتصل يقرر أين يبحث عن توفرها.
    """
    fields = Fields(json_body(), allowed=("medication_id", "q"))
    medication_id = fields.uuid("medication_id", required=False)
    query = fields.string("q", required=False, max_len=100)
    if bool(medication_id) == bool(query) and not fields.errors:
        fields.errors["medication_id"] = "Provide exactly one of medication_id or q."
    fields.raise_if_invalid()

    if medication_id:
        medication, found = catalog.alternatives(medication_id, include_inactive=False)
        return ok({"items": [{"medication": catalog.to_view(medication), "alternatives": [catalog.to_view(m) for m in found]}]})
    matched, _ = catalog.search(
        query=query, dosage_form=None, category=None, include_inactive=False, limit=_ALTERNATIVES_FOR_TEXT, offset=0
    )
    with database.transaction() as session:
        found = catalog.alternatives_of(session, matched)
    return ok(
        {
            "items": [
                {"medication": catalog.to_view(m), "alternatives": [catalog.to_view(a) for a in found[m.public_id]]}
                for m in matched
            ]
        }
    )


@internal.post("/search-ids")
@require_internal
def search_ids():
    """معرّفات الأدوية المطابقة لنص أو تصنيف — لتصفية المخزون دون نسخ الأسماء والتصنيفات إليه."""
    fields = Fields(json_body(), allowed=("q", "category", "limit"))
    query = fields.string("q", required=False, max_len=100)
    category = fields.choice("category", CATEGORIES, required=False)
    limit = fields.integer("limit", required=False, minimum=1, maximum=500, default=500)
    if not query and not category and not fields.errors:
        fields.errors["q"] = "Provide q or category."
    fields.raise_if_invalid()
    items, _ = catalog.search(
        query=query, dosage_form=None, category=category, include_inactive=True, limit=limit, offset=0
    )
    return ok({"ids": [m.public_id for m in items]})


# ======== [قرار المستخدم] طلبات للإدارة


@requests_public.post("")
@require_auth("PATIENT", "PHARMACY")
def create_request():
    body = json_body()
    fields = Fields(body, allowed=("request_type", "medication_id", "medication_name", "details", "note"))
    request_type = fields.choice("request_type", REQUEST_TYPES)
    data: dict[str, Any] = {"request_type": request_type}
    if request_type == medication_requests.SHORTAGE:
        data["medication_id"] = fields.uuid("medication_id")
        for key in ("medication_name", "details"):
            if key in body:
                fields.errors[key] = "Only a NEW_MEDICATION request takes this field."
    elif request_type == medication_requests.NEW_MEDICATION:
        data["medication_name"] = fields.string("medication_name", min_len=2, max_len=150, collapse_spaces=True)
        data["details"] = fields.string("details", required=False, max_len=300, collapse_spaces=True)
        if "medication_id" in body:
            fields.errors["medication_id"] = "Only a SHORTAGE request takes a catalog medication."
    data["note"] = fields.string("note", required=False, max_len=500)
    fields.raise_if_invalid()
    return created(medication_requests.create(current_principal(), data))


@requests_public.get("")
@require_auth("PATIENT", "PHARMACY")
def list_my_requests():
    fields = Fields(request.args, allowed=("status", "limit", "offset"))
    status = fields.choice("status", REQUEST_STATUSES, required=False)
    fields.raise_if_invalid()
    limit, offset = page_params()
    items, total = medication_requests.list_own(current_principal(), status=status, limit=limit, offset=offset)
    return page(items, total=total, limit=limit, offset=offset)


@requests_admin.get("")
@require_auth("ADMIN")
def list_requests():
    fields = Fields(request.args, allowed=("status", "request_type", "limit", "offset"))
    status = fields.choice("status", REQUEST_STATUSES, required=False)
    request_type = fields.choice("request_type", REQUEST_TYPES, required=False)
    fields.raise_if_invalid()
    limit, offset = page_params()
    items, total = medication_requests.list_all(status=status, request_type=request_type, limit=limit, offset=offset)
    return page(items, total=total, limit=limit, offset=offset)


@requests_admin.get("/summary")
@require_auth("ADMIN")
def requests_summary():
    return ok(medication_requests.summary())


@requests_admin.post("/<uuid:request_id>/resolve")
@require_auth("ADMIN")
def resolve_request(request_id):
    fields = Fields(json_body(), allowed=("reply",))
    reply = fields.string("reply", required=False, max_len=500)
    fields.raise_if_invalid()
    return ok(medication_requests.answer(str(request_id), medication_requests.RESOLVED, reply, current_principal()))


@requests_admin.post("/<uuid:request_id>/reject")
@require_auth("ADMIN")
def reject_request(request_id):
    fields = Fields(json_body(), allowed=("reply",))
    reply = fields.string("reply", min_len=3, max_len=500)
    fields.raise_if_invalid()
    return ok(medication_requests.answer(str(request_id), medication_requests.REJECTED, reply, current_principal()))
