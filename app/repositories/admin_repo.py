from app.models.admin import Admin
from app.repositories.base_repo import BaseRepository


class AdminRepository(BaseRepository):

    def __init__(self):
        super().__init__(Admin)

    def find_by_email(self, email: str):
        return Admin.query.filter_by(email=email).first()
