from app.validators.common_validators import require_fields, as_str, validate_decimal, validate_date_str, validate_int, parse_bool, validate_time_str
from app.utils.dose_periods import DEFAULT_REMINDER_MINUTES, normalize_period
from app.exception import ValidationError

VALID_FORMS = {"tablet", "capsule", "syrup", "injection", "drop", "ointment", "spray", "other"}
VALID_CATEGORIES = ["قلبية", "نفسية", "سكري", "ضغط", "مسكنات", "مضاد حيوي", "حساسية", "أخرى"]
VALID_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
DAY_ORDER = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]


def ensure_quantity_above_threshold(current_quantity, min_threshold):
    if current_quantity <= min_threshold:
        raise ValidationError(
            "الكمية الحالية يجب أن تكون أكبر من حد تنبيه النفاد.",
            {
                "current_quantity": "أدخل كمية أكبر من حد التنبيه.",
                "min_threshold": "حد التنبيه يجب أن يكون أقل من الكمية الحالية.",
            },
        )


def validate_category(value):
    category = as_str(value, "category", max_len=100)
    if category not in VALID_CATEGORIES:
        raise ValidationError("اختر تصنيفًا صحيحًا من القائمة.", {"category": "التصنيف غير موجود ضمن التصنيفات المعتمدة."})
    return category


def validate_form(value):
    form = as_str(value, "form").lower()
    if form not in VALID_FORMS:
        raise ValidationError("شكل الدواء غير صحيح.", {"form": "اختر شكلًا صحيحًا من القائمة."})
    return form


def validate_add_medication(data: dict):
    require_fields(data, ["name", "category", "form", "strength"])
    return {
        "name": as_str(data["name"], "name", max_len=150),
        "category": validate_category(data["category"]),
        "form": validate_form(data["form"]),
        "strength": as_str(data["strength"], "strength", max_len=50),
        "description": as_str(data.get("description"), "description", required=False),
        "is_active": parse_bool(data.get("is_active", True), "is_active"),
    }


def validate_update_medication(data: dict):
    allowed = {}
    if "name" in data:
        allowed["name"] = as_str(data["name"], "name", max_len=150)
    if "category" in data:
        allowed["category"] = validate_category(data["category"])
    if "form" in data:
        allowed["form"] = validate_form(data["form"])
    if "strength" in data:
        allowed["strength"] = as_str(data["strength"], "strength", max_len=50)
    if "description" in data:
        allowed["description"] = as_str(data.get("description"), "description", required=False)
    if "is_active" in data:
        allowed["is_active"] = parse_bool(data["is_active"], "is_active")
    if not allowed:
        raise ValidationError("لا توجد بيانات صالحة للتعديل.")
    return allowed


def validate_add_patient_medication(data: dict):
    require_fields(data, ["medication_id", "current_quantity", "min_threshold", "start_date"])
    start = validate_date_str(data["start_date"], "start_date")
    end = validate_date_str(data["end_date"], "end_date") if data.get("end_date") else None
    if end and end <= start:
        raise ValidationError("تاريخ النهاية يجب أن يكون بعد تاريخ البداية.", {"end_date": "اختر تاريخًا لاحقًا."})
    current_quantity = validate_decimal(data["current_quantity"], "current_quantity", allow_zero=False)
    min_threshold = validate_decimal(data["min_threshold"], "min_threshold", allow_zero=True)
    ensure_quantity_above_threshold(current_quantity, min_threshold)
    return {
        "medication_id": validate_int(data["medication_id"], "medication_id", minimum=1),
        "current_quantity": current_quantity,
        "min_threshold": min_threshold,
        "start_date": start,
        "end_date": end,
        "notes": as_str(data.get("notes"), "notes", required=False),
    }


