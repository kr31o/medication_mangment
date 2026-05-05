import os
import sys
from pathlib import Path
from datetime import datetime
from tempfile import gettempdir

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DEFAULT_DB_PATH = (Path(gettempdir()) / f"medtrack_smoke_{os.getpid()}.db").resolve()
DEFAULT_DB_URL = f"sqlite:///{DEFAULT_DB_PATH.as_posix()}"
os.environ.setdefault("DATABASE_URL", DEFAULT_DB_URL)
os.environ.setdefault("SCHEDULER_ENABLED", "false")
os.environ.setdefault("AUTO_CREATE_TABLES", "true")
os.environ.setdefault("JWT_SECRET_KEY", "0123456789abcdef0123456789abcdef")

# اجعل الاختبار قابلاً للتكرار عند استخدام قاعدة SQLite الافتراضية الخاصة بالاختبار.
if os.environ.get("DATABASE_URL") == DEFAULT_DB_URL:
    try:
        DEFAULT_DB_PATH.unlink()
    except FileNotFoundError:
        pass

from app import create_app
from app.scheduler import reminder_scheduler
import app.services.dose_service as dose_service_module
import app.services.notification_service as notification_service_module

app = create_app()
client = app.test_client()


def req(method, path, json=None, token=None, expect=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    kwargs = {"headers": headers}
    if json is not None:
        kwargs["json"] = json
    response = getattr(client, method)(path, **kwargs)
    body = response.get_json(silent=True)
    print(method.upper(), path, response.status_code, body.get("message") if isinstance(body, dict) else body)
    if expect is None:
        assert 200 <= response.status_code < 400, (method, path, response.status_code, body)
    elif isinstance(expect, int):
        assert response.status_code == expect, (method, path, response.status_code, body)
    else:
        assert response.status_code in expect, (method, path, response.status_code, body)
    return body


def set_fake_now(fake_now):
    old_dose = dose_service_module.utc_now_naive
    old_notif = notification_service_module.utc_now_naive
    dose_service_module.utc_now_naive = lambda: fake_now
    notification_service_module.utc_now_naive = lambda: fake_now
    return old_dose, old_notif


def restore_now(old_dose, old_notif):
    dose_service_module.utc_now_naive = old_dose
    notification_service_module.utc_now_naive = old_notif


admin_token = req("post", "/api/auth/admin/login", {"email": "admin@admin.com", "password": "123456"})["data"]["access_token"]
req("get", "/api/admin/stats", token=admin_token)

med = req("post", "/api/admin/medications", {
    "name": "دواء قلب الاختبار",
    "category": "قلبية",
    "form": "tablet",
    "strength": "5mg",
    "description": "اختبار"
}, admin_token)["data"]
med2 = req("post", "/api/admin/medications", {
    "name": "دواء نفسي الاختبار",
    "category": "نفسية",
    "form": "capsule",
    "strength": "10mg"
}, admin_token)["data"]
req("post", "/api/admin/medications", {
    "name": "دواء قلب الاختبار",
    "category": "قلبية",
    "form": "tablet",
    "strength": "5mg"
}, admin_token, expect=409)

patient = req("post", "/api/auth/register", {"full_name": "مريض", "email": "p@example.com", "password": "123456", "phone": "1"})["data"]
ptoken = req("post", "/api/auth/login", {"email": "p@example.com", "password": "123456"})["data"]["access_token"]

assert req("get", "/api/medications?q=قلب&per_page=20", token=ptoken)["data"]["total"] >= 1
assert req("get", "/api/medications?category=نفسية&per_page=20", token=ptoken)["data"]["total"] >= 1

# الكمية الحالية يجب أن تكون أكبر من حد التنبيه.
req("post", "/api/medications/my", {
    "medication_id": med["medication_id"],
    "current_quantity": 2,
    "min_threshold": 2,
    "start_date": "2026-05-02"
}, ptoken, expect=422)

pm = req("post", "/api/medications/my", {
    "medication_id": med["medication_id"],
    "current_quantity": 2,
    "min_threshold": 1,
    "start_date": "2026-05-02"
}, ptoken)["data"]
pm_id = pm["patient_med_id"]
admin_meds = req("get", "/api/admin/medications?per_page=100", token=admin_token)["data"]["items"]
assert "available_quantity" not in next(item for item in admin_meds if item["medication_id"] == med["medication_id"])

# تعديل حد التنبيه ليصبح مساويًا للكمية مرفوض.
req("patch", f"/api/medications/my/{pm_id}", {"min_threshold": 2}, ptoken, expect=422)
req("patch", f"/api/medications/my/{pm_id}", {"current_quantity": 3, "min_threshold": 1}, ptoken)

sched = req("post", f"/api/medications/my/{pm_id}/schedule", {
    "start_date": "2026-05-02",
    "is_continuous": True,
    "days": ["sat"],
    "dose_periods": [
        {"dose_period": "morning", "dose_time": "09:30", "dose_amount": 2, "dose_unit": "حبة"},
        {"dose_period": "evening", "dose_time": "21:15", "dose_amount": 1, "dose_unit": "حبة"}
    ]
}, ptoken)["data"]
assert {period["dose_period"]: period["dose_time"] for period in sched["dose_periods"]} == {"morning": "09:30", "evening": "21:15"}
morning_id = next(x["dose_time_id"] for x in sched["dose_periods"] if x["dose_period"] == "morning")
evening_id = next(x["dose_time_id"] for x in sched["dose_periods"] if x["dose_period"] == "evening")

# لا يتم إنشاء إشعار قبل وقت المستخدم.
reminder_scheduler._check_dose_reminders(app, datetime(2026, 5, 2, 9, 29, 20))
notifs = req("get", "/api/notifications/my?per_page=50", token=ptoken)["data"]["items"]
assert not [n for n in notifs if n["type"] == "dose" and n["dose_time_id"] == morning_id]

# إنشاء إشعار وقت المستخدم صباحًا، مرة واحدة فقط.
reminder_scheduler._check_dose_reminders(app, datetime(2026, 5, 2, 9, 30, 15))
reminder_scheduler._check_dose_reminders(app, datetime(2026, 5, 2, 9, 30, 45))
notifs = req("get", "/api/notifications/my?per_page=50", token=ptoken)["data"]["items"]
morning_notifs = [n for n in notifs if n["type"] == "dose" and n["dose_time_id"] == morning_id]
assert len(morning_notifs) == 1 and morning_notifs[0]["actionable"] is True
assert morning_notifs[0]["scheduled_for"].startswith("2026-05-02T09:30")
assert morning_notifs[0]["dose_time"] == "09:30"

old_dose, old_notif = set_fake_now(datetime(2026, 5, 2, 9, 31, 0))
try:
    req("post", f"/api/notifications/my/{morning_notifs[0]['notification_id']}/confirm-dose", {}, ptoken)
finally:
    restore_now(old_dose, old_notif)

# بعد خصم جرعة صباحًا: 3 -> 1 والحد 1، يجب ظهور تنبيه النفاد في قائمة الإشعارات.
notifs = req("get", "/api/notifications/my?per_page=50", token=ptoken)["data"]["items"]
assert any(n["type"] == "low_stock" for n in notifs)

# إشعار مساءً في الوقت الذي اختاره المستخدم.
reminder_scheduler._check_dose_reminders(app, datetime(2026, 5, 2, 21, 15, 10))
notifs = req("get", "/api/notifications/my?per_page=80", token=ptoken)["data"]["items"]
evening_notifs = [n for n in notifs if n["type"] == "dose" and n["dose_time_id"] == evening_id]
assert evening_notifs and evening_notifs[0]["scheduled_for"].startswith("2026-05-02T21:15")
assert evening_notifs[0]["dose_time"] == "21:15"
old_dose, old_notif = set_fake_now(datetime(2026, 5, 2, 21, 16, 0))
try:
    req("post", f"/api/notifications/my/{evening_notifs[0]['notification_id']}/miss-dose", {}, ptoken)
finally:
    restore_now(old_dose, old_notif)

history = req("get", "/api/doses/my/history?per_page=50", token=ptoken)["data"]
assert history["total"] == 2

# إيقاف وتفعيل، مع منع حد تنبيه مساوي للكمية.
req("post", f"/api/medications/my/{pm_id}/stop", {}, ptoken)
req("post", f"/api/medications/my/{pm_id}/activate", {"current_quantity": 1, "min_threshold": 1}, ptoken, expect=422)
req("post", f"/api/medications/my/{pm_id}/activate", {"current_quantity": 1, "min_threshold": 0}, ptoken)

# وظائف الإدارة والتنبيهات.
assert req("get", "/api/admin/patients?q=p@example.com", token=admin_token)["data"]["total"] == 1
req("get", f"/api/admin/patients/{patient['patient_id']}/medications", token=admin_token)
req("patch", f"/api/admin/patients/{patient['patient_id']}", {"full_name": "مريض معدل", "phone": "2"}, admin_token)
req("post", "/api/admin/notifications/warning", {"patient_id": patient["patient_id"], "title": "تحذير", "message": "رسالة واضحة"}, admin_token)
req("delete", f"/api/admin/medications/{med2['medication_id']}", token=admin_token)
req("post", f"/api/admin/medications/{med2['medication_id']}/activate", {}, admin_token)
req("post", f"/api/admin/patients/{patient['patient_id']}/deactivate", {}, admin_token)
req("get", "/api/notifications/my", token=ptoken, expect=403)
req("post", f"/api/admin/patients/{patient['patient_id']}/activate", {}, admin_token)

for page in ["/login", "/dashboard", "/admin"]:
    response = client.get(page)
    print("GETPAGE", page, response.status_code)
    assert response.status_code == 200

print("[OK] strict smoke test passed")
