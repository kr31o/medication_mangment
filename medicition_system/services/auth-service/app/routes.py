"""مسارات auth-service (الـ API).

    GET   /health  و  /ready                               الحالة والجاهزية
    GET   /.well-known/jwks.json                           المفتاح العام لتوقيع رموز الدخول
    POST  /api/v1/auth/register                            إنشاء حساب (مريض أو صيدلية)
    POST  /api/v1/auth/login  و  /refresh  و  /logout      الدخول وتجديد الجلسة والخروج
    GET   /api/v1/auth/admin/patients (+ /summary)         المرضى للأدمن
    POST  /api/v1/auth/admin/patients/<id>/suspend|reactivate      إيقاف الحساب وإعادة تفعيله
    POST  /internal/v1/users/contacts                      للخدمات الأخرى: بريد وهاتف أصحاب حسابات
"""

from __future__ import annotations

from flask import Blueprint, g, jsonify, request, Response

from medplat.internal import require_internal
from medplat.web import ok, page
from medplat.security import current_principal, require_auth
from medplat.validation import Fields, json_body, page_params

from app import account_admin, REQUEST_ID_HEADER
from app.auth_service import AuthService
from app.contracts import (
    LoginRequest,
    RefreshTokenRequest,
    RegisterRequest,
)
from app.db import check_database_connection
from app.errors import ValidationError
from app.security import check_jwt_keys, public_jwk


# ======== الحالة والجاهزية

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    """هل العملية حيّة؟ لا تفحص أي اعتمادية.

    الفصل بين هذا و`/ready` مقصود: خلطهما يجعل أي مراقب خارجي يعلن
    الخدمة ميتة ويعيد تشغيلها لمجرد أن قاعدة البيانات تأخرت لحظة —
    وإعادة التشغيل لا تصلح قاعدة بيانات.
    """
    return jsonify({"status": "ok", "service": "auth-service"}), 200


@health_bp.get("/ready")
def ready():
    """هل تستطيع الخدمة تلبية الطلبات فعلًا؟

    اعتماديتان: MySQL وزوج مفاتيح JWT.
    """
    database_ok = check_database_connection()
    jwt_keys_ok = check_jwt_keys()
    all_ready = database_ok and jwt_keys_ok

    return (
        jsonify(
            {
                "status": "ready" if all_ready else "degraded",
                "service": "auth-service",
                "database": "ok" if database_ok else "unavailable",
                "jwt_keys": "ok" if jwt_keys_ok else "unavailable",
            }
        ),
        200 if all_ready else 503,
    )


# ======== المفتاح العام

well_known_bp = Blueprint("well_known", __name__)


@well_known_bp.get("/.well-known/jwks.json")
def jwks():
    return jsonify({"keys": [public_jwk()]})


# ======== التسجيل

register_bp = Blueprint("auth_register", __name__, url_prefix="/api/v1/auth")


@register_bp.post("/register")
def register():
    """Create an active PATIENT or PHARMACY account."""
    if not request.is_json:
        raise ValidationError("Content-Type must be application/json.")

    payload = request.get_json(silent=True)
    if payload is None:
        raise ValidationError("Request body must be valid JSON.")

    try:
        registration_request = RegisterRequest.from_mapping(payload)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc

    result = AuthService().register(
        registration_request,
        correlation_id=g.request_id,
        client_ip=request.remote_addr or "unknown",
    )

    response = jsonify(
        {
            "data": result,
            "request_id": g.request_id,
        }
    )
    response.status_code = 201
    response.headers[REQUEST_ID_HEADER] = g.request_id
    return response


# ======== الدخول

login_bp = Blueprint("auth_login", __name__, url_prefix="/api/v1/auth")


@login_bp.post("/login")
def login():
    if not request.is_json:
        raise ValidationError("Content-Type must be application/json.")

    payload = request.get_json(silent=True)
    if payload is None:
        raise ValidationError("Request body must be valid JSON.")

    try:
        login_request = LoginRequest.from_mapping(payload)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc

    result = AuthService().login(
        login_request,
        client_ip=request.remote_addr or "unknown",
        correlation_id=g.request_id,
    )

    response = jsonify({"data": result, "request_id": g.request_id})
    response.status_code = 200
    response.headers[REQUEST_ID_HEADER] = g.request_id
    response.headers["Cache-Control"] = "no-store"
    return response


# ======== تجديد الجلسة

refresh_bp = Blueprint("auth_refresh", __name__, url_prefix="/api/v1/auth")


