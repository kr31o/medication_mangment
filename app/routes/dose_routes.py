from flask import Blueprint, request
from flask_jwt_extended import jwt_required
from app.services.dose_service import DoseService
from app.validators.dose_validators import validate_confirm_intake, validate_mark_missed
from app.utils.helpers import success_response, pagination_args
from app.utils.guards import role_required, get_current_patient_id

dose_bp = Blueprint("dose", __name__, url_prefix="/api/doses")
_svc = DoseService()


@dose_bp.post("/my/<int:patient_med_id>/confirm")
@jwt_required()
@role_required("patient")
def confirm_intake(patient_med_id: int):
    data = validate_confirm_intake(request.get_json(silent=True) or {})
    result = _svc.confirm_intake(get_current_patient_id(), patient_med_id, data, require_notification=True)
    return success_response(result, "تم تأكيد الجرعة.", 201)


@dose_bp.post("/my/<int:patient_med_id>/missed")
@jwt_required()
@role_required("patient")
def mark_missed(patient_med_id: int):
    data = validate_mark_missed(request.get_json(silent=True) or {})
    result = _svc.mark_missed_dose(get_current_patient_id(), patient_med_id, data, require_notification=True)
    return success_response(result, "تم تسجيل الجرعة كفائتة.", 201)


@dose_bp.get("/my/<int:patient_med_id>/history")
@jwt_required()
@role_required("patient")
def dose_history(patient_med_id: int):
    page, per_page = pagination_args(request.args, default_per_page=30)
    return success_response(_svc.get_dose_history(get_current_patient_id(), patient_med_id, page, per_page))


@dose_bp.get("/my/history")
@jwt_required()
@role_required("patient")
def all_dose_history():
    page, per_page = pagination_args(request.args, default_per_page=30)
    return success_response(_svc.get_all_dose_history(get_current_patient_id(), page, per_page))


@dose_bp.get("/my/<int:patient_med_id>/adherence")
@jwt_required()
@role_required("patient")
def adherence(patient_med_id: int):
    return success_response(_svc.calculate_adherence(get_current_patient_id(), patient_med_id))
