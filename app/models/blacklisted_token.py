from app.extensions import db
from app.utils.helpers import utc_now_naive


class BlacklistedToken(db.Model):
    __tablename__ = "blacklisted_token"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    jti = db.Column(db.String(36), unique=True, nullable=False)
    token_type = db.Column(db.String(20), nullable=False, default="access")
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now_naive)
