from app.extensions import db


class DosageScheduleDay(db.Model):
    __tablename__ = "dosage_schedule_day"

    __table_args__ = (
        db.UniqueConstraint("schedule_id", "day_of_week", name="uq_schedule_day"),
    )

    schedule_day_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    schedule_id = db.Column(db.Integer, db.ForeignKey("dosage_schedule.schedule_id"), nullable=False)
    day_of_week = db.Column(db.Enum("mon", "tue", "wed", "thu", "fri", "sat", "sun"), nullable=False)

    schedule = db.relationship("DosageSchedule", back_populates="days")

    def to_dict(self):
        return {"schedule_day_id": self.schedule_day_id, "schedule_id": self.schedule_id, "day_of_week": self.day_of_week}
