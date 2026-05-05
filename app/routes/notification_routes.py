from flask import Blueprint, request
from flask_jwt_extended import jwt_required
from app.services.notification_service import NotificationService
from app.utils.helpers import success_response, pagination_args
from app.utils.guards import role_required, get_current_patient_id

notification_bp = Blueprint("notification", __name__, url_prefix="/api/notifications")
_svc = NotificationService()


@notification_bp.get("/my")
@jwt_required()
@role_required("patient")
def get_my_notifications():
    page, per_page = pagination_args(request.args, default_per_page=30)
    return success_response(_svc.get_patient_notifications(get_current_patient_id(), page, per_page))


@notification_bp.get("/my/unread")
@jwt_required()
@role_required("patient")
def get_unread():
    return success_response(_svc.get_unread_notifications(get_current_patient_id()))


@notification_bp.patch("/my/<int:notification_id>/read")
@jwt_required()
@role_required("patient")
def mark_read(notification_id: int):
    return success_response(_svc.mark_as_read(get_current_patient_id(), notification_id), "تم وضع التنبيه كمقروء.")


@notification_bp.post("/my/<int:notification_id>/confirm-dose")
@jwt_required()
@role_required("patient")
def confirm_dose_from_notification(notification_id: int):
    result = _svc.confirm_dose_from_notification(get_current_patient_id(), notification_id)
    return success_response(result, "تم تأكيد الجرعة من الإشعار.", 201)


@notification_bp.post("/my/<int:notification_id>/miss-dose")
@jwt_required()
@role_required("patient")
def miss_dose_from_notification(notification_id: int):
    result = _svc.miss_dose_from_notification(get_current_patient_id(), notification_id)
    return success_response(result, "تم تسجيل الجرعة كفائتة من الإشعار.", 201)
