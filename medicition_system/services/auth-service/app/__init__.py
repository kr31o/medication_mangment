"""auth-service: accounts, sign-in, sessions, and patient accounts for the admin.

Files in this package (one job each):
    config.py          settings from .env
    db.py              database connection and transactions
    models.py          auth_db tables as Python classes
    repositories.py    the queries on those tables
    security.py        password hashing, JWT signing, token hashes
    contracts.py       request validation and error codes
    errors.py          errors and their JSON responses
    auth_service.py    register, login, refresh, logout
    account_admin.py   patient accounts for the admin (list, suspend, reactivate)
    routes.py          the HTTP API

ASCII-only on purpose: this file was emptied once by an extraction tool on the
owner's machine; plain ASCII is the safest content for it.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from flask import Flask, g, request

REQUEST_ID_HEADER = "X-Request-ID"
# 16 KB is plenty for every auth request; larger bodies get 413 REQUEST_TOO_LARGE.
MAX_BODY_BYTES = 16 * 1024


def install_request_context(app: Flask) -> None:
    """Attach one bounded, validated correlation/request ID to every request."""
    # Assigned, not setdefault: Flask's default config already holds the key (None),
    # so setdefault left request bodies unlimited.
    app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

    @app.before_request
    def _set_request_id() -> None:
        raw_request_id = request.headers.get(REQUEST_ID_HEADER, "").strip()
        try:
            request_id = str(UUID(raw_request_id)) if raw_request_id else str(uuid4())
        except ValueError:
            request_id = str(uuid4())
        g.request_id = request_id

    @app.after_request
    def _add_request_id(response):
        response.headers[REQUEST_ID_HEADER] = g.request_id
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.path.startswith(("/api/v1/auth/", "/internal/")):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


def create_app() -> Flask:
    """Create and configure the Auth Service Flask application."""
    from medplat.web import trust_forwarded_for

    from app import routes
    from app.errors import register_error_handlers

    # An API service serves no static files; disabling the route removes unused surface.
    app = Flask(__name__, static_folder=None)

    # The real client address behind the gateway (per-IP limits), same policy as the other services.
    trust_forwarded_for(app)
    install_request_context(app)
    register_error_handlers(app)

    for blueprint in routes.BLUEPRINTS:
        app.register_blueprint(blueprint)
    return app
