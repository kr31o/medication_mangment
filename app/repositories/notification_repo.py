from datetime import datetime
from app.models.notification import Notification
from app.repositories.base_repo import BaseRepository


class NotificationRepository(BaseRepository):
    def __init__(self):
        super().__init__(Notification)

    def get_for_patient(self, patient_id: int, page: int, per_page: int):
        return Notification.query.filter_by(patient_id=patient_id).order_by(Notification.created_at.desc(), Notification.notification_id.desc()).paginate(page=page, per_page=per_page, error_out=False)

    def get_unread_for_patient(self, patient_id: int):
        return Notification.query.filter_by(patient_id=patient_id, status="unread").order_by(Notification.created_at.desc(), Notification.notification_id.desc()).all()

    def find_by_id_and_patient(self, notification_id: int, patient_id: int):
        return Notification.query.filter_by(notification_id=notification_id, patient_id=patient_id).first()

    def exists_dose_notification(self, dose_time_id: int, scheduled_for: datetime) -> bool:
        return Notification.query.filter_by(type="dose", dose_time_id=dose_time_id, scheduled_for=scheduled_for).first() is not None

    def exists_unread_low_stock(self, patient_med_id: int) -> bool:
        return Notification.query.filter_by(type="low_stock", patient_med_id=patient_med_id, status="unread").first() is not None
