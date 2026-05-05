from flask import Blueprint, request
from flask_jwt_extended import jwt_required
from app.services.medication_service import MedicationService
from app.validators.medication_validators import (
    validate_add_patient_medication, validate_update_patient_medication,
    validate_activate_patient_medication, validate_dosage_schedule,
)
from app.utils.helpers import success_response, pagination_args
from app.utils.guards import role_required, get_current_patient_id

medication_bp = Blueprint("medication", __name__, url_prefix="/api/medications")
_svc = MedicationService()


@medication_bp.get("/categories")
def categories():
    return success_response(_svc.categories())


@medication_bp.get("")
@medication_bp.get("/")
@jwt_required()
@role_required("patient", "admin")
def list_medications():
    page, per_page = pagination_args(request.args, default_per_page=20, max_per_page=500)
    query = request.args.get("q", "").strip()
    category = request.args.get("category", "").strip()
    if query:
        data = _svc.search_medication(query, page, per_page)
    elif category:
        data = _svc.browse_by_category(category, page, per_page)
    else:
        data = _svc.get_all_medications(page, per_page)
    return success_response(data)


@medication_bp.get("/my")
@jwt_required()
@role_required("patient")
def my_medications():
    return success_response(_svc.get_patient_medications(get_current_patient_id(), request.args.get("status")))


@medication_bp.post("/my")
@jwt_required()
@role_required("patient")
def add_my_medication():
    data = validate_add_patient_medication(request.get_json(silent=True) or {})
    result = _svc.add_patient_medication(get_current_patient_id(), data)
    return success_response(result, "تمت إضافة الدواء إلى حسابك.", 201)


@medication_bp.patch("/my/<int:patient_med_id>")
@jwt_required()
@role_required("patient")
def update_my_medication(patient_med_id: int):
    data = validate_update_patient_medication(request.get_json(silent=True) or {})
    result = _svc.update_patient_medication(get_current_patient_id(), patient_med_id, data)
    return success_response(result, "تم تعديل بيانات الدواء.")


@medication_bp.post("/my/<int:patient_med_id>/stop")
@jwt_required()
@role_required("patient")
def stop_my_medication(patient_med_id: int):
    result = _svc.stop_patient_medication(get_current_patient_id(), patient_med_id)
    return success_response(result, "تم إيقاف الدواء.")


@medication_bp.post("/my/<int:patient_med_id>/activate")
@jwt_required()
@role_required("patient")
def activate_my_medication(patient_med_id: int):
    data = validate_activate_patient_medication(request.get_json(silent=True) or {})
    result = _svc.activate_patient_medication(get_current_patient_id(), patient_med_id, data)
    return success_response(result, "تم تفعيل الدواء من جديد.")


@medication_bp.get("/my/<int:patient_med_id>/schedule")
@jwt_required()
@role_required("patient")
def get_schedule(patient_med_id: int):
    return success_response(_svc.get_schedule(get_current_patient_id(), patient_med_id))


@medication_bp.post("/my/<int:patient_med_id>/schedule")
@jwt_required()
@role_required("patient")
def set_schedule(patient_med_id: int):
    data = validate_dosage_schedule(request.get_json(silent=True) or {})
    result = _svc.set_dosage_schedule(get_current_patient_id(), patient_med_id, data)
    return success_response(result, "تم حفظ جدول الجرعات.", 201)


@medication_bp.put("/my/schedule/<int:schedule_id>")
@jwt_required()
@role_required("patient")
def update_schedule(schedule_id: int):
    data = validate_dosage_schedule(request.get_json(silent=True) or {})
    result = _svc.update_dosage_schedule(get_current_patient_id(), schedule_id, data)
    return success_response(result, "تم تعديل جدول الجرعات.")
