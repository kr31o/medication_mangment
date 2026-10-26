from flask import Flask

from medplat.web import create_service_app
from medplat.security import public_key_available


def create_app() -> Flask:
    from app.models import database
    from app.routes import admin, internal, public, requests_admin, requests_public

    return create_service_app(
        service_name="medication-service",
        blueprints=[public, admin, internal, requests_public, requests_admin],
        readiness={"database": database.ping, "jwt_public_key": public_key_available},
    )
