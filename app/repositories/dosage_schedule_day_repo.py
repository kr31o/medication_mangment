from app.models.dosage_schedule_day import DosageScheduleDay
from app.repositories.base_repo import BaseRepository


class DosageScheduleDayRepository(BaseRepository):

    def __init__(self):
        super().__init__(DosageScheduleDay)

    def get_by_schedule(self, schedule_id: int):
        return DosageScheduleDay.query.filter_by(schedule_id=schedule_id).all()

    def delete_by_schedule(self, schedule_id: int):
        DosageScheduleDay.query.filter_by(schedule_id=schedule_id).delete()
