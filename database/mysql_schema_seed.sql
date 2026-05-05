SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
DROP DATABASE IF EXISTS medication_system;
CREATE DATABASE medication_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE medication_system;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE admin (
  admin_id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (admin_id),
  UNIQUE KEY uq_admin_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE patient (
  patient_id INT NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (patient_id),
  UNIQUE KEY uq_patient_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE medication (
  medication_id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(100) NOT NULL,
  form ENUM('tablet','capsule','syrup','injection','drop','ointment','spray','other') NOT NULL,
  strength VARCHAR(50) NOT NULL,
  available_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  description TEXT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (medication_id),
  UNIQUE KEY uq_medication_name (name),
  KEY ix_medication_active_name (is_active, name),
  KEY ix_medication_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE patient_medication (
  patient_med_id INT NOT NULL AUTO_INCREMENT,
  patient_id INT NOT NULL,
  medication_id INT NOT NULL,
  current_quantity DECIMAL(10,2) NOT NULL,
  min_threshold DECIMAL(10,2) NOT NULL,
  status ENUM('active','stopped') NOT NULL DEFAULT 'active',
  start_date DATE NOT NULL,
  end_date DATE DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  PRIMARY KEY (patient_med_id),
  UNIQUE KEY uq_patient_medication (patient_id, medication_id),
  KEY ix_patient_medication_patient_status (patient_id, status),
  KEY ix_patient_medication_medication (medication_id),
  CONSTRAINT fk_patient_medication_patient FOREIGN KEY (patient_id) REFERENCES patient (patient_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_patient_medication_medication FOREIGN KEY (medication_id) REFERENCES medication (medication_id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dosage_schedule (
  schedule_id INT NOT NULL AUTO_INCREMENT,
  patient_med_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE DEFAULT NULL,
  is_continuous TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active','stopped','completed') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (schedule_id),
  KEY ix_dosage_schedule_patient_med_status (patient_med_id, status),
  CONSTRAINT fk_dosage_schedule_patient_medication FOREIGN KEY (patient_med_id) REFERENCES patient_medication (patient_med_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dosage_schedule_day (
  schedule_day_id INT NOT NULL AUTO_INCREMENT,
  schedule_id INT NOT NULL,
  day_of_week ENUM('mon','tue','wed','thu','fri','sat','sun') NOT NULL,
  PRIMARY KEY (schedule_day_id),
  UNIQUE KEY uq_schedule_day (schedule_id, day_of_week),
  CONSTRAINT fk_schedule_day_schedule FOREIGN KEY (schedule_id) REFERENCES dosage_schedule (schedule_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dose_time (
  dose_time_id INT NOT NULL AUTO_INCREMENT,
  schedule_id INT NOT NULL,
  dose_period ENUM('morning','evening') NOT NULL,
  dose_time TIME NOT NULL,
  dose_amount DECIMAL(10,2) NOT NULL,
  dose_unit VARCHAR(30) NOT NULL,
  reminder_before_minutes INT NOT NULL DEFAULT 0,
  PRIMARY KEY (dose_time_id),
  UNIQUE KEY uq_schedule_dose_period (schedule_id, dose_period),
  KEY ix_dose_time_schedule (schedule_id, dose_period),
  CONSTRAINT fk_dose_time_schedule FOREIGN KEY (schedule_id) REFERENCES dosage_schedule (schedule_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dose_log (
  dose_log_id INT NOT NULL AUTO_INCREMENT,
  patient_med_id INT NOT NULL,
  dose_time_id INT NOT NULL,
  scheduled_time DATETIME NOT NULL,
  taken_time DATETIME DEFAULT NULL,
  status ENUM('taken','missed','skipped') NOT NULL,
  is_late TINYINT(1) NOT NULL DEFAULT 0,
  late_minutes INT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (dose_log_id),
  UNIQUE KEY uq_dose_log (patient_med_id, dose_time_id, scheduled_time),
  KEY ix_dose_log_patient_med_scheduled (patient_med_id, scheduled_time),
  KEY ix_dose_log_dose_time (dose_time_id),
  CONSTRAINT fk_dose_log_patient_medication FOREIGN KEY (patient_med_id) REFERENCES patient_medication (patient_med_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_dose_log_dose_time FOREIGN KEY (dose_time_id) REFERENCES dose_time (dose_time_id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification (
  notification_id INT NOT NULL AUTO_INCREMENT,
  patient_id INT NOT NULL,
  patient_med_id INT DEFAULT NULL,
  dose_time_id INT DEFAULT NULL,
  created_by_admin_id INT DEFAULT NULL,
  scheduled_for DATETIME DEFAULT NULL,
  type ENUM('dose','low_stock','warning') NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('read','unread') NOT NULL DEFAULT 'unread',
  read_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id),
  KEY ix_notification_patient_status (patient_id, status),
  KEY ix_notification_type_patient_med (type, patient_med_id),
  UNIQUE KEY uq_notification_dose (type, dose_time_id, scheduled_for),
  CONSTRAINT fk_notification_patient FOREIGN KEY (patient_id) REFERENCES patient (patient_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_notification_patient_medication FOREIGN KEY (patient_med_id) REFERENCES patient_medication (patient_med_id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_notification_dose_time FOREIGN KEY (dose_time_id) REFERENCES dose_time (dose_time_id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_notification_admin FOREIGN KEY (created_by_admin_id) REFERENCES admin (admin_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE blacklisted_token (
  id INT NOT NULL AUTO_INCREMENT,
  jti VARCHAR(36) NOT NULL,
  token_type VARCHAR(20) NOT NULL DEFAULT 'access',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_blacklisted_token_jti (jti)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin (admin_id, name, email, password_hash, status, created_at, updated_at) VALUES
(1, 'Administrator', 'admin@admin.com', 'pbkdf2:sha256:260000$adminsalt1$54fed1fe27699e8757a9a09e564748ff488d52df2a2ce2210ed0a9a60c15fc0a', 'active', '2026-05-02 00:00:00', '2026-05-02 00:00:00');

INSERT INTO patient (patient_id, full_name, email, password_hash, phone, status, created_at, updated_at) VALUES
(1, 'Demo Patient', 'patient@demo.com', 'pbkdf2:sha256:260000$patients1$cc55a8f8017f6cdfdfde1ef55b59c2259d1fb7abed32b3d511891e2748d5ae30', '0100000000', 'active', '2026-05-02 00:00:00', '2026-05-02 00:00:00');

INSERT INTO medication (medication_id, name, category, form, strength, available_quantity, description, is_active, created_at, updated_at) VALUES
(1, 'Paracetamol', 'مسكنات', 'tablet', '500 mg', 0.00, 'مسكن وخافض حرارة.', 1, '2026-05-02 00:00:00', '2026-05-02 00:00:00'),
(2, 'Sertraline', 'نفسية', 'tablet', '50 mg', 0.00, 'دواء نفسي تجريبي في النظام.', 1, '2026-05-02 00:00:00', '2026-05-02 00:00:00'),
(3, 'Amlodipine', 'قلبية', 'tablet', '5 mg', 0.00, 'دواء قلبي تجريبي في النظام.', 1, '2026-05-02 00:00:00', '2026-05-02 00:00:00');

INSERT INTO patient_medication (patient_med_id, patient_id, medication_id, current_quantity, min_threshold, status, start_date, end_date, notes) VALUES
(1, 1, 1, 5.00, 2.00, 'active', '2026-05-01', NULL, 'دواء تجريبي نشط');

INSERT INTO dosage_schedule (schedule_id, patient_med_id, start_date, end_date, is_continuous, status, created_at, updated_at) VALUES
(1, 1, '2026-05-01', NULL, 1, 'active', '2026-05-02 00:00:00', '2026-05-02 00:00:00');

INSERT INTO dosage_schedule_day (schedule_day_id, schedule_id, day_of_week) VALUES
(1, 1, 'sat'), (2, 1, 'mon'), (3, 1, 'wed');

INSERT INTO dose_time (dose_time_id, schedule_id, dose_period, dose_time, dose_amount, dose_unit, reminder_before_minutes) VALUES
(1, 1, 'morning', '09:30:00', 1.00, 'tablet', 0),
(2, 1, 'evening', '21:15:00', 1.00, 'tablet', 0);

INSERT INTO dose_log (dose_log_id, patient_med_id, dose_time_id, scheduled_time, taken_time, status, is_late, late_minutes, created_at) VALUES
(1, 1, 1, '2026-05-02 09:30:00', '2026-05-02 09:37:00', 'taken', 1, 7, '2026-05-02 09:37:00');

INSERT INTO notification (notification_id, patient_id, patient_med_id, dose_time_id, created_by_admin_id, scheduled_for, type, title, message, status, read_at, created_at) VALUES
(1, 1, 1, 1, NULL, '2026-05-02 09:30:00', 'dose', 'إشعار جرعة Paracetamol', 'حان الآن وقت جرعة صباحًا (09:30) من دواء Paracetamol. يمكنك تأكيد الجرعة أو تسجيلها فائتة.', 'read', '2026-05-02 09:37:00', '2026-05-02 09:30:00'),
(2, 1, NULL, NULL, 1, NULL, 'warning', 'مراجعة جدول الدواء', 'يرجى مراجعة جدول الدواء إذا ظهرت لديك أي مشكلة.', 'unread', NULL, '2026-05-02 10:00:00');
