-- =============================================================================
-- Migration: SA Attendance Violation, Warning, Memo, and Under Agreement Management
-- Date: 2026-10-11
-- Database: assistpay
-- =============================================================================

-- 1. Add disciplinary_status and under_agreement_at to sa_profiles
--    Separated from assignment_status so an SA Under Agreement can retain their duty assignment.
ALTER TABLE sa_profiles
    ADD COLUMN IF NOT EXISTS disciplinary_status ENUM('GOOD_STANDING','FIRST_WARNING','SECOND_WARNING','UNDER_AGREEMENT') NOT NULL DEFAULT 'GOOD_STANDING' AFTER assignment_status,
    ADD COLUMN IF NOT EXISTS under_agreement_at DATE NULL DEFAULT NULL AFTER disciplinary_status;

-- 2. Semester-specific Attendance Violation Settings
CREATE TABLE IF NOT EXISTS attendance_violation_settings (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id         INT UNSIGNED NOT NULL,
    category            ENUM('LATES','EXCUSE_SLIP','AWOL','NTI_NTO','UNDERTIME') NOT NULL,
    category_label      VARCHAR(60)  NOT NULL,
    allowed_chances     INT UNSIGNED NOT NULL DEFAULT 6,
    policy_reference    VARCHAR(160) NOT NULL DEFAULT 'NCST Student Assistantship Disciplinary Policy',
    description         VARCHAR(255) DEFAULT NULL,
    updated_by          INT UNSIGNED DEFAULT NULL,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sem_violation_cat (semester_id, category),
    CONSTRAINT fk_avs_semester   FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_avs_updated_by FOREIGN KEY (updated_by)  REFERENCES users(id)     ON DELETE SET NULL
) ENGINE=InnoDB;

-- 3. History of Attendance Violation Settings Changes
CREATE TABLE IF NOT EXISTS attendance_violation_settings_history (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id         INT UNSIGNED NOT NULL,
    category            VARCHAR(40)  NOT NULL,
    old_allowed_chances VARCHAR(40)   DEFAULT NULL,
    new_allowed_chances VARCHAR(40)  NOT NULL,
    change_reason       VARCHAR(255) DEFAULT NULL,
    changed_by          INT UNSIGNED DEFAULT NULL,
    changed_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_avsh_sem (semester_id, changed_at),
    CONSTRAINT fk_avsh_semester   FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_avsh_changed_by FOREIGN KEY (changed_by)  REFERENCES users(id)     ON DELETE SET NULL
) ENGINE=InnoDB;

-- 4. SA Attendance Violation Incidents (Semester-scoped attendance occurrences)
CREATE TABLE IF NOT EXISTS sa_attendance_incidents (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id         INT UNSIGNED NOT NULL,
    sa_profile_id       INT UNSIGNED NOT NULL,
    category            ENUM('LATES','EXCUSE_SLIP','AWOL','NTI_NTO','UNDERTIME') NOT NULL,
    incident_date       DATE         NOT NULL,
    scheduled_start     TIME         DEFAULT NULL,
    scheduled_end       TIME         DEFAULT NULL,
    actual_time_in      TIME         DEFAULT NULL,
    actual_time_out     TIME         DEFAULT NULL,
    minutes_affected    INT UNSIGNED NOT NULL DEFAULT 0,
    evidence_notes      VARCHAR(255) DEFAULT NULL,
    correction_notes    VARCHAR(255) DEFAULT NULL,
    status              ENUM('VALID','CORRECTED','VOIDED') NOT NULL DEFAULT 'VALID',
    recorded_by         INT UNSIGNED DEFAULT NULL,
    updated_by          INT UNSIGNED DEFAULT NULL,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sa_sem_cat_date (semester_id, sa_profile_id, category, incident_date),
    INDEX idx_sai_sa_sem (sa_profile_id, semester_id, category, status),
    CONSTRAINT fk_sai_semester    FOREIGN KEY (semester_id)   REFERENCES semesters(id)   ON DELETE CASCADE,
    CONSTRAINT fk_sai_sa_profile  FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_sai_recorded_by FOREIGN KEY (recorded_by)   REFERENCES users(id)       ON DELETE SET NULL,
    CONSTRAINT fk_sai_updated_by  FOREIGN KEY (updated_by)    REFERENCES users(id)       ON DELETE SET NULL
) ENGINE=InnoDB;

