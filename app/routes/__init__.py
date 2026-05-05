from app.routes.pages_routes import pages_bp
from app.routes.auth_routes import auth_bp
from app.routes.medication_routes import medication_bp
from app.routes.dose_routes import dose_bp
from app.routes.notification_routes import notification_bp
from app.routes.admin_routes import admin_bp


def register_routes(app):
    app.register_blueprint(pages_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(medication_bp)
    app.register_blueprint(dose_bp)
    app.register_blueprint(notification_bp)
    app.register_blueprint(admin_bp)