def validate_update_patient_medication(data: dict):
    allowed = {}
    if "current_quantity" in data:
        allowed["current_quantity"] = validate_decimal(data["current_quantity"], "current_quantity", allow_zero=False)
    if "min_threshold" in data:
        allowed["min_threshold"] = validate_decimal(data["min_threshold"], "min_threshold", allow_zero=True)
    if "current_quantity" in allowed and "min_threshold" in allowed:
        ensure_quantity_above_threshold(allowed["current_quantity"], allowed["min_threshold"])
    if "end_date" in data:
        allowed["end_date"] = validate_date_str(data["end_date"], "end_date") if data["end_date"] else None
    if "notes" in data:
        allowed["notes"] = as_str(data.get("notes"), "notes", required=False)
    if not allowed:
        raise ValidationError("لا توجد بيانات صالحة للتعديل.")
    return allowed


def validate_activate_patient_medication(data: dict):
    require_fields(data, ["current_quantity"])
    current_quantity = validate_decimal(data["current_quantity"], "current_quantity", allow_zero=False)
    min_threshold = validate_decimal(data.get("min_threshold", 0), "min_threshold", allow_zero=True)
    ensure_quantity_above_threshold(current_quantity, min_threshold)
    return {"current_quantity": current_quantity, "min_threshold": min_threshold}


def _normalize_days(days):
    if not isinstance(days, list) or not days:
        raise ValidationError("اختر يومًا واحدًا على الأقل للجرعات.", {"days": "هذا الحقل مطلوب."})
    normalized = []
    for day in days:
        day = as_str(day, "day_of_week").lower()
        if day not in VALID_DAYS:
            raise ValidationError("يوجد يوم غير صحيح في جدول الجرعات.", {"days": "اختر أيامًا من القائمة."})
        if day not in normalized:
            normalized.append(day)
    return sorted(normalized, key=lambda d: DAY_ORDER.index(d))


def _normalize_dose_periods(periods):
    if not isinstance(periods, list) or not periods:
        raise ValidationError("اختر فترة صباحًا أو مساءً على الأقل.", {"dose_periods": "هذا الحقل مطلوب."})
    result, seen_periods, seen_times = [], set(), set()
    for item in periods:
        if not isinstance(item, dict):
            raise ValidationError("بيانات فترة الجرعة غير صحيحة.")
        require_fields(item, ["dose_period", "dose_time", "dose_amount", "dose_unit"])
        period = normalize_period(item["dose_period"])
        if period in seen_periods:
            raise ValidationError("لا يمكن تكرار نفس فترة الجرعة.", {"dose_periods": "اختر صباحًا مرة واحدة ومساءً مرة واحدة فقط."})
        seen_periods.add(period)
        dose_time = validate_time_str(item["dose_time"], "dose_time")
        if dose_time in seen_times:
            raise ValidationError("لا يمكن تكرار نفس وقت الجرعة داخل الجدول.", {"dose_time": "اختر وقتًا مختلفًا لكل جرعة."})
        seen_times.add(dose_time)
        result.append({
            "dose_period": period,
            "dose_time": dose_time,
            "dose_amount": validate_decimal(item["dose_amount"], "dose_amount", allow_zero=False),
            "dose_unit": as_str(item["dose_unit"], "dose_unit", max_len=30),
            "reminder_before_minutes": DEFAULT_REMINDER_MINUTES,
        })
    return result


def validate_dosage_schedule(data: dict):
    require_fields(data, ["start_date", "days"])
    start = validate_date_str(data["start_date"], "start_date")
    is_continuous = parse_bool(data.get("is_continuous", True), "is_continuous")
    end = None
    if not is_continuous:
        if not data.get("end_date"):
            raise ValidationError("تاريخ النهاية مطلوب إذا كان الجدول غير مستمر.", {"end_date": "هذا الحقل مطلوب."})
        end = validate_date_str(data["end_date"], "end_date")
        if end <= start:
            raise ValidationError("تاريخ نهاية الجدول يجب أن يكون بعد تاريخ البداية.", {"end_date": "اختر تاريخًا لاحقًا."})
    periods = data.get("dose_periods", data.get("dose_times"))
    return {
        "start_date": start,
        "end_date": end,
        "is_continuous": is_continuous,
        "days": _normalize_days(data.get("days")),
        "dose_periods": _normalize_dose_periods(periods),
    }
