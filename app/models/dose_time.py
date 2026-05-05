from app.extensions import db
from app.utils.dose_periods import period_label


class DoseTime(db.Model):
    __tablename__ = "dose_time"

    __table_args__ = (
        db.UniqueConstraint("schedule_id", "dose_period", name="uq_schedule_dose_period"),
        db.Index("ix_dose_time_schedule", "schedule_id", "dose_period"),
    )

    dose_time_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    schedule_id = db.Column(db.Integer, db.ForeignKey("dosage_schedule.schedule_id"), nullable=False)
    dose_period = db.Column(db.Enum("morning", "evening"), nullable=False)
    dose_time = db.Column(db.Time, nullable=False)
    dose_amount = db.Column(db.Numeric(10, 2), nullable=False)
    dose_unit = db.Column(db.String(30), nullable=False)
    reminder_before_minutes = db.Column(db.Integer, nullable=False, default=0)

    schedule = db.relationship("DosageSchedule", back_populates="dose_times")
    dose_logs = db.relationship("DoseLog", back_populates="dose_time_entry", lazy="dynamic")
    notifications = db.relationship("Notification", back_populates="dose_time_entry", lazy="dynamic")

    def to_dict(self):
        return {
            "dose_time_id": self.dose_time_id,
            "schedule_id": self.schedule_id,
            "dose_period": self.dose_period,
            "period_label": period_label(self.dose_period),
            "dose_time": self.dose_time.strftime("%H:%M") if self.dose_time else None,
            "dose_amount": float(self.dose_amount or 0),
            "dose_unit": self.dose_unit,
            "reminder_before_minutes": self.reminder_before_minutes,
        }