-- 5. SA Disciplinary Warnings (First, Second, Third Warning evaluations & approvals)
CREATE TABLE IF NOT EXISTS sa_disciplinary_warnings (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id             INT UNSIGNED NOT NULL,
    sa_profile_id           INT UNSIGNED NOT NULL,
    warning_level           ENUM('FIRST_WARNING','SECOND_WARNING','THIRD_WARNING') NOT NULL,
    violation_category      ENUM('LATES','EXCUSE_SLIP','AWOL','NTI_NTO','UNDERTIME') NOT NULL,
    allowed_chances         INT UNSIGNED NOT NULL,
    recorded_occurrences    INT UNSIGNED NOT NULL,
    incident_ids_json       TEXT         NOT NULL,
    incident_dates_json     TEXT         NOT NULL,
    attendance_evidence     TEXT         NOT NULL,
    applicable_policy       TEXT         NOT NULL,
    explanation             TEXT         NOT NULL,
    corrective_action       TEXT         NOT NULL,
    previous_warning_ids    VARCHAR(120) DEFAULT NULL,
    evaluation_status       ENUM('PENDING_REVIEW','APPROVED','ISSUED','ACKNOWLEDGED','RECALLED') NOT NULL DEFAULT 'PENDING_REVIEW',
    requires_under_agreement TINYINT(1)  NOT NULL DEFAULT 0,
    recall_reason           VARCHAR(255) DEFAULT NULL,
    evaluated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by             INT UNSIGNED DEFAULT NULL,
    reviewed_at             DATETIME     DEFAULT NULL,
    approved_by             INT UNSIGNED DEFAULT NULL,
    approved_at             DATETIME     DEFAULT NULL,
    updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sa_sem_warning_level (semester_id, sa_profile_id, warning_level),
    INDEX idx_sdw_sa_sem (sa_profile_id, semester_id, evaluation_status),
    CONSTRAINT fk_sdw_semester    FOREIGN KEY (semester_id)   REFERENCES semesters(id)   ON DELETE CASCADE,
    CONSTRAINT fk_sdw_sa_profile  FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_sdw_reviewed_by FOREIGN KEY (reviewed_by)   REFERENCES users(id)       ON DELETE SET NULL,
    CONSTRAINT fk_sdw_approved_by FOREIGN KEY (approved_by)   REFERENCES users(id)       ON DELETE SET NULL
) ENGINE=InnoDB;

