from datetime import datetime
from sqlalchemy.exc import IntegrityError
from app.models.notification import Notification
from app.repositories.notification_repo import NotificationRepository
from app.repositories.patient_repo import PatientRepository
from app.repositories.dose_log_repo import DoseLogRepository
from app.utils.helpers import utc_now_naive
from app.exception import NotFoundError, ValidationError
from app.extensions import db


class NotificationService:
    def __init__(self):
        self.repo = NotificationRepository()
        self.patient_repo = PatientRepository()
        self.log_repo = DoseLogRepository()

    def get_patient_notifications(self, patient_id: int, page: int = 1, per_page: int = 30):
        p = self.repo.get_for_patient(patient_id, page, per_page)
        return {"items": [self._serialize(n) for n in p.items], "total": p.total, "page": p.page, "per_page": p.per_page, "pages": p.pages}

    def get_unread_notifications(self, patient_id: int):
        return [self._serialize(n) for n in self.repo.get_unread_for_patient(patient_id)]

    def mark_as_read(self, patient_id: int, notification_id: int):
        notif = self.repo.find_by_id_and_patient(notification_id, patient_id)
        if not notif:
            raise NotFoundError("التنبيه غير موجود.")
        self._mark_read(notif)
        return self._serialize(notif)

    def confirm_dose_from_notification(self, patient_id: int, notification_id: int):
        notif = self._get_actionable_dose_notification(patient_id, notification_id)
        existing = self._existing_log(notif)
        if existing:
            self._mark_read(notif)
            return {"already_logged": True, "dose_log": existing.to_dict(), "notification": self._serialize(notif)}
        from app.services.dose_service import DoseService
        log = DoseService().confirm_intake(patient_id, notif.patient_med_id, {"dose_time_id": notif.dose_time_id, "scheduled_date": notif.scheduled_for.date()}, require_notification=True)
        self._mark_read(notif)
        return {"already_logged": False, "dose_log": log, "notification": self._serialize(notif)}

    def miss_dose_from_notification(self, patient_id: int, notification_id: int):
        notif = self._get_actionable_dose_notification(patient_id, notification_id)
        existing = self._existing_log(notif)
        if existing:
            self._mark_read(notif)
            return {"already_logged": True, "dose_log": existing.to_dict(), "notification": self._serialize(notif)}
        from app.services.dose_service import DoseService
        log = DoseService().mark_missed_dose(patient_id, notif.patient_med_id, {"dose_time_id": notif.dose_time_id, "scheduled_date": notif.scheduled_for.date()}, require_notification=True)
        self._mark_read(notif)
        return {"already_logged": False, "dose_log": log, "notification": self._serialize(notif)}

    def send_warning_notification(self, admin_id: int, data: dict):
        patient = self.patient_repo.get_by_id(data["patient_id"])
        if not patient:
            raise NotFoundError("المريض غير موجود.")
        if patient.status != "active":
            raise ValidationError("لا يمكن إرسال تنبيه لمريض حسابه غير نشط.")
        notif = Notification(patient_id=patient.patient_id, created_by_admin_id=admin_id, type="warning", title=data["title"], message=data["message"], status="unread")
        db.session.add(notif)
        db.session.commit()
        return self._serialize(notif)

    def create_dose_notification(self, patient_id: int, patient_med_id: int, dose_time_id: int, scheduled_for: datetime, medication_name: str, period_label: str):
        if self.repo.exists_dose_notification(dose_time_id, scheduled_for):
            return None
        scheduled_time = scheduled_for.strftime("%H:%M")
        notif = Notification(
            patient_id=patient_id,
            patient_med_id=patient_med_id,
            dose_time_id=dose_time_id,
            scheduled_for=scheduled_for,
            type="dose",
            title=f"إشعار جرعة {medication_name}",
            message=f"حان الآن وقت جرعة {period_label} ({scheduled_time}) من دواء {medication_name}. يمكنك تأكيد الجرعة أو تسجيلها فائتة.",
            status="unread",
        )
        db.session.add(notif)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return None
        return self._serialize(notif)

    def create_low_stock_notification(self, pat_med):
        if self.repo.exists_unread_low_stock(pat_med.patient_med_id):
            return None
        med_name = pat_med.medication.name if pat_med.medication else "الدواء"
        notif = Notification(
            patient_id=pat_med.patient_id,
            patient_med_id=pat_med.patient_med_id,
            type="low_stock",
            title=f"تنبيه نفاد الدواء: {med_name}",
            message=f"كمية {med_name} وصلت إلى {float(pat_med.current_quantity or 0):.2f}. حد التنبيه المحدد هو {float(pat_med.min_threshold or 0):.2f}.",
            status="unread",
        )
        db.session.add(notif)
        db.session.commit()
        return self._serialize(notif)

    def mark_matching_dose_notification_read(self, patient_id, patient_med_id, dose_time_id, scheduled_for, log_status: str):
        notif = Notification.query.filter_by(patient_id=patient_id, patient_med_id=patient_med_id, dose_time_id=dose_time_id, scheduled_for=scheduled_for, type="dose").first()
        if notif:
            self._mark_read(notif)

    def _get_actionable_dose_notification(self, patient_id: int, notification_id: int):
        notif = self.repo.find_by_id_and_patient(notification_id, patient_id)
        if not notif:
            raise NotFoundError("التنبيه غير موجود.")
        if notif.type != "dose" or not notif.patient_med_id or not notif.dose_time_id or not notif.scheduled_for:
            raise ValidationError("هذا التنبيه ليس تنبيه جرعة صالحًا.")
        return notif

    def _existing_log(self, notif):
        return self.log_repo.find_existing(notif.patient_med_id, notif.dose_time_id, notif.scheduled_for.replace(second=0, microsecond=0))

    def _mark_read(self, notif):
        if notif.status == "unread":
            notif.status = "read"
            notif.read_at = utc_now_naive()
            db.session.commit()

    def _serialize(self, notif):
        data = notif.to_dict()
        data["actionable"] = False
        data["dose_log_status"] = None
        data["dose_log_id"] = None
        if notif.type == "dose" and notif.patient_med_id and notif.dose_time_id and notif.scheduled_for:
            existing = self._existing_log(notif)
            if existing:
                data["dose_log_status"] = existing.status
                data["dose_log_id"] = existing.dose_log_id
            else:
                data["actionable"] = True
        return data
