-- =====================================================================
-- منصة إدارة الأدوية والصيدليات — مخطط قواعد البيانات
-- 9 قواعد (قاعدة لكل خدمة)، 38 جدولًا، صفر مفاتيح أجنبية بين القواعد.
--
-- هذا الملف هو المصدر الوحيد للمخطط: القاعدة ثابتة، ولا migrations في المشروع.
-- الخدمات لا تنشئ جداول ولا تعدّلها أبدًا؛ تقرأ وتكتب الصفوف فقط.
--
-- يحتاج MySQL 8.0.16 أو أحدث (قيود CHECK والأعمدة المولَّدة).
--
-- طريقتان لتنفيذه على خادم فارغ، والنتيجة واحدة:
--   1) python scripts/setup.py
--      ينفّذ هذا الملف، ثم ينشئ حسابات الخدمات وصلاحياتها ويتحقق من كل شيء.
--   2) يدويًا: MySQL Workbench ← File > Open SQL Script ← زر التنفيذ (⚡)
--      أو:  mysql -u root -p -e "source db/medplat_schema.sql"
--      ثم:  python scripts/setup.py   (للحسابات والصلاحيات فقط)
--
-- لا حسابات ولا كلمات مرور هنا: الملف داخل المشروع، والأسرار في .env وحده (BR-025).
-- =====================================================================

SET NAMES utf8mb4;
SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- لإعادة التثبيت من الصفر (يمسح كل البيانات!) أزل علامة التعليق عن الأسطر التالية:
-- DROP DATABASE IF EXISTS `auth_db`;
-- DROP DATABASE IF EXISTS `patient_db`;
-- DROP DATABASE IF EXISTS `pharmacy_db`;
-- DROP DATABASE IF EXISTS `medication_db`;
-- DROP DATABASE IF EXISTS `inventory_db`;
-- DROP DATABASE IF EXISTS `order_db`;
-- DROP DATABASE IF EXISTS `health_db`;
-- DROP DATABASE IF EXISTS `ai_db`;
-- DROP DATABASE IF EXISTS `notification_db`;


