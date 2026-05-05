from flask import Blueprint, request
from flask_jwt_extended import jwt_required
from app.services.admin_service import AdminService
from app.services.medication_service import MedicationService
from app.services.notification_service import NotificationService
from app.validators.medication_validators import validate_add_medication, validate_update_medication
from app.validators.admin_validators import validate_update_patient
from app.validators.notification_validators import validate_send_warning
from app.utils.helpers import success_response, pagination_args
from app.utils.guards import role_required, get_current_admin_id

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")
_admin_svc = AdminService()
_med_svc = MedicationService()
_notif_svc = NotificationService()


@admin_bp.get("/stats")
@jwt_required()
@role_required("admin")
def stats():
    return success_response(_admin_svc.stats())


@admin_bp.get("/patients")
@jwt_required()
@role_required("admin")
def list_patients():
    page, per_page = pagination_args(request.args, default_per_page=20, max_per_page=500)
    query = request.args.get("q", "").strip()
    data = _admin_svc.search_patients(query, page, per_page) if query else _admin_svc.get_all_patients(page, per_page)
    return success_response(data)


@admin_bp.get("/patients/<int:patient_id>")
@jwt_required()
@role_required("admin")
def get_patient(patient_id: int):
    return success_response(_admin_svc.get_patient_details(patient_id))


@admin_bp.get("/patients/<int:patient_id>/medications")
@jwt_required()
@role_required("admin")
def get_patient_medications(patient_id: int):
    return success_response(_admin_svc.get_patient_medications(patient_id))


@admin_bp.patch("/patients/<int:patient_id>")
@jwt_required()
@role_required("admin")
def update_patient(patient_id: int):
    data = validate_update_patient(request.get_json(silent=True) or {})
    return success_response(_admin_svc.update_patient(patient_id, data), "تم تحديث بيانات المريض.")


@admin_bp.post("/patients/<int:patient_id>/deactivate")
@jwt_required()
@role_required("admin")
def deactivate_patient(patient_id: int):
    return success_response(_admin_svc.deactivate_patient(patient_id), "تم تعطيل حساب المريض.")


@admin_bp.post("/patients/<int:patient_id>/activate")
@jwt_required()
@role_required("admin")
def activate_patient(patient_id: int):
    return success_response(_admin_svc.activate_patient(patient_id), "تم تفعيل حساب المريض.")


@admin_bp.get("/medications/categories")
@jwt_required()
@role_required("admin")
def medication_categories():
    return success_response(_med_svc.categories())


@admin_bp.get("/medications")
@jwt_required()
@role_required("admin")
def list_medications():
    page, per_page = pagination_args(request.args, default_per_page=20, max_per_page=500)
    query = request.args.get("q", "").strip()
    return success_response(_med_svc.get_all_medications_admin(page, per_page, query))


@admin_bp.post("/medications")
@jwt_required()
@role_required("admin")
def add_medication():
    data = validate_add_medication(request.get_json(silent=True) or {})
    return success_response(_med_svc.add_medication(data), "تمت إضافة الدواء إلى النظام.", 201)


@admin_bp.patch("/medications/<int:medication_id>")
@jwt_required()
@role_required("admin")
def update_medication(medication_id: int):
    data = validate_update_medication(request.get_json(silent=True) or {})
    return success_response(_med_svc.update_medication(medication_id, data), "تم تعديل الدواء.")


@admin_bp.post("/medications/<int:medication_id>/activate")
@jwt_required()
@role_required("admin")
def activate_medication(medication_id: int):
    return success_response(_med_svc.activate_medication(medication_id), "تمت استعادة الدواء في الكتالوج.")


@admin_bp.delete("/medications/<int:medication_id>")
@jwt_required()
@role_required("admin")
def delete_medication(medication_id: int):
    return success_response(_med_svc.delete_medication(medication_id), "تم حذف الدواء من كتالوج المرضى مع حفظ السجلات القديمة.")


@admin_bp.post("/notifications/warning")
@jwt_required()
@role_required("admin")
def send_warning():
    data = validate_send_warning(request.get_json(silent=True) or {})
    return success_response(_notif_svc.send_warning_notification(get_current_admin_id(), data), "تم إرسال التحذير للمريض.", 201)
