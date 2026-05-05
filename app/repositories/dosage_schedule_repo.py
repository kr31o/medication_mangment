from app.models.dosage_schedule import DosageSchedule
from app.repositories.base_repo import BaseRepository


class DosageScheduleRepository(BaseRepository):
    def __init__(self):
        super().__init__(DosageSchedule)

    def get_all_active_by_patient_med(self, patient_med_id: int):
        return DosageSchedule.query.filter_by(patient_med_id=patient_med_id, status="active").all()

    def get_all_by_patient_med(self, patient_med_id: int):
        return DosageSchedule.query.filter_by(patient_med_id=patient_med_id).order_by(DosageSchedule.created_at.desc(), DosageSchedule.schedule_id.desc()).all()

    def get_all_active_schedules(self):
        return DosageSchedule.query.filter_by(status="active").all()
