from flask import Flask, jsonify
from app.config import Config
from app.extensions import db, jwt, cors
from app.exception import AppError, ValidationError


def _seed_default_admin():
    from werkzeug.security import generate_password_hash
    from app.models.admin import Admin

    email = "admin@admin.com"
    if Admin.query.filter_by(email=email).first():
        return
    db.session.add(Admin(
        name="Administrator",
        email=email,
        password_hash=generate_password_hash("123456"),
        status="active",
    ))
    db.session.commit()


def create_app() -> Flask:
    flask_app = Flask(__name__)
    flask_app.config.from_object(Config)

    db.init_app(flask_app)
    jwt.init_app(flask_app)
    cors.init_app(flask_app, resources={r"/api/*": {"origins": "*"}})

    @jwt.token_in_blocklist_loader
    def check_if_token_revoked(jwt_header, jwt_payload):
        from app.models.blacklisted_token import BlacklistedToken
        return BlacklistedToken.query.filter_by(jti=jwt_payload["jti"]).first() is not None

    @jwt.revoked_token_loader
    def revoked_token_response(jwt_header, jwt_payload):
        return jsonify({"success": False, "message": "تم تسجيل الخروج من هذه الجلسة. يرجى تسجيل الدخول مرة أخرى."}), 401

    @jwt.expired_token_loader
    def expired_token_response(jwt_header, jwt_payload):
        return jsonify({"success": False, "message": "انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى."}), 401

    @jwt.invalid_token_loader
    def invalid_token_response(error):
        return jsonify({"success": False, "message": "جلسة الدخول غير صحيحة. يرجى تسجيل الدخول من جديد."}), 422

    @jwt.unauthorized_loader
    def missing_token_response(error):
        return jsonify({"success": False, "message": "يرجى تسجيل الدخول أولًا."}), 401

    @flask_app.errorhandler(AppError)
    def handle_app_error(e):
        body = {"success": False, "message": e.message}
        if isinstance(e, ValidationError) and e.errors:
            body["errors"] = e.errors
        return jsonify(body), e.status_code

    @flask_app.errorhandler(404)
    def handle_404(e):
        return jsonify({"success": False, "message": "المسار المطلوب غير موجود."}), 404

    @flask_app.errorhandler(405)
    def handle_405(e):
        return jsonify({"success": False, "message": "طريقة الطلب غير مسموحة لهذا المسار."}), 405

    @flask_app.errorhandler(Exception)
    def handle_unexpected(e):
        import logging
        import traceback
        logging.error(traceback.format_exc())
        return jsonify({"success": False, "message": "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى."}), 500

    from app.routes import register_routes
    register_routes(flask_app)

    with flask_app.app_context():
        import app.models  # noqa: F401
        if flask_app.config.get("AUTO_CREATE_TABLES", True):
            db.create_all()
            _seed_default_admin()

    if flask_app.config.get("SCHEDULER_ENABLED", True):
        from app.scheduler import init_scheduler
        init_scheduler(flask_app)

    return flask_app
