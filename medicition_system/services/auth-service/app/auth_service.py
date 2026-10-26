"""منطق الحسابات: التسجيل، الدخول، تجديد الجلسة (مع كشف إعادة الاستعمال)، والخروج.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.contracts import LoginRequest, RegisterRequest
from app.db import transaction
from app.errors import (
    AccountSuspendedError,
    ConflictError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
    RateLimitedError,
)
from app.models import OutboxEvent, RefreshSession, User
from app.repositories import (
    consume_rate_limit,
    OutboxRepository,
    RefreshSessionRepository,
    UserRepository,
)
from app.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    needs_rehash,
    rate_limit_key,
    verify_password_for_login,
)



def _utc_now() -> datetime:
    """Return a timezone-naive UTC datetime for MySQL DATETIME columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _is_duplicate_user_error(error: IntegrityError) -> bool:
    """Identify unique-user conflicts without hiding unrelated DB errors."""
    message = str(getattr(error, "orig", error))
    return any(
        constraint in message
        for constraint in (
            "uq_users_email",
            "uq_users_phone",
            "uq_users_public_id",
        )
    )


def _security_event(
    session,
    *,
    user: User,
    event_type: str,
    correlation_id: str | None,
    payload: dict[str, object],
    now: datetime,
    actor_role: str | None = None,
) -> None:
    """حدث أمني في الـ outbox ضمن نفس الـ transaction."""
    body = dict(payload)
    # نفس شكل الفاعل في الحزمة المشتركة (medplat.security.actor_of).
    body["actor"] = {"ref": user.public_id if actor_role is None else None, "role": actor_role or user.role}
    OutboxRepository(session).add(
        OutboxEvent(
            event_id=str(uuid4()),
            aggregate_type="USER",
            aggregate_id=user.public_id,
            event_type=event_type,
            version=1,
            correlation_id=correlation_id,
            causation_id=None,
            payload=body,
            status="PENDING",
            attempts=0,
            occurred_at=now,
        )
    )


