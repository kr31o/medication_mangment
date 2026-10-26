"""auth-service: الـ API أو العامل في الخلفية.

    python main.py api       الـ API على منفذ الخدمة (AUTH_SERVICE_PORT في .env)
    python main.py worker    العامل: ينشر أحداث outbox_events إلى RabbitMQ.

scripts/dev.py يشغّل الاثنين لكل خدمة، فلا حاجة لتشغيلهما باليد.
"""

from __future__ import annotations

import sys

from medplat.config import database_settings, env_str, service_port
from medplat.db import Database
from medplat.events import OutboxPublisher
from medplat.worker import run_worker

from app.db import engine
from app.models import OutboxEvent


def api() -> None:
    from app import create_app

    create_app().run(
        host=env_str("AUTH_SERVICE_HOST", "127.0.0.1"),
        port=service_port("auth"),
        threaded=True,
        use_reloader=False,
    )


def worker() -> None:
    # Auth أقدم من الحزمة المشتركة ويملك محركه؛ نعيد استخدامه بدل فتح pool ثانٍ.
    database = Database(database_settings("AUTH"), engine=engine)
    run_worker(
        "auth",
        runners=[OutboxPublisher(database=database, model=OutboxEvent, source="auth")],
    )


if __name__ == "__main__":
    {"api": api, "worker": worker}[sys.argv[1] if len(sys.argv) > 1 else "api"]()
