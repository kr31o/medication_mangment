"""جداول auth_db كأصناف Python: المستخدمون، جلسات الدخول، حدود المحاولات، والـ outbox.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, ForeignKey, Index, Text, text, UniqueConstraint
from sqlalchemy.dialects.mysql import BIGINT, CHAR, DATETIME, INTEGER, JSON, VARCHAR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


# ======== جداول الحسابات والجلسات والـ outbox

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        primary_key=True,
        autoincrement=True,
    )
    public_id: Mapped[str] = mapped_column(
        CHAR(36, charset="ascii", collation="ascii_bin"),
        nullable=False,
    )
    email: Mapped[Optional[str]] = mapped_column(
        VARCHAR(320),
        nullable=True,
    )
    phone: Mapped[Optional[str]] = mapped_column(
        VARCHAR(32),
        nullable=True,
    )
    password_hash: Mapped[str] = mapped_column(
        VARCHAR(255),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(
        VARCHAR(20),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        VARCHAR(24),
        nullable=False,
        server_default=text("'ACTIVE'"),
    )
    # [إضافة، قرار «و»] سبب إيقاف الأدمن للحساب ووقت آخر تغيير للحالة بيده. السبب
    # يُعرض لصاحب الحساب حين يحاول الدخول. NULL لحساب لم يغيّر الأدمن حالته.
    status_reason: Mapped[Optional[str]] = mapped_column(
        VARCHAR(500),
        nullable=True,
    )
    status_changed_at: Mapped[Optional[datetime]] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP(6)"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)"),
    )

    refresh_sessions: Mapped[list["RefreshSession"]] = relationship(
        back_populates="user",
        passive_deletes=True,
    )

    __table_args__ = (
        UniqueConstraint("public_id", name="uq_users_public_id"),
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("phone", name="uq_users_phone"),
        CheckConstraint(
            "email IS NOT NULL OR phone IS NOT NULL",
            name="chk_users_identity",
        ),
        CheckConstraint(
            "email IS NULL OR CHAR_LENGTH(TRIM(email)) > 0",
            name="chk_users_email_nonempty",
        ),
        CheckConstraint(
            "phone IS NULL OR CHAR_LENGTH(TRIM(phone)) > 0",
            name="chk_users_phone_nonempty",
        ),
        CheckConstraint(
            "role IN ('PATIENT', 'PHARMACY', 'ADMIN')",
            name="chk_users_role",
        ),
        CheckConstraint(
            "status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')",
            name="chk_users_status",
        ),
        # لا إيقاف بلا سبب مكتوب: صاحب الحساب يجب أن يعرف لماذا أُوقف.
        CheckConstraint(
            "status <> 'SUSPENDED' OR (status_reason IS NOT NULL AND CHAR_LENGTH(TRIM(status_reason)) > 0)",
            name="chk_users_status_reason",
        ),
    )


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        primary_key=True,
        autoincrement=True,
    )
    public_id: Mapped[str] = mapped_column(
        CHAR(36, charset="ascii", collation="ascii_bin"),
        nullable=False,
    )
    family_id: Mapped[str] = mapped_column(
        CHAR(36, charset="ascii", collation="ascii_bin"),
        nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey(
            "users.id",
            name="fk_refresh_sessions_user",
            onupdate="RESTRICT",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(
        CHAR(64, charset="ascii", collation="ascii_bin"),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )
    replaced_by_id: Mapped[Optional[int]] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey(
            "refresh_sessions.id",
            name="fk_refresh_sessions_replaced_by",
            onupdate="RESTRICT",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    revoked_reason: Mapped[Optional[str]] = mapped_column(
        VARCHAR(128),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP(6)"),
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )

    user: Mapped["User"] = relationship(
        back_populates="refresh_sessions",
        foreign_keys=[user_id],
    )
    replaced_by: Mapped[Optional["RefreshSession"]] = relationship(
        remote_side=[id],
        foreign_keys=[replaced_by_id],
        uselist=False,
    )

    __table_args__ = (
        UniqueConstraint("public_id", name="uq_refresh_sessions_public_id"),
        UniqueConstraint("token_hash", name="uq_refresh_sessions_token_hash"),
        Index("idx_refresh_sessions_family_id", "family_id"),
        Index("idx_refresh_sessions_user_id", "user_id"),
        Index("idx_refresh_sessions_expires_at", "expires_at"),
        CheckConstraint(
            "CHAR_LENGTH(public_id) = 36 AND CHAR_LENGTH(family_id) = 36",
            name="chk_refresh_sessions_public_ids",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="chk_refresh_sessions_expiry",
        ),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name="chk_refresh_sessions_revoked",
        ),
        CheckConstraint(
            "last_used_at IS NULL OR (last_used_at >= created_at AND last_used_at <= expires_at)",
            name="chk_refresh_sessions_last_used",
        ),
        CheckConstraint(
            "(revoked_at IS NULL AND revoked_reason IS NULL) OR "
            "(revoked_at IS NOT NULL AND revoked_reason IS NOT NULL AND CHAR_LENGTH(TRIM(revoked_reason)) > 0)",
            name="chk_refresh_sessions_revoked_reason",
        ),
    )


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        primary_key=True,
        autoincrement=True,
    )
    event_id: Mapped[str] = mapped_column(
        CHAR(36, charset="ascii", collation="ascii_bin"),
        nullable=False,
    )
    aggregate_type: Mapped[str] = mapped_column(
        VARCHAR(64),
        nullable=False,
    )
    aggregate_id: Mapped[str] = mapped_column(
        CHAR(36, charset="ascii", collation="ascii_bin"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(
        VARCHAR(128),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(
        INTEGER(unsigned=True),
        nullable=False,
        server_default=text("1"),
    )
    correlation_id: Mapped[Optional[str]] = mapped_column(
        CHAR(36, charset="ascii", collation="ascii_bin"),
        nullable=True,
    )
    causation_id: Mapped[Optional[str]] = mapped_column(
        CHAR(36, charset="ascii", collation="ascii_bin"),
        nullable=True,
    )
    payload: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        VARCHAR(16),
        nullable=False,
        server_default=text("'PENDING'"),
    )
    attempts: Mapped[int] = mapped_column(
        INTEGER(unsigned=True),
        nullable=False,
        server_default=text("0"),
    )
    last_error: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint("event_id", name="uq_auth_outbox_event_id"),
        Index("idx_auth_outbox_status_occurred", "status", "occurred_at"),
        CheckConstraint(
            "status IN ('PENDING', 'PUBLISHED', 'FAILED')",
            name="chk_auth_outbox_status",
        ),
        CheckConstraint(
            "CHAR_LENGTH(TRIM(event_id)) = 36",
            name="chk_auth_outbox_event_id_format",
        ),
        CheckConstraint(
            "CHAR_LENGTH(TRIM(aggregate_type)) > 0",
            name="chk_auth_outbox_aggregate_type_nonempty",
        ),
        CheckConstraint(
            "CHAR_LENGTH(TRIM(aggregate_id)) = 36",
            name="chk_auth_outbox_aggregate_id_format",
        ),
        CheckConstraint(
            "correlation_id IS NULL OR CHAR_LENGTH(TRIM(correlation_id)) = 36",
            name="chk_auth_outbox_correlation_id_format",
        ),
        CheckConstraint(
            "causation_id IS NULL OR CHAR_LENGTH(TRIM(causation_id)) = 36",
            name="chk_auth_outbox_causation_id_format",
        ),
        CheckConstraint(
            "status <> 'FAILED' OR (last_error IS NOT NULL AND CHAR_LENGTH(TRIM(last_error)) > 0)",
            name="chk_auth_outbox_failed_error",
        ),
        CheckConstraint(
            "CHAR_LENGTH(TRIM(event_type)) > 0",
            name="chk_auth_outbox_event_type",
        ),
        CheckConstraint(
            "version >= 1",
            name="chk_auth_outbox_version",
        ),
        CheckConstraint(
            "(status = 'PUBLISHED' AND published_at IS NOT NULL) OR "
            "(status <> 'PUBLISHED' AND published_at IS NULL)",
            name="chk_auth_outbox_publish_state",
        ),
    )


# ======== حدود المحاولات

class AuthRateLimit(Base):
    """نافذة ثابتة للحد من محاولات عملية Auth واحدة.

    `key_hash` هو HMAC لمفتاح خام (IP أو معرّف مستخدم)، فلا يُخزَّن بريد
    ولا هاتف ولا عنوان IP كنص صريح.
    """

    __tablename__ = "auth_rate_limits"

    id: Mapped[int] = mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        CHAR(36, charset="ascii", collation="ascii_bin"),
        nullable=False,
    )
    scope: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    key_hash: Mapped[str] = mapped_column(
        CHAR(64, charset="ascii", collation="ascii_bin"),
        nullable=False,
    )
    window_started_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    request_count: Mapped[int] = mapped_column(
        INTEGER(unsigned=True), nullable=False, server_default=text("0")
    )
    request_limit: Mapped[int] = mapped_column(INTEGER(unsigned=True), nullable=False)
    window_seconds: Mapped[int] = mapped_column(INTEGER(unsigned=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6), nullable=False, server_default=text("CURRENT_TIMESTAMP(6)")
    )
    # server_onupdate في SQLAlchemy تلميح لا يولّد DDL، فلو اكتفينا به
    # لخرج العمود بلا ON UPDATE ولما تحدّث أبدًا. الجملة كاملة داخل
    # server_default هي الصيغة المطابقة لتعريف العمود في db/medplat_schema.sql.
    updated_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)"),
    )

    __table_args__ = (
        UniqueConstraint("public_id", name="uq_auth_rate_limits_public_id"),
        # هذا القيد هو ما يجعل INSERT ... ON DUPLICATE KEY UPDATE ذريًا.
        UniqueConstraint("scope", "key_hash", name="uq_auth_rate_limits_scope_key"),
        Index("idx_auth_rate_limits_expires_at", "expires_at"),
        CheckConstraint("request_limit >= 1", name="chk_auth_rate_limits_limit"),
        CheckConstraint("window_seconds >= 1", name="chk_auth_rate_limits_window"),
        CheckConstraint("CHAR_LENGTH(TRIM(scope)) > 0", name="chk_auth_rate_limits_scope_nonempty"),
    )
