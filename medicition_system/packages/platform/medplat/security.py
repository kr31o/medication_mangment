"""الأمن في كل خدمة: التحقق من رمز الدخول (JWT) والدور، وتحديد صيدلية صاحب الرمز (الـ tenant).
"""

from __future__ import annotations

import functools
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, TypeVar

import jwt
from cryptography.hazmat.primitives import serialization
from flask import g, request

from medplat.config import platform_settings
from medplat.internal import InternalClient
from medplat.web import Forbidden, Unauthorized


# ======== رمز الدخول والدور
# التحقق من access tokens في كل خدمة غير Auth (§10.2).
#
# الخدمات تملك المفتاح العام فقط وتتحقق محليًا، بلا استدعاء لـ Auth في كل
# طلب. هذا يعني أن خدمة Auth المتوقفة لا توقف بقية المنصة لمن يحمل token
# صالحًا — وهو المقصود من RS256 أصلًا.

F = TypeVar("F", bound=Callable[..., Any])

ROLES = ("PATIENT", "PHARMACY", "ADMIN")


@dataclass(frozen=True, slots=True)
class Principal:
    user_ref: str
    role: str
    token_id: str

    @property
    def is_pharmacy(self) -> bool:
        return self.role == "PHARMACY"

    @property
    def is_admin(self) -> bool:
        return self.role == "ADMIN"


@lru_cache(maxsize=1)
def _public_key():
    path = platform_settings().jwt_public_key_path
    try:
        return serialization.load_pem_public_key(path.read_bytes())
    except OSError as exc:
        raise RuntimeError(f"JWT public key could not be read: {path}") from exc


def public_key_available() -> bool:
    try:
        _public_key()
        return True
    except Exception:
        return False


def decode_access_token(token: str) -> Principal:
    settings = platform_settings()
    try:
        claims = jwt.decode(
            token,
            _public_key(),
            # قائمة ثابتة بخوارزمية واحدة: تمنع هجوم alg=none وخلط HS256/RS256.
            algorithms=["RS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "role", "iss", "aud", "iat", "nbf", "exp", "jti"]},
            leeway=5,
        )
    except jwt.PyJWTError as exc:
        raise Unauthorized("Authentication is required.") from exc

    role = claims.get("role")
    if role not in ROLES:
        raise Unauthorized("Authentication is required.")

    return Principal(user_ref=str(claims["sub"]), role=str(role), token_id=str(claims["jti"]))


def _bearer_token() -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthorized("Authentication is required.")
    return token.strip()


def require_auth(*roles: str) -> Callable[[F], F]:
    """يحمي route: 401 بلا token صالح، و403 إن لم يكن الدور مسموحًا.

        @bp.get("/me")
        @require_auth("PATIENT")
        def me(): ...
    """
    unknown = set(roles) - set(ROLES)
    if unknown:
        raise ValueError(f"Unknown roles: {sorted(unknown)}")

    def decorator(fn: F) -> F:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            principal = decode_access_token(_bearer_token())
            if roles and principal.role not in roles:
                raise Forbidden("You are not allowed to perform this action.")
            g.principal = principal
            return fn(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return decorator


def current_principal() -> Principal:
    principal = getattr(g, "principal", None)
    if principal is None:  # pragma: no cover - خطأ برمجي لا خطأ مستخدم
        raise RuntimeError("current_principal() used outside a @require_auth route.")
    return principal


def actor_of(principal: Principal | None) -> dict[str, str | None]:
    """من قام بالفعل — يُضمَّن في كل حدث، فيعرف مستهلكه من فعل ماذا."""
    if principal is None:
        return {"ref": None, "role": "SYSTEM"}
    return {"ref": principal.user_ref, "role": principal.role}


# ======== صيدلية صاحب الرمز
# تحديد الصيدلية (tenant) من الـ principal لا من الطلب (BR-010، NFR-SEC-05).
#
# الـ access token لا يحمل هوية الصيدلية لأن Auth لا يملك بيانات الصيدليات
# (§8.2). فكل خدمة تحتاج الـ tenant تسأل pharmacy-service: "أي صيدلية
# يملكها هذا المستخدم؟". الجواب يُخزَّن مؤقتًا لـ 15 ثانية، فالصيدلية
# الموقوفة تتوقف عملياتها خلال 15 ثانية كحد أقصى.

_TTL_SECONDS = 15.0
_cache: dict[str, tuple[float, "PharmacyTenant | None"]] = {}
_lock = threading.Lock()


@dataclass(frozen=True, slots=True)
class PharmacyTenant:
    pharmacy_ref: str
    status: str
    name: str


def _lookup(user_ref: str) -> "PharmacyTenant | None":
    now = time.monotonic()
    with _lock:
        cached = _cache.get(user_ref)
        if cached and cached[0] > now:
            return cached[1]

    response = InternalClient("pharmacy").get(f"/internal/v1/pharmacies/by-owner/{user_ref}")
    tenant: PharmacyTenant | None = None
    if response.ok and isinstance(response.data, dict):
        data = response.data
        tenant = PharmacyTenant(
            pharmacy_ref=data["id"],
            status=data["status"],
            name=data["name"],
        )

    with _lock:
        _cache[user_ref] = (now + _TTL_SECONDS, tenant)
    return tenant


def resolve_pharmacy_tenant(principal: Principal, *, require_active: bool = True) -> PharmacyTenant:
    if not principal.is_pharmacy:
        raise Forbidden("Only pharmacy accounts can perform this action.")

    tenant = _lookup(principal.user_ref)
    if tenant is None:
        raise Forbidden(
            "Complete your pharmacy profile first.",
            code="PHARMACY_PROFILE_REQUIRED",
        )
    if require_active and tenant.status != "ACTIVE":
        raise Forbidden(
            "The pharmacy is not active. It must be approved by an administrator.",
            code="PHARMACY_NOT_ACTIVE",
            details={"status": tenant.status},
        )
    return tenant
