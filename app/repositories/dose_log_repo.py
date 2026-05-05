from sqlalchemy import func
from app.models.dose_log import DoseLog
from app.models.patient_medication import PatientMedication
from app.repositories.base_repo import BaseRepository


class DoseLogRepository(BaseRepository):
    def __init__(self):
        super().__init__(DoseLog)

    def find_existing(self, patient_med_id: int, dose_time_id: int, scheduled_time):
        return DoseLog.query.filter_by(patient_med_id=patient_med_id, dose_time_id=dose_time_id, scheduled_time=scheduled_time).first()

    def get_history(self, patient_med_id: int, page: int, per_page: int):
        return DoseLog.query.filter_by(patient_med_id=patient_med_id).order_by(DoseLog.scheduled_time.desc()).paginate(page=page, per_page=per_page, error_out=False)

    def get_all_history_for_patient(self, patient_id: int, page: int, per_page: int):
        return DoseLog.query.join(PatientMedication).filter(PatientMedication.patient_id == patient_id).order_by(DoseLog.scheduled_time.desc()).paginate(page=page, per_page=per_page, error_out=False)

    def count_by_status(self, patient_med_id: int):
        rows = DoseLog.query.with_entities(DoseLog.status, func.count(DoseLog.dose_log_id)).filter_by(patient_med_id=patient_med_id).group_by(DoseLog.status).all()
        return {status: count for status, count in rows}
