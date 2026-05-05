from sqlalchemy import func
from app.models.patient import Patient
from app.models.medication import Medication
from app.models.patient_medication import PatientMedication
from app.models.dosage_schedule import DosageSchedule
from app.repositories.patient_repo import PatientRepository
from app.repositories.patient_medication_repo import PatientMedicationRepository
from app.exception import NotFoundError
from app.extensions import db


class AdminService:
    def __init__(self):
        self.patient_repo = PatientRepository()
        self.patient_med_repo = PatientMedicationRepository()

    def _paginate(self, p):
        return {"items": [item.to_dict() for item in p.items], "total": p.total, "page": p.page, "per_page": p.per_page, "pages": p.pages}

    def stats(self):
        return {
            "total_patients": Patient.query.count(),
            "active_patients": Patient.query.filter_by(status="active").count(),
            "inactive_patients": Patient.query.filter_by(status="inactive").count(),
            "total_medications": Medication.query.count(),
            "active_medications": Medication.query.filter_by(is_active=True).count(),
            "inactive_medications": Medication.query.filter_by(is_active=False).count(),
            "total_patient_stock": float(db.session.query(func.coalesce(func.sum(PatientMedication.current_quantity), 0)).scalar() or 0),
        }

    def search_patients(self, query: str, page: int = 1, per_page: int = 20):
        return self._paginate(self.patient_repo.search(query, page, per_page))

    def get_all_patients(self, page: int = 1, per_page: int = 20):
        return self._paginate(self.patient_repo.get_all(page, per_page))

    def get_patient_details(self, patient_id: int) -> dict:
        patient = self.patient_repo.get_by_id(patient_id)
        if not patient:
            raise NotFoundError("المريض غير موجود.")
        return patient.to_dict()

    def get_patient_medications(self, patient_id: int):
        patient = self.patient_repo.get_by_id(patient_id)
        if not patient:
            raise NotFoundError("المريض غير موجود.")
        result = []
        for pat_med in self.patient_med_repo.get_patient_medications(patient_id):
            item = pat_med.to_dict()
            schedules = pat_med.schedules.order_by(DosageSchedule.created_at.desc(), DosageSchedule.schedule_id.desc()).all()
            item["schedules"] = [s.to_dict() for s in schedules]
            item["active_schedule"] = next((s.to_dict() for s in schedules if s.status == "active"), None)
            result.append(item)
        return result

    def update_patient(self, patient_id: int, data: dict) -> dict:
        patient = self.patient_repo.get_by_id(patient_id)
        if not patient:
            raise NotFoundError("المريض غير موجود.")
        for key, value in data.items():
            setattr(patient, key, value)
        db.session.commit()
        return patient.to_dict()

    def deactivate_patient(self, patient_id: int) -> dict:
        patient = self.patient_repo.get_by_id(patient_id)
        if not patient:
            raise NotFoundError("المريض غير موجود.")
        patient.status = "inactive"
        db.session.commit()
        return patient.to_dict()

    def activate_patient(self, patient_id: int) -> dict:
        patient = self.patient_repo.get_by_id(patient_id)
        if not patient:
            raise NotFoundError("المريض غير موجود.")
        patient.status = "active"
        db.session.commit()
        return patient.to_dict()
