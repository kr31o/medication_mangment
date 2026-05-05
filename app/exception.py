class AppError(Exception):
    """Base application error with HTTP status code."""

    def __init__(self, message: str = "حدث خطأ في الطلب.", status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class NotFoundError(AppError):
    def __init__(self, message: str = "العنصر المطلوب غير موجود."):
        super().__init__(message, 404)


class UnauthorizedError(AppError):
    def __init__(self, message: str = "يرجى تسجيل الدخول أولًا."):
        super().__init__(message, 401)


class ForbiddenError(AppError):
    def __init__(self, message: str = "لا تملك صلاحية تنفيذ هذه العملية."):
        super().__init__(message, 403)


class ConflictError(AppError):
    def __init__(self, message: str = "يوجد تعارض في البيانات."):
        super().__init__(message, 409)


class ValidationError(AppError):
    def __init__(self, message: str = "البيانات المدخلة غير صحيحة.", errors: dict = None):
        super().__init__(message, 422)
        self.errors = errors or {}


class InsufficientStockError(AppError):
    def __init__(self, message: str = "كمية الدواء غير كافية."):
        super().__init__(message, 400)
