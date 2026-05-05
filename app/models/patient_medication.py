from app.extensions import db


class PatientMedication(db.Model):
    __tablename__ = "patient_medication"

    __table_args__ = (
        db.UniqueConstraint("patient_id", "medication_id", name="uq_patient_medication"),
        db.Index("ix_patient_medication_patient_status", "patient_id", "status"),
    )

    patient_med_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    patient_id = db.Column(db.Integer, db.ForeignKey("patient.patient_id"), nullable=False)
    medication_id = db.Column(db.Integer, db.ForeignKey("medication.medication_id"), nullable=False)
    current_quantity = db.Column(db.Numeric(10, 2), nullable=False)
    min_threshold = db.Column(db.Numeric(10, 2), nullable=False)
    status = db.Column(db.Enum("active", "stopped"), nullable=False, default="active")
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=True)
    notes = db.Column(db.Text, nullable=True)

    patient = db.relationship("Patient", back_populates="patient_medications")
    medication = db.relationship("Medication", back_populates="patient_medications")
    schedules = db.relationship("DosageSchedule", back_populates="patient_medication", lazy="dynamic", cascade="all, delete-orphan")
    dose_logs = db.relationship("DoseLog", back_populates="patient_medication", lazy="dynamic", cascade="all, delete-orphan")
    notifications = db.relationship("Notification", back_populates="patient_medication", lazy="dynamic")

    def to_dict(self):
        med = self.medication
        return {
            "patient_med_id": self.patient_med_id,
            "patient_id": self.patient_id,
            "medication_id": self.medication_id,
            "medication_name": med.name if med else None,
            "medication_category": med.category if med else None,
            "medication_form": med.form if med else None,
            "medication_strength": med.strength if med else None,
            "current_quantity": float(self.current_quantity or 0),
            "min_threshold": float(self.min_threshold or 0),
            "status": self.status,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "notes": self.notes,
        }
