from decimal import Decimal
from app.models.medication import Medication
from app.models.patient_medication import PatientMedication
from app.models.dosage_schedule import DosageSchedule
from app.models.dosage_schedule_day import DosageScheduleDay
from app.models.dose_time import DoseTime
from app.repositories.medication_repo import MedicationRepository
from app.repositories.patient_medication_repo import PatientMedicationRepository
from app.repositories.dosage_schedule_repo import DosageScheduleRepository
from app.exception import NotFoundError, ConflictError, ValidationError, ForbiddenError
from app.extensions import db
from app.validators.medication_validators import VALID_CATEGORIES, ensure_quantity_above_threshold


class MedicationService:
    def __init__(self):
        self.med_repo = MedicationRepository()
        self.pat_med_repo = PatientMedicationRepository()
        self.schedule_repo = DosageScheduleRepository()

    def categories(self):
        return VALID_CATEGORIES

    def _paginate(self, pagination):
        return {
            "items": [item.to_dict() for item in pagination.items],
            "total": pagination.total,
            "page": pagination.page,
            "per_page": pagination.per_page,
            "pages": pagination.pages,
        }

    def search_medication(self, query: str, page: int = 1, per_page: int = 20):
        return self._paginate(self.med_repo.search(query, page, per_page))

    def browse_by_category(self, category: str, page: int = 1, per_page: int = 20):
        return self._paginate(self.med_repo.browse_by_category(category, page, per_page))

    def get_all_medications(self, page: int = 1, per_page: int = 20):
        return self._paginate(self.med_repo.get_all_active(page, per_page))

    def get_all_medications_admin(self, page: int = 1, per_page: int = 20, query: str = ""):
        pagination = self.med_repo.search_all(query, page, per_page) if query else self.med_repo.get_all(page, per_page)
        return self._paginate(pagination)

    def add_patient_medication(self, patient_id: int, data: dict) -> dict:
        med = self.med_repo.get_by_id(data["medication_id"])
        if not med or not med.is_active:
            raise NotFoundError("الدواء غير موجود أو غير متاح في الكتالوج.")
        qty = Decimal(str(data["current_quantity"]))
        ensure_quantity_above_threshold(qty, data["min_threshold"])

        existing = self.pat_med_repo.find_by_patient_and_medication(patient_id, med.medication_id)
        if existing and existing.status == "active":
            raise ConflictError("هذا الدواء موجود بالفعل ضمن أدوية المريض النشطة.")
        if existing and existing.status == "stopped":
            return self.activate_patient_medication(patient_id, existing.patient_med_id, {
                "current_quantity": qty,
                "min_threshold": data.get("min_threshold", existing.min_threshold),
            })

        pat_med = PatientMedication(
            patient_id=patient_id,
            medication_id=med.medication_id,
            current_quantity=qty,
            min_threshold=data["min_threshold"],
            start_date=data["start_date"],
            end_date=data.get("end_date"),
            notes=data.get("notes"),
            status="active",
        )
        db.session.add(pat_med)
        db.session.commit()
        return self._patient_med_to_dict(pat_med)

    def update_patient_medication(self, patient_id: int, patient_med_id: int, data: dict) -> dict:
        pat_med = self._get_owned_patient_med(patient_id, patient_med_id)
        if pat_med.status != "active":
            raise ValidationError("لا يمكن تعديل دواء متوقف. استخدم زر التفعيل أولًا.")
        med = pat_med.medication
        if "current_quantity" in data:
            new_qty = Decimal(str(data["current_quantity"]))
            candidate_threshold = data.get("min_threshold", pat_med.min_threshold)
            ensure_quantity_above_threshold(new_qty, candidate_threshold)
            pat_med.current_quantity = new_qty
        if "current_quantity" not in data and "min_threshold" in data:
            ensure_quantity_above_threshold(pat_med.current_quantity, data["min_threshold"])
        for key in ("min_threshold", "end_date", "notes"):
            if key in data:
                setattr(pat_med, key, data[key])
        if pat_med.end_date and pat_med.end_date <= pat_med.start_date:
            raise ValidationError("تاريخ النهاية يجب أن يكون بعد تاريخ البداية.")
        db.session.commit()
        return self._patient_med_to_dict(pat_med)

    def stop_patient_medication(self, patient_id: int, patient_med_id: int) -> dict:
        pat_med = self._get_owned_patient_med(patient_id, patient_med_id)
        if pat_med.status != "active":
            raise ValidationError("هذا الدواء متوقف بالفعل.")
        pat_med.current_quantity = 0
        pat_med.status = "stopped"
        for schedule in self.schedule_repo.get_all_active_by_patient_med(patient_med_id):
            schedule.status = "stopped"
        db.session.commit()
        return self._patient_med_to_dict(pat_med)

    def activate_patient_medication(self, patient_id: int, patient_med_id: int, data: dict) -> dict:
        pat_med = self._get_owned_patient_med(patient_id, patient_med_id)
        if pat_med.status == "active":
            raise ValidationError("هذا الدواء نشط بالفعل.")
        med = pat_med.medication
        if not med or not med.is_active:
            raise ValidationError("لا يمكن تفعيل دواء غير متاح في كتالوج النظام.")
        qty = Decimal(str(data["current_quantity"]))
        ensure_quantity_above_threshold(qty, data["min_threshold"])
        pat_med.current_quantity = qty
        pat_med.min_threshold = data.get("min_threshold", pat_med.min_threshold)
        pat_med.status = "active"
        db.session.commit()
        return self._patient_med_to_dict(pat_med)

    def get_patient_medications(self, patient_id: int, status: str = None):
        return [self._patient_med_to_dict(med) for med in self.pat_med_repo.get_patient_medications(patient_id, status)]

    def set_dosage_schedule(self, patient_id: int, patient_med_id: int, data: dict) -> dict:
        pat_med = self._get_owned_patient_med(patient_id, patient_med_id)
        if pat_med.status != "active":
            raise ValidationError("لا يمكن إنشاء جدول جرعات لدواء متوقف.")
        self._validate_schedule_against_medication(pat_med, data)
        for existing in self.schedule_repo.get_all_active_by_patient_med(patient_med_id):
            existing.status = "stopped"
        schedule = self._build_schedule(patient_med_id, data)
        db.session.commit()
        db.session.refresh(schedule)
        return schedule.to_dict()

    def update_dosage_schedule(self, patient_id: int, schedule_id: int, data: dict) -> dict:
        schedule = self.schedule_repo.get_by_id(schedule_id)
        if not schedule:
            raise NotFoundError("جدول الجرعات غير موجود.")
        pat_med = schedule.patient_medication
        if not pat_med or pat_med.patient_id != patient_id:
            raise ForbiddenError("لا يمكنك تعديل هذا الجدول.")
        if schedule.status != "active":
            raise ValidationError("لا يمكن تعديل جدول غير نشط.")
        self._validate_schedule_against_medication(pat_med, data)
        schedule.status = "stopped"
        replacement = self._build_schedule(schedule.patient_med_id, data)
        db.session.commit()
        db.session.refresh(replacement)
        return replacement.to_dict()

    def get_schedule(self, patient_id: int, patient_med_id: int):
        self._get_owned_patient_med(patient_id, patient_med_id)
        return [schedule.to_dict() for schedule in self.schedule_repo.get_all_by_patient_med(patient_med_id)]

    def add_medication(self, data: dict) -> dict:
        if self.med_repo.find_by_name(data["name"]):
            raise ConflictError("يوجد دواء بهذا الاسم مسبقًا.")
        med = Medication(**data)
        db.session.add(med)
        db.session.commit()
        return med.to_dict()

    def update_medication(self, medication_id: int, data: dict) -> dict:
        med = self.med_repo.get_by_id(medication_id)
        if not med:
            raise NotFoundError("الدواء غير موجود.")
        if "name" in data and data["name"] != med.name and self.med_repo.find_by_name(data["name"]):
            raise ConflictError("يوجد دواء آخر بهذا الاسم.")
        for key, value in data.items():
            setattr(med, key, value)
        db.session.commit()
        return med.to_dict()

    def delete_medication(self, medication_id: int):
        med = self.med_repo.get_by_id(medication_id)
        if not med:
            raise NotFoundError("الدواء غير موجود.")
        med.is_active = False
        db.session.commit()
        return med.to_dict()

    def activate_medication(self, medication_id: int) -> dict:
        med = self.med_repo.get_by_id(medication_id)
        if not med:
            raise NotFoundError("الدواء غير موجود.")
        med.is_active = True
        db.session.commit()
        return med.to_dict()

    def _build_schedule(self, patient_med_id: int, data: dict):
        schedule = DosageSchedule(
            patient_med_id=patient_med_id,
            start_date=data["start_date"],
            end_date=data.get("end_date"),
            is_continuous=data["is_continuous"],
            status="active",
        )
        db.session.add(schedule)
        db.session.flush()
        for day in data["days"]:
            db.session.add(DosageScheduleDay(schedule_id=schedule.schedule_id, day_of_week=day))
        for period in data["dose_periods"]:
            db.session.add(DoseTime(schedule_id=schedule.schedule_id, **period))
        return schedule

    def _validate_schedule_against_medication(self, pat_med, data: dict):
        if data["start_date"] < pat_med.start_date:
            raise ValidationError("تاريخ بداية الجدول لا يمكن أن يكون قبل تاريخ بداية الدواء.")
        if pat_med.end_date:
            if data.get("end_date") is None:
                raise ValidationError("لا يمكن جعل الجدول مستمرًا إذا كان للدواء تاريخ نهاية.")
            if data["end_date"] > pat_med.end_date:
                raise ValidationError("تاريخ نهاية الجدول لا يمكن أن يكون بعد تاريخ نهاية الدواء.")

    def _patient_med_to_dict(self, pat_med):
        item = pat_med.to_dict()
        schedules = pat_med.schedules.order_by(DosageSchedule.created_at.desc(), DosageSchedule.schedule_id.desc()).all()
        item["schedules"] = [s.to_dict() for s in schedules]
        item["active_schedule"] = next((s.to_dict() for s in schedules if s.status == "active"), None)
        return item

    def _get_owned_patient_med(self, patient_id: int, patient_med_id: int):
        pat_med = self.pat_med_repo.get_by_id(patient_med_id)
        if not pat_med:
            raise NotFoundError("دواء المريض غير موجود.")
        if pat_med.patient_id != patient_id:
            raise ForbiddenError("لا يمكنك الوصول إلى هذا الدواء.")
        return pat_med
