from flask_jwt_extended import create_access_token, get_jwt
from werkzeug.security import generate_password_hash, check_password_hash
from app.models.patient import Patient
from app.models.admin import Admin
from app.models.blacklisted_token import BlacklistedToken
from app.repositories.patient_repo import PatientRepository
from app.exception import ConflictError, UnauthorizedError, ForbiddenError
from app.extensions import db


class AuthService:
    def __init__(self):
        self.patient_repo = PatientRepository()

    def register_patient(self, data: dict) -> dict:
        if self.patient_repo.find_by_email(data["email"]):
            raise ConflictError("هذا البريد الإلكتروني مسجل مسبقًا.")
        patient = Patient(
            full_name=data["full_name"],
            email=data["email"],
            password_hash=generate_password_hash(data["password"]),
            phone=data.get("phone"),
            status="active",
        )
        db.session.add(patient)
        db.session.commit()
        return patient.to_dict()

    def login_patient(self, data: dict) -> dict:
        patient = self.patient_repo.find_by_email(data["email"])
        if not patient or not check_password_hash(patient.password_hash, data["password"]):
            raise UnauthorizedError("البريد الإلكتروني أو كلمة المرور غير صحيحة.")
        if patient.status != "active":
            raise ForbiddenError("حسابك غير نشط. يرجى التواصل مع الإدارة.")
        token = create_access_token(identity=str(patient.patient_id), additional_claims={"role": "patient"})
        return {"access_token": token, "patient": patient.to_dict(), "role": "patient"}

    def login_admin(self, data: dict) -> dict:
        admin = Admin.query.filter_by(email=data["email"]).first()
        if not admin or not check_password_hash(admin.password_hash, data["password"]):
            raise UnauthorizedError("بيانات دخول الإدارة غير صحيحة.")
        if admin.status != "active":
            raise ForbiddenError("حساب الإدارة غير نشط.")
        token = create_access_token(identity=str(admin.admin_id), additional_claims={"role": "admin"})
        return {"access_token": token, "admin": admin.to_dict(), "role": "admin"}

    def logout(self):
        claims = get_jwt()
        jti = claims.get("jti")
        if jti and not BlacklistedToken.query.filter_by(jti=jti).first():
            db.session.add(BlacklistedToken(jti=jti, token_type=claims.get("type", "access")))
            db.session.commit()
