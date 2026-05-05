import re
from decimal import Decimal, InvalidOperation
from app.exception import ValidationError


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def as_str(value, field_name: str, required: bool = True, max_len: int = None) -> str:
    if _blank(value):
        if required:
            raise ValidationError("يرجى تعبئة الحقول المطلوبة.", {field_name: "هذا الحقل مطلوب."})
        return None
    text = str(value).strip()
    if max_len is not None and len(text) > max_len:
        raise ValidationError("القيمة المدخلة طويلة جدًا.", {field_name: f"يجب ألا يتجاوز {max_len} حرفًا."})
    return text


def require_fields(data: dict, fields: list):
    missing = [field for field in fields if field not in data or _blank(data.get(field))]
    if missing:
        raise ValidationError("يرجى تعبئة الحقول المطلوبة.", {field: "هذا الحقل مطلوب." for field in missing})


def validate_email(email: str) -> str:
    email = as_str(email, "email", max_len=120).lower()
    if not re.match(r"^[\w\.-]+@[\w\.-]+\.\w{2,}$", email):
        raise ValidationError("صيغة البريد الإلكتروني غير صحيحة.", {"email": "اكتب بريدًا صحيحًا مثل name@example.com."})
    return email


def parse_bool(value, field_name: str = "value") -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"true", "1", "yes", "y", "on"}:
            return True
        if v in {"false", "0", "no", "n", "off"}:
            return False
    raise ValidationError("قيمة نعم/لا غير صحيحة.", {field_name: "استخدم true أو false."})


def validate_int(value, field_name: str, minimum: int = None, maximum: int = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValidationError("يرجى إدخال رقم صحيح.", {field_name: "رقم غير صالح."})
    if minimum is not None and parsed < minimum:
        raise ValidationError("القيمة أقل من الحد المسموح.", {field_name: f"الحد الأدنى {minimum}."})
    if maximum is not None and parsed > maximum:
        raise ValidationError("القيمة أكبر من الحد المسموح.", {field_name: f"الحد الأعلى {maximum}."})
    return parsed


def validate_decimal(value, field_name: str, allow_zero: bool = True) -> Decimal:
    try:
        dec = Decimal(str(value).strip())
    except (InvalidOperation, AttributeError, ValueError, TypeError):
        raise ValidationError("يرجى إدخال رقم صالح.", {field_name: "اكتب رقمًا صحيحًا مثل 10 أو 10.5."})
    if not dec.is_finite():
        raise ValidationError("يرجى إدخال رقم صالح.", {field_name: "الرقم غير صالح."})
    if allow_zero and dec < 0:
        raise ValidationError("القيمة لا يمكن أن تكون سالبة.", {field_name: "أدخل صفرًا أو رقمًا أكبر."})
    if not allow_zero and dec <= 0:
        raise ValidationError("القيمة يجب أن تكون أكبر من صفر.", {field_name: "أدخل رقمًا أكبر من صفر."})
    return dec


def validate_date_str(value, field_name: str):
    from datetime import date
    try:
        return date.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        raise ValidationError("صيغة التاريخ غير صحيحة.", {field_name: "استخدم الصيغة YYYY-MM-DD."})


def validate_time_str(value, field_name: str):
    from datetime import time
    try:
        parsed = time.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        raise ValidationError("صيغة الوقت غير صحيحة.", {field_name: "استخدم الصيغة HH:MM مثل 09:30."})
    if parsed.second or parsed.microsecond:
        raise ValidationError("صيغة الوقت غير صحيحة.", {field_name: "حدد الوقت بالدقائق فقط مثل 09:30."})
    return parsed.replace(second=0, microsecond=0)
