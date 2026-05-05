from datetime import datetime
from app.exception import ValidationError


def utc_now_naive() -> datetime:
    return datetime.now().replace(microsecond=0)


def parse_positive_int(value, field_name: str, default: int = None, minimum: int = 1, maximum: int = None) -> int:
    if value in (None, "") and default is not None:
        value = default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{field_name} يجب أن يكون رقمًا صحيحًا.", {field_name: "رقم غير صالح."})
    if parsed < minimum:
        raise ValidationError(f"{field_name} يجب أن يكون على الأقل {minimum}.", {field_name: f"الحد الأدنى {minimum}."})
    if maximum is not None and parsed > maximum:
        parsed = maximum
    return parsed


def pagination_args(args, default_per_page: int = 20, max_per_page: int = 100):
    page = parse_positive_int(args.get("page"), "page", default=1, minimum=1)
    per_page = parse_positive_int(args.get("per_page"), "per_page", default=default_per_page, minimum=1, maximum=max_per_page)
    return page, per_page


def success_response(data=None, message: str = "تم تنفيذ الطلب بنجاح.", status_code: int = 200):
    body = {"success": True, "message": message}
    if data is not None:
        body["data"] = data
    return body, status_code


DAY_MAP = {0: "mon", 1: "tue", 2: "wed", 3: "thu", 4: "fri", 5: "sat", 6: "sun"}


def get_day_abbr(dt: datetime) -> str:
    return DAY_MAP[dt.weekday()]
