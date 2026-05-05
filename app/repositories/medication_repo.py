from sqlalchemy import func, or_
from app.models.medication import Medication
from app.repositories.base_repo import BaseRepository


class MedicationRepository(BaseRepository):
    def __init__(self):
        super().__init__(Medication)

    def find_by_name(self, name: str):
        return Medication.query.filter(func.lower(Medication.name) == func.lower(name.strip())).first()

    def get_all_active(self, page: int, per_page: int):
        return Medication.query.filter_by(is_active=True).order_by(Medication.name.asc()).paginate(page=page, per_page=per_page, error_out=False)

    def get_all(self, page: int, per_page: int):
        return Medication.query.order_by(Medication.created_at.desc(), Medication.medication_id.desc()).paginate(page=page, per_page=per_page, error_out=False)

    def search(self, query: str, page: int, per_page: int):
        like = f"%{query.strip()}%"
        return Medication.query.filter(
            Medication.is_active.is_(True),
            or_(Medication.name.ilike(like), Medication.category.ilike(like), Medication.form.ilike(like), Medication.strength.ilike(like)),
        ).order_by(Medication.name.asc()).paginate(page=page, per_page=per_page, error_out=False)

    def search_all(self, query: str, page: int, per_page: int):
        like = f"%{query.strip()}%"
        return Medication.query.filter(
            or_(Medication.name.ilike(like), Medication.category.ilike(like), Medication.form.ilike(like), Medication.strength.ilike(like)),
        ).order_by(Medication.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)

    def browse_by_category(self, category: str, page: int, per_page: int):
        return Medication.query.filter(
            Medication.is_active.is_(True),
            Medication.category == category.strip(),
        ).order_by(Medication.name.asc()).paginate(page=page, per_page=per_page, error_out=False)