-- ---------------------------------------------------------------------
-- auth_db — يملكها auth-service وحدها (4 جداول)
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `auth_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `auth_db`;

-- auth_rate_limits: نوافذ حدود المحاولات (المفتاح HMAC للمعرّف لا المعرّف نفسه)
CREATE TABLE `auth_rate_limits` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope` varchar(64) NOT NULL,
  `key_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `window_started_at` datetime(6) NOT NULL,
  `request_count` int unsigned NOT NULL DEFAULT '0',
  `request_limit` int unsigned NOT NULL,
  `window_seconds` int unsigned NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_rate_limits_public_id` (`public_id`),
  UNIQUE KEY `uq_auth_rate_limits_scope_key` (`scope`,`key_hash`),
  KEY `idx_auth_rate_limits_expires_at` (`expires_at`),
  CONSTRAINT `chk_auth_rate_limits_limit` CHECK ((`request_limit` >= 1)),
  CONSTRAINT `chk_auth_rate_limits_scope_nonempty` CHECK ((char_length(trim(`scope`)) > 0)),
  CONSTRAINT `chk_auth_rate_limits_window` CHECK ((`window_seconds` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- users: الحسابات وأدوارها وحالتها (وسبب إيقاف الأدمن لها)؛ كلمة المرور Argon2id فقط
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `email` varchar(320) DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` varchar(20) NOT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'ACTIVE',
  `status_reason` varchar(500) DEFAULT NULL,
  `status_changed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_public_id` (`public_id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_phone` (`phone`),
  CONSTRAINT `chk_users_email_nonempty` CHECK (((`email` is null) or (char_length(trim(`email`)) > 0))),
  CONSTRAINT `chk_users_identity` CHECK (((`email` is not null) or (`phone` is not null))),
  CONSTRAINT `chk_users_phone_nonempty` CHECK (((`phone` is null) or (char_length(trim(`phone`)) > 0))),
  CONSTRAINT `chk_users_role` CHECK ((`role` in (_utf8mb4'PATIENT',_utf8mb4'PHARMACY',_utf8mb4'ADMIN'))),
  CONSTRAINT `chk_users_status` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'SUSPENDED',_utf8mb4'DEACTIVATED'))),
  CONSTRAINT `chk_users_status_reason` CHECK (((`status` <> _utf8mb4'SUSPENDED') or ((`status_reason` is not null) and (char_length(trim(`status_reason`)) > 0))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- refresh_sessions: جلسات التجديد: SHA-256 للرمز وعائلة التدوير
CREATE TABLE `refresh_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `revoked_at` datetime(6) DEFAULT NULL,
  `replaced_by_id` bigint unsigned DEFAULT NULL,
  `revoked_reason` varchar(128) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `last_used_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_sessions_public_id` (`public_id`),
  UNIQUE KEY `uq_refresh_sessions_token_hash` (`token_hash`),
  KEY `fk_refresh_sessions_replaced_by` (`replaced_by_id`),
  KEY `idx_refresh_sessions_family_id` (`family_id`),
  KEY `idx_refresh_sessions_user_id` (`user_id`),
  KEY `idx_refresh_sessions_expires_at` (`expires_at`),
  CONSTRAINT `fk_refresh_sessions_replaced_by` FOREIGN KEY (`replaced_by_id`) REFERENCES `refresh_sessions` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_refresh_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `chk_refresh_sessions_expiry` CHECK ((`expires_at` > `created_at`)),
  CONSTRAINT `chk_refresh_sessions_last_used` CHECK (((`last_used_at` is null) or ((`last_used_at` >= `created_at`) and (`last_used_at` <= `expires_at`)))),
  CONSTRAINT `chk_refresh_sessions_public_ids` CHECK (((char_length(`public_id`) = 36) and (char_length(`family_id`) = 36))),
  CONSTRAINT `chk_refresh_sessions_revoked` CHECK (((`revoked_at` is null) or (`revoked_at` >= `created_at`))),
  CONSTRAINT `chk_refresh_sessions_revoked_reason` CHECK ((((`revoked_at` is null) and (`revoked_reason` is null)) or ((`revoked_at` is not null) and (`revoked_reason` is not null) and (char_length(trim(`revoked_reason`)) > 0))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- outbox_events: أحداث صادرة تُكتب مع العملية نفسها ثم تُنشر إلى RabbitMQ
CREATE TABLE `outbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_type` varchar(64) NOT NULL,
  `aggregate_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `version` int unsigned NOT NULL DEFAULT '1',
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'PENDING',
  `attempts` int unsigned NOT NULL DEFAULT '0',
  `last_error` text,
  `occurred_at` datetime(6) NOT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_outbox_event_id` (`event_id`),
  KEY `idx_auth_outbox_status_occurred` (`status`,`occurred_at`),
  CONSTRAINT `chk_auth_outbox_aggregate_id_format` CHECK ((char_length(trim(`aggregate_id`)) = 36)),
  CONSTRAINT `chk_auth_outbox_aggregate_type_nonempty` CHECK ((char_length(trim(`aggregate_type`)) > 0)),
  CONSTRAINT `chk_auth_outbox_causation_id_format` CHECK (((`causation_id` is null) or (char_length(trim(`causation_id`)) = 36))),
  CONSTRAINT `chk_auth_outbox_correlation_id_format` CHECK (((`correlation_id` is null) or (char_length(trim(`correlation_id`)) = 36))),
  CONSTRAINT `chk_auth_outbox_event_id_format` CHECK ((char_length(trim(`event_id`)) = 36)),
  CONSTRAINT `chk_auth_outbox_event_type` CHECK ((char_length(trim(`event_type`)) > 0)),
  CONSTRAINT `chk_auth_outbox_failed_error` CHECK (((`status` <> _utf8mb4'FAILED') or ((`last_error` is not null) and (char_length(trim(`last_error`)) > 0)))),
  CONSTRAINT `chk_auth_outbox_publish_state` CHECK ((((`status` = _utf8mb4'PUBLISHED') and (`published_at` is not null)) or ((`status` <> _utf8mb4'PUBLISHED') and (`published_at` is null)))),
  CONSTRAINT `chk_auth_outbox_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'PUBLISHED',_utf8mb4'FAILED'))),
  CONSTRAINT `chk_auth_outbox_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------
-- patient_db — يملكها patient-service وحدها (جدولان)
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `patient_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `patient_db`;

-- patients: ملف المريض المرتبط بهوية Auth
CREATE TABLE `patients` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `full_name` varchar(120) NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `gender` varchar(8) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_patients_public_id` (`public_id`),
  UNIQUE KEY `uq_patients_user_ref` (`user_ref`),
  CONSTRAINT `chk_patients_date_of_birth` CHECK (((`date_of_birth` is null) or (`date_of_birth` >= _utf8mb4'1900-01-01'))),
  CONSTRAINT `chk_patients_full_name` CHECK ((char_length(trim(`full_name`)) > 0)),
  CONSTRAINT `chk_patients_gender` CHECK (((`gender` is null) or (`gender` in (_utf8mb4'MALE',_utf8mb4'FEMALE'))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- outbox_events: أحداث صادرة تُكتب مع العملية نفسها ثم تُنشر إلى RabbitMQ
CREATE TABLE `outbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_type` varchar(64) NOT NULL,
  `aggregate_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `version` int unsigned NOT NULL DEFAULT '1',
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'PENDING',
  `attempts` int unsigned NOT NULL DEFAULT '0',
  `last_error` text,
  `occurred_at` datetime(6) NOT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_patient_outbox_event_id` (`event_id`),
  KEY `idx_patient_outbox_status_id` (`status`,`id`),
  CONSTRAINT `chk_patient_outbox_event_type` CHECK ((char_length(trim(`event_type`)) > 0)),
  CONSTRAINT `chk_patient_outbox_failed_error` CHECK (((`status` <> _utf8mb4'FAILED') or ((`last_error` is not null) and (char_length(trim(`last_error`)) > 0)))),
  CONSTRAINT `chk_patient_outbox_publish_state` CHECK ((((`status` = _utf8mb4'PUBLISHED') and (`published_at` is not null)) or ((`status` <> _utf8mb4'PUBLISHED') and (`published_at` is null)))),
  CONSTRAINT `chk_patient_outbox_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'PUBLISHED',_utf8mb4'FAILED'))),
  CONSTRAINT `chk_patient_outbox_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------
-- pharmacy_db — يملكها pharmacy-service وحدها (5 جداول)
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `pharmacy_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `pharmacy_db`;

-- pharmacies: ملف الصيدلية وموقعها وحالة اعتمادها
CREATE TABLE `pharmacies` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `owner_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` varchar(150) NOT NULL,
  `license_number` varchar(64) NOT NULL,
  `phone` varchar(16) NOT NULL,
  `city` varchar(100) NOT NULL,
  `address_line` varchar(255) NOT NULL,
  `latitude` decimal(9,6) NOT NULL,
  `longitude` decimal(9,6) NOT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'PENDING_APPROVAL',
  `status_reason` varchar(500) DEFAULT NULL,
  `status_changed_at` datetime(6) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `license_key` varchar(64) GENERATED ALWAYS AS (if((`status` = _utf8mb4'REJECTED'),NULL,`license_number`)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pharmacies_owner_user_ref` (`owner_user_ref`),
  UNIQUE KEY `uq_pharmacies_public_id` (`public_id`),
  UNIQUE KEY `uq_pharmacies_license_key` (`license_key`),
  KEY `idx_pharmacies_status_created` (`status`,`created_at`),
  KEY `idx_pharmacies_status_location` (`status`,`latitude`,`longitude`),
  CONSTRAINT `chk_pharmacies_latitude` CHECK ((`latitude` between -(90) and 90)),
  CONSTRAINT `chk_pharmacies_license_number` CHECK ((char_length(trim(`license_number`)) > 0)),
  CONSTRAINT `chk_pharmacies_longitude` CHECK ((`longitude` between -(180) and 180)),
  CONSTRAINT `chk_pharmacies_name` CHECK ((char_length(trim(`name`)) > 0)),
  CONSTRAINT `chk_pharmacies_status` CHECK ((`status` in (_utf8mb4'PENDING_APPROVAL',_utf8mb4'ACTIVE',_utf8mb4'REJECTED',_utf8mb4'SUSPENDED'))),
  CONSTRAINT `chk_pharmacies_status_reason` CHECK (((`status` not in (_utf8mb4'REJECTED',_utf8mb4'SUSPENDED')) or ((`status_reason` is not null) and (char_length(trim(`status_reason`)) > 0))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- pharmacists: صيادلة الصيدلية
CREATE TABLE `pharmacists` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pharmacy_id` bigint unsigned NOT NULL,
  `full_name` varchar(120) NOT NULL,
  `license_number` varchar(64) NOT NULL,
  `phone` varchar(16) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pharmacists_pharmacy_license` (`pharmacy_id`,`license_number`),
  UNIQUE KEY `uq_pharmacists_public_id` (`public_id`),
  CONSTRAINT `fk_pharmacists_pharmacy` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_pharmacists_full_name` CHECK ((char_length(trim(`full_name`)) > 0)),
  CONSTRAINT `chk_pharmacists_license_number` CHECK ((char_length(trim(`license_number`)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- pharmacy_documents: بيانات وثائق الترخيص (الملف نفسه على القرص)
CREATE TABLE `pharmacy_documents` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pharmacy_id` bigint unsigned NOT NULL,
  `document_type` varchar(32) NOT NULL,
  `original_filename` varchar(255) NOT NULL,
  `content_type` varchar(64) NOT NULL,
  `size_bytes` int unsigned NOT NULL,
  `sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `storage_key` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `uploaded_by_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pharmacy_documents_public_id` (`public_id`),
  UNIQUE KEY `uq_pharmacy_documents_storage_key` (`storage_key`),
  KEY `idx_pharmacy_documents_pharmacy` (`pharmacy_id`,`created_at`),
  CONSTRAINT `fk_pharmacy_documents_pharmacy` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_pharmacy_documents_content_type` CHECK ((`content_type` in (_utf8mb4'application/pdf',_utf8mb4'image/png',_utf8mb4'image/jpeg'))),
  CONSTRAINT `chk_pharmacy_documents_size` CHECK ((`size_bytes` > 0)),
  CONSTRAINT `chk_pharmacy_documents_type` CHECK ((`document_type` in (_utf8mb4'PHARMACY_LICENSE',_utf8mb4'COMMERCIAL_REGISTRATION',_utf8mb4'PHARMACIST_LICENSE',_utf8mb4'OTHER')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- pharmacy_status_history: سجل تغيّر حالة الصيدلية — إضافة فقط
CREATE TABLE `pharmacy_status_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `pharmacy_id` bigint unsigned NOT NULL,
  `from_status` varchar(24) DEFAULT NULL,
  `to_status` varchar(24) NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `actor_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actor_role` varchar(16) NOT NULL,
  `changed_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pharmacy_status_history_pharmacy` (`pharmacy_id`,`id`),
  CONSTRAINT `fk_pharmacy_status_history_pharmacy` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_pharmacy_status_history_actor` CHECK ((`actor_role` in (_utf8mb4'PHARMACY',_utf8mb4'ADMIN',_utf8mb4'SYSTEM'))),
  CONSTRAINT `chk_pharmacy_status_history_from` CHECK (((`from_status` is null) or (`from_status` in (_utf8mb4'PENDING_APPROVAL',_utf8mb4'ACTIVE',_utf8mb4'REJECTED',_utf8mb4'SUSPENDED')))),
  CONSTRAINT `chk_pharmacy_status_history_reason` CHECK (((`to_status` not in (_utf8mb4'REJECTED',_utf8mb4'SUSPENDED')) or ((`reason` is not null) and (char_length(trim(`reason`)) > 0)))),
  CONSTRAINT `chk_pharmacy_status_history_to` CHECK ((`to_status` in (_utf8mb4'PENDING_APPROVAL',_utf8mb4'ACTIVE',_utf8mb4'REJECTED',_utf8mb4'SUSPENDED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- outbox_events: أحداث صادرة تُكتب مع العملية نفسها ثم تُنشر إلى RabbitMQ
CREATE TABLE `outbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_type` varchar(64) NOT NULL,
  `aggregate_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `version` int unsigned NOT NULL DEFAULT '1',
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'PENDING',
  `attempts` int unsigned NOT NULL DEFAULT '0',
  `last_error` text,
  `occurred_at` datetime(6) NOT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pharmacy_outbox_event_id` (`event_id`),
  KEY `idx_pharmacy_outbox_status_id` (`status`,`id`),
  CONSTRAINT `chk_pharmacy_outbox_event_type` CHECK ((char_length(trim(`event_type`)) > 0)),
  CONSTRAINT `chk_pharmacy_outbox_failed_error` CHECK (((`status` <> _utf8mb4'FAILED') or ((`last_error` is not null) and (char_length(trim(`last_error`)) > 0)))),
  CONSTRAINT `chk_pharmacy_outbox_publish_state` CHECK ((((`status` = _utf8mb4'PUBLISHED') and (`published_at` is not null)) or ((`status` <> _utf8mb4'PUBLISHED') and (`published_at` is null)))),
  CONSTRAINT `chk_pharmacy_outbox_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'PUBLISHED',_utf8mb4'FAILED'))),
  CONSTRAINT `chk_pharmacy_outbox_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------
-- medication_db — يملكها medication-service وحدها (3 جداول)
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `medication_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `medication_db`;

-- medications: الكتالوج المركزي للأدوية
CREATE TABLE `medications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `brand_name` varchar(150) NOT NULL,
  `generic_name` varchar(150) NOT NULL,
  `strength` varchar(50) NOT NULL,
  `dosage_form` varchar(24) NOT NULL,
  `category` varchar(24) NOT NULL DEFAULT 'OTHER',
  `manufacturer` varchar(120) DEFAULT NULL,
  `pack_size` decimal(10,2) NOT NULL,
  `pack_unit` varchar(16) NOT NULL,
  `description` varchar(2000) DEFAULT NULL,
  `composition_key` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_medications_identity` (`brand_name`,`strength`,`dosage_form`),
  UNIQUE KEY `uq_medications_public_id` (`public_id`),
  KEY `idx_medications_active_brand` (`is_active`,`brand_name`),
  KEY `idx_medications_active_category` (`is_active`,`category`),
  KEY `idx_medications_active_composition` (`is_active`,`composition_key`),
  KEY `idx_medications_active_generic` (`is_active`,`generic_name`),
  CONSTRAINT `chk_medications_brand_name` CHECK ((char_length(trim(`brand_name`)) > 0)),
  CONSTRAINT `chk_medications_category` CHECK ((`category` in (_utf8mb4'ANALGESIC',_utf8mb4'ANTIBIOTIC',_utf8mb4'CARDIOVASCULAR',_utf8mb4'DIABETES',_utf8mb4'RESPIRATORY',_utf8mb4'GASTROINTESTINAL',_utf8mb4'ALLERGY',_utf8mb4'VITAMINS',_utf8mb4'DERMATOLOGY',_utf8mb4'NEUROLOGY',_utf8mb4'HORMONAL',_utf8mb4'EYE_ENT',_utf8mb4'MUSCULOSKELETAL',_utf8mb4'OTHER'))),
  CONSTRAINT `chk_medications_dosage_form` CHECK ((`dosage_form` in (_utf8mb4'TABLET',_utf8mb4'CAPSULE',_utf8mb4'SYRUP',_utf8mb4'SUSPENSION',_utf8mb4'INJECTION',_utf8mb4'CREAM',_utf8mb4'OINTMENT',_utf8mb4'GEL',_utf8mb4'DROPS',_utf8mb4'INHALER',_utf8mb4'SUPPOSITORY',_utf8mb4'PATCH',_utf8mb4'SACHET',_utf8mb4'OTHER'))),
  CONSTRAINT `chk_medications_generic_name` CHECK ((char_length(trim(`generic_name`)) > 0)),
  CONSTRAINT `chk_medications_pack_size` CHECK ((`pack_size` > 0)),
  CONSTRAINT `chk_medications_pack_unit` CHECK ((`pack_unit` in (_utf8mb4'TABLET',_utf8mb4'CAPSULE',_utf8mb4'ML',_utf8mb4'G',_utf8mb4'DOSE',_utf8mb4'PIECE'))),
  CONSTRAINT `chk_medications_strength` CHECK ((char_length(trim(`strength`)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- medication_requests: [قرار المستخدم] طلبات المرضى والصيدليات للإدارة: دواء من الكتالوج ناقص
-- (SHORTAGE، مرتبط بدوائه) أو دواء غير موجود في الكتالوج (NEW_MEDICATION، باسمه كما كُتب).
-- الأدمن يرد: RESOLVED (تمت المعالجة) أو REJECTED (مرفوض، بسبب).
CREATE TABLE `medication_requests` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_type` varchar(16) NOT NULL,
  `requester_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requester_role` varchar(16) NOT NULL,
  `requester_name` varchar(150) NOT NULL,
  `medication_id` bigint unsigned DEFAULT NULL,
  `medication_name` varchar(150) DEFAULT NULL,
  `details` varchar(300) DEFAULT NULL,
  `note` varchar(500) DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'OPEN',
  `admin_reply` varchar(500) DEFAULT NULL,
  `answered_by_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `answered_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_medication_requests_public_id` (`public_id`),
  KEY `fk_medication_requests_medication` (`medication_id`),
  KEY `idx_medication_requests_requester` (`requester_user_ref`,`id`),
  KEY `idx_medication_requests_status` (`status`,`id`),
  CONSTRAINT `fk_medication_requests_medication` FOREIGN KEY (`medication_id`) REFERENCES `medications` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_medication_requests_answer` CHECK ((((`status` = _utf8mb4'OPEN') and (`answered_at` is null) and (`answered_by_ref` is null)) or ((`status` <> _utf8mb4'OPEN') and (`answered_at` is not null) and (`answered_by_ref` is not null)))),
  CONSTRAINT `chk_medication_requests_reject_reason` CHECK (((`status` <> _utf8mb4'REJECTED') or ((`admin_reply` is not null) and (char_length(trim(`admin_reply`)) > 0)))),
  CONSTRAINT `chk_medication_requests_role` CHECK ((`requester_role` in (_utf8mb4'PATIENT',_utf8mb4'PHARMACY'))),
  CONSTRAINT `chk_medication_requests_status` CHECK ((`status` in (_utf8mb4'OPEN',_utf8mb4'RESOLVED',_utf8mb4'REJECTED'))),
  CONSTRAINT `chk_medication_requests_subject` CHECK ((((`request_type` = _utf8mb4'SHORTAGE') and (`medication_id` is not null) and (`medication_name` is null)) or ((`request_type` = _utf8mb4'NEW_MEDICATION') and (`medication_id` is null) and (`medication_name` is not null) and (char_length(trim(`medication_name`)) > 0)))),
  CONSTRAINT `chk_medication_requests_type` CHECK ((`request_type` in (_utf8mb4'SHORTAGE',_utf8mb4'NEW_MEDICATION')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- outbox_events: أحداث صادرة تُكتب مع العملية نفسها ثم تُنشر إلى RabbitMQ
CREATE TABLE `outbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_type` varchar(64) NOT NULL,
  `aggregate_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `version` int unsigned NOT NULL DEFAULT '1',
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'PENDING',
  `attempts` int unsigned NOT NULL DEFAULT '0',
  `last_error` text,
  `occurred_at` datetime(6) NOT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_medication_outbox_event_id` (`event_id`),
  KEY `idx_medication_outbox_status_id` (`status`,`id`),
  CONSTRAINT `chk_medication_outbox_event_type` CHECK ((char_length(trim(`event_type`)) > 0)),
  CONSTRAINT `chk_medication_outbox_failed_error` CHECK (((`status` <> _utf8mb4'FAILED') or ((`last_error` is not null) and (char_length(trim(`last_error`)) > 0)))),
  CONSTRAINT `chk_medication_outbox_publish_state` CHECK ((((`status` = _utf8mb4'PUBLISHED') and (`published_at` is not null)) or ((`status` <> _utf8mb4'PUBLISHED') and (`published_at` is null)))),
  CONSTRAINT `chk_medication_outbox_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'PUBLISHED',_utf8mb4'FAILED'))),
  CONSTRAINT `chk_medication_outbox_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------
-- inventory_db — يملكها inventory-service وحدها (3 جداول)
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `inventory_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `inventory_db`;

-- pharmacy_inventory: كمية وسعر كل دواء في كل صيدلية
CREATE TABLE `pharmacy_inventory` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pharmacy_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `medication_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity` int NOT NULL DEFAULT '0',
  `unit_price` decimal(10,2) NOT NULL,
  `is_available` tinyint(1) NOT NULL DEFAULT '1',
  `low_stock_threshold` int NOT NULL DEFAULT '5',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pharmacy_inventory_item` (`pharmacy_ref`,`medication_ref`),
  UNIQUE KEY `uq_pharmacy_inventory_public_id` (`public_id`),
  KEY `idx_pharmacy_inventory_medication` (`medication_ref`,`is_available`,`quantity`),
  CONSTRAINT `chk_pharmacy_inventory_quantity` CHECK ((`quantity` >= 0)),
  CONSTRAINT `chk_pharmacy_inventory_threshold` CHECK ((`low_stock_threshold` >= 0)),
  CONSTRAINT `chk_pharmacy_inventory_unit_price` CHECK ((`unit_price` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- stock_movements: كل حركة مخزون مع الكمية بعدها — إضافة فقط
CREATE TABLE `stock_movements` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inventory_id` bigint unsigned NOT NULL,
  `movement_type` varchar(24) NOT NULL,
  `quantity_delta` int NOT NULL,
  `quantity_after` int NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `reference_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `order_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actor_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actor_role` varchar(16) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_movements_public_id` (`public_id`),
  UNIQUE KEY `uq_stock_movements_reference` (`inventory_id`,`movement_type`,`reference_ref`),
  KEY `idx_stock_movements_inventory` (`inventory_id`,`id`),
  KEY `idx_stock_movements_reference` (`reference_ref`),
  KEY `idx_stock_movements_type_created` (`movement_type`,`created_at`),
  CONSTRAINT `fk_stock_movements_inventory` FOREIGN KEY (`inventory_id`) REFERENCES `pharmacy_inventory` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_stock_movements_actor` CHECK ((`actor_role` in (_utf8mb4'PHARMACY',_utf8mb4'ADMIN',_utf8mb4'SYSTEM'))),
  CONSTRAINT `chk_stock_movements_after` CHECK ((`quantity_after` >= 0)),
  CONSTRAINT `chk_stock_movements_delta` CHECK ((`quantity_delta` <> 0)),
  CONSTRAINT `chk_stock_movements_direction` CHECK ((((`movement_type` in (_utf8mb4'INITIAL',_utf8mb4'RESTOCK',_utf8mb4'DISPENSE_REVERSAL')) and (`quantity_delta` > 0)) or ((`movement_type` = _utf8mb4'DISPENSE') and (`quantity_delta` < 0)) or (`movement_type` = _utf8mb4'ADJUSTMENT'))),
  CONSTRAINT `chk_stock_movements_dispense_reference` CHECK (((`movement_type` not in (_utf8mb4'DISPENSE',_utf8mb4'DISPENSE_REVERSAL')) or (`reference_ref` is not null))),
  CONSTRAINT `chk_stock_movements_type` CHECK ((`movement_type` in (_utf8mb4'INITIAL',_utf8mb4'RESTOCK',_utf8mb4'ADJUSTMENT',_utf8mb4'DISPENSE',_utf8mb4'DISPENSE_REVERSAL')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- outbox_events: أحداث صادرة تُكتب مع العملية نفسها ثم تُنشر إلى RabbitMQ
CREATE TABLE `outbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_type` varchar(64) NOT NULL,
  `aggregate_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `version` int unsigned NOT NULL DEFAULT '1',
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'PENDING',
  `attempts` int unsigned NOT NULL DEFAULT '0',
  `last_error` text,
  `occurred_at` datetime(6) NOT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inventory_outbox_event_id` (`event_id`),
  KEY `idx_inventory_outbox_status_id` (`status`,`id`),
  CONSTRAINT `chk_inventory_outbox_event_type` CHECK ((char_length(trim(`event_type`)) > 0)),
  CONSTRAINT `chk_inventory_outbox_failed_error` CHECK (((`status` <> _utf8mb4'FAILED') or ((`last_error` is not null) and (char_length(trim(`last_error`)) > 0)))),
  CONSTRAINT `chk_inventory_outbox_publish_state` CHECK ((((`status` = _utf8mb4'PUBLISHED') and (`published_at` is not null)) or ((`status` <> _utf8mb4'PUBLISHED') and (`published_at` is null)))),
  CONSTRAINT `chk_inventory_outbox_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'PUBLISHED',_utf8mb4'FAILED'))),
  CONSTRAINT `chk_inventory_outbox_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------
-- order_db — يملكها order-service وحدها (8 جداول)
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `order_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `order_db`;

-- orders: الطلب وحالته ومحاولة الصرف، ونوعه: عادي أو بصورة وصفة [قرار المستخدم]
CREATE TABLE `orders` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `kind` varchar(16) NOT NULL,
  `patient_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_name_snapshot` varchar(120) NOT NULL,
  `pharmacy_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pharmacy_owner_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pharmacy_name_snapshot` varchar(150) NOT NULL,
  `status` varchar(16) NOT NULL,
  `status_reason` varchar(500) DEFAULT NULL,
  `total_amount` decimal(12,2) NOT NULL,
  `currency` char(3) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `patient_note` varchar(500) DEFAULT NULL,
  `idempotency_key` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `dispense_attempt_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `dispense_attempt_at` datetime(6) DEFAULT NULL,
  `deduction_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `dispensed_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_public_id` (`public_id`),
  UNIQUE KEY `uq_orders_patient_idempotency` (`patient_user_ref`,`idempotency_key`),
  UNIQUE KEY `uq_orders_deduction_ref` (`deduction_ref`),
  KEY `idx_orders_pharmacy_status` (`pharmacy_ref`,`status`,`created_at`),
  KEY `idx_orders_dispense_attempt` (`dispense_attempt_ref`),
  KEY `idx_orders_patient_created` (`patient_user_ref`,`created_at`),
  CONSTRAINT `chk_orders_dispense_attempt` CHECK (((`dispense_attempt_ref` is null) = (`dispense_attempt_at` is null))),
  CONSTRAINT `chk_orders_dispensed_state` CHECK (((`status` = _utf8mb4'DISPENSED') = ((`deduction_ref` is not null) and (`dispensed_at` is not null)))),
  CONSTRAINT `chk_orders_kind` CHECK ((`kind` in (_utf8mb4'STANDARD',_utf8mb4'PRESCRIPTION'))),
  CONSTRAINT `chk_orders_prescription_states` CHECK (((`kind` = _utf8mb4'PRESCRIPTION') or (`status` not in (_utf8mb4'IN_REVIEW',_utf8mb4'QUOTED')))),
  CONSTRAINT `chk_orders_rejection_reason` CHECK (((`status` <> _utf8mb4'REJECTED') or ((`status_reason` is not null) and (char_length(trim(`status_reason`)) > 0)))),
  CONSTRAINT `chk_orders_status` CHECK ((`status` in (_utf8mb4'IN_REVIEW',_utf8mb4'QUOTED',_utf8mb4'PENDING',_utf8mb4'DISPENSED',_utf8mb4'REJECTED',_utf8mb4'CANCELLED'))),
  CONSTRAINT `chk_orders_total` CHECK ((`total_amount` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- order_items: سطور الطلب بلقطة الاسم والسعر لحظة الإنشاء، وطريقة الاستعمال التي يقترحها الصيدلي [قرار المستخدم]
CREATE TABLE `order_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `order_id` bigint unsigned NOT NULL,
  `medication_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `brand_name` varchar(150) NOT NULL,
  `generic_name` varchar(150) NOT NULL,
  `strength` varchar(50) NOT NULL,
  `dosage_form` varchar(24) NOT NULL,
  `pack_size` decimal(10,2) NOT NULL,
  `pack_unit` varchar(16) NOT NULL,
  `quantity` int NOT NULL,
  `unit_price_snapshot` decimal(10,2) NOT NULL,
  `line_total` decimal(12,2) NOT NULL,
  `dose_plan` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_items_public_id` (`public_id`),
  UNIQUE KEY `uq_order_items_order_medication` (`order_id`,`medication_ref`),
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_order_items_line_total` CHECK ((`line_total` = (`quantity` * `unit_price_snapshot`))),
  CONSTRAINT `chk_order_items_pack_size` CHECK ((`pack_size` > 0)),
  CONSTRAINT `chk_order_items_quantity` CHECK ((`quantity` > 0)),
  CONSTRAINT `chk_order_items_unit_price` CHECK ((`unit_price_snapshot` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- order_prescriptions: [قرار المستخدم] صورة الوصفة المرفقة بطلب الوصفة (الملف نفسه على القرص، ولا قراءة آلية له)
CREATE TABLE `order_prescriptions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` bigint unsigned NOT NULL,
  `original_filename` varchar(200) NOT NULL,
  `content_type` varchar(64) NOT NULL,
  `size_bytes` int unsigned NOT NULL,
  `sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `storage_key` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_prescriptions_order` (`order_id`),
  UNIQUE KEY `uq_order_prescriptions_storage_key` (`storage_key`),
  CONSTRAINT `fk_order_prescriptions_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_order_prescriptions_size` CHECK ((`size_bytes` > 0)),
  CONSTRAINT `chk_order_prescriptions_type` CHECK ((`content_type` in (_utf8mb4'image/jpeg',_utf8mb4'image/png',_utf8mb4'application/pdf')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- order_missing_items: [قرار المستخدم] أدوية في الوصفة ليست عند الصيدلية، كما كتبها الصيدلي في العرض
CREATE TABLE `order_missing_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` bigint unsigned NOT NULL,
  `name` varchar(150) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_order_missing_items_order` (`order_id`,`id`),
  CONSTRAINT `fk_order_missing_items_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_order_missing_items_name` CHECK ((char_length(trim(`name`)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- order_status_history: سجل انتقالات حالة الطلب — إضافة فقط
CREATE TABLE `order_status_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` bigint unsigned NOT NULL,
  `from_status` varchar(16) DEFAULT NULL,
  `to_status` varchar(16) NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `actor_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actor_role` varchar(16) NOT NULL,
  `changed_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_order_status_history_order` (`order_id`,`id`),
  CONSTRAINT `fk_order_status_history_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_order_status_history_actor` CHECK ((`actor_role` in (_utf8mb4'PATIENT',_utf8mb4'PHARMACY',_utf8mb4'ADMIN',_utf8mb4'SYSTEM'))),
  CONSTRAINT `chk_order_status_history_from` CHECK (((`from_status` is null) or (`from_status` in (_utf8mb4'IN_REVIEW',_utf8mb4'QUOTED',_utf8mb4'PENDING',_utf8mb4'DISPENSED',_utf8mb4'REJECTED',_utf8mb4'CANCELLED')))),
  CONSTRAINT `chk_order_status_history_reason` CHECK (((`to_status` <> _utf8mb4'REJECTED') or ((`reason` is not null) and (char_length(trim(`reason`)) > 0)))),
  CONSTRAINT `chk_order_status_history_to` CHECK ((`to_status` in (_utf8mb4'IN_REVIEW',_utf8mb4'QUOTED',_utf8mb4'PENDING',_utf8mb4'DISPENSED',_utf8mb4'REJECTED',_utf8mb4'CANCELLED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- conversations: [قرار المستخدم] محادثات المريض والصيدلية: واحدة عامة لكل مريض وصيدلية، وواحدة لكل طلب
CREATE TABLE `conversations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_name_snapshot` varchar(120) NOT NULL,
  `pharmacy_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pharmacy_owner_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pharmacy_name_snapshot` varchar(150) NOT NULL,
  `order_id` bigint unsigned DEFAULT NULL,
  `thread_key` bigint unsigned GENERATED ALWAYS AS (coalesce(`order_id`,0)) STORED NOT NULL,
  `last_message_at` datetime(6) DEFAULT NULL,
  `patient_last_read_id` bigint unsigned DEFAULT NULL,
  `pharmacy_last_read_id` bigint unsigned DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_conversations_public_id` (`public_id`),
  UNIQUE KEY `uq_conversations_thread` (`patient_user_ref`,`pharmacy_ref`,`thread_key`),
  KEY `idx_conversations_patient_recent` (`patient_user_ref`,`last_message_at`),
  KEY `idx_conversations_pharmacy_recent` (`pharmacy_ref`,`last_message_at`),
  KEY `idx_conversations_order` (`order_id`),
  CONSTRAINT `fk_conversations_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- messages: [قرار المستخدم] رسائل المحادثات — إضافة فقط
CREATE TABLE `messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `conversation_id` bigint unsigned NOT NULL,
  `sender_role` varchar(16) NOT NULL,
  `sender_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `body` varchar(1000) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_messages_public_id` (`public_id`),
  KEY `idx_messages_conversation` (`conversation_id`,`id`),
  CONSTRAINT `fk_messages_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_messages_body` CHECK ((char_length(trim(`body`)) > 0)),
  CONSTRAINT `chk_messages_sender_role` CHECK ((`sender_role` in (_utf8mb4'PATIENT',_utf8mb4'PHARMACY')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- outbox_events: أحداث صادرة تُكتب مع العملية نفسها ثم تُنشر إلى RabbitMQ
CREATE TABLE `outbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_type` varchar(64) NOT NULL,
  `aggregate_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `version` int unsigned NOT NULL DEFAULT '1',
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'PENDING',
  `attempts` int unsigned NOT NULL DEFAULT '0',
  `last_error` text,
  `occurred_at` datetime(6) NOT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_outbox_event_id` (`event_id`),
  KEY `idx_order_outbox_status_id` (`status`,`id`),
  CONSTRAINT `chk_order_outbox_event_type` CHECK ((char_length(trim(`event_type`)) > 0)),
  CONSTRAINT `chk_order_outbox_failed_error` CHECK (((`status` <> _utf8mb4'FAILED') or ((`last_error` is not null) and (char_length(trim(`last_error`)) > 0)))),
  CONSTRAINT `chk_order_outbox_publish_state` CHECK ((((`status` = _utf8mb4'PUBLISHED') and (`published_at` is not null)) or ((`status` <> _utf8mb4'PUBLISHED') and (`published_at` is null)))),
  CONSTRAINT `chk_order_outbox_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'PUBLISHED',_utf8mb4'FAILED'))),
  CONSTRAINT `chk_order_outbox_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------
-- health_db — يملكها health-service وحدها (8 جداول)
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `health_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `health_db`;

-- patient_medications: أدوية المريض ورصيدها بالوحدات
CREATE TABLE `patient_medications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `medication_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `brand_name` varchar(150) NOT NULL,
  `generic_name` varchar(150) NOT NULL,
  `strength` varchar(50) NOT NULL,
  `dosage_form` varchar(24) NOT NULL,
  `unit` varchar(16) NOT NULL,
  `quantity_on_hand` decimal(12,2) NOT NULL,
  `min_quantity` decimal(12,2) DEFAULT NULL,
  `status` varchar(16) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_patient_medications_patient_medication` (`patient_user_ref`,`medication_ref`),
  UNIQUE KEY `uq_patient_medications_public_id` (`public_id`),
  CONSTRAINT `chk_patient_medications_min_quantity` CHECK (((`min_quantity` is null) or (`min_quantity` >= 0))),
  CONSTRAINT `chk_patient_medications_quantity` CHECK ((`quantity_on_hand` >= 0)),
  CONSTRAINT `chk_patient_medications_status` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'STOPPED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dosage_schedules: جداول الجرعات وحالتها ومنطقتها الزمنية، ومنها ما اقترحه الصيدلي ولم يفعّله المريض بعد [قرار المستخدم]
CREATE TABLE `dosage_schedules` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_medication_id` bigint unsigned NOT NULL,
  `status` varchar(16) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `timezone` varchar(64) NOT NULL,
  `instructions` varchar(500) DEFAULT NULL,
  `proposed_by` varchar(150) DEFAULT NULL,
  `source_order_item_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `active_since` datetime(6) NOT NULL,
  `open_slot` bigint unsigned GENERATED ALWAYS AS ((case when (`status` in (_utf8mb4'ACTIVE',_utf8mb4'PAUSED')) then `patient_medication_id` else NULL end)) STORED,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dosage_schedules_public_id` (`public_id`),
  UNIQUE KEY `uq_dosage_schedules_open_slot` (`open_slot`),
  KEY `idx_dosage_schedules_status` (`status`),
  KEY `idx_dosage_schedules_source_item` (`source_order_item_ref`),
  KEY `idx_dosage_schedules_medication` (`patient_medication_id`,`id`),
  CONSTRAINT `fk_dosage_schedules_patient_medication` FOREIGN KEY (`patient_medication_id`) REFERENCES `patient_medications` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_dosage_schedules_dates` CHECK (((`end_date` is null) or (`end_date` >= `start_date`))),
  CONSTRAINT `chk_dosage_schedules_ended` CHECK (((`status` <> _utf8mb4'ENDED') or (`end_date` is not null))),
  CONSTRAINT `chk_dosage_schedules_proposal` CHECK (((`status` not in (_utf8mb4'PROPOSED',_utf8mb4'DISMISSED')) or (`proposed_by` is not null))),
  CONSTRAINT `chk_dosage_schedules_status` CHECK ((`status` in (_utf8mb4'PROPOSED',_utf8mb4'ACTIVE',_utf8mb4'PAUSED',_utf8mb4'ENDED',_utf8mb4'DISMISSED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- patient_medication_acquisitions: كل عملية حصول على دواء من صرف — إضافة فقط
CREATE TABLE `patient_medication_acquisitions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_medication_id` bigint unsigned NOT NULL,
  `order_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `order_item_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pharmacy_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pharmacy_name` varchar(150) NOT NULL,
  `packs` smallint NOT NULL,
  `pack_size` decimal(10,2) NOT NULL,
  `units_added` decimal(12,2) NOT NULL,
  `acquired_at` datetime(6) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_acquisitions_order_item` (`order_item_ref`),
  UNIQUE KEY `uq_acquisitions_public_id` (`public_id`),
  KEY `idx_acquisitions_patient_medication` (`patient_medication_id`,`acquired_at`),
  CONSTRAINT `fk_acquisitions_patient_medication` FOREIGN KEY (`patient_medication_id`) REFERENCES `patient_medications` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_acquisitions_packs` CHECK ((`packs` > 0)),
  CONSTRAINT `chk_acquisitions_units` CHECK ((`units_added` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dose_schedule_days: أيام الأسبوع لكل جدول
CREATE TABLE `dose_schedule_days` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `schedule_id` bigint unsigned NOT NULL,
  `day_of_week` smallint NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dose_schedule_days_day` (`schedule_id`,`day_of_week`),
  CONSTRAINT `fk_dose_schedule_days_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `dosage_schedules` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_dose_schedule_days_day` CHECK ((`day_of_week` between 1 and 7))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dose_times: أوقات الجرعات وكمياتها
CREATE TABLE `dose_times` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `schedule_id` bigint unsigned NOT NULL,
  `time_of_day` time NOT NULL,
  `dose_amount` decimal(8,2) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dose_times_public_id` (`public_id`),
  UNIQUE KEY `uq_dose_times_schedule_time` (`schedule_id`,`time_of_day`),
  CONSTRAINT `fk_dose_times_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `dosage_schedules` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_dose_times_amount` CHECK ((`dose_amount` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- dose_logs: الجرعات المسجلة: مأخوذة، متروكة، فائتة
CREATE TABLE `dose_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `dose_time_id` bigint unsigned NOT NULL,
  `patient_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scheduled_date` date NOT NULL,
  `scheduled_at` datetime(6) NOT NULL,
  `status` varchar(16) NOT NULL,
  `source` varchar(16) NOT NULL,
  `dose_amount` decimal(8,2) NOT NULL,
  `taken_at` datetime(6) DEFAULT NULL,
  `recorded_at` datetime(6) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dose_logs_identity` (`dose_time_id`,`scheduled_date`),
  UNIQUE KEY `uq_dose_logs_public_id` (`public_id`),
  KEY `idx_dose_logs_patient_scheduled` (`patient_user_ref`,`scheduled_at`),
  CONSTRAINT `fk_dose_logs_dose_time` FOREIGN KEY (`dose_time_id`) REFERENCES `dose_times` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_dose_logs_missed_source` CHECK (((`status` <> _utf8mb4'MISSED') or (`source` = _utf8mb4'SYSTEM'))),
  CONSTRAINT `chk_dose_logs_source` CHECK ((`source` in (_utf8mb4'PATIENT',_utf8mb4'SYSTEM'))),
  CONSTRAINT `chk_dose_logs_status` CHECK ((`status` in (_utf8mb4'TAKEN',_utf8mb4'MISSED',_utf8mb4'SKIPPED'))),
  CONSTRAINT `chk_dose_logs_taken_at` CHECK (((`status` = _utf8mb4'TAKEN') = (`taken_at` is not null)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- outbox_events: أحداث صادرة تُكتب مع العملية نفسها ثم تُنشر إلى RabbitMQ
CREATE TABLE `outbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_type` varchar(64) NOT NULL,
  `aggregate_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `version` int unsigned NOT NULL DEFAULT '1',
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'PENDING',
  `attempts` int unsigned NOT NULL DEFAULT '0',
  `last_error` text,
  `occurred_at` datetime(6) NOT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_health_outbox_event_id` (`event_id`),
  KEY `idx_health_outbox_status_id` (`status`,`id`),
  CONSTRAINT `chk_health_outbox_event_type` CHECK ((char_length(trim(`event_type`)) > 0)),
  CONSTRAINT `chk_health_outbox_failed_error` CHECK (((`status` <> _utf8mb4'FAILED') or ((`last_error` is not null) and (char_length(trim(`last_error`)) > 0)))),
  CONSTRAINT `chk_health_outbox_publish_state` CHECK ((((`status` = _utf8mb4'PUBLISHED') and (`published_at` is not null)) or ((`status` <> _utf8mb4'PUBLISHED') and (`published_at` is null)))),
  CONSTRAINT `chk_health_outbox_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'PUBLISHED',_utf8mb4'FAILED'))),
  CONSTRAINT `chk_health_outbox_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- inbox_events: معرّفات الأحداث المستقبَلة لمنع معالجتها مرتين
CREATE TABLE `inbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `source` varchar(64) NOT NULL,
  `received_at` datetime(6) NOT NULL,
  `processed_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_health_inbox_event_id` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------
-- ai_db — يملكها ai-service وحدها (3 جداول)
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `ai_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `ai_db`;

-- ai_insights: ملخصات الالتزام ومؤشراتها واسم النموذج
CREATE TABLE `ai_insights` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `trigger_type` varchar(16) NOT NULL,
  `period_label` varchar(32) NOT NULL,
  `period_start` datetime(6) NOT NULL,
  `period_end` datetime(6) NOT NULL,
  `insight_text` varchar(1000) NOT NULL,
  `input_metrics_json` json NOT NULL,
  `model_name` varchar(64) NOT NULL,
  `policy_version` varchar(32) NOT NULL,
  `source_event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_insights_public_id` (`public_id`),
  UNIQUE KEY `uq_ai_insights_source_event` (`source_event_id`),
  KEY `idx_ai_insights_patient_created` (`patient_user_ref`,`created_at`),
  CONSTRAINT `chk_ai_insights_period` CHECK ((`period_end` > `period_start`)),
  CONSTRAINT `chk_ai_insights_text` CHECK ((char_length(trim(`insight_text`)) > 0)),
  CONSTRAINT `chk_ai_insights_trigger` CHECK ((`trigger_type` in (_utf8mb4'SCHEDULED',_utf8mb4'ON_DEMAND')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- outbox_events: أحداث صادرة تُكتب مع العملية نفسها ثم تُنشر إلى RabbitMQ
CREATE TABLE `outbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aggregate_type` varchar(64) NOT NULL,
  `aggregate_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `version` int unsigned NOT NULL DEFAULT '1',
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'PENDING',
  `attempts` int unsigned NOT NULL DEFAULT '0',
  `last_error` text,
  `occurred_at` datetime(6) NOT NULL,
  `published_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_outbox_event_id` (`event_id`),
  KEY `idx_ai_outbox_status_id` (`status`,`id`),
  CONSTRAINT `chk_ai_outbox_event_type` CHECK ((char_length(trim(`event_type`)) > 0)),
  CONSTRAINT `chk_ai_outbox_failed_error` CHECK (((`status` <> _utf8mb4'FAILED') or ((`last_error` is not null) and (char_length(trim(`last_error`)) > 0)))),
  CONSTRAINT `chk_ai_outbox_publish_state` CHECK ((((`status` = _utf8mb4'PUBLISHED') and (`published_at` is not null)) or ((`status` <> _utf8mb4'PUBLISHED') and (`published_at` is null)))),
  CONSTRAINT `chk_ai_outbox_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'PUBLISHED',_utf8mb4'FAILED'))),
  CONSTRAINT `chk_ai_outbox_version` CHECK ((`version` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- inbox_events: معرّفات الأحداث المستقبَلة لمنع معالجتها مرتين
CREATE TABLE `inbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `source` varchar(64) NOT NULL,
  `received_at` datetime(6) NOT NULL,
  `processed_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_inbox_event_id` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------
-- notification_db — يملكها notification-service وحدها (جدولان)
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `notification_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `notification_db`;

-- notifications: إشعارات كل مستخدم وحالة قراءتها
CREATE TABLE `notifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `public_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recipient_user_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `type` varchar(48) NOT NULL,
  `title` varchar(150) NOT NULL,
  `message` varchar(1000) NOT NULL,
  `priority` varchar(8) NOT NULL,
  `entity_type` varchar(32) DEFAULT NULL,
  `entity_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `source_event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `read_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notifications_public_id` (`public_id`),
  UNIQUE KEY `uq_notifications_event_recipient` (`source_event_id`,`recipient_user_ref`),
  KEY `idx_notifications_recipient_created` (`recipient_user_ref`,`created_at`),
  KEY `idx_notifications_recipient_unread` (`recipient_user_ref`,`read_at`,`created_at`),
  CONSTRAINT `chk_notifications_priority` CHECK ((`priority` in (_utf8mb4'LOW',_utf8mb4'NORMAL',_utf8mb4'HIGH'))),
  CONSTRAINT `chk_notifications_title` CHECK ((char_length(trim(`title`)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- inbox_events: معرّفات الأحداث المستقبَلة لمنع معالجتها مرتين
CREATE TABLE `inbox_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `source` varchar(64) NOT NULL,
  `received_at` datetime(6) NOT NULL,
  `processed_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_inbox_event_id` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
-- انتهى: 38 جدولًا في 9 قواعد. التالي (للحسابات والصلاحيات): python scripts/setup.py
