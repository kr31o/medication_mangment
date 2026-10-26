"""الاستدعاءات بين الخدمات.

المسارات الداخلية `/internal/v1/...` محمية برمز مشترك `X-Internal-Token`.
**[إضافة]** المواصفة لم تحدد كيف تتحقق الخدمات من بعضها؛ الرمز المشترك
هو أبسط حل صحيح لتشغيل محلي، ويُستبدل لاحقًا بـ mTLS أو token خدمة
صادر من Auth عند النشر الحقيقي.
"""

from __future__ import annotations

import functools
import hmac
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar

import requests
from flask import request

from medplat.config import platform_settings
from medplat.web import current_request_id, DependencyUnavailable, Forbidden, REQUEST_ID_HEADER

logger = logging.getLogger(__name__)

INTERNAL_TOKEN_HEADER = "X-Internal-Token"
F = TypeVar("F", bound=Callable[..., Any])


def require_internal(fn: F) -> F:
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        supplied = request.headers.get(INTERNAL_TOKEN_HEADER, "")
        expected = platform_settings().internal_api_token
        if not hmac.compare_digest(supplied.encode(), expected.encode()):
            raise Forbidden("Internal endpoint.")
        return fn(*args, **kwargs)

    return wrapper  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class InternalResponse:
    status: int
    body: dict[str, Any]

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def data(self) -> Any:
        return self.body.get("data")

    @property
    def error_code(self) -> str | None:
        error = self.body.get("error")
        return error.get("code") if isinstance(error, dict) else None


class InternalClient:
    """عميل HTTP لخدمة أخرى.

    - انقطاع الاتصال أو انتهاء المهلة أو 5xx → DependencyUnavailable (503).
    - 4xx تُرجع كما هي؛ المتصل يقرر معناها في سياقه.
    - معرّف الطلب يُمرَّر، فيظهر نفس request_id في logs الخدمتين.
    """

    def __init__(self, service: str, *, timeout: tuple[float, float] = (2.0, 8.0)) -> None:
        self.service = service
        self._timeout = timeout

    def _url(self, path: str) -> str:
        return platform_settings().service_urls[self.service] + path

    def _headers(self, extra: dict[str, str] | None) -> dict[str, str]:
        headers = {
            INTERNAL_TOKEN_HEADER: platform_settings().internal_api_token,
            "Accept": "application/json",
        }
        request_id = current_request_id()
        if request_id:
            headers[REQUEST_ID_HEADER] = request_id
        if extra:
            headers.update(extra)
        return headers

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ) -> InternalResponse:
        try:
            response = requests.request(
                method,
                self._url(path),
                params=params,
                json=json,
                headers=self._headers(headers),
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            logger.error("%s-service unreachable: %s %s (%s)", self.service, method, path, exc)
            raise DependencyUnavailable(f"The {self.service} service is unavailable.") from exc

        if response.status_code >= 500:
            logger.error("%s-service returned %s for %s %s", self.service, response.status_code, method, path)
            raise DependencyUnavailable(f"The {self.service} service is unavailable.")

        try:
            body = response.json() if response.content else {}
        except ValueError:
            body = {}
        return InternalResponse(status=response.status_code, body=body if isinstance(body, dict) else {})

    def get(self, path: str, **kwargs: Any) -> InternalResponse:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> InternalResponse:
        return self.request("POST", path, **kwargs)
