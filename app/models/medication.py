from app.extensions import db
from app.utils.helpers import utc_now_naive


class Medication(db.Model):
    __tablename__ = "medication"

    __table_args__ = (
        db.Index("ix_medication_active_name", "is_active", "name"),
        db.Index("ix_medication_category", "category"),
    )

    medication_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(150), unique=True, nullable=False)
    category = db.Column(db.String(100), nullable=False)
    form = db.Column(db.Enum("tablet", "capsule", "syrup", "injection", "drop", "ointment", "spray", "other"), nullable=False)
    strength = db.Column(db.String(50), nullable=False)
    available_quantity = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    description = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now_naive)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive)

    patient_medications = db.relationship("PatientMedication", back_populates="medication", lazy="dynamic")

    def to_dict(self):
        return {
            "medication_id": self.medication_id,
            "name": self.name,
            "category": self.category,
            "form": self.form,
            "strength": self.strength,
            "description": self.description,
            "is_active": bool(self.is_active),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
