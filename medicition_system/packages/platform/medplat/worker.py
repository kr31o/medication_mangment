"""عامل الخلفية لكل خدمة: الـ publisher والـ consumers والمهام الدورية.

كل خدمة تملك عملية worker واحدة بجانب عملية الـ API. داخلها خيط لكل
مهمة، وإيقاف نظيف عند Ctrl+C أو SIGTERM.
"""

from __future__ import annotations

import logging
import signal
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from medplat.config import platform_settings
from medplat.web import configure_logging

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class PeriodicJob:
    name: str
    interval_seconds: float
    func: Callable[[], None]
    initial_delay: float = 2.0


def _run_periodic(job: PeriodicJob, stop: threading.Event) -> None:
    stop.wait(job.initial_delay)
    while not stop.is_set():
        try:
            job.func()
        except Exception:
            # مهمة فاشلة لا تقتل العامل؛ تُسجل وتُعاد في دورتها التالية.
            logger.exception("Periodic job %s failed", job.name)
        stop.wait(job.interval_seconds)


def run_worker(
    service_name: str,
    *,
    runners: Iterable[object] = (),
    jobs: Iterable[PeriodicJob] = (),
) -> None:
    """`runners` كائنات لها run(stop) — OutboxPublisher و EventConsumer."""
    configure_logging(f"{service_name}-worker", platform_settings().log_level)
    stop = threading.Event()

    def _shutdown(signum, _frame) -> None:
        logger.info("Stopping worker (signal %s)...", signum)
        stop.set()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    threads: list[threading.Thread] = []
    for runner in runners:
        name = type(runner).__name__
        threads.append(threading.Thread(target=runner.run, args=(stop,), name=name, daemon=True))
    for job in jobs:
        threads.append(
            threading.Thread(target=_run_periodic, args=(job, stop), name=job.name, daemon=True)
        )

    for thread in threads:
        thread.start()
    logger.info("Worker started with %s task(s): %s", len(threads), ", ".join(t.name for t in threads))

    while not stop.is_set():
        stop.wait(1.0)
    for thread in threads:
        thread.join(timeout=10)
    logger.info("Worker stopped.")
