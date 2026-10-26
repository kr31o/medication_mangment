"""قراءة الإعدادات من البيئة، مع فشل واضح عند النقص (FR-CROSS-12).

كل الخدمات تقرأ ملف `.env` واحدًا في جذر المستودع. الإعدادات الخاصة
بكل خدمة مسبوقة باسمها (PATIENT_DB_HOST ...)، والمشتركة بلا بادئة.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import URL


class ConfigError(RuntimeError):
    """إعداد حرج مفقود أو غير صالح — يجب أن يوقف الإقلاع."""


def _find_repo_root() -> Path:
    override = os.getenv("MEDPLAT_ROOT")
    if override:
        return Path(override).resolve()

    here = Path.cwd().resolve()
    for candidate in (here, *here.parents):
        if (candidate / "services").is_dir() and (candidate / "packages" / "platform").is_dir():
            return candidate

    # تثبيت editable: الملف في packages/platform/medplat/config.py
    return Path(__file__).resolve().parents[3]


REPO_ROOT = _find_repo_root()
load_dotenv(REPO_ROOT / ".env")


def env_str(name: str, default: str | None = None, *, required: bool = False) -> str | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        if required:
            raise ConfigError(f"Required environment variable is missing: {name}")
        return default
    return value.strip()


def env_int(
    name: str,
    default: int,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        value = default
    else:
        try:
            value = int(raw)
        except ValueError as exc:
            raise ConfigError(f"Environment variable {name} must be an integer.") from exc
    if minimum is not None and value < minimum:
        raise ConfigError(f"{name} must be >= {minimum}.")
    if maximum is not None and value > maximum:
        raise ConfigError(f"{name} must be <= {maximum}.")
    return value


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def repo_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else REPO_ROOT / path


# ---------------------------------------------------------------------------
# قاعدة البيانات
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DatabaseSettings:
    host: str
    port: int
    name: str
    user: str
    password: str

    def url(self) -> URL:
        """رابط الاتصال بحساب الخدمة svc_*.

        هذا الحساب يملك SELECT/INSERT/UPDATE/DELETE على جداول قاعدته فقط؛ لا
        ينشئ جدولًا ولا يعدّله (BR-028). الجداول من db/medplat_schema.sql.
        """
        return URL.create(
            drivername="mysql+pymysql",
            username=self.user,
            password=self.password,
            host=self.host,
            port=self.port,
            database=self.name,
            query={"charset": "utf8mb4"},
        )


def database_settings(prefix: str) -> DatabaseSettings:
    """يقرأ {PREFIX}_DB_* ويرفض حساب root للتشغيل.

    كلمة المرور وحدها في .env. الباقي له قيمة ثابتة: القاعدة <الخدمة>_db والحساب svc_<الخدمة>
    على 127.0.0.1:3306، ويُغيَّر بإضافته إلى .env.
    """
    user = env_str(f"{prefix}_DB_USER", f"svc_{prefix.lower()}")
    if user == "root":
        raise ConfigError(f"{prefix}_DB_USER must be a service account, never root (BR-028).")

    return DatabaseSettings(
        host=env_str(f"{prefix}_DB_HOST", "127.0.0.1"),
        port=env_int(f"{prefix}_DB_PORT", 3306, minimum=1, maximum=65535),
        name=env_str(f"{prefix}_DB_NAME", f"{prefix.lower()}_db"),
        user=user,
        password=env_str(f"{prefix}_DB_PASSWORD", required=True),
    )


# ---------------------------------------------------------------------------
# الإعدادات المشتركة
# ---------------------------------------------------------------------------

SERVICE_NAMES = (
    "auth",
    "patient",
    "pharmacy",
    "medication",
    "inventory",
    "order",
    "health",
    "ai",
    "notification",
)

DEFAULT_PORTS = {name: 5001 + index for index, name in enumerate(SERVICE_NAMES)}

# رمز الدخول: من يصدره ولمن، وأين مفتاحاه. auth-service تقرأ القيم نفسها من هنا.
JWT_ISSUER = "medication-platform-auth"
JWT_AUDIENCE = "medication-platform-api"
JWT_PRIVATE_KEY_PATH = "services/auth-service/keys/private_key.pem"
JWT_PUBLIC_KEY_PATH = "services/auth-service/keys/public_key.pem"


@dataclass(frozen=True, slots=True)
class PlatformSettings:
    app_env: str
    app_debug: bool
    log_level: str
    jwt_issuer: str
    jwt_audience: str
    jwt_public_key_path: Path
    internal_api_token: str
    rabbitmq_url: str
    max_content_length: int
    service_urls: dict[str, str]


@lru_cache(maxsize=1)
def platform_settings() -> PlatformSettings:
    app_env = env_str("APP_ENV", "local")
    app_debug = env_bool("APP_DEBUG", False)
    if app_env != "local" and app_debug:
        raise ConfigError("APP_DEBUG must be false outside local development.")

    token = env_str("INTERNAL_API_TOKEN", required=True)
    if len(token) < 32:
        raise ConfigError("INTERNAL_API_TOKEN must be at least 32 characters long.")

    # العنوان يتبع منفذ الخدمة في .env، فتغيير المنافذ لا يحتاج غيره.
    service_urls = {
        name: env_str(f"{name.upper()}_SERVICE_URL", f"http://127.0.0.1:{service_port(name)}").rstrip("/")
        for name in SERVICE_NAMES
    }

    return PlatformSettings(
        app_env=app_env,
        app_debug=app_debug,
        log_level=env_str("LOG_LEVEL", "INFO").upper(),
        jwt_issuer=env_str("JWT_ISSUER", JWT_ISSUER),
        jwt_audience=env_str("JWT_AUDIENCE", JWT_AUDIENCE),
        jwt_public_key_path=repo_path(env_str("JWT_PUBLIC_KEY_PATH", JWT_PUBLIC_KEY_PATH)),
        internal_api_token=token,
        rabbitmq_url=env_str("RABBITMQ_URL", "amqp://guest:guest@127.0.0.1:5672/%2F"),
        max_content_length=env_int("MAX_REQUEST_BYTES", 64 * 1024, minimum=1024, maximum=1024 * 1024),
        service_urls=service_urls,
    )


def service_port(name: str) -> int:
    return env_int(f"{name.upper()}_SERVICE_PORT", DEFAULT_PORTS[name], minimum=1, maximum=65535)
