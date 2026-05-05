from app.models.dose_time import DoseTime
from app.repositories.base_repo import BaseRepository


class DoseTimeRepository(BaseRepository):
    def __init__(self):
        super().__init__(DoseTime)
