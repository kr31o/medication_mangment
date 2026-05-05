from flask import Blueprint, render_template, redirect, url_for

pages_bp = Blueprint("pages", __name__)


@pages_bp.get("/")
def root():
    return redirect(url_for("pages.login_page"))


@pages_bp.get("/login")
def login_page():
    return render_template("login.html", title="MedTrack Login")


@pages_bp.get("/dashboard")
def dashboard_page():
    return render_template("dashboard.html", title="لوحة المريض")


@pages_bp.get("/admin")
def admin_page():
    return render_template("admin.html", title="لوحة الإدارة")
