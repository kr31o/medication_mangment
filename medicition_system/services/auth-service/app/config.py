from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

from medplat.config import JWT_AUDIENCE, JWT_ISSUER, JWT_PRIVATE_KEY_PATH, JWT_PUBLIC_KEY_PATH


_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(_REPOSITORY_ROOT / ".env")


def _required(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"Required environment variable is missing: {name}")
    return value.strip()


def _str_env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else default


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise RuntimeError(f"Environment variable {name} must be an integer.") from exc


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class Settings:
    """Immutable runtime settings for the Auth Service."""

    app_env: str
    app_debug: bool

    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str

    # مفتاح HMAC لحدود المحاولات: يُخزَّن hash المعرّف أو الـ IP لا قيمته (auth_rate_limits).
    rate_limit_pepper: str

    register_rate_limit: int
    register_rate_window_seconds: int

    login_rate_limit: int
    login_rate_window_seconds: int
    login_identifier_rate_limit: int
    login_identifier_rate_window_seconds: int

    refresh_rate_limit: int
    refresh_rate_window_seconds: int
    refresh_token_rate_limit: int
    refresh_token_rate_window_seconds: int

    jwt_algorithm: str
    jwt_issuer: str
    jwt_audience: str
    jwt_access_token_minutes: int
    jwt_refresh_token_days: int
    jwt_key_id: str
    jwt_private_key_path: Path
    jwt_public_key_path: Path


# أرقام يجب أن تكون أكبر من صفر: (الحقل، اسمه في .env).
_POSITIVE = (
    ("register_rate_limit", "REGISTER_RATE_LIMIT"),
    ("register_rate_window_seconds", "REGISTER_RATE_WINDOW_SECONDS"),
    ("login_rate_limit", "LOGIN_RATE_LIMIT"),
    ("login_rate_window_seconds", "LOGIN_RATE_WINDOW_SECONDS"),
    ("login_identifier_rate_limit", "LOGIN_IDENTIFIER_RATE_LIMIT"),
    ("login_identifier_rate_window_seconds", "LOGIN_IDENTIFIER_RATE_WINDOW_SECONDS"),
    ("refresh_rate_limit", "REFRESH_RATE_LIMIT"),
    ("refresh_rate_window_seconds", "REFRESH_RATE_WINDOW_SECONDS"),
    ("refresh_token_rate_limit", "REFRESH_TOKEN_RATE_LIMIT"),
    ("refresh_token_rate_window_seconds", "REFRESH_TOKEN_RATE_WINDOW_SECONDS"),
    ("jwt_access_token_minutes", "JWT_ACCESS_TOKEN_MINUTES"),
    ("jwt_refresh_token_days", "JWT_REFRESH_TOKEN_DAYS"),
)


def _validate(settings: Settings) -> Settings:
    if settings.app_env != "local" and settings.app_debug:
        raise RuntimeError("APP_DEBUG must be false outside local development.")
    if not 1 <= settings.db_port <= 65535:
        raise RuntimeError("AUTH_DB_PORT must be between 1 and 65535.")
    if settings.db_user.strip().lower() == "root":
        # BR-028: مثل بقية الخدمات (medplat.config)؛ auth لها ملف إعداداتها الخاص.
        raise RuntimeError("AUTH_DB_USER must be the service account (svc_auth), never root (BR-028).")
    if settings.jwt_algorithm != "RS256":
        raise RuntimeError("JWT_ALGORITHM must be RS256 for Auth Service.")
    for field, name in _POSITIVE:
        if getattr(settings, field) <= 0:
            raise RuntimeError(f"{name} must be greater than zero.")
    if not settings.jwt_key_id.strip():
        raise RuntimeError("JWT_KEY_ID must not be empty.")
    if len(settings.rate_limit_pepper) < 32:
        raise RuntimeError("RATE_LIMIT_PEPPER must be at least 32 characters long.")
    return settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Build and cache validated application settings."""
    return _validate(
        Settings(
            app_env=os.getenv("APP_ENV", "local"),
            app_debug=_bool_env("APP_DEBUG", False),
            db_host=_str_env("AUTH_DB_HOST", "127.0.0.1"),
            db_port=_int_env("AUTH_DB_PORT", 3306),
            db_name=_str_env("AUTH_DB_NAME", "auth_db"),
            db_user=_str_env("AUTH_DB_USER", "svc_auth"),
            db_password=_required("AUTH_DB_PASSWORD"),
            rate_limit_pepper=_required("RATE_LIMIT_PEPPER"),
            register_rate_limit=_int_env("REGISTER_RATE_LIMIT", 20),
            register_rate_window_seconds=_int_env("REGISTER_RATE_WINDOW_SECONDS", 900),
            login_rate_limit=_int_env("LOGIN_RATE_LIMIT", 30),
            login_rate_window_seconds=_int_env("LOGIN_RATE_WINDOW_SECONDS", 900),
            login_identifier_rate_limit=_int_env("LOGIN_IDENTIFIER_RATE_LIMIT", 10),
            login_identifier_rate_window_seconds=_int_env("LOGIN_IDENTIFIER_RATE_WINDOW_SECONDS", 900),
            refresh_rate_limit=_int_env("REFRESH_RATE_LIMIT", 60),
            refresh_rate_window_seconds=_int_env("REFRESH_RATE_WINDOW_SECONDS", 900),
            refresh_token_rate_limit=_int_env("REFRESH_TOKEN_RATE_LIMIT", 10),
            refresh_token_rate_window_seconds=_int_env("REFRESH_TOKEN_RATE_WINDOW_SECONDS", 900),
            jwt_algorithm=os.getenv("JWT_ALGORITHM", "RS256"),
            jwt_issuer=_str_env("JWT_ISSUER", JWT_ISSUER),
            jwt_audience=_str_env("JWT_AUDIENCE", JWT_AUDIENCE),
            jwt_access_token_minutes=_int_env("JWT_ACCESS_TOKEN_MINUTES", 15),
            jwt_refresh_token_days=_int_env("JWT_REFRESH_TOKEN_DAYS", 30),
            jwt_key_id=_str_env("JWT_KEY_ID", "auth-key-1"),
            jwt_private_key_path=_REPOSITORY_ROOT / _str_env("JWT_PRIVATE_KEY_PATH", JWT_PRIVATE_KEY_PATH),
            jwt_public_key_path=_REPOSITORY_ROOT / _str_env("JWT_PUBLIC_KEY_PATH", JWT_PUBLIC_KEY_PATH),
        )
    )