-- 6. Official Warning Memo Documents
CREATE TABLE IF NOT EXISTS sa_warning_memos (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    warning_id              INT UNSIGNED NOT NULL UNIQUE,
    semester_id             INT UNSIGNED NOT NULL,
    sa_profile_id           INT UNSIGNED NOT NULL,
    memo_ref_no             VARCHAR(50)  NOT NULL UNIQUE,
    warning_level           ENUM('FIRST_WARNING','SECOND_WARNING','THIRD_WARNING') NOT NULL,
    violation_category      ENUM('LATES','EXCUSE_SLIP','AWOL','NTI_NTO','UNDERTIME') NOT NULL,
    issued_date             DATE         NOT NULL,
    subject_line            VARCHAR(200) NOT NULL,
    recipient_name          VARCHAR(150) NOT NULL,
    student_number          VARCHAR(30)  NOT NULL,
    sa_number               VARCHAR(30)  DEFAULT NULL,
    course_year             VARCHAR(80)  NOT NULL,
    assigned_office         VARCHAR(120) NOT NULL,
    semester_label          VARCHAR(100) NOT NULL,
    allowed_chances         INT UNSIGNED NOT NULL,
    recorded_occurrences    INT UNSIGNED NOT NULL,
    incident_dates_json     TEXT         NOT NULL,
    attendance_records_text TEXT         NOT NULL,
    previous_warnings_text  TEXT         DEFAULT NULL,
    explanation_body        TEXT         NOT NULL,
    applicable_policy       TEXT         NOT NULL,
    corrective_action       TEXT         NOT NULL,
    coordinator_name        VARCHAR(150) NOT NULL,
    coordinator_title       VARCHAR(100) NOT NULL DEFAULT 'S.A. Coordinator',
    status                  ENUM('DRAFT','PENDING_REVIEW','APPROVED','ISSUED','ACKNOWLEDGED','SUPERSEDED') NOT NULL DEFAULT 'PENDING_REVIEW',
    acknowledged_at         DATE         DEFAULT NULL,
    acknowledged_by_user_id INT UNSIGNED DEFAULT NULL,
    created_by              INT UNSIGNED DEFAULT NULL,
    updated_by              INT UNSIGNED DEFAULT NULL,
    created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_swm_sa_sem (sa_profile_id, semester_id, status),
    CONSTRAINT fk_swm_warning     FOREIGN KEY (warning_id)    REFERENCES sa_disciplinary_warnings(id) ON DELETE CASCADE,
    CONSTRAINT fk_swm_semester    FOREIGN KEY (semester_id)   REFERENCES semesters(id)                ON DELETE CASCADE,
    CONSTRAINT fk_swm_sa_profile  FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id)              ON DELETE CASCADE,
    CONSTRAINT fk_swm_created_by  FOREIGN KEY (created_by)    REFERENCES users(id)                    ON DELETE SET NULL,
    CONSTRAINT fk_swm_updated_by  FOREIGN KEY (updated_by)    REFERENCES users(id)                    ON DELETE SET NULL
) ENGINE=InnoDB;

-- 7. Under Agreement Records (Triggered by Third Warning)
CREATE TABLE IF NOT EXISTS sa_under_agreements (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sa_profile_id           INT UNSIGNED NOT NULL,
    semester_id             INT UNSIGNED NOT NULL,
    third_warning_id        INT UNSIGNED NOT NULL UNIQUE,
    agreement_ref_no        VARCHAR(50)  NOT NULL UNIQUE,
    effective_date          DATE         NOT NULL,
    end_date                DATE         DEFAULT NULL,
    reason                  TEXT         NOT NULL,
    conditions_text         TEXT         NOT NULL,
    status                  ENUM('PENDING_APPROVAL','PENDING_SIGNATURE','SIGNED','COMPLETED','REVOKED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    approved_by             INT UNSIGNED DEFAULT NULL,
    approved_at             DATETIME     DEFAULT NULL,
    approver_name           VARCHAR(150) DEFAULT NULL,
    signed_at               DATE         DEFAULT NULL,
    completed_at            DATE         DEFAULT NULL,
    remarks                 VARCHAR(255) DEFAULT NULL,
    created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sua_sa_status (sa_profile_id, status),
    CONSTRAINT fk_sua_sa_profile FOREIGN KEY (sa_profile_id)    REFERENCES sa_profiles(id)              ON DELETE CASCADE,
    CONSTRAINT fk_sua_semester   FOREIGN KEY (semester_id)      REFERENCES semesters(id)                ON DELETE CASCADE,
    CONSTRAINT fk_sua_warning    FOREIGN KEY (third_warning_id) REFERENCES sa_disciplinary_warnings(id) ON DELETE CASCADE,
    CONSTRAINT fk_sua_approver   FOREIGN KEY (approved_by)      REFERENCES users(id)                    ON DELETE SET NULL
) ENGINE=InnoDB;

