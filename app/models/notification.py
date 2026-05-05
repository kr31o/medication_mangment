from app.extensions import db
from app.utils.helpers import utc_now_naive
from app.utils.dose_periods import period_label


class Notification(db.Model):
    __tablename__ = "notification"

    __table_args__ = (
        db.Index("ix_notification_patient_status", "patient_id", "status"),
        db.Index("ix_notification_type_patient_med", "type", "patient_med_id"),
        db.UniqueConstraint("type", "dose_time_id", "scheduled_for", name="uq_notification_dose"),
    )

    notification_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    patient_id = db.Column(db.Integer, db.ForeignKey("patient.patient_id"), nullable=False)
    patient_med_id = db.Column(db.Integer, db.ForeignKey("patient_medication.patient_med_id"), nullable=True)
    dose_time_id = db.Column(db.Integer, db.ForeignKey("dose_time.dose_time_id"), nullable=True)
    created_by_admin_id = db.Column(db.Integer, db.ForeignKey("admin.admin_id"), nullable=True)
    scheduled_for = db.Column(db.DateTime, nullable=True)  # actual dose time
    type = db.Column(db.Enum("dose", "low_stock", "warning"), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    message = db.Column(db.Text, nullable=False)
    status = db.Column(db.Enum("read", "unread"), nullable=False, default="unread")
    read_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now_naive)

    patient = db.relationship("Patient", back_populates="notifications")
    patient_medication = db.relationship("PatientMedication", back_populates="notifications")
    dose_time_entry = db.relationship("DoseTime", back_populates="notifications")
    admin = db.relationship("Admin", back_populates="sent_notifications")

    def to_dict(self):
        period = self.dose_time_entry.dose_period if self.dose_time_entry else None
        med_name = None
        if self.patient_medication and self.patient_medication.medication:
            med_name = self.patient_medication.medication.name
        return {
            "notification_id": self.notification_id,
            "patient_id": self.patient_id,
            "patient_med_id": self.patient_med_id,
            "dose_time_id": self.dose_time_id,
            "type": self.type,
            "title": self.title,
            "message": self.message,
            "status": self.status,
            "medication_name": med_name,
            "dose_period": period,
            "period_label": period_label(period) if period else None,
            "dose_time": self.dose_time_entry.dose_time.strftime("%H:%M") if self.dose_time_entry and self.dose_time_entry.dose_time else None,
            "scheduled_for": self.scheduled_for.isoformat() if self.scheduled_for else None,
            "scheduled_date": self.scheduled_for.date().isoformat() if self.scheduled_for else None,
            "read_at": self.read_at.isoformat() if self.read_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