@refresh_bp.post("/refresh")
def refresh():
    if not request.is_json:
        raise ValidationError("Content-Type must be application/json.")

    payload = request.get_json(silent=True)
    if payload is None:
        raise ValidationError("Request body must be valid JSON.")

    try:
        refresh_request = RefreshTokenRequest.from_mapping(payload)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc

    result = AuthService().refresh(
        refresh_request.refresh_token,
        client_ip=request.remote_addr or "unknown",
        correlation_id=g.request_id,
    )

    response = jsonify({"data": result, "request_id": g.request_id})
    response.status_code = 200
    response.headers[REQUEST_ID_HEADER] = g.request_id
    response.headers["Cache-Control"] = "no-store"
    return response


# ======== الخروج

logout_bp = Blueprint("auth_logout", __name__, url_prefix="/api/v1/auth")


@logout_bp.post("/logout")
def logout() -> Response:
    """Revoke the current refresh-token family and end the login session."""
    if not request.is_json:
        raise ValidationError("Content-Type must be application/json.")

    payload = request.get_json(silent=True)
    if payload is None:
        raise ValidationError("Request body must be valid JSON.")

    try:
        logout_request = RefreshTokenRequest.from_mapping(payload)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc

    AuthService().logout(
        logout_request.refresh_token,
        correlation_id=g.request_id,
    )

    response = Response(status=204)
    response.headers[REQUEST_ID_HEADER] = g.request_id
    response.headers["Cache-Control"] = "no-store"
    return response


# ======== المرضى للأدمن، والمسار الداخلي
# [إضافة، قرار «و»] حسابات المرضى للأدمن، ومسار داخلي لبيانات التواصل.
#
#     GET   /api/v1/auth/admin/patients                    حسابات المرضى (بحث وحالة وصفحات)
#     GET   /api/v1/auth/admin/patients/summary            عدد الحسابات في كل حالة
#     POST  /api/v1/auth/admin/patients/<id>/suspend       إيقاف الحساب مع سبب إلزامي
#     POST  /api/v1/auth/admin/patients/<id>/reactivate    إعادة التفعيل
#     POST  /internal/v1/users/contacts                    للخدمات الأخرى: بريد وهاتف أصحاب حسابات
#
# مكتوبة بأدوات الحزمة المشتركة (require_auth، Fields، مغلف الردود) كبقية الخدمات.

admin_patients_bp = Blueprint("auth_admin_patients", __name__, url_prefix="/api/v1/auth/admin/patients")
users_internal_bp = Blueprint("auth_users_internal", __name__, url_prefix="/internal/v1/users")


@admin_patients_bp.get("")
@require_auth("ADMIN")
def list_patients():
    fields = Fields(request.args, allowed=("status", "q", "limit", "offset"))
    status = fields.choice("status", account_admin.STATUSES, required=False)
    query = fields.string("q", required=False, max_len=100)
    fields.raise_if_invalid()
    limit, offset = page_params()
    items, total, names_available = account_admin.list_patients(status=status, query=query, limit=limit, offset=offset)
    return page(items, total=total, limit=limit, offset=offset, extra_meta={"names_available": names_available})


@admin_patients_bp.get("/summary")
@require_auth("ADMIN")
def patients_summary():
    return ok(account_admin.summary())


@admin_patients_bp.post("/<uuid:user_id>/suspend")
@require_auth("ADMIN")
def suspend_patient(user_id):
    fields = Fields(json_body(), allowed=("reason",))
    reason = fields.string("reason", min_len=3, max_len=500, collapse_spaces=True)
    fields.raise_if_invalid()
    return ok(account_admin.suspend(str(user_id), reason=reason, principal=current_principal(), correlation_id=g.request_id))


@admin_patients_bp.post("/<uuid:user_id>/reactivate")
@require_auth("ADMIN")
def reactivate_patient(user_id):
    return ok(account_admin.reactivate(str(user_id), principal=current_principal(), correlation_id=g.request_id))


@users_internal_bp.post("/contacts")
@require_internal
def contacts():
    fields = Fields(json_body(), allowed=("user_refs",))
    raw_refs = fields.items("user_refs", max_items=account_admin.LOOKUP_MAX)
    refs: list[str] = []
    for index, raw in enumerate(raw_refs):
        child = Fields({"ref": raw}, prefix=f"user_refs[{index}].")
        value = child.uuid("ref")
        fields.absorb(child)
        if value:
            refs.append(value)
    fields.raise_if_invalid()
    return ok({"items": account_admin.contacts(refs)})


# بترتيب تسجيلها في التطبيق (app/__init__.py).
BLUEPRINTS = (
    health_bp,
    register_bp,
    login_bp,
    logout_bp,
    refresh_bp,
    well_known_bp,
    admin_patients_bp,
    users_internal_bp,
)
