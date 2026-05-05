from datetime import datetime
from decimal import Decimal
from app.models.dose_log import DoseLog
from app.repositories.patient_medication_repo import PatientMedicationRepository
from app.repositories.dosage_schedule_repo import DosageScheduleRepository
from app.repositories.dose_time_repo import DoseTimeRepository
from app.repositories.dose_log_repo import DoseLogRepository
from app.services.notification_service import NotificationService
from app.utils.helpers import utc_now_naive, get_day_abbr
from app.exception import NotFoundError, ConflictError, ForbiddenError, ValidationError, InsufficientStockError
from app.extensions import db


class DoseService:
    def __init__(self):
        self.pat_med_repo = PatientMedicationRepository()
        self.schedule_repo = DosageScheduleRepository()
        self.time_repo = DoseTimeRepository()
        self.log_repo = DoseLogRepository()

    def confirm_intake(self, patient_id: int, patient_med_id: int, data: dict, require_notification: bool = False) -> dict:
        pat_med = self._get_owned_active_pat_med(patient_id, patient_med_id)
        dose_time_entry = self._get_dose_time_for_patient_med(patient_med_id, data["dose_time_id"])
        scheduled_time = self._scheduled_datetime(dose_time_entry, data["scheduled_date"])
        self._validate_scheduled_slot(patient_med_id, dose_time_entry, scheduled_time)
        if require_notification and not self._has_dose_notification(patient_id, patient_med_id, dose_time_entry.dose_time_id, scheduled_time):
            raise ValidationError("لا يمكن تأكيد الجرعة قبل وصول إشعار الجرعة.")
        if self.log_repo.find_existing(patient_med_id, dose_time_entry.dose_time_id, scheduled_time):
            raise ConflictError("تم تسجيل هذه الجرعة مسبقًا.")

        available = Decimal(str(pat_med.current_quantity or 0))
        required = Decimal(str(dose_time_entry.dose_amount or 0))
        if available < required:
            raise InsufficientStockError(f"الكمية غير كافية لتأكيد الجرعة. المتوفر {float(available):.2f} والمطلوب {float(required):.2f}.")

        now = utc_now_naive()
        diff_minutes = int((now - scheduled_time).total_seconds() / 60)
        if diff_minutes < 0:
            raise ValidationError("يمكن تأكيد الجرعة عند وصول الإشعار في موعدها المحدد فقط.")

        pat_med.current_quantity = available - required
        log = DoseLog(
            patient_med_id=patient_med_id,
            dose_time_id=dose_time_entry.dose_time_id,
            scheduled_time=scheduled_time,
            taken_time=now,
            status="taken",
            is_late=diff_minutes > 0,
            late_minutes=diff_minutes if diff_minutes > 0 else None,
        )
        db.session.add(log)
        db.session.commit()
        NotificationService().mark_matching_dose_notification_read(patient_id, patient_med_id, dose_time_entry.dose_time_id, scheduled_time, "taken")
        if Decimal(str(pat_med.current_quantity or 0)) <= Decimal(str(pat_med.min_threshold or 0)):
            NotificationService().create_low_stock_notification(pat_med)
        return log.to_dict()

    def mark_missed_dose(self, patient_id: int, patient_med_id: int, data: dict, require_notification: bool = False) -> dict:
        self._get_owned_active_pat_med(patient_id, patient_med_id)
        dose_time_entry = self._get_dose_time_for_patient_med(patient_med_id, data["dose_time_id"])
        scheduled_time = self._scheduled_datetime(dose_time_entry, data["scheduled_date"])
        self._validate_scheduled_slot(patient_med_id, dose_time_entry, scheduled_time)
        if require_notification and not self._has_dose_notification(patient_id, patient_med_id, dose_time_entry.dose_time_id, scheduled_time):
            raise ValidationError("لا يمكن تسجيل الجرعة كفائتة قبل وصول إشعار الجرعة.")
        if self.log_repo.find_existing(patient_med_id, dose_time_entry.dose_time_id, scheduled_time):
            raise ConflictError("تم تسجيل هذه الجرعة مسبقًا.")
        if scheduled_time > utc_now_naive():
            # Allowed only after the reminder notification has arrived, but not before the actual future dose unless the notification exists.
            pass
        log = DoseLog(
            patient_med_id=patient_med_id,
            dose_time_id=dose_time_entry.dose_time_id,
            scheduled_time=scheduled_time,
            taken_time=None,
            status="missed",
            is_late=False,
            late_minutes=None,
        )
        db.session.add(log)
        db.session.commit()
        NotificationService().mark_matching_dose_notification_read(patient_id, patient_med_id, dose_time_entry.dose_time_id, scheduled_time, "missed")
        return log.to_dict()

    def get_dose_history(self, patient_id: int, patient_med_id: int, page: int = 1, per_page: int = 30):
        self._get_owned_patient_med(patient_id, patient_med_id)
        pagination = self.log_repo.get_history(patient_med_id, page, per_page)
        return self._pagination_dict(pagination)

    def get_all_dose_history(self, patient_id: int, page: int = 1, per_page: int = 30):
        pagination = self.log_repo.get_all_history_for_patient(patient_id, page, per_page)
        return self._pagination_dict(pagination)

    def calculate_adherence(self, patient_id: int, patient_med_id: int) -> dict:
        self._get_owned_patient_med(patient_id, patient_med_id)
        counts = self.log_repo.count_by_status(patient_med_id)
        taken = counts.get("taken", 0)
        missed = counts.get("missed", 0)
        skipped = counts.get("skipped", 0)
        total = taken + missed + skipped
        return {
            "patient_med_id": patient_med_id,
            "taken": taken,
            "missed": missed,
            "skipped": skipped,
            "total": total,
            "adherence_rate": round((taken / total) * 100, 2) if total else 0.0,
        }

    def _pagination_dict(self, pagination):
        return {"items": [i.to_dict() for i in pagination.items], "total": pagination.total, "page": pagination.page, "per_page": pagination.per_page, "pages": pagination.pages}

    def _scheduled_datetime(self, dose_time_entry, scheduled_date):
        return datetime.combine(scheduled_date, dose_time_entry.dose_time).replace(second=0, microsecond=0)

    def _has_dose_notification(self, patient_id, patient_med_id, dose_time_id, scheduled_time):
        from app.models.notification import Notification
        return Notification.query.filter_by(patient_id=patient_id, patient_med_id=patient_med_id, dose_time_id=dose_time_id, scheduled_for=scheduled_time, type="dose").first() is not None

    def _get_dose_time_for_patient_med(self, patient_med_id: int, dose_time_id: int):
        dose_time_entry = self.time_repo.get_by_id(dose_time_id)
        if not dose_time_entry:
            raise NotFoundError("فترة الجرعة غير موجودة.")
        schedule = dose_time_entry.schedule
        if not schedule or schedule.patient_med_id != patient_med_id:
            raise ForbiddenError("فترة الجرعة لا تتبع هذا الدواء.")
        if schedule.status != "active":
            raise ValidationError("جدول الجرعات غير نشط.")
        return dose_time_entry

    def _validate_scheduled_slot(self, patient_med_id: int, dose_time_entry, scheduled_time):
        schedule = dose_time_entry.schedule
        if not schedule or schedule.patient_med_id != patient_med_id:
            raise ForbiddenError("فترة الجرعة لا تتبع هذا الدواء.")
        day_abbr = get_day_abbr(scheduled_time)
        if day_abbr not in {day.day_of_week for day in schedule.days}:
            raise ValidationError("لا توجد جرعة مجدولة في هذا اليوم.")
        scheduled_date = scheduled_time.date()
        if scheduled_date < schedule.start_date:
            raise ValidationError("تاريخ الجرعة قبل بداية جدول الجرعات.")
        if not schedule.is_continuous and schedule.end_date and scheduled_date > schedule.end_date:
            raise ValidationError("تاريخ الجرعة بعد نهاية جدول الجرعات.")

    def _get_owned_patient_med(self, patient_id: int, patient_med_id: int):
        pat_med = self.pat_med_repo.get_by_id(patient_med_id)
        if not pat_med:
            raise NotFoundError("دواء المريض غير موجود.")
        if pat_med.patient_id != patient_id:
            raise ForbiddenError("لا يمكنك الوصول إلى هذا الدواء.")
        return pat_med

    def _get_owned_active_pat_med(self, patient_id: int, patient_med_id: int):
        pat_med = self._get_owned_patient_med(patient_id, patient_med_id)
        if pat_med.status != "active":
            raise ValidationError("لا يمكن تسجيل جرعة لدواء متوقف.")
        return pat_med
