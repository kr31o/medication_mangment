"""كل ما يخص طلب HTTP في الخدمات كلها: رقم الطلب، السجل، الأخطاء بشكل موحّد، الردود، وإنشاء التطبيق.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from typing import Any
from uuid import UUID, uuid4

from flask import Blueprint, Flask, g, has_request_context, jsonify, request, Response
from sqlalchemy.exc import OperationalError
from werkzeug.exceptions import HTTPException

from medplat.config import env_int, platform_settings
from medplat.util import ApiJSONProvider


# ======== رقم الطلب (X-Request-ID)

REQUEST_ID_HEADER = "X-Request-ID"


def install_request_context(app: Flask) -> None:
    """معرّف طلب واحد لكل طلب، ورؤوس أمان ثابتة (FR-CROSS-01، NFR-SEC-08/09)."""

    @app.before_request
    def _assign_request_id() -> None:
        raw = request.headers.get(REQUEST_ID_HEADER, "").strip()
        try:
            g.request_id = str(UUID(raw)) if raw else str(uuid4())
        except ValueError:
            # قيمة من العميل غير صالحة لا تُقبل ولا تُعاد كما هي.
            g.request_id = str(uuid4())

    @app.after_request
    def _decorate_response(response):
        response.headers[REQUEST_ID_HEADER] = getattr(g, "request_id", "")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if request.path.startswith(("/api/", "/internal/")):
            # بيانات صحية وشخصية: لا تُخزَّن في أي cache وسيط.
            response.headers.setdefault("Cache-Control", "no-store")
        return response


def current_request_id() -> str | None:
    from flask import has_request_context

    if has_request_context():
        return getattr(g, "request_id", None)
    return None


# ======== السجل

class RequestIdFilter(logging.Filter):
    """يضيف request_id لكل سطر log حتى يُربط بالطلب (NFR-OPER-02)."""

    def filter(self, record: logging.LogRecord) -> bool:
        request_id = "-"
        if has_request_context():
            request_id = getattr(g, "request_id", "-")
        record.request_id = request_id
        return True


class StripQueryStringFilter(logging.Filter):
    """يحذف الـ query string من سطر الوصول الذي يكتبه werkzeug.

    البحث عن صيدليات قريبة يمرر إحداثيات المريض في الرابط. لو بقيت في
    سجل الوصول لصار عندنا location history مكتوب على القرص، وهو ما تمنعه
    BR-006 صراحة. السجل يحتفظ بالمسار والحالة فقط.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.args and isinstance(record.args, tuple) and isinstance(record.args[0], str):
            line = record.args[0]
            if "?" in line:
                method_path, _, rest = line.partition("?")
                protocol = rest.rsplit(" ", 1)[-1] if " " in rest else ""
                cleaned = f"{method_path} {protocol}".strip()
                record.args = (cleaned, *record.args[1:])
        return True


def configure_logging(service_name: str, level: str = "INFO") -> None:
    root = logging.getLogger()
    if getattr(root, "_medplat_configured", False):
        return

    handler = logging.StreamHandler()
    handler.addFilter(RequestIdFilter())
    handler.setFormatter(
        logging.Formatter(
            f"%(asctime)s %(levelname)s [{service_name}] [%(request_id)s] %(name)s: %(message)s"
        )
    )
    root.handlers = [handler]
    root.setLevel(level)
    # SQLAlchemy و pika مزعجان على INFO.
    # pika يكتب 7 أسطر ERROR لكل محاولة اتصال فاشلة بالـ broker. الـ
    # publisher والـ consumer يلتقطان الخطأ ويكتبان سطرًا واحدًا واضحًا.
    logging.getLogger("pika").setLevel(logging.CRITICAL)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("werkzeug").addFilter(StripQueryStringFilter())
    root._medplat_configured = True  # type: ignore[attr-defined]


# ======== الأخطاء ومغلفها الموحد
# مغلف الأخطاء الموحد لكل الخدمات (FR-CROSS-02، §15.3).
#
#     {"error": {"code": "...", "message": "...", "details": {...}}, "request_id": "..."}
#
# الرمز `code` ثابت وقابل للقراءة الآلية؛ الرسالة للبشر. الواجهة تعتمد على
# الرمز لا على الرسالة.

logger = logging.getLogger(__name__)


class ApiError(Exception):
    status: int = 500
    code: str = "INTERNAL_ERROR"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status is not None:
            self.status = status
        self.details = details or {}


class BadRequest(ApiError):
    status, code = 400, "INVALID_REQUEST"


class Unauthorized(ApiError):
    status, code = 401, "UNAUTHORIZED"


class Forbidden(ApiError):
    status, code = 403, "FORBIDDEN"


class NotFound(ApiError):
    status, code = 404, "NOT_FOUND"


class Conflict(ApiError):
    status, code = 409, "CONFLICT"


class ValidationFailed(ApiError):
    status, code = 422, "VALIDATION_ERROR"


class RateLimited(ApiError):
    status, code = 429, "RATE_LIMITED"


class DependencyUnavailable(ApiError):
    status, code = 503, "SERVICE_UNAVAILABLE"


_HTTP_CODES = {
    400: "INVALID_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    413: "REQUEST_TOO_LARGE",
    415: "INVALID_REQUEST",
    429: "RATE_LIMITED",
    503: "SERVICE_UNAVAILABLE",
}

_HTTP_MESSAGES = {
    400: "The request is invalid.",
    404: "The requested resource was not found.",
    405: "The method is not allowed for this resource.",
    413: "Request body is too large.",
}


