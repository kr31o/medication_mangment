from app.validators.common_validators import as_str
from app.exception import ValidationError


def validate_update_patient(data: dict):
    allowed = {}
    if "full_name" in data:
        allowed["full_name"] = as_str(data["full_name"], "full_name", max_len=120)
    if "phone" in data:
        allowed["phone"] = as_str(data.get("phone"), "phone", required=False, max_len=20)
    if "status" in data:
        status = as_str(data["status"], "status")
        if status not in ("active", "inactive"):
            raise ValidationError("حالة المريض غير صحيحة.", {"status": "اختر active أو inactive."})
        allowed["status"] = status
    if not allowed:
        raise ValidationError("لا توجد بيانات صالحة للتعديل.")
    return allowed
