"""التشفير: كلمات المرور (Argon2id)، توقيع رموز الدخول (JWT RS256)، hash رموز الجلسات، ومفاتيح حدود المحاولات.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from uuid import uuid4

import jwt
from argon2 import PasswordHasher as Argon2PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type
from cryptography.hazmat.primitives import serialization
from jwt.algorithms import RSAAlgorithm

from app.config import get_settings


# ======== كلمات المرور (Argon2id)

# Fixed, version-controlled password hashing parameters. They are intentionally
# not configurable through environment variables so an accidental deployment
# cannot silently weaken password protection.
_ARGON2_MEMORY_COST_KIB = 65_536  # 64 MiB
_ARGON2_TIME_COST = 3
_ARGON2_PARALLELISM = 2
_ARGON2_HASH_LENGTH = 32
_ARGON2_SALT_LENGTH = 16

_MIN_PASSWORD_LENGTH = 8
_MAX_PASSWORD_LENGTH = 128


class PasswordHashError(ValueError):
    """Raised when a password cannot be safely hashed or verified."""


# Fixed valid Argon2id hash used only to equalize login verification cost when
# the requested account does not exist. It contains no real user credential.
_DUMMY_LOGIN_PASSWORD_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=2$uPx/+0KV0YDzamgf65EjWA"
    "$tJ/xeoAIO8Psps05kzA4O2W1Kihm9TnSQnBftGUq9rA"
)


_hasher = Argon2PasswordHasher(
    time_cost=_ARGON2_TIME_COST,
    memory_cost=_ARGON2_MEMORY_COST_KIB,
    parallelism=_ARGON2_PARALLELISM,
    hash_len=_ARGON2_HASH_LENGTH,
    salt_len=_ARGON2_SALT_LENGTH,
    type=Type.ID,
)


def _validate_password_input(password: str) -> None:
    if not isinstance(password, str):
        raise PasswordHashError("Password must be a string.")

    length = len(password)
    if length < _MIN_PASSWORD_LENGTH or length > _MAX_PASSWORD_LENGTH:
        raise PasswordHashError(
            f"Password length must be between {_MIN_PASSWORD_LENGTH} "
            f"and {_MAX_PASSWORD_LENGTH} characters."
        )


def hash_password(password: str) -> str:
    """Return a self-contained Argon2id PHC password hash."""
    _validate_password_input(password)
    password_hash = _hasher.hash(password)

    # users.password_hash is VARCHAR(255); keep this contract explicit.
    if len(password_hash) > 255:
        raise PasswordHashError("Generated password hash exceeds database capacity.")

    return password_hash


def verify_password(password_hash: str, password: str) -> bool:
    """Return True only when the supplied password matches the stored hash."""
    if not isinstance(password_hash, str) or not password_hash:
        return False

    _validate_password_input(password)

    try:
        return bool(_hasher.verify(password_hash, password))
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def verify_password_for_login(password_hash: str | None, password: str) -> bool:
    """Verify a login password with roughly equal hashing work for unknown users."""
    candidate_hash = password_hash or _DUMMY_LOGIN_PASSWORD_HASH
    password_matches = verify_password(candidate_hash, password)
    return bool(password_hash) and password_matches


def needs_rehash(password_hash: str) -> bool:
    """Return whether the stored Argon2id hash should be upgraded."""
    if not isinstance(password_hash, str) or not password_hash:
        return True

    try:
        return _hasher.check_needs_rehash(password_hash)
    except (VerificationError, InvalidHashError):
        return True


# ======== رموز الدخول (JWT RS256)

@lru_cache(maxsize=1)
def _load_private_key():
    settings = get_settings()
    try:
        key_bytes = settings.jwt_private_key_path.read_bytes()
    except OSError as exc:
        raise RuntimeError(
            f"JWT private key could not be read: {settings.jwt_private_key_path}"
        ) from exc

    try:
        return serialization.load_pem_private_key(
            key_bytes,
            password=None,
        )
    except ValueError as exc:
        raise RuntimeError("JWT private key is not a valid PEM key.") from exc


@lru_cache(maxsize=1)
def _load_public_key():
    settings = get_settings()
    try:
        key_bytes = settings.jwt_public_key_path.read_bytes()
    except OSError as exc:
        raise RuntimeError(
            f"JWT public key could not be read: {settings.jwt_public_key_path}"
        ) from exc

    try:
        return serialization.load_pem_public_key(key_bytes)
    except ValueError as exc:
        raise RuntimeError("JWT public key is not a valid PEM key.") from exc


def create_access_token(*, user_public_id: str, role: str) -> str:
    """Create a short-lived RS256 access token with minimal claims."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.jwt_access_token_minutes)

    payload = {
        "sub": user_public_id,
        "role": role,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": now,
        "nbf": now,
        "exp": expires_at,
        "jti": str(uuid4()),
    }

    return jwt.encode(
        payload,
        _load_private_key(),
        algorithm=settings.jwt_algorithm,
        headers={"kid": settings.jwt_key_id},
    )


def decode_access_token(token: str) -> dict:
    """Validate an access token using the Auth Service public key."""
    settings = get_settings()
    return jwt.decode(
        token,
        _load_public_key(),
        algorithms=[settings.jwt_algorithm],
        audience=settings.jwt_audience,
        issuer=settings.jwt_issuer,
        options={
            "require": ["sub", "role", "iss", "aud", "iat", "nbf", "exp", "jti"],
        },
    )


def public_jwk() -> dict:
    """Return the active verification key as a JWKS-compatible JWK."""
    settings = get_settings()
    jwk = RSAAlgorithm.to_jwk(_load_public_key(), as_dict=True)
    jwk.update(
        {
            "kid": settings.jwt_key_id,
            "use": "sig",
            "alg": settings.jwt_algorithm,
        }
    )
    return jwk


def check_jwt_keys() -> bool:
    """Return True only when the configured RSA key pair is readable and matches."""
    try:
        private_key = _load_private_key()
        public_key = _load_public_key()
        private_public = private_key.public_key().public_numbers()
        public_numbers = public_key.public_numbers()
        return (
            getattr(private_key, "key_size", 0) >= 2048
            and getattr(public_key, "key_size", 0) >= 2048
            and private_public == public_numbers
        )
    except Exception:
        return False


# ======== رموز تجديد الجلسة

def hash_refresh_token(raw_token: str) -> str:
    """Return the SHA-256 storage hash for an opaque refresh token."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_refresh_token() -> tuple[str, str]:
    """Generate an opaque refresh token and its SHA-256 storage hash."""
    raw_token = secrets.token_urlsafe(64)
    return raw_token, hash_refresh_token(raw_token)


# ======== مفاتيح حدود المحاولات

def rate_limit_key(*, scope: str, value: str) -> str:
    """يشتق مفتاح حد المحاولات من قيمة خام مثل IP أو بريد.

    HMAC لا SHA-256 عاديًا: بدون السر (RATE_LIMIT_PEPPER) يستطيع من يقرأ الجدول
    أن يجرّب قيمًا شائعة (نطاق عناوين IP محلي مثلاً) ويطابق التجزئة.
    """
    settings = get_settings()
    message = f"ratelimit:{scope}:{value}".encode("utf-8")
    return hmac.new(
        settings.rate_limit_pepper.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()
