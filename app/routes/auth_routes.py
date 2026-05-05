from flask import Blueprint, request
from flask_jwt_extended import jwt_required
from app.services.auth_service import AuthService
from app.validators.auth_validators import validate_register, validate_login
from app.utils.helpers import success_response

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")
_svc = AuthService()


@auth_bp.post("/register")
def register():
    data = validate_register(request.get_json(silent=True) or {})
    result = _svc.register_patient(data)
    return success_response(result, "تم إنشاء الحساب بنجاح.", 201)


@auth_bp.post("/login")
def login():
    data = validate_login(request.get_json(silent=True) or {})
    return success_response(_svc.login_patient(data), "تم تسجيل الدخول بنجاح.")


@auth_bp.post("/admin/login")
def admin_login():
    data = validate_login(request.get_json(silent=True) or {})
    return success_response(_svc.login_admin(data), "تم تسجيل دخول الإدارة بنجاح.")


@auth_bp.post("/logout")
@jwt_required()
def logout():
    _svc.logout()
    return success_response(message="تم تسجيل الخروج بنجاح.")
