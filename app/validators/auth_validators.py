from app.validators.common_validators import require_fields, validate_email, as_str
from app.exception import ValidationError


def validate_register(data: dict):
    require_fields(data, ["full_name", "email", "password"])
    password = str(data["password"])
    if len(password) < 6:
        raise ValidationError("كلمة المرور قصيرة جدًا.", {"password": "يجب أن تكون 6 أحرف على الأقل."})
    return {
        "full_name": as_str(data["full_name"], "full_name", max_len=120),
        "email": validate_email(data["email"]),
        "password": password,
        "phone": as_str(data.get("phone"), "phone", required=False, max_len=20),
    }


def validate_login(data: dict):
    require_fields(data, ["email", "password"])
    return {"email": validate_email(data["email"]), "password": str(data["password"])}
