import logging
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)
_scheduler = BackgroundScheduler()


def _day_abbr(dt: datetime) -> str:
    return {0: "mon", 1: "tue", 2: "wed", 3: "thu", 4: "fri", 5: "sat", 6: "sun"}[dt.weekday()]


def _check_dose_reminders(flask_app, now: datetime = None):
    from app.repositories.dosage_schedule_repo import DosageScheduleRepository
    from app.services.notification_service import NotificationService

    with flask_app.app_context():
        try:
            now = (now or datetime.now()).replace(second=0, microsecond=0)
            today = now.date()
            today_abbr = _day_abbr(now)
            notif_svc = NotificationService()
            for schedule in DosageScheduleRepository().get_all_active_schedules():
                if today < schedule.start_date:
                    continue
                if not schedule.is_continuous and schedule.end_date and today > schedule.end_date:
                    continue
                if today_abbr not in {day.day_of_week for day in schedule.days}:
                    continue
                pat_med = schedule.patient_medication
                if not pat_med or pat_med.status != "active":
                    continue
                medication = pat_med.medication
                if not medication or not medication.is_active:
                    continue
                for dose_time_entry in schedule.dose_times:
                    actual_time = datetime.combine(today, dose_time_entry.dose_time).replace(second=0, microsecond=0)
                    if now < actual_time:
                        continue
                    notif_svc.create_dose_notification(
                        patient_id=pat_med.patient_id,
                        patient_med_id=pat_med.patient_med_id,
                        dose_time_id=dose_time_entry.dose_time_id,
                        scheduled_for=actual_time,
                        medication_name=medication.name,
                        period_label=dose_time_entry.to_dict()["period_label"],
                    )
        except Exception as exc:
            logger.error("[Scheduler] Dose reminder error: %s", exc, exc_info=True)


def _check_low_stock(flask_app):
    from app.repositories.patient_medication_repo import PatientMedicationRepository
    from app.services.notification_service import NotificationService

    with flask_app.app_context():
        try:
            notif_svc = NotificationService()
            for pat_med in PatientMedicationRepository().get_all_active_below_threshold():
                notif_svc.create_low_stock_notification(pat_med)
        except Exception as exc:
            logger.error("[Scheduler] Low stock error: %s", exc, exc_info=True)


def init_scheduler(flask_app):
    import os
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not flask_app.config.get("DEBUG", False):
        _scheduler.add_job(_check_dose_reminders, trigger=IntervalTrigger(minutes=1), id="dose_reminder_job", args=[flask_app], replace_existing=True, max_instances=1, coalesce=True)
        _scheduler.add_job(_check_low_stock, trigger=IntervalTrigger(minutes=30), id="low_stock_job", args=[flask_app], replace_existing=True, max_instances=1, coalesce=True)
        if not _scheduler.running:
            _scheduler.start()
            logger.info("[Scheduler] Started.")
