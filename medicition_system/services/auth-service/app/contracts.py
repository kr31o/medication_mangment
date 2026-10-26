"""عقد الـ API: فحص مدخلات كل طلب (البريد، الهاتف، كلمة المرور…) ورموز الأخطاء وحالاتها HTTP.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Mapping



class RegistrationAccountType(StrEnum):
    """Public account types that can be requested during self-registration."""

    PATIENT = "PATIENT"
    PHARMACY = "PHARMACY"


class ErrorCode(StrEnum):
    """Stable machine-readable API error codes for Auth Service."""

    INVALID_REQUEST = "INVALID_REQUEST"
    REQUEST_TOO_LARGE = "REQUEST_TOO_LARGE"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    ACCOUNT_ALREADY_EXISTS = "ACCOUNT_ALREADY_EXISTS"
    RATE_LIMITED = "RATE_LIMITED"
    REFRESH_TOKEN_INVALID = "REFRESH_TOKEN_INVALID"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    # §15.2 من المواصفة ينص على 403 و404، ولم تكن ممثلة هنا. غيابها
    # كان يجعل كل مسار غير موجود يسقط في معالج Exception ويرجع 500.
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    # كلمة المرور صحيحة لكن الأدمن أوقف الحساب؛ السبب في error.details.reason.
    ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED"


_ERROR_HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.INVALID_REQUEST: 400,
    ErrorCode.REQUEST_TOO_LARGE: 413,
    ErrorCode.VALIDATION_ERROR: 422,
    ErrorCode.INVALID_CREDENTIALS: 401,
    ErrorCode.ACCOUNT_ALREADY_EXISTS: 409,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.REFRESH_TOKEN_INVALID: 401,
    ErrorCode.SERVICE_UNAVAILABLE: 503,
    ErrorCode.INTERNAL_ERROR: 500,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.METHOD_NOT_ALLOWED: 405,
    ErrorCode.ACCOUNT_SUSPENDED: 403,
}


# ASCII فقط بعد casefold. ترتيب MySQL للعمود (utf8mb4_0900_ai_ci) يساوي
# "víctim" بـ "victim"، بينما مفتاح حد المحاولات يُحسب من النص كما هو: لو قبلنا
# الأحرف المشكّلة لصار لكل صيغة من بريد الضحية عدّاد مستقل يتخطى الحد.
EMAIL_PATTERN = re.compile(
    r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$"
)
MAX_EMAIL_LENGTH = 254
PHONE_PATTERN = re.compile(r"^\+[1-9][0-9]{7,14}$")

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128


@dataclass(frozen=True, slots=True)
class RegisterRequest:
    """Validated public registration contract."""

    account_type: RegistrationAccountType
    email: str | None
    phone: str | None
    password: str

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any]) -> "RegisterRequest":
        """Parse and validate the externally supplied registration payload."""
        if not isinstance(payload, Mapping):
            raise ValueError("Request body must be a JSON object.")

        raw_account_type = payload.get("account_type")
        account_type_value = (
            str(raw_account_type).strip().upper()
            if raw_account_type is not None
            else ""
        )

        try:
            account_type = RegistrationAccountType(account_type_value)
        except ValueError as exc:
            raise ValueError(
                "account_type must be PATIENT or PHARMACY."
            ) from exc

        email = _normalize_email(payload.get("email"))
        phone = _normalize_phone(payload.get("phone"))
        password = payload.get("password")

        # معرّف واحد بالضبط: البريد أو الهاتف، وبه يدخل صاحب الحساب.
        if email is None and phone is None:
            raise ValueError("Exactly one of email or phone is required.")

        if email is not None and phone is not None:
            raise ValueError("Provide either email or phone, not both.")

        if email is not None and not EMAIL_PATTERN.fullmatch(email):
            raise ValueError("email format is invalid.")

        if phone is not None and not PHONE_PATTERN.fullmatch(phone):
            raise ValueError("phone must use E.164 format.")

        password = _check_password(password)

        return cls(
            account_type=account_type,
            email=email,
            phone=phone,
            password=password,
        )


def _ensure_encodable(value: str, field: str) -> None:
    # surrogate منفرد (\ud800) نص JSON صالح لا يُرمَّز UTF-8: كان يصل إلى
    # التجزئة أو MySQL فيرجع 500 بدل 422.
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ValueError(f"{field} contains invalid characters.") from exc


def _normalize_optional_text(value: Any) -> str | None:
    if value is None:
        return None

    if not isinstance(value, str):
        raise ValueError("Text fields must be strings.")
    _ensure_encodable(value, "Text field")

    normalized = value.strip()
    return normalized or None


def _normalize_email(value: Any) -> str | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    normalized = normalized.casefold()
    # الطول بعد casefold لأنه قد يطيل النص؛ العمود VARCHAR(320) والحد العملي 254.
    if len(normalized) > MAX_EMAIL_LENGTH:
        raise ValueError("email format is invalid.")
    return normalized


def _check_password(value: Any, field: str = "password") -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string.")
    _ensure_encodable(value, field)
    if not MIN_PASSWORD_LENGTH <= len(value) <= MAX_PASSWORD_LENGTH:
        raise ValueError(
            f"{field} length must be between {MIN_PASSWORD_LENGTH} and "
            f"{MAX_PASSWORD_LENGTH} characters."
        )
    return value


def _normalize_phone(value: Any) -> str | None:
    return _normalize_optional_text(value)


def http_status_for(error_code: ErrorCode) -> int:
    """Return the stable HTTP status associated with an Auth error code."""
    return _ERROR_HTTP_STATUS[error_code]


@dataclass(frozen=True, slots=True)
class LoginRequest:
    """Validated login contract."""

    identifier: str
    password: str

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any]) -> "LoginRequest":
        if not isinstance(payload, Mapping):
            raise ValueError("Request body must be a JSON object.")

        identifier = _normalize_optional_text(payload.get("identifier"))
        password = payload.get("password")

        if not identifier:
            raise ValueError("identifier is required.")
        password = _check_password(password)

        if "@" in identifier:
            normalized = _normalize_email(identifier)
            if normalized is None or not EMAIL_PATTERN.fullmatch(normalized):
                raise ValueError("identifier email format is invalid.")
            return cls(identifier=normalized, password=password)

        normalized = _normalize_phone(identifier)
        if normalized is None or not PHONE_PATTERN.fullmatch(normalized):
            raise ValueError("identifier phone must use E.164 format.")
        return cls(identifier=normalized, password=password)


@dataclass(frozen=True, slots=True)
class RefreshTokenRequest:
    """Validated refresh-token request contract."""

    refresh_token: str

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any]) -> "RefreshTokenRequest":
        if not isinstance(payload, Mapping):
            raise ValueError("Request body must be a JSON object.")

        refresh_token = _normalize_optional_text(payload.get("refresh_token"))
        if not refresh_token:
            raise ValueError("refresh_token is required.")
        if not 40 <= len(refresh_token) <= 256:
            raise ValueError("refresh_token format is invalid.")
        return cls(refresh_token=refresh_token)
