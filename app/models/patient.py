from app.extensions import db
from app.utils.helpers import utc_now_naive


class Patient(db.Model):
    __tablename__ = "patient"

    patient_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    phone = db.Column(db.String(20), nullable=True)
    status = db.Column(db.Enum("active", "inactive"), nullable=False, default="active")
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now_naive)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive)

    patient_medications = db.relationship("PatientMedication", back_populates="patient", lazy="dynamic", cascade="all, delete-orphan")
    notifications = db.relationship("Notification", back_populates="patient", lazy="dynamic", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "patient_id": self.patient_id,
            "full_name": self.full_name,
            "email": self.email,
            "phone": self.phone,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
