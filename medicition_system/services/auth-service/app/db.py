"""اتصال auth-service بقاعدته: المحرك، الجلسات، والـ transaction (يقرأ AUTH_DB_* من .env).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, text, URL
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


# ======== الصنف الأساسي للجداول

class Base(DeclarativeBase):
    """Base class for all Auth Service ORM models."""


# ======== المحرك والاتصال

def create_database_engine() -> Engine:
    """Create the Auth Service SQLAlchemy engine."""
    settings = get_settings()

    database_url = URL.create(
        drivername="mysql+pymysql",
        username=settings.db_user,
        password=settings.db_password,
        host=settings.db_host,
        port=settings.db_port,
        database=settings.db_name,
        query={"charset": "utf8mb4"},
    )

    return create_engine(
        database_url,
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_size=5,
        max_overflow=5,
        pool_timeout=30,
        # لا قيم معاملات في رسائل الأخطاء: كانت ستكتب البريد وبصمة كلمة المرور في السجل.
        hide_parameters=True,
        connect_args={"init_command": "SET time_zone = '+00:00'"},
    )


engine = create_database_engine()


def check_database_connection() -> bool:
    """Check database reachability without leaking connection details."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


# ======== الجلسات

SessionFactory = sessionmaker(
    bind=engine,
    class_=Session,
    autoflush=False,
    expire_on_commit=False,
)


# ======== الـ transaction

@contextmanager
def transaction() -> Iterator[Session]:
    """Provide one transactional SQLAlchemy session.

    The context commits only when the caller exits successfully. Any
    exception rolls the transaction back before the session is closed.
    """
    with SessionFactory() as session:
        try:
            with session.begin():
                yield session
        except Exception:
            # `session.begin()` already rolls back on exception. This explicit
            # rollback is defensive and harmless for an inactive transaction.
            if session.in_transaction():
                session.rollback()
            raise
