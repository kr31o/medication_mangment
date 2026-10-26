#!/usr/bin/env python3
"""بوابة الواجهة [إضافة]: خادم واحد على http://127.0.0.1:5173 يقدّم صفحات المنصة ويوصل طلبات الـ API.

    python scripts/dev.py up        # يشغّلها مع الخدمات (الطريقة المعتادة)
    python scripts/web.py           # أو وحدها

ما تفعله:
1. الصفحات: /patient/orders تفتح frontend/html/patient/orders.html، و /patient تفتح
   frontend/html/patient/index.html. صفحات التفاصيل (/patient/orders/<id>) لها صفحة
   واحدة لكل نوع (DETAIL_PAGES)، والصفحة تقرأ المعرّف من الرابط.
2. ملفات الشكل والكود كما هي: /css /js /fonts /vendor /favicon.svg من مجلد frontend.
3. /config.json: ما تحتاجه الواجهة من .env (العملة، رمز التحقق عند التسجيل، خدمة الطريق).
   لا يخرج منه سر: هذه القيم فقط.
4. كل طلب /api/v1/... يذهب للخدمة المالكة له (ROUTES)، فيرى المتصفح عنوانًا واحدًا
   (لا CORS) ولا يعرف منفذ أي خدمة. المنافذ من .env كما تقرؤها الخدمات (dev.SERVICES).

مكتبة Python القياسية فقط: لا Node ولا npm.
"""

from __future__ import annotations

import email.utils
import http.client
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from dev import SERVICES

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
PAGES = FRONTEND / "html"


def _env() -> dict[str, str]:
    try:
        from dotenv import dotenv_values

        return {**{k: v or "" for k, v in dotenv_values(ROOT / ".env").items()}, **os.environ}
    except ImportError:  # قبل تثبيت الاعتماديات
        return dict(os.environ)


ENV = _env()
HOST = "127.0.0.1"
PORT = int(ENV.get("WEB_PORT") or 5173)

# أي خدمة تملك أي مسار. الترتيب مهم: الأخص قبل الأعم.
ROUTES = [
    ("/api/v1/auth", "auth"),
    ("/.well-known", "auth"),
    ("/api/v1/patients", "patient"),
    ("/api/v1/admin/pharmacies", "pharmacy"),
    ("/api/v1/pharmacies", "pharmacy"),
    ("/api/v1/admin/medications", "medication"),
    ("/api/v1/admin/medication-requests", "medication"),
    ("/api/v1/medications", "medication"),
    ("/api/v1/medication-requests", "medication"),
    ("/api/v1/inventory", "inventory"),
    ("/api/v1/admin/orders", "order"),
    ("/api/v1/pharmacy/orders", "order"),
    ("/api/v1/orders", "order"),
    ("/api/v1/conversations", "order"),
    ("/api/v1/health", "health"),
    ("/api/v1/insights", "ai"),
    ("/api/v1/notifications", "notification"),
]
PORTS = dict(SERVICES)

# صفحة واحدة لكل نوع تفاصيل: الرابط فيه المعرّف، والصفحة تقرؤه منه.
DETAIL_PAGES = [
    (re.compile(r"^/patient/orders/[^/]+$"), "patient/order.html"),
    (re.compile(r"^/patient/pharmacies/[^/]+$"), "patient/pharmacy.html"),
    (re.compile(r"^/patient/medications/[^/]+$"), "patient/medication.html"),
    (re.compile(r"^/pharmacy/orders/[^/]+$"), "pharmacy/order.html"),
    (re.compile(r"^/admin/pharmacies/[^/]+$"), "admin/pharmacy.html"),
]

STATIC_DIRS = ("/css/", "/js/", "/fonts/", "/vendor/")
# أنواع الملفات صريحة: على Windows قد يقول سجل النظام إن .js «text/plain»، فيرفض المتصفح تشغيله.
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
}

# رؤوس تخص الاتصال الواحد فلا تُمرَّر عبر البوابة.
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"}
# توليد ملخص الالتزام بالنموذج المحلي قد يأخذ دقيقة أو أكثر.
API_TIMEOUT_SECONDS = 180


def frontend_config() -> bytes:
    """إعدادات الواجهة من .env. تُقرأ عند تشغيل البوابة: بعد تعديل .env أعد python scripts/dev.py restart."""
    routing = ENV.get("ROUTING_URL")
    config = {
        "currency": (ENV.get("INVENTORY_CURRENCY") or "SYP").strip().upper(),
        # قيمة فارغة تعطّل مسافة الطريق (تبقى مسافة الخط المستقيم).
        "routing_url": "https://router.project-osrm.org" if routing is None else routing.strip(),
        "map_tiles_url": (ENV.get("MAP_TILES_URL") or "").strip(),
        "map_tiles_attribution": (ENV.get("MAP_TILES_ATTRIBUTION") or "").strip(),
    }
    return json.dumps(config, ensure_ascii=False).encode()


