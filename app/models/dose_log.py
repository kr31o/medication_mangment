from app.extensions import db
from app.utils.helpers import utc_now_naive
from app.utils.dose_periods import period_label


class DoseLog(db.Model):
    __tablename__ = "dose_log"

    __table_args__ = (
        db.UniqueConstraint("patient_med_id", "dose_time_id", "scheduled_time", name="uq_dose_log"),
        db.Index("ix_dose_log_patient_med_scheduled", "patient_med_id", "scheduled_time"),
        db.Index("ix_dose_log_dose_time", "dose_time_id"),
    )

    dose_log_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    patient_med_id = db.Column(db.Integer, db.ForeignKey("patient_medication.patient_med_id"), nullable=False)
    dose_time_id = db.Column(db.Integer, db.ForeignKey("dose_time.dose_time_id"), nullable=False)
    scheduled_time = db.Column(db.DateTime, nullable=False)
    taken_time = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.Enum("taken", "missed", "skipped"), nullable=False)
    is_late = db.Column(db.Boolean, nullable=False, default=False)
    late_minutes = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now_naive)

    patient_medication = db.relationship("PatientMedication", back_populates="dose_logs")
    dose_time_entry = db.relationship("DoseTime", back_populates="dose_logs")

    def to_dict(self):
        period = self.dose_time_entry.dose_period if self.dose_time_entry else None
        med = self.patient_medication.medication if self.patient_medication and self.patient_medication.medication else None
        return {
            "dose_log_id": self.dose_log_id,
            "patient_med_id": self.patient_med_id,
            "dose_time_id": self.dose_time_id,
            "medication_name": med.name if med else None,
            "dose_period": period,
            "period_label": period_label(period) if period else None,
            "dose_amount": float(self.dose_time_entry.dose_amount) if self.dose_time_entry else None,
            "dose_unit": self.dose_time_entry.dose_unit if self.dose_time_entry else None,
            "scheduled_date": self.scheduled_time.date().isoformat() if self.scheduled_time else None,
            "scheduled_time": self.scheduled_time.isoformat() if self.scheduled_time else None,
            "taken_time": self.taken_time.isoformat() if self.taken_time else None,
            "status": self.status,
            "is_late": bool(self.is_late),
            "late_minutes": self.late_minutes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
