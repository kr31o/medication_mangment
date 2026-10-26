"""أخطاء auth-service وتحويلها إلى رد JSON موحّد: {"error": {code, message, details, request_id}}.
"""

from __future__ import annotations

from flask import Flask, g, jsonify
from sqlalchemy.exc import OperationalError
from werkzeug.exceptions import HTTPException

from medplat.web import ApiError

from app import REQUEST_ID_HEADER
from app.contracts import ErrorCode, http_status_for


# ======== أصناف الأخطاء

class ApplicationError(Exception):
    """Base exception for expected application-level failures."""


class ConflictError(ApplicationError):
    """Raised when an operation conflicts with existing state."""


class ValidationError(ApplicationError):
    """Raised when application input violates a business rule."""


class RateLimitedError(ApplicationError):
    """Raised when a security rate limit has been exceeded."""


class InvalidCredentialsError(ApplicationError):
    """Raised when supplied authentication credentials are invalid."""


class InvalidRefreshTokenError(ApplicationError):
    """Raised when a refresh token is invalid, expired, revoked, or reused."""


class AccountSuspendedError(ApplicationError):
    """Raised when a correct password belongs to an account an admin has suspended."""

    def __init__(self, reason: str | None) -> None:
        super().__init__("This account has been suspended by the administrator.")
        self.reason = reason


# ======== تحويل الأخطاء إلى JSON

# أي استثناء HTTP من Werkzeug يُترجم إلى رمز خطأ من عقدنا مع الحفاظ على
# رمز الحالة الأصلي. بدون هذا الجدول كان معالج Exception العام يبتلع
# 404 و405 ويرجعهما 500 — لأن NotFound يرث HTTPException ثم Exception،
# وبحث Flask عن المعالج يمشي في MRO فيصل إلى Exception.
_HTTP_STATUS_TO_ERROR_CODE: dict[int, ErrorCode] = {
    400: ErrorCode.INVALID_REQUEST,
    401: ErrorCode.INVALID_CREDENTIALS,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
    406: ErrorCode.INVALID_REQUEST,
    413: ErrorCode.REQUEST_TOO_LARGE,
    415: ErrorCode.INVALID_REQUEST,
    429: ErrorCode.RATE_LIMITED,
    503: ErrorCode.SERVICE_UNAVAILABLE,
}


# مطابق لـ medplat.db: انقطاع، اتصالات ممتلئة، انتظار قفل، deadlock.
_UNAVAILABLE_MYSQL_CODES = {1040, 1203, 1205, 1213, 2002, 2003, 2005, 2006, 2013, 2055}


def _error_payload(
    error_code: ErrorCode,
    message: str,
    *,
    status: int | None = None,
    details: dict | None = None,
) -> tuple:
    """يبني مغلف الخطأ الموحد.

    `status` يسمح بالحفاظ على رمز HTTP الأصلي (404، 405) بدل الرمز
    القانوني المرتبط بـ ErrorCode.
    """
    request_id = getattr(g, "request_id", "")
    response = jsonify(
        {
            "error": {
                "code": error_code.value,
                "message": message,
                "details": details or {},
                # §15.3 يضع request_id داخل error؛ ويبقى في المستوى الأعلى للتوافق.
                "request_id": request_id,
            },
            "request_id": request_id,
        }
    )
    return response, status if status is not None else http_status_for(error_code)


