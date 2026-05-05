from app.exception import ValidationError

DOSE_PERIODS = {
    "morning": {"label": "صباحًا", "icon": "🌅"},
    "evening": {"label": "مساءً", "icon": "🌙"},
}
DEFAULT_REMINDER_MINUTES = 0


def normalize_period(value: str) -> str:
    value = str(value or "").strip().lower()
    aliases = {
        "morning": "morning", "am": "morning", "صباح": "morning", "صباحا": "morning", "صباحًا": "morning",
        "evening": "evening", "pm": "evening", "مساء": "evening", "مساءا": "evening", "مساءً": "evening",
    }
    period = aliases.get(value)
    if not period:
        raise ValidationError("اختر فترة جرعة صحيحة: صباحًا أو مساءً.", {"dose_period": "اختر صباحًا أو مساءً فقط."})
    return period


def period_label(period: str) -> str:
    if not period:
        return None
    try:
        return DOSE_PERIODS[normalize_period(period)]["label"]
    except ValidationError:
        return str(period)
