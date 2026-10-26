"""أدوات صغيرة مشتركة: الوقت بـ UTC، تحويل القيم إلى JSON، وتمييز العدد بالعربية («علبتان»، «3 علب»).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any

from flask.json.provider import DefaultJSONProvider


# ======== الوقت (UTC)

def utc_now() -> datetime:
    """وقت UTC بلا tzinfo، ليطابق أعمدة DATETIME(6) (BR-024).

    القاعدة في كل المنصة: كل datetime مخزّن أو متبادل داخليًا هو UTC
    بلا tzinfo. التحويل إلى توقيت محلي يحدث فقط عند حساب مواعيد الجرعات
    وعند العرض في الواجهة.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_iso_utc(value: datetime) -> str:
    """ISO 8601 بلاحقة Z. الـ datetime بلا tzinfo يُعامل كـ UTC."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.isoformat(timespec="microseconds") + "Z"


def parse_iso_utc(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


# ======== JSON

def to_jsonable(value: Any) -> Any:
    """يحوّل القيم إلى صيغة JSON ثابتة عبر كل المنصة.

    - datetime  → ISO 8601 بلاحقة Z (Flask الافتراضي يخرج صيغة RFC 822)
    - Decimal   → نص، حفاظًا على الدقة في الأسعار والكميات
    - date/time → ISO
    """
    if isinstance(value, datetime):
        return to_iso_utc(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item) for item in value]
    return value


def plain_decimal(value: Decimal | None) -> str | None:
    """كمية بلا أصفار زائدة: 24.00 → "24"، و 2.50 → "2.5".

    للكميات والأحجام فقط. الأسعار تبقى بخانتين ثابتتين عبر to_jsonable.
    """
    if value is None:
        return None
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


class ApiJSONProvider(DefaultJSONProvider):
    ensure_ascii = False  # النص العربي يخرج كما هو، لا ا...
    sort_keys = False

    def dumps(self, obj: Any, **kwargs: Any) -> str:
        return super().dumps(to_jsonable(obj), **kwargs)


# ======== العدد بالعربية
# صياغة الأعداد مع المعدود بالعربية في نصوص الإشعارات والملخصات.
#
# "3 علبة" و"68 قرص" خطأ نحوي يلاحظه أي قارئ عربي. القاعدة المطبقة
# (المعتمدة في الكتابة الحديثة):
#
#     1        → علبة واحدة / قرص واحد
#     2        → علبتان (رفع) / علبتين (نصب وجر)
#     3..10    → 3 علب / 3 أقراص            (جمع)
#     11..99   → 11 علبة / 11 قرصًا          (مفرد منصوب)
#     100، 1000... ومضاعفاتها → 100 علبة / 100 قرص   (مفرد مجرور)
#     غير الصحيح (2.5) → 2.5 مل             (الوحدة كما هي)

# المفرد، المثنى رفعًا، المثنى نصبًا، الجمع، المفرد المنصوب (للتمييز 11–99)، مؤنث؟
NOUNS: dict[str, tuple[str, str, str, str, str, bool]] = {
    "box": ("علبة", "علبتان", "علبتين", "علب", "علبة", True),
    "TABLET": ("قرص", "قرصان", "قرصين", "أقراص", "قرصًا", False),
    "CAPSULE": ("كبسولة", "كبسولتان", "كبسولتين", "كبسولات", "كبسولة", True),
    "ML": ("مل", "مل", "مل", "مل", "مل", False),
    "G": ("غرام", "غرامان", "غرامين", "غرامات", "غرامًا", False),
    "DOSE": ("بخّة", "بخّتان", "بخّتين", "بخّات", "بخّة", True),
    "PIECE": ("قطعة", "قطعتان", "قطعتين", "قطع", "قطعة", True),
    "dose": ("جرعة", "جرعتان", "جرعتين", "جرعات", "جرعة", True),
    "item": ("صنف", "صنفان", "صنفين", "أصناف", "صنفًا", False),
    "medication": ("دواء", "دواءان", "دواءين", "أدوية", "دواءً", False),
}


def _number(value) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def count(value, noun: str, *, accusative: bool = False) -> str:
    """العدد مع معدوده بصيغة صحيحة. `accusative` للمثنى في موقع النصب أو الجر
    (بعد حرف جر: "إلى علبتين")."""
    singular, dual_nom, dual_acc, plural, tamyeez, feminine = NOUNS.get(noun, (noun,) * 5 + (False,))
    number = _number(value)
    if number is None:
        return f"{value} {singular}"
    if number != number.to_integral_value():
        return f"{format(number.normalize(), 'f')} {singular}"
    n = int(number)
    if noun not in NOUNS or singular == dual_nom == plural:
        # وحدة لا تُثنّى ولا تُجمع (مل) أو معدود غير معروف: الرقم يُكتب دائمًا.
        # المثنى هنا كان يُسقط الرقم: "2 مل" تصبح "مل".
        return f"{n} {singular}"
    if n == 1:
        return f"{singular} {'واحدة' if feminine else 'واحد'}"
    if n == 2:
        return dual_acc if accusative else dual_nom
    if 3 <= n % 100 <= 10:
        return f"{n} {plural}"
    if 11 <= n % 100 <= 99:
        return f"{n} {tamyeez}"
    return f"{n} {singular}"


def money(amount, currency: str) -> str:
    """المبلغ كما يظهر في نص الإشعار: «7,500 ل.س»، «75.50 ل.س»، «5.50 دينار»."""
    number = _number(amount) or Decimal("0")
    name = {"SYP": "ل.س", "JOD": "دينار"}.get(currency, currency)
    if currency == "JOD":
        return f"{number.quantize(Decimal('0.01'))} {name}"
    # الليرة تُكتب بفواصل الآلاف وبلا كسور إلا إن وُجدت.
    text = f"{number.quantize(Decimal('0.01')):,.2f}"
    return f"{text.removesuffix('.00')} {name}"
