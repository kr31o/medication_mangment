from app.models.patient_medication import PatientMedication
from app.repositories.base_repo import BaseRepository


class PatientMedicationRepository(BaseRepository):
    def __init__(self):
        super().__init__(PatientMedication)

    def find_by_patient_and_medication(self, patient_id: int, medication_id: int):
        return PatientMedication.query.filter_by(patient_id=patient_id, medication_id=medication_id).first()

    def get_patient_medications(self, patient_id: int, status: str = None):
        q = PatientMedication.query.filter_by(patient_id=patient_id)
        if status:
            q = q.filter_by(status=status)
        return q.order_by(PatientMedication.patient_med_id.desc()).all()

    def get_all_active_below_threshold(self):
        return PatientMedication.query.filter(
            PatientMedication.status == "active",
            PatientMedication.current_quantity <= PatientMedication.min_threshold,
        ).all()
