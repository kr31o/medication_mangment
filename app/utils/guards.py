from functools import wraps
from flask_jwt_extended import get_jwt, get_jwt_identity
from app.exception import ForbiddenError, UnauthorizedError
from app.extensions import db


def _active_account_id(role: str) -> int:
    identity = get_jwt_identity()
    if identity is None:
        raise UnauthorizedError("يرجى تسجيل الدخول أولًا.")
    account_id = int(identity)

    if role == "patient":
        from app.models.patient import Patient
        account = db.session.get(Patient, account_id)
        if not account:
            raise UnauthorizedError("حساب المريض غير موجود. يرجى تسجيل الدخول مرة أخرى.")
        if account.status != "active":
            raise ForbiddenError("حسابك غير نشط. يرجى التواصل مع الإدارة.")
        return account_id

    if role == "admin":
        from app.models.admin import Admin
        account = db.session.get(Admin, account_id)
        if not account:
            raise UnauthorizedError("حساب الإدارة غير موجود. يرجى تسجيل الدخول مرة أخرى.")
        if account.status != "active":
            raise ForbiddenError("حساب الإدارة غير نشط.")
        return account_id

    raise ForbiddenError("نوع الحساب غير مدعوم.")


def role_required(*roles):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            role = get_jwt().get("role")
            if role not in roles:
                raise ForbiddenError("لا تملك صلاحية الوصول لهذه العملية.")
            _active_account_id(role)
            return f(*args, **kwargs)
        return wrapper
    return decorator


def get_current_patient_id() -> int:
    if get_jwt().get("role") != "patient":
        raise ForbiddenError("هذا الطلب مخصص لحساب المريض فقط.")
    return _active_account_id("patient")


def get_current_admin_id() -> int:
    if get_jwt().get("role") != "admin":
        raise ForbiddenError("هذا الطلب مخصص للإدارة فقط.")
    return _active_account_id("admin")
