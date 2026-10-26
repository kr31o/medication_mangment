# Medication Platform — selected source

هذه نسخة منتقاة من المشروع لرفع الواجهة مع جزء من الباك إند.

## المحتوى

- `frontend/` — ملفات الواجهة.
- `services/auth-service/` — المصادقة وتسجيل الدخول.
- `services/medication-service/` — كتالوج الأدوية.
- `packages/platform/medplat/` — كود مشترك بين الخدمات.
- `scripts/web.py` — بوابة الـAPI.
- `db/medplat_schema.sql` — مخطط قاعدة البيانات.
- `docs/ARCHITECTURE.md` — نظرة على تصميم المشروع.

هذه نسخة جزئية؛ خدمات الصيدليات والطلبات والجرعات والإشعارات وبقية خدمات الباك إند غير مرفقة، لذلك بعض صفحات الواجهة لن تعمل مع هذا الجزء وحده.

`/.env.example` قالب إعدادات بقيم `CHANGE_ME`. لا يوجد ملف `.env` فعلي ضمن هذه النسخة.
