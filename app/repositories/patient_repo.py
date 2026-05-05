from sqlalchemy import or_
from app.models.patient import Patient
from app.repositories.base_repo import BaseRepository


class PatientRepository(BaseRepository):
    def __init__(self):
        super().__init__(Patient)

    def find_by_email(self, email: str):
        return Patient.query.filter_by(email=email.lower().strip()).first()

    def search(self, query: str, page: int, per_page: int):
        like = f"%{query.strip()}%"
        return Patient.query.filter(or_(Patient.full_name.ilike(like), Patient.email.ilike(like), Patient.phone.ilike(like))).order_by(Patient.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)

    def get_all(self, page: int, per_page: int):
        return Patient.query.order_by(Patient.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