def error_response(code: str, message: str, status: int, details: dict[str, Any] | None = None):
    request_id = getattr(g, "request_id", "")
    return (
        jsonify(
            {
                # request_id داخل error كما في §15.3، وفي المستوى الأعلى كما في
                # عقد Auth الأصلي وبقية الاستجابات — العميل يقرأ أيهما شاء.
                "error": {"code": code, "message": message, "details": details or {}, "request_id": request_id},
                "request_id": request_id,
            }
        ),
        status,
    )


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def _api_error(error: ApiError):
        response, status = error_response(error.code, error.message, error.status, error.details)
        if status == 401:
            response.headers["WWW-Authenticate"] = "Bearer"
        return response, status

    @app.errorhandler(HTTPException)
    def _http_error(error: HTTPException):
        # بدون هذا المعالج يسقط 404 و405 في معالج Exception ويرجعان 500 (D-02).
        status = error.code or 500
        return error_response(
            _HTTP_CODES.get(status, "INVALID_REQUEST"),
            _HTTP_MESSAGES.get(status, "The request could not be processed."),
            status,
        )

    @app.errorhandler(OperationalError)
    def _database_unavailable(error: OperationalError):
        from medplat.db import is_unavailable

        if not is_unavailable(error):
            # خطأ دائم (قيد CHECK، صلاحية، عمود): عيب لا انقطاع — 500 مع السجل الكامل.
            logger.exception("Database error", exc_info=(type(error), error, error.__traceback__))
            return error_response("INTERNAL_ERROR", "An internal error occurred.", 500)
        # قاعدة البيانات متوقفة أو مقطوعة: هذه 503 لا 500 — الخدمة سليمة
        # والاعتمادية هي الغائبة.
        logger.error("Database unavailable: %s", getattr(error, "orig", error))
        return error_response(
            "SERVICE_UNAVAILABLE", "A required dependency is unavailable.", 503
        )

    @app.errorhandler(Exception)
    def _unexpected(error: Exception):
        logger.exception("Unhandled exception", exc_info=(type(error), error, error.__traceback__))
        return error_response("INTERNAL_ERROR", "An internal error occurred.", 500)


# ======== الردود (ok، created، page)

def ok(data: Any, status: int = 200) -> tuple[Response, int]:
    return jsonify({"data": data, "request_id": getattr(g, "request_id", "")}), status


def created(data: Any) -> tuple[Response, int]:
    return ok(data, 201)


def no_content() -> Response:
    return Response(status=204)


def page(
    items: list[Any], *, total: int, limit: int, offset: int, extra_meta: dict[str, Any] | None = None
) -> tuple[Response, int]:
    return (
        jsonify(
            {
                "data": items,
                "meta": {"total": total, "limit": limit, "offset": offset, **(extra_meta or {})},
                "request_id": getattr(g, "request_id", ""),
            }
        ),
        200,
    )


# ======== إنشاء تطبيق الخدمة

ReadinessCheck = Callable[[], bool]


def _health_blueprint(service_name: str, checks: dict[str, ReadinessCheck]) -> Blueprint:
    bp = Blueprint("platform_probes", __name__)

    @bp.get("/health")
    def health():
        # حيّة أم لا — بلا فحص اعتماديات، حتى لا يُعاد تشغيل خدمة سليمة
        # لأن قاعدة البيانات تأخرت لحظة.
        return jsonify({"status": "ok", "service": service_name}), 200

    @bp.get("/ready")
    def ready():
        results = {}
        for name, check in checks.items():
            try:
                results[name] = "ok" if check() else "unavailable"
            except Exception:
                results[name] = "unavailable"
        all_ok = all(value == "ok" for value in results.values())
        return (
            jsonify(
                {
                    "status": "ready" if all_ok else "degraded",
                    "service": service_name,
                    "checks": results,
                }
            ),
            200 if all_ok else 503,
        )

    return bp


def trust_forwarded_for(app: Flask) -> None:
    """عنوان العميل الحقيقي من البوابة لا عنوان البوابة نفسها.

    كل الطلبات تمر عبر بوابة الواجهة (scripts/web.py)، فبدون X-Forwarded-For يظهر كل المستخدمين
    كـ 127.0.0.1 ويصبح حد كل IP حدًا واحدًا للمنصة كلها. الخدمات تستمع على
    127.0.0.1 فقط، فلا يصلها إلا البوابة أو خدمة محلية. TRUSTED_PROXY_HOPS=0
    يعطّل الثقة بالرأس (خدمة معروضة مباشرة بلا بوابة).
    """
    from werkzeug.middleware.proxy_fix import ProxyFix

    hops = env_int("TRUSTED_PROXY_HOPS", 1, minimum=0, maximum=3)
    if hops:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops)  # type: ignore[method-assign]


def create_service_app(
    *,
    service_name: str,
    blueprints: Iterable[Blueprint],
    readiness: dict[str, ReadinessCheck],
    max_content_length: int | None = None,
) -> Flask:
    """ينشئ تطبيق خدمة بالشكل الموحد لكل المنصة."""
    settings = platform_settings()
    configure_logging(service_name, settings.log_level)

    app = Flask(service_name, static_folder=None)
    app.json = ApiJSONProvider(app)
    app.config["MAX_CONTENT_LENGTH"] = max_content_length or settings.max_content_length

    trust_forwarded_for(app)
    install_request_context(app)
    register_error_handlers(app)
    app.register_blueprint(_health_blueprint(service_name, readiness))
    for blueprint in blueprints:
        app.register_blueprint(blueprint)
    return app
