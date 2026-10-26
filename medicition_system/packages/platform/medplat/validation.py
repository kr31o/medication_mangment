"""التحقق من المدخلات بعقود صارمة.

قراران مقصودان:

1. **تُجمع كل الأخطاء ثم تُرفع مرة واحدة** في `details`، فتعرض الواجهة
   كل حقل خاطئ بجانبه بدل أن يصحح المستخدم خطأً ثم يكتشف التالي.

2. **الحقول غير المعروفة تُرفض.** هذا ليس تشددًا شكليًا: هو ما يطبّق
   BR-010 عمليًا. لو قبل endpoint المخزون حقلًا اسمه `pharmacy_ref` في
   الـ body وتجاهله بصمت، لظن العميل أنه يستطيع تمريره. رفضه صراحة
   يغلق الباب ويوثّق القاعدة في سلوك الـ API نفسه.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Iterable, Mapping
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from flask import request

from medplat.web import BadRequest, ValidationFailed

_MISSING = object()
MIN_DATE = date(1900, 1, 1)
MAX_DATE = date(2100, 12, 31)
PHONE_PATTERN = re.compile(r"^\+[1-9][0-9]{7,14}$")
# مطابق لـ Auth: ASCII فقط بعد casefold (انظر auth-service/app/contracts.py).
EMAIL_PATTERN = re.compile(
    r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$"
)


def json_body() -> dict[str, Any]:
    if not request.is_json:
        raise BadRequest("Content-Type must be application/json.")
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise BadRequest("Request body must be a JSON object.")
    return payload


class Fields:
    """قارئ حقول يجمع الأخطاء. يعمل على JSON body أو على query string."""

    def __init__(
        self,
        source: Mapping[str, Any],
        *,
        allowed: Iterable[str] | None = None,
        prefix: str = "",
    ) -> None:
        self._source = source
        self._prefix = prefix
        self.errors: dict[str, str] = {}
        if allowed is not None:
            allowed_set = set(allowed)
            for key in source:
                if key not in allowed_set:
                    self.errors[self._name(key)] = "Unknown field."

    # ------------------------------------------------------------------ helpers

    def _name(self, key: str) -> str:
        return f"{self._prefix}{key}"

    def _fail(self, key: str, message: str) -> None:
        self.errors.setdefault(self._name(key), message)

    def _raw(self, key: str, required: bool) -> Any:
        value = self._source.get(key, _MISSING)
        if value is _MISSING or value is None or (isinstance(value, str) and not value.strip()):
            if required:
                self._fail(key, "This field is required.")
            return _MISSING
        return value

    def raise_if_invalid(self) -> None:
        if self.errors:
            raise ValidationFailed("Request validation failed.", details=self.errors)

    # ------------------------------------------------------------------ types

    def string(
        self,
        key: str,
        *,
        required: bool = True,
        min_len: int = 1,
        max_len: int = 255,
        default: str | None = None,
        collapse_spaces: bool = False,
    ) -> str | None:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return default
        if not isinstance(raw, str):
            self._fail(key, "Must be a string.")
            return default
        try:
            # JSON يسمح بـ surrogate منفرد (\ud800) لا يُرمَّز UTF-8: كان يصل إلى
            # MySQL فيفجّر 500. NFC يوحّد الحرف المركّب وغير المركّب.
            raw.encode("utf-8")
        except UnicodeEncodeError:
            self._fail(key, "Contains invalid characters.")
            return default
        value = unicodedata.normalize("NFC", raw).strip()
        if collapse_spaces:
            # "500 mg" و "500  mg" قيمة واحدة: لا يتكرر الدواء في الكتالوج بفارق مسافة.
            value = " ".join(value.split())
        if not min_len <= len(value) <= max_len:
            self._fail(key, f"Length must be between {min_len} and {max_len} characters.")
            return default
        return value

    def email(self, key: str, *, required: bool = True) -> str | None:
        value = self.string(key, required=required, max_len=320)
        if value is None:
            return None
        value = value.casefold()
        # الطول بعد casefold (قد يطيل النص)، وحد RFC العملي 254.
        if len(value) > 254 or not EMAIL_PATTERN.fullmatch(value):
            self._fail(key, "Email format is invalid.")
            return None
        return value

    def phone(self, key: str, *, required: bool = True) -> str | None:
        value = self.string(key, required=required, max_len=16)
        if value is None:
            return None
        if not PHONE_PATTERN.fullmatch(value):
            self._fail(key, "Phone must use E.164 format, e.g. +962790000000.")
            return None
        return value

    def uuid(self, key: str, *, required: bool = True) -> str | None:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return None
        try:
            return str(UUID(str(raw)))
        except (ValueError, TypeError):
            self._fail(key, "Must be a valid UUID.")
            return None

    def integer(
        self,
        key: str,
        *,
        required: bool = True,
        minimum: int | None = None,
        maximum: int | None = None,
        default: int | None = None,
    ) -> int | None:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return default
        if isinstance(raw, bool):
            self._fail(key, "Must be an integer.")
            return default
        try:
            value = int(raw) if isinstance(raw, str) else raw
        except ValueError:
            self._fail(key, "Must be an integer.")
            return default
        if not isinstance(value, int):
            self._fail(key, "Must be an integer.")
            return default
        if minimum is not None and value < minimum:
            self._fail(key, f"Must be at least {minimum}.")
            return default
        if maximum is not None and value > maximum:
            self._fail(key, f"Must be at most {maximum}.")
            return default
        return value

    def decimal(
        self,
        key: str,
        *,
        required: bool = True,
        minimum: Decimal | None = None,
        maximum: Decimal | None = None,
        places: int = 2,
    ) -> Decimal | None:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return None
        if isinstance(raw, bool) or isinstance(raw, float):
            # float يفقد الدقة (0.1 + 0.2). المبالغ تُرسل نصًا أو عددًا صحيحًا.
            if isinstance(raw, float):
                raw = repr(raw)
            else:
                self._fail(key, "Must be a decimal number.")
                return None
        try:
            value = Decimal(str(raw))
        except InvalidOperation:
            self._fail(key, "Must be a decimal number.")
            return None
        if not value.is_finite():
            self._fail(key, "Must be a finite number.")
            return None
        if -value.as_tuple().exponent > places:
            self._fail(key, f"At most {places} decimal places are allowed.")
            return None
        if minimum is not None and value < minimum:
            self._fail(key, f"Must be at least {minimum}.")
            return None
        if maximum is not None and value > maximum:
            self._fail(key, f"Must be at most {maximum}.")
            return None
        return value

    def number(
        self,
        key: str,
        *,
        required: bool = True,
        minimum: float | None = None,
        maximum: float | None = None,
    ) -> float | None:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return None
        if isinstance(raw, bool):
            self._fail(key, "Must be a number.")
            return None
        try:
            value = float(raw)
        except (TypeError, ValueError):
            self._fail(key, "Must be a number.")
            return None
        if not math.isfinite(value):
            # nan تتخطى كل مقارنة (nan < x و nan > x كلاهما False) فتصل لـ SQL.
            self._fail(key, "Must be a finite number.")
            return None
        if minimum is not None and value < minimum:
            self._fail(key, f"Must be at least {minimum}.")
            return None
        if maximum is not None and value > maximum:
            self._fail(key, f"Must be at most {maximum}.")
            return None
        return value

    def boolean(self, key: str, *, required: bool = True, default: bool | None = None) -> bool | None:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return default
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str) and raw.lower() in {"true", "false", "1", "0"}:
            return raw.lower() in {"true", "1"}
        self._fail(key, "Must be a boolean.")
        return default

    def choice(
        self,
        key: str,
        choices: Iterable[str],
        *,
        required: bool = True,
        default: str | None = None,
        upper: bool = True,
    ) -> str | None:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return default
        if not isinstance(raw, str):
            self._fail(key, "Must be a string.")
            return default
        value = raw.strip().upper() if upper else raw.strip()
        options = tuple(choices)
        if value not in options:
            self._fail(key, f"Must be one of: {', '.join(options)}.")
            return default
        return value

    def date(self, key: str, *, required: bool = True) -> date | None:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return None
        try:
            value = date.fromisoformat(str(raw))
        except ValueError:
            self._fail(key, "Must be a date in YYYY-MM-DD format.")
            return None
        # 9999-12-31 تاريخ صالح في Python، لكن "اليوم التالي" له أو تحويله
        # بين المناطق الزمنية يرمي OverflowError فيصبح الطلب 500. نحصر
        # المدى في ما له معنى لمنصة أدوية.
        if not MIN_DATE <= value <= MAX_DATE:
            self._fail(key, f"Must be between {MIN_DATE.isoformat()} and {MAX_DATE.isoformat()}.")
            return None
        return value

    def time_of_day(self, key: str, *, required: bool = True) -> time | None:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return None
        try:
            parsed = time.fromisoformat(str(raw))
        except ValueError:
            self._fail(key, "Must be a time in HH:MM format.")
            return None
        return parsed.replace(second=0, microsecond=0, tzinfo=None)

    def datetime_utc(self, key: str, *, required: bool = True) -> datetime | None:
        from medplat.util import parse_iso_utc

        raw = self._raw(key, required)
        if raw is _MISSING:
            return None
        try:
            value = parse_iso_utc(str(raw))
        except (ValueError, OverflowError):
            self._fail(key, "Must be an ISO 8601 datetime.")
            return None
        if not MIN_DATE <= value.date() <= MAX_DATE:
            self._fail(key, f"Must be between {MIN_DATE.isoformat()} and {MAX_DATE.isoformat()}.")
            return None
        return value

    def items(
        self,
        key: str,
        *,
        required: bool = True,
        min_items: int = 1,
        max_items: int = 50,
    ) -> list[Any]:
        raw = self._raw(key, required)
        if raw is _MISSING:
            return []
        if not isinstance(raw, list):
            self._fail(key, "Must be a list.")
            return []
        if not min_items <= len(raw) <= max_items:
            self._fail(key, f"Must contain between {min_items} and {max_items} items.")
            return []
        return raw

    def nested(self, key: str, value: Any, *, allowed: Iterable[str]) -> "Fields | None":
        """حقول كائن داخل قائمة: الأخطاء تُسمّى items[0].quantity مثلاً."""
        if not isinstance(value, Mapping):
            self._fail(key, "Must be an object.")
            return None
        child = Fields(value, allowed=allowed, prefix=f"{self._prefix}{key}.")
        return child

    def absorb(self, child: "Fields | None") -> None:
        if child is not None:
            for field, message in child.errors.items():
                self.errors.setdefault(field, message)


def page_params(*, default_limit: int = 20, max_limit: int = 100) -> tuple[int, int]:
    fields = Fields(request.args)
    limit = fields.integer("limit", required=False, minimum=1, maximum=max_limit, default=default_limit)
    offset = fields.integer("offset", required=False, minimum=0, maximum=1_000_000, default=0)
    fields.raise_if_invalid()
    return int(limit), int(offset)
