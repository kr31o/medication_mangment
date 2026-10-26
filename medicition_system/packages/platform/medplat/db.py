"""قاعدة البيانات لكل خدمة: الاتصال والـ transaction والأقفال، وتصنيف أخطاء MySQL، وأعمدة مشتركة بين الجداول.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.dialects.mysql import BIGINT, CHAR, DATETIME
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import mapped_column, Session, sessionmaker

from medplat.config import DatabaseSettings


# ======== الاتصال والـ transaction

# رموز أخطاء MySQL المؤقتة: deadlock، انتظار قفل، انقطاع.
_TRANSIENT_MYSQL_CODES = {1205, 1213, 2006, 2013}


def mysql_error_code(error: Exception) -> int | None:
    orig = getattr(error, "orig", None)
    args = getattr(orig, "args", None)
    if args and isinstance(args[0], int):
        return args[0]
    return None


def is_duplicate_key(error: IntegrityError, constraint: str | None = None) -> bool:
    """1062 = duplicate entry. `constraint` يحصر المطابقة في قيد بعينه."""
    if mysql_error_code(error) != 1062:
        return False
    return constraint is None or constraint in str(getattr(error, "orig", error))


# PyMySQL يرفع OperationalError لكل رمز MySQL غير مصنّف، ومنها أخطاء دائمة
# لا علاقة لها بتوفر القاعدة: 3819 (قيد CHECK)، 1142 (صلاحية)، 1054 (عمود).
# هذه عيب في الكود أو البيانات: 500 في الـ API و DLQ في المستهلك، لا 503 ولا
# إعادة محاولة بلا نهاية.
_UNAVAILABLE_MYSQL_CODES = _TRANSIENT_MYSQL_CODES | {1040, 1203, 2002, 2003, 2005, 2055}


def is_unavailable(error: Exception) -> bool:
    """القاعدة غير متاحة الآن (انقطاع، اتصالات ممتلئة، قفل) — تستحق 503 أو إعادة محاولة."""
    if not isinstance(error, OperationalError):
        return False
    code = mysql_error_code(error)
    return code is None or code in _UNAVAILABLE_MYSQL_CODES


class LockNotAcquired(Exception):
    """طلب آخر يمسك نفس القفل المسمّى الآن."""


class Database:
    """محرك واحد وجلسات لقاعدة بيانات خدمة واحدة.

    المحرك يُنشأ عند أول استخدام لا عند الاستيراد: استيراد نموذج أو
    تشغيل اختبار عقد لا يحتاج اتصالاً.
    """

    def __init__(
        self,
        settings: DatabaseSettings,
        *,
        pool_size: int = 5,
        engine: Engine | None = None,
    ) -> None:
        self.settings = settings
        self._pool_size = pool_size
        # engine جاهز يُمرَّر من خدمة تملك محركها أصلًا (auth-service).
        self._engine: Engine | None = engine
        self._session_factory: sessionmaker[Session] | None = None

    @property
    def engine(self) -> Engine:
        if self._engine is None:
            self._engine = create_engine(
                self.settings.url(),
                pool_pre_ping=True,
                pool_recycle=1800,
                pool_size=self._pool_size,
                max_overflow=5,
                pool_timeout=30,
                # بلا هذا تكتب SQLAlchemy قيم المعاملات في رسالة الاستثناء، فيصل
                # إلى السجلات بريد المستخدم أو ملاحظة جرعة عند أي خطأ قاعدة.
                hide_parameters=True,
                # كل جلسة على UTC، فـ CURRENT_TIMESTAMP(6) و UTC_TIMESTAMP متطابقان.
                connect_args={"init_command": "SET time_zone = '+00:00'"},
            )
        return self._engine

    @property
    def session_factory(self) -> sessionmaker[Session]:
        if self._session_factory is None:
            self._session_factory = sessionmaker(
                bind=self.engine,
                class_=Session,
                autoflush=False,
                expire_on_commit=False,
            )
        return self._session_factory

    @contextmanager
    def transaction(self) -> Iterator[Session]:
        """transaction واحدة: commit عند الخروج السليم، rollback عند أي استثناء."""
        with self.session_factory() as session:
            with session.begin():
                yield session

    @contextmanager
    def named_lock(self, name: str, *, timeout_seconds: int = 5) -> Iterator[Session]:
        """transaction كاملة تحت قفل MySQL مسمّى، يُحرَّر بعد الـ COMMIT لا قبله.

        لقرار "هل يوجد صف؟ إن لا فأنشئه" حين لا يوجد صف يُقفل ولا قيد فريد
        يناسب (مثل: ملخص واحد كل 10 دقائق). القفل على اتصال مخصص لا يعود إلى
        الـ pool وهو ممسك به.
        """
        lock_name = name[:64]
        with self.engine.connect() as connection:
            acquired = connection.execute(
                text("SELECT GET_LOCK(:name, :timeout)"), {"name": lock_name, "timeout": timeout_seconds}
            ).scalar()
            connection.commit()
            if acquired != 1:
                raise LockNotAcquired(lock_name)
            try:
                with Session(bind=connection, autoflush=False, expire_on_commit=False) as session:
                    with session.begin():
                        yield session
            finally:
                connection.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": lock_name})
                connection.commit()

    def ping(self) -> bool:
        try:
            with self.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return True
        except Exception:
            return False


# ======== أعمدة مشتركة
# أعمدة متكررة في كل قواعد المنصة، بنفس التعريف حرفيًا (§9.2).
#
# ليست طبقة تجريد: دوال صغيرة ترجع `mapped_column` حتى لا يكتب كل
# نموذج نوع الـ UUID أو قيمة `ON UPDATE` بيده فيخطئ في واحد منها.

# ascii_bin: مقارنة بايت ببايت، وحجم ثابت 36 بايت بدل 144 في utf8mb4.
UUID_TYPE = CHAR(36, charset="ascii", collation="ascii_bin")


def new_uuid() -> str:
    return str(uuid4())


def id_column():
    return mapped_column(BIGINT(unsigned=True), primary_key=True, autoincrement=True)


def public_id_column():
    return mapped_column(UUID_TYPE, nullable=False, default=new_uuid)


def ref_column(*, nullable: bool = False):
    """مرجع منطقي لكيان في خدمة أخرى — UUID بلا FK (BR-008)."""
    return mapped_column(UUID_TYPE, nullable=nullable)


def created_at_column():
    return mapped_column(
        DATETIME(fsp=6), nullable=False, server_default=text("CURRENT_TIMESTAMP(6)")
    )


def updated_at_column():
    return mapped_column(
        DATETIME(fsp=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)"),
    )


def utc_datetime(*, nullable: bool = True):
    return mapped_column(DATETIME(fsp=6), nullable=nullable)


__all__ = [
    "UUID_TYPE",
    "created_at_column",
    "id_column",
    "new_uuid",
    "public_id_column",
    "ref_column",
    "updated_at_column",
    "utc_datetime",
]