def page_for(path: str) -> Path | None:
    """ملف HTML لرابط صفحة، أو None إن لم توجد صفحة بهذا الرابط."""
    clean = path.rstrip("/") or "/"
    if ".." in clean or "\\" in clean:
        return None
    candidates = ["index.html"] if clean == "/" else [f"{clean[1:]}.html", f"{clean[1:]}/index.html"]
    candidates += [page for pattern, page in DETAIL_PAGES if pattern.match(clean)]
    for name in candidates:
        file = PAGES / name
        if file.is_file():
            return file
    return None


def static_file(path: str) -> Path | None:
    """ملف من frontend (css و js و fonts و vendor و favicon.svg)، داخل المجلد فقط."""
    if not (path.startswith(STATIC_DIRS) or path == "/favicon.svg"):
        return None
    file = (FRONTEND / path.lstrip("/")).resolve()
    if FRONTEND.resolve() not in file.parents or not file.is_file():
        return None
    return file


def service_for(path: str) -> str | None:
    for prefix, service in ROUTES:
        if path == prefix or path.startswith(prefix + "/"):
            return service
    return None


class Gateway(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "medplat-web"

    # ------------------------------------------------------------------ الرد

    def _send(self, status: int, body: bytes, content_type: str, headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_file(self, file: Path, status: int = 200) -> None:
        modified = email.utils.formatdate(file.stat().st_mtime, usegmt=True)
        # no-cache: المتصفح يسأل كل مرة إن تغيّر الملف (رد 304 صغير إن لم يتغير)،
        # فتعديل أي ملف يظهر بمجرد تحديث الصفحة.
        headers = {"Cache-Control": "no-cache", "Last-Modified": modified}
        if status == 200 and self.headers.get("If-Modified-Since") == modified:
            self.send_response(304)
            for name, value in headers.items():
                self.send_header(name, value)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self._send(status, file.read_bytes(), TYPES.get(file.suffix, "application/octet-stream"), headers)

    def _send_error_json(self, status: int, message: str) -> None:
        body = json.dumps({"error": {"code": "SERVICE_UNAVAILABLE", "message": message}}, ensure_ascii=False).encode()
        self._send(status, body, "application/json")

    # ------------------------------------------------------------------ الطلبات

    def _handle(self) -> None:
        path = urlsplit(self.path).path
        service = service_for(path)
        if service:
            self._proxy(service)
            return
        if self.command not in ("GET", "HEAD"):
            self._send(405, b"", "text/plain")
            return
        if path == "/config.json":
            self._send(200, frontend_config(), "application/json", {"Cache-Control": "no-store"})
            return
        file = static_file(path) or page_for(path)
        if file:
            self._send_file(file)
        else:
            self._send_file(PAGES / "404.html", status=404)

    def _proxy(self, service: str) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        # عنوان المتصفح الحقيقي: حدود الطلبات لكل IP تعمل لكل مستخدم لا للبوابة كلها.
        client = self.client_address[0]
        forwarded = self.headers.get("X-Forwarded-For")
        headers["X-Forwarded-For"] = f"{forwarded}, {client}" if forwarded else client
        connection = http.client.HTTPConnection("127.0.0.1", PORTS[service], timeout=API_TIMEOUT_SECONDS)
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read()
        except (ConnectionError, OSError) as exc:
            self.log_message("%s %s → %s: %s", self.command, self.path, service, exc)
            timeout = isinstance(exc, TimeoutError)
            self._send_error_json(
                504 if timeout else 502,
                f"خدمة {service} تأخرت في الرد." if timeout else f"خدمة {service} لا تعمل الآن.",
            )
            return
        finally:
            connection.close()
        self.send_response(response.status, response.reason)
        for name, value in response.getheaders():
            if name.lower() not in HOP_BY_HOP and name.lower() != "content-length":
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = _handle

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        # السجل (var/log/web.log) للأخطاء فقط: ملفات الصفحات كثيرة ولا حاجة لكل واحد منها.
        if str(code).startswith("5"):
            self.log_message('"%s" %s', self.requestline, code)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # على Windows يسمح SO_REUSEADDR لبرنامجين بنفس المنفذ معًا: لا نطلبه هناك.
    allow_reuse_address = sys.platform != "win32"

    def handle_error(self, request, client_address) -> None:  # type: ignore[no-untyped-def]
        # المتصفح أغلق الاتصال قبل اكتمال الرد (انتقل إلى صفحة أخرى مثلًا): أمر عادي، لا
        # يستحق سطرًا في السجل. أي خطأ آخر يُكتب كاملًا كما هو.
        if isinstance(sys.exc_info()[1], ConnectionError):
            return
        super().handle_error(request, client_address)


def main() -> int:
    try:
        server = Server((HOST, PORT), Gateway)
    except OSError:
        print(f"المنفذ {PORT} مستخدم: الواجهة تعمل مسبقًا، أو برنامج آخر عليه. أوقفه أو غيّر WEB_PORT في .env.")
        return 1
    print(f"الواجهة على http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