class AuthService:
    """Application-level authentication operations."""

    def register(
        self,
        request: RegisterRequest,
        *,
        correlation_id: str,
        client_ip: str,
    ) -> dict[str, str]:
        """ينشئ الحساب داخل transaction واحدة، مفعّلًا من لحظة إنشائه (بلا رمز تحقق)."""
        settings = get_settings()

        if not consume_rate_limit(
            scope="register-ip",
            key_hash=rate_limit_key(scope="register-ip", value=client_ip),
            limit=settings.register_rate_limit,
            window_seconds=settings.register_rate_window_seconds,
            now=_utc_now(),
        ):
            raise RateLimitedError("Too many registration attempts. Please try again later.")

        public_id = str(uuid4())
        role = request.account_type.value
        password_hash = hash_password(request.password)
        now = _utc_now()

        try:
            with transaction() as session:
                user_repository = UserRepository(session)
                outbox_repository = OutboxRepository(session)

                # Fast-path duplicate detection. Database UNIQUE constraints
                # remain the authoritative final protection against races.
                if request.email is not None and user_repository.get_by_email(request.email):
                    raise ConflictError("An account with this email already exists.")

                if request.phone is not None and user_repository.get_by_phone(request.phone):
                    raise ConflictError("An account with this phone already exists.")

                user = User(
                    public_id=public_id,
                    email=request.email,
                    phone=request.phone,
                    password_hash=password_hash,
                    role=role,
                    status="ACTIVE",
                )
                user_repository.add(user)
                outbox_repository.add(
                    OutboxEvent(
                        event_id=str(uuid4()),
                        aggregate_type="USER",
                        aggregate_id=public_id,
                        event_type="UserRegistered",
                        version=1,
                        correlation_id=correlation_id,
                        causation_id=None,
                        payload={
                            "user_public_id": public_id,
                            "role": role,
                            "status": "ACTIVE",
                        },
                        status="PENDING",
                        attempts=0,
                        occurred_at=now,
                    )
                )
                session.flush()
        except ConflictError:
            raise
        except IntegrityError as exc:
            if _is_duplicate_user_error(exc):
                raise ConflictError("An account with the supplied contact already exists.") from exc
            raise

        return {"user_id": public_id, "role": role, "status": "ACTIVE"}

    def login(
        self,
        request: LoginRequest,
        *,
        client_ip: str,
        correlation_id: str | None = None,
    ) -> dict[str, object]:
        """Authenticate an active user and issue access/refresh tokens."""
        settings = get_settings()
        now = _utc_now()

        if not consume_rate_limit(
            scope="login-ip",
            key_hash=rate_limit_key(scope="login-ip", value=client_ip),
            limit=settings.login_rate_limit,
            window_seconds=settings.login_rate_window_seconds,
            now=now,
        ):
            raise RateLimitedError("Too many login attempts. Please try again later.")

        if not consume_rate_limit(
            scope="login-identifier",
            key_hash=rate_limit_key(scope="login-identifier", value=request.identifier),
            limit=settings.login_identifier_rate_limit,
            window_seconds=settings.login_identifier_rate_window_seconds,
            now=now,
        ):
            raise RateLimitedError("Too many login attempts. Please try again later.")

        refresh_token, refresh_token_hash = generate_refresh_token()
        refresh_expires_at = now + timedelta(days=settings.jwt_refresh_token_days)
        by_email = "@" in request.identifier

        with transaction() as session:
            repository = UserRepository(session)
            # Lock the user row for the whole authentication transaction.
            # This serializes Login with status changes (an admin suspending the
            # account) that also lock the same row, so a login cannot create a
            # fresh refresh session after the suspension revoked all sessions.
            user = (
                repository.get_by_email_for_update(request.identifier)
                if by_email
                else repository.get_by_phone_for_update(request.identifier)
            )

            password_valid = verify_password_for_login(
                user.password_hash if user is not None else None,
                request.password,
            )
            if not password_valid:
                raise InvalidCredentialsError("Invalid credentials.")

            if user.status == "SUSPENDED":
                # كلمة المرور صحيحة، فالسائل صاحب الحساب: يُقال له أن الأدمن أوقفه ولماذا.
                # بكلمة مرور خاطئة يبقى الرد "Invalid credentials" ولا يُعرف أن الحساب موقوف.
                raise AccountSuspendedError(user.status_reason)

            if user.status != "ACTIVE":
                raise InvalidCredentialsError("Invalid credentials.")

            if needs_rehash(user.password_hash):
                user.password_hash = hash_password(request.password)

            RefreshSessionRepository(session).add(
                RefreshSession(
                    public_id=str(uuid4()),
                    family_id=str(uuid4()),
                    user_id=user.id,
                    token_hash=refresh_token_hash,
                    expires_at=refresh_expires_at,
                    revoked_at=None,
                    replaced_by_id=None,
                    revoked_reason=None,
                    last_used_at=None,
                )
            )
            # §14.2: الدخول حدث أمني يُدقَّق (من دخل، بأي دور، ومتى). لا كلمة مرور
            # ولا token في الحمولة.
            _security_event(
                session,
                user=user,
                event_type="UserLoggedIn",
                correlation_id=correlation_id,
                payload={"user_public_id": user.public_id, "role": user.role},
                now=now,
            )
            session.flush()

            access_token = create_access_token(
                user_public_id=user.public_id,
                role=user.role,
            )

            return {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_type": "Bearer",
                "expires_in": settings.jwt_access_token_minutes * 60,
                "refresh_expires_in": settings.jwt_refresh_token_days * 24 * 60 * 60,
                "user": {
                    "id": user.public_id,
                    "role": user.role,
                },
            }

    def refresh(
        self,
        raw_refresh_token: str,
        *,
        client_ip: str,
        correlation_id: str | None = None,
    ) -> dict[str, object]:
        """Rotate a refresh token and issue a fresh access/refresh pair.

        The current refresh-session row is locked for update so two concurrent
        uses of the same refresh token cannot both succeed. Reuse of a token
        that was already rotated revokes the whole token family.
        """
        settings = get_settings()
        token_hash = hash_refresh_token(raw_refresh_token)
        now = _utc_now()

        if not consume_rate_limit(
            scope="refresh-ip",
            key_hash=rate_limit_key(scope="refresh-ip", value=client_ip),
            limit=settings.refresh_rate_limit,
            window_seconds=settings.refresh_rate_window_seconds,
            now=now,
        ):
            raise RateLimitedError("Too many refresh attempts. Please try again later.")

        if not consume_rate_limit(
            scope="refresh-token",
            key_hash=rate_limit_key(scope="refresh-token", value=token_hash),
            limit=settings.refresh_token_rate_limit,
            window_seconds=settings.refresh_token_rate_window_seconds,
            now=now,
        ):
            raise RateLimitedError("Too many refresh attempts. Please try again later.")

        new_raw_token, new_token_hash = generate_refresh_token()

        # قاعدة هذه الدالة: أي إجراء أمني (إلغاء العائلة، تعليم الجلسة
        # منتهية) يجب أن يُحفظ قبل رفض الطلب. رفع الاستثناء داخل
        # `with transaction()` يُلغي كل ما سبقه — وهكذا كان كشف إعادة
        # الاستخدام في الكود الأصلي لا يُلغي شيئًا فعليًا. الآن نحدد النتيجة
        # داخل الـ transaction، نتركها تنتهي بـ commit، ثم نرفض.
        rejected = False
        result: dict[str, object] = {}

        with transaction() as session:
            refresh_repository = RefreshSessionRepository(session)
            user_repository = UserRepository(session)

            # ترتيب الأقفال: المستخدم ثم الجلسة، كما في إيقاف الأدمن للحساب
            # (يقفل المستخدم ثم كل جلساته). الترتيب المعاكس كان يجعل refresh
            # متزامنًا مع الإيقاف ينتهي بـ deadlock (1213) و 503.
            owner_id = refresh_repository.owner_of_token_hash(token_hash)
            if owner_id is not None:
                user_repository.get_by_id_for_update(owner_id)
            current = refresh_repository.get_by_token_hash_for_update(token_hash)
            # الوقت بعد أخذ القفل لا قبله: قد ننتظر طلبًا متزامنًا.
            now = _utc_now()

            if current is None:
                rejected = True
            elif current.revoked_at is not None:
                # token سبق تدويره = إشارة سرقة. تُلغى العائلة كلها.
                if current.replaced_by_id is not None or current.revoked_reason == "ROTATED":
                    refresh_repository.revoke_family(
                        current.family_id,
                        reason="REFRESH_TOKEN_REUSE_DETECTED",
                    )
                    owner = user_repository.get_by_id(current.user_id)
                    if owner is not None:
                        # §14.2: إشارة سرقة جلسة — أهم حدث أمني، يُنشر لمن يستمع.
                        _security_event(
                            session,
                            user=owner,
                            event_type="RefreshTokenReuseDetected",
                            correlation_id=correlation_id,
                            payload={
                                "user_public_id": owner.public_id,
                                "family_ref": current.family_id,
                                "reason": "REFRESH_TOKEN_REUSE_DETECTED",
                            },
                            now=now,
                            actor_role="SYSTEM",
                        )
                rejected = True
            elif current.expires_at <= now:
                # ساعة MySQL لا ساعة التطبيق: created_at يأتي من CURRENT_TIMESTAMP(6)
                # وقيود CHECK تقارن بينهما؛ انحراف ساعتين مضيفين كان سيجعل
                # refresh فوري بعد الدخول يخالف القيد (D-08 في التدقيق الأول).
                current.revoked_at = func.utc_timestamp(6)
                current.revoked_reason = "EXPIRED"
                rejected = True
            else:
                user = user_repository.get_by_id_for_update(current.user_id)
                if user is None or user.status != "ACTIVE":
                    refresh_repository.revoke_user(current.user_id, reason="ACCOUNT_NOT_ACTIVE")
                    rejected = True
                else:
                    replacement = RefreshSession(
                        public_id=str(uuid4()),
                        family_id=current.family_id,
                        user_id=current.user_id,
                        token_hash=new_token_hash,
                        expires_at=now + timedelta(days=settings.jwt_refresh_token_days),
                        revoked_at=None,
                        replaced_by_id=None,
                        revoked_reason=None,
                        last_used_at=None,
                    )
                    refresh_repository.add(replacement)
                    session.flush()

                    current.replaced_by_id = replacement.id
                    current.revoked_at = func.utc_timestamp(6)
                    current.revoked_reason = "ROTATED"
                    current.last_used_at = func.utc_timestamp(6)

                    result = {
                        "access_token": create_access_token(
                            user_public_id=user.public_id,
                            role=user.role,
                        ),
                        "refresh_token": new_raw_token,
                        "token_type": "Bearer",
                        "expires_in": settings.jwt_access_token_minutes * 60,
                        "refresh_expires_in": settings.jwt_refresh_token_days * 24 * 60 * 60,
                        "user": {"id": user.public_id, "role": user.role},
                    }

        if rejected:
            raise InvalidRefreshTokenError("Refresh token is invalid.")
        return result

    def logout(self, raw_refresh_token: str, *, correlation_id: str) -> None:
        """Revoke the refresh-token family for the current login session.

        Logout is intentionally idempotent: an unknown, expired, or already
        revoked refresh token results in no state change and no information
        disclosure. A currently active session revokes its entire token family
        so all rotated descendants from that login are invalidated together.
        """
        token_hash = hash_refresh_token(raw_refresh_token)
        now = _utc_now()

        with transaction() as session:
            refresh_repository = RefreshSessionRepository(session)
            user_repository = UserRepository(session)

            current = refresh_repository.get_by_token_hash_for_update(token_hash)
            if current is None or current.revoked_at is not None:
                return

            if current.expires_at <= now:
                return

            user = user_repository.get_by_id(current.user_id)
            if user is None:
                # The refresh row should normally not outlive its user because
                # the FK uses ON DELETE CASCADE. Treat a missing parent as a
                # safe no-op rather than exposing internal consistency details.
                return

            refresh_repository.revoke_family(current.family_id, reason="USER_LOGOUT")

            OutboxRepository(session).add(
                OutboxEvent(
                    event_id=str(uuid4()),
                    aggregate_type="USER",
                    aggregate_id=user.public_id,
                    event_type="UserLoggedOut",
                    version=1,
                    correlation_id=correlation_id,
                    causation_id=None,
                    payload={
                        "user_public_id": user.public_id,
                        # الدور يعرّف مستهلك الحدث بالفاعل الحقيقي لا SYSTEM.
                        "role": user.role,
                        "family_id": current.family_id,
                        "reason": "USER_LOGOUT",
                    },
                    status="PENDING",
                    attempts=0,
                    occurred_at=now,
                )
            )

            session.flush()
