from app.extensions import db
from app.utils.helpers import utc_now_naive


class DosageSchedule(db.Model):
    __tablename__ = "dosage_schedule"

    __table_args__ = (
        db.Index("ix_dosage_schedule_patient_med_status", "patient_med_id", "status"),
    )

    schedule_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    patient_med_id = db.Column(db.Integer, db.ForeignKey("patient_medication.patient_med_id"), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=True)
    is_continuous = db.Column(db.Boolean, nullable=False, default=True)
    status = db.Column(db.Enum("active", "stopped", "completed"), nullable=False, default="active")
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now_naive)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive)

    patient_medication = db.relationship("PatientMedication", back_populates="schedules")
    days = db.relationship("DosageScheduleDay", back_populates="schedule", cascade="all, delete-orphan", order_by="DosageScheduleDay.schedule_day_id")
    dose_times = db.relationship("DoseTime", back_populates="schedule", cascade="all, delete-orphan", order_by="DoseTime.dose_time")

    def to_dict(self):
        return {
            "schedule_id": self.schedule_id,
            "patient_med_id": self.patient_med_id,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "is_continuous": bool(self.is_continuous),
            "status": self.status,
            "days": [d.to_dict() for d in self.days],
            "dose_periods": [dt.to_dict() for dt in self.dose_times],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