def register_error_handlers(app: Flask) -> None:
    """Register stable JSON responses for expected and unexpected failures."""

    @app.errorhandler(ValidationError)
    def _validation_error(error: ValidationError):
        return _error_payload(ErrorCode.VALIDATION_ERROR, str(error))

    @app.errorhandler(RateLimitedError)
    def _rate_limited_error(error: RateLimitedError):
        return _error_payload(ErrorCode.RATE_LIMITED, str(error))

    @app.errorhandler(ConflictError)
    def _conflict_error(error: ConflictError):
        return _error_payload(ErrorCode.ACCOUNT_ALREADY_EXISTS, str(error))

    @app.errorhandler(InvalidCredentialsError)
    def _invalid_credentials_error(error: InvalidCredentialsError):
        return _error_payload(ErrorCode.INVALID_CREDENTIALS, str(error))

    @app.errorhandler(AccountSuspendedError)
    def _account_suspended_error(error: AccountSuspendedError):
        # يصل إلى هنا من أثبت كلمة المرور فقط، فهو صاحب الحساب: يُقال له السبب.
        return _error_payload(ErrorCode.ACCOUNT_SUSPENDED, str(error), details={"reason": error.reason})

    @app.errorhandler(ApiError)
    def _platform_api_error(error: ApiError):
        """مسارات الأدمن والمسارات الداخلية مكتوبة بأدوات الحزمة المشتركة (medplat):
        أخطاؤها تخرج بالمغلف نفسه، برمزها وحالتها وتفاصيلها."""
        request_id = getattr(g, "request_id", "")
        body = {"code": error.code, "message": error.message, "details": error.details, "request_id": request_id}
        return jsonify({"error": body, "request_id": request_id}), error.status

    @app.errorhandler(InvalidRefreshTokenError)
    def _invalid_refresh_token_error(error: InvalidRefreshTokenError):
        return _error_payload(ErrorCode.REFRESH_TOKEN_INVALID, str(error))

    @app.errorhandler(413)
    def _request_too_large(_error):
        return _error_payload(
            ErrorCode.REQUEST_TOO_LARGE,
            "Request body is too large.",
        )

    @app.errorhandler(400)
    def _bad_request(_error):
        return _error_payload(
            ErrorCode.INVALID_REQUEST,
            "The request is invalid.",
        )

    @app.errorhandler(HTTPException)
    def _http_exception(error: HTTPException):
        """يعالج كل ما تبقى من أخطاء HTTP — أهمها 404 و405.

        الرسالة عامة عمدًا: لا نكشف المسارات الموجودة ولا الطرق المسموحة،
        لأن ذلك يساعد على استكشاف الـ API من الخارج.
        """
        status = error.code or 500
        error_code = _HTTP_STATUS_TO_ERROR_CODE.get(status, ErrorCode.INVALID_REQUEST)
        messages = {
            404: "The requested resource was not found.",
            405: "The method is not allowed for this resource.",
        }
        return _error_payload(
            error_code,
            messages.get(status, "The request could not be processed."),
            status=status,
        )

    @app.errorhandler(OperationalError)
    def _database_unavailable(error: OperationalError):
        orig = getattr(error, "orig", None)
        code = orig.args[0] if orig is not None and orig.args and isinstance(orig.args[0], int) else None
        if code is not None and code not in _UNAVAILABLE_MYSQL_CODES:
            # خطأ دائم (قيد CHECK، صلاحية، عمود) لا انقطاع: 500 مع السجل الكامل.
            app.logger.exception("Database error", exc_info=(type(error), error, error.__traceback__))
            return _error_payload(ErrorCode.INTERNAL_ERROR, "An internal error occurred.")
        # قاعدة البيانات متوقفة: الاعتمادية غائبة لا الخدمة معطوبة، فالرد
        # 503 كما في §15.2 وكما في بقية الخدمات، لا 500.
        app.logger.error("Database unavailable: %s", getattr(error, "orig", error))
        return _error_payload(ErrorCode.SERVICE_UNAVAILABLE, "A required dependency is unavailable.")

    @app.errorhandler(Exception)
    def _unexpected_error(error: Exception):
        app.logger.exception(
            "Unhandled exception in Auth Service",
            exc_info=(type(error), error, error.__traceback__),
        )
        response, status = _error_payload(
            ErrorCode.INTERNAL_ERROR,
            "An internal error occurred.",
        )
        response.headers[REQUEST_ID_HEADER] = getattr(g, "request_id", "")
        return response, status
