"""medication-service: الـ API أو العامل في الخلفية.

    python main.py api       الـ API على منفذ الخدمة (MEDICATION_SERVICE_PORT في .env)
    python main.py worker    العامل: ينشر أحداث outbox_events إلى RabbitMQ.

scripts/dev.py يشغّل الاثنين لكل خدمة، فلا حاجة لتشغيلهما باليد.
"""

from __future__ import annotations

import sys

from medplat.config import env_str, service_port
from medplat.events import OutboxPublisher
from medplat.worker import run_worker

from app.models import OutboxEvent, database


def api() -> None:
    from app import create_app

    create_app().run(
        host=env_str("MEDICATION_SERVICE_HOST", "127.0.0.1"),
        port=service_port("medication"),
        threaded=True,
        use_reloader=False,
    )


def worker() -> None:
    run_worker(
        "medication",
        runners=[OutboxPublisher(database=database, model=OutboxEvent, source="medication")],
    )


if __name__ == "__main__":
    {"api": api, "worker": worker}[sys.argv[1] if len(sys.argv) > 1 else "api"]()
