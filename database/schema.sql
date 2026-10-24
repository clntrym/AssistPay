-- AssistPay Complete Unified Database Schema
-- Run: C:\xampp\mysql\bin\mysql.exe -u root < database\schema.sql
-- Then: C:\xampp\php\php.exe database\seed.php
--
-- WARNING: drops and recreates every table (development only).

CREATE DATABASE IF NOT EXISTS assistpay CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE assistpay;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS fee_assessments;
DROP TABLE IF EXISTS enrollment_details;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS subject_schedules;
DROP TABLE IF EXISTS student_grades;
DROP TABLE IF EXISTS subject_prerequisites;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS room_utilization;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS schedule_changes;
DROP TABLE IF EXISTS schedule_assignments;
DROP TABLE IF EXISTS schedule_publications;
DROP TABLE IF EXISTS match_candidates;
DROP TABLE IF EXISTS match_slots;
DROP TABLE IF EXISTS matching_runs;
DROP TABLE IF EXISTS assignment_reviews;
DROP TABLE IF EXISTS duty_preferences;
DROP TABLE IF EXISTS class_change_documents;
DROP TABLE IF EXISTS class_schedules;
DROP TABLE IF EXISTS room_requirements;
DROP TABLE IF EXISTS office_requirements;
DROP TABLE IF EXISTS sa_benefits;
DROP TABLE IF EXISTS sa_profiles;
DROP TABLE IF EXISTS allowance_rates;
DROP TABLE IF EXISTS academic_terms;
DROP TABLE IF EXISTS semesters;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS offices;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 1. CORE & AUTHENTICATION TABLES
-- ============================================================

-- Offices an OFFICE-category S.A. or supervisor can belong to
CREATE TABLE offices (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(20)  NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    is_active   TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Every login account. The role here is the ONLY source of truth for access.
CREATE TABLE users (
    id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username              VARCHAR(50)  NOT NULL UNIQUE,          -- S.A.: student ID
    password_hash         VARCHAR(255) NOT NULL,                  -- password_hash() output
    role                  ENUM('ADMIN','SUPERVISOR','SA','REGISTRAR') NOT NULL,
    full_name             VARCHAR(150) NOT NULL,
    email                 VARCHAR(150) NULL UNIQUE,

    -- Supervisor scope (NULL for ADMIN and SA)
    supervisor_category   ENUM('ITO','ACADS','OFFICE') NULL,
    office_id             INT UNSIGNED NULL,

    status                ENUM('PENDING_ACTIVATION','ACTIVE','INACTIVE','LOCKED','SUSPENDED')
                          NOT NULL DEFAULT 'PENDING_ACTIVATION',
    must_change_password  TINYINT(1)   NOT NULL DEFAULT 1,

    -- Brute-force protection
    failed_attempts       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    locked_until          DATETIME     NULL,

    last_login_at         DATETIME     NULL,
    password_changed_at   DATETIME     NULL,
    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_users_office FOREIGN KEY (office_id) REFERENCES offices(id),
    CONSTRAINT chk_username_no_at CHECK (username NOT LIKE '%@%')
) ENGINE=InnoDB;

-- Multi-office assignment for Supervisors
CREATE TABLE supervisor_offices (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supervisor_id INT UNSIGNED NOT NULL,
    office_id     INT UNSIGNED NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sup_office (supervisor_id, office_id),
    CONSTRAINT fk_sup_off_user FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_sup_off_office FOREIGN KEY (office_id) REFERENCES offices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Per-IP throttling
CREATE TABLE login_attempts (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ip_address   VARCHAR(45)  NOT NULL,
    username     VARCHAR(150) NULL,             
    success      TINYINT(1)   NOT NULL,
    attempted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ip_time (ip_address, attempted_at)
) ENGINE=InnoDB;

-- Security and activity log
CREATE TABLE audit_logs (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NULL,
    action      VARCHAR(60)  NOT NULL,       
    details     VARCHAR(500) NULL,
    ip_address  VARCHAR(45)  NULL,
    user_agent  VARCHAR(255) NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_action_time (action, created_at),
    INDEX idx_user_time (user_id, created_at),
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO offices (code, name) VALUES
    ('SHS_TVL',     'SHS-TVL'),
    ('TOOLS_ROOM',  'TOOLS ROOM'),
    ('HRM_BAR',     'HRM BAR'),
    ('HR',          'HR'),
    ('PSMO_FMO',    'PSMO/FMO'),
    ('OCM',         'OCM'),
    ('PRD',         'PRD'),
    ('REGISTRAR',   'REGISTRAR'),
    ('ACAD_OFFICE', 'ACAD OFFICE'),
    ('OSA',         'OSA'),
    ('HSO',         'HSO'),
    ('LIBRARY',     'LIBRARY'),
    ('NSTP',        'NSTP'),
    ('SIR_ALEX',    'SIR ALEX'),
    ('SHS_OFFICE',  'SHS OFFICE'),
    ('ITO_OFFICE',  'ITO OFFICE'),
    ('RECORDS',     'RECORDS'),
    ('ITJPO',       'ITJPO'),
    ('FMO',         'FMO');

-- ============================================================
-- 2. ACADEMIC, COURSES, & STUDENTS CURRICULUM MODULE
-- ============================================================

CREATE TABLE courses (
    course_id INT AUTO_INCREMENT PRIMARY KEY,
    course_code VARCHAR(20) UNIQUE NOT NULL,     
    course_name VARCHAR(100) NOT NULL            
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE curriculums (
    curriculum_id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT NOT NULL,
    curriculum_code VARCHAR(50) UNIQUE NOT NULL,
    effective_sy VARCHAR(20) NOT NULL,
    total_units DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE students (
    student_id INT AUTO_INCREMENT PRIMARY KEY,
    student_number VARCHAR(20) UNIQUE NOT NULL,       -- e.g. '2024-58030'
    admission_date DATE NULL,                         -- e.g. '2024-10-06'
    course_id INT NOT NULL,                           -- Foreign Key to courses
    curriculum_id INT NOT NULL,                       -- Foreign Key to curriculums
    first_name VARCHAR(50) NOT NULL,                  -- e.g. 'Daizy'
    middle_name VARCHAR(50) NULL,                     -- e.g. 'Salva'
    last_name VARCHAR(50) NOT NULL,                   -- e.g. 'Magpantay'
    suffix VARCHAR(20) NULL,                          -- e.g. 'Jr.'
    gender ENUM('Male', 'Female', 'Other') DEFAULT 'Female',
    civil_status VARCHAR(30) DEFAULT 'Single',
    nationality VARCHAR(50) DEFAULT 'Filipino',
    birth_date DATE NULL,
    age INT NULL,
    birth_place VARCHAR(150) NULL,
    email VARCHAR(150) NULL,
    religion VARCHAR(100) NULL,
    contact_no VARCHAR(20) NULL,                      -- Mobile No
    landline VARCHAR(30) NULL,                        -- Home Landline
    mobile_provider VARCHAR(50) DEFAULT 'Globe',
    address TEXT NULL,                                -- Complete address
    zip_code VARCHAR(10) NULL,
    region VARCHAR(100) NULL,
    province VARCHAR(100) NULL,
    city VARCHAR(100) NULL,
    barangay VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
    FOREIGN KEY (curriculum_id) REFERENCES curriculums(curriculum_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE subjects (
    subject_id INT AUTO_INCREMENT PRIMARY KEY,
    curriculum_id INT NOT NULL,
    subject_code VARCHAR(20) NOT NULL,          
    description VARCHAR(150) NOT NULL,          
    units DECIMAL(4,2) NOT NULL DEFAULT 3.00,   
    year_level INT NOT NULL,                     
    semester INT NOT NULL,                      
    FOREIGN KEY (curriculum_id) REFERENCES curriculums(curriculum_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE subject_prerequisites (
    prereq_id INT AUTO_INCREMENT PRIMARY KEY,
    subject_id INT NOT NULL,                     
    prereq_subject_id INT NOT NULL,              
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
    FOREIGN KEY (prereq_subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
    UNIQUE KEY unique_prereq (subject_id, prereq_subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE academic_terms (
    term_id INT AUTO_INCREMENT PRIMARY KEY,
    school_year VARCHAR(20) NOT NULL,            
    semester VARCHAR(20) NOT NULL,               
    is_active BOOLEAN DEFAULT FALSE,             
    UNIQUE KEY unique_term (school_year, semester)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE subject_schedules (
    schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    term_id INT NOT NULL,
    subject_id INT NOT NULL,
    section_code VARCHAR(20) NOT NULL,           
    type ENUM('Lec', 'Lab', 'Lec/Lab') NOT NULL DEFAULT 'Lec',
    units DECIMAL(4,2) NOT NULL,
    days VARCHAR(20) NOT NULL,                   
    start_time TIME NOT NULL,                    
    end_time TIME NOT NULL,                      
    room VARCHAR(30) NOT NULL,                   
    instructor VARCHAR(100) NOT NULL,            
    FOREIGN KEY (term_id) REFERENCES academic_terms(term_id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE enrollments (
    enrollment_id INT AUTO_INCREMENT PRIMARY KEY,
    reference_no VARCHAR(30) UNIQUE NOT NULL,    
    student_id INT NOT NULL,
    term_id INT NOT NULL,
    enrollment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Pending', 'Enrolled', 'Dropped', 'Cancelled') DEFAULT 'Enrolled',
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (term_id) REFERENCES academic_terms(term_id) ON DELETE CASCADE,
    UNIQUE KEY unique_student_term (student_id, term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE enrollment_details (
    detail_id INT AUTO_INCREMENT PRIMARY KEY,
    enrollment_id INT NOT NULL,
    schedule_id INT NOT NULL,
    FOREIGN KEY (enrollment_id) REFERENCES enrollments(enrollment_id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES subject_schedules(schedule_id) ON DELETE CASCADE,
    UNIQUE KEY unique_enrollment_schedule (enrollment_id, schedule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE student_grades (
    grade_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    term_id INT NOT NULL,
    subject_id INT NOT NULL,
    prelims DECIMAL(5,2) DEFAULT NULL,           
    midterms DECIMAL(5,2) DEFAULT NULL,          
    prefinals DECIMAL(5,2) DEFAULT NULL,         
    finals DECIMAL(5,2) DEFAULT NULL,            
    final_grade DECIMAL(5,2) DEFAULT NULL,       
    points DECIMAL(3,2) DEFAULT NULL,            
    status ENUM('Passed', 'Failed', 'Incomplete', 'Enrolled', 'Dropped') DEFAULT 'Enrolled',
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (term_id) REFERENCES academic_terms(term_id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
    UNIQUE KEY unique_student_subject_term (student_id, subject_id, term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fee_assessments (
    assessment_id INT AUTO_INCREMENT PRIMARY KEY,
    enrollment_id INT UNIQUE NOT NULL,
    tuition_fee DECIMAL(10,2) DEFAULT 0.00,
    lab_fee DECIMAL(10,2) DEFAULT 0.00,
    misc_fee DECIMAL(10,2) DEFAULT 0.00,
    lms_fee DECIMAL(10,2) DEFAULT 0.00,
    nstp_fee DECIMAL(10,2) DEFAULT 0.00,
    omr_fee DECIMAL(10,2) DEFAULT 0.00,
    cash_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    installment_charge DECIMAL(10,2) DEFAULT 0.00,
    installment_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (enrollment_id) REFERENCES enrollments(enrollment_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 3. ASSISTPAY S.A. MANAGEMENT & SCHEDULING MODULE
-- ============================================================

CREATE TABLE semesters (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    academic_year  CHAR(9)      NOT NULL,                  
    term           ENUM('1ST','2ND','SUMMER') NOT NULL,
    start_date     DATE         NOT NULL,
    end_date       DATE         NOT NULL,
    status         ENUM('PLANNED','ACTIVE','CLOSED') NOT NULL DEFAULT 'PLANNED',
    required_sa    SMALLINT UNSIGNED NOT NULL DEFAULT 80,   
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_semester (academic_year, term),
    CONSTRAINT chk_semester_dates CHECK (end_date > start_date)
) ENGINE=InnoDB;

CREATE TABLE allowance_rates (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id  INT UNSIGNED  NOT NULL UNIQUE,
    hourly_rate  DECIMAL(8,2)  NOT NULL,          
    created_by   INT UNSIGNED  NULL,
    created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_rate_semester FOREIGN KEY (semester_id) REFERENCES semesters(id),
    CONSTRAINT fk_rate_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_rate_positive CHECK (hourly_rate > 0)
) ENGINE=InnoDB;

CREATE TABLE sa_profiles (
    id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id                INT UNSIGNED NOT NULL UNIQUE,
    student_id             VARCHAR(20)  NOT NULL UNIQUE,
    first_name             VARCHAR(60)  NOT NULL,
    middle_name            VARCHAR(60)  NULL,
    last_name              VARCHAR(60)  NOT NULL,
    suffix                 VARCHAR(10)  NULL,
    birth_date             DATE         NULL,
    sex                    ENUM('MALE','FEMALE') NULL,
    contact_number         VARCHAR(20)  NOT NULL,
    personal_email         VARCHAR(150) NULL,
    course                 VARCHAR(20)  NOT NULL,
    year_level             TINYINT UNSIGNED NOT NULL,
    semester_id            INT UNSIGNED NOT NULL,
    academic_status        ENUM('REGULAR','IRREGULAR') NOT NULL,
    enrollment_status      ENUM('ENROLLED','NOT_ENROLLED') NOT NULL,
    expected_graduation    DATE         NULL,           
    sa_category            ENUM('ACADS','ITO','OFFICE','RELIEVER') NOT NULL,
    department_type        ENUM('ACADS','ITO','OFFICE') NOT NULL,
    office_id              INT UNSIGNED NULL,           
    sa_status              ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    appointment_start      DATE         NOT NULL,
    appointment_end        DATE         NULL,
    assignment_status      ENUM('ASSIGNED','UNASSIGNED','FOR_REASSIGNMENT','INACTIVE') NOT NULL DEFAULT 'UNASSIGNED',
    weekly_target_hours    DECIMAL(4,1) NOT NULL DEFAULT 35.0,
    hourly_rate            DECIMAL(8,2) NULL,           
    is_reliever            TINYINT(1)   NOT NULL DEFAULT 0,
    supervisor_id          INT UNSIGNED NULL,
    emergency_name         VARCHAR(120) NULL,
    emergency_number       VARCHAR(20)  NULL,
    emergency_relationship VARCHAR(40)  NULL,
    archived_at            TIMESTAMP    NULL,
    archive_reason         VARCHAR(200) NULL,
    created_by             INT UNSIGNED NULL,
    created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_sa_status (sa_status, assignment_status),
    INDEX idx_sa_supervisor (supervisor_id),
    CONSTRAINT fk_sa_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_sa_semester FOREIGN KEY (semester_id) REFERENCES semesters(id),
    CONSTRAINT fk_sa_office FOREIGN KEY (office_id) REFERENCES offices(id),
    CONSTRAINT fk_sa_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id),
    CONSTRAINT fk_sa_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_sa_office CHECK ((department_type = 'OFFICE') = (office_id IS NOT NULL)),
    CONSTRAINT chk_sa_appointment CHECK (appointment_end IS NULL OR appointment_end >= appointment_start)
) ENGINE=InnoDB;

CREATE TABLE sa_benefits (
    id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sa_profile_id        INT UNSIGNED  NOT NULL,
    semester_id          INT UNSIGNED  NOT NULL,
    tuition_fee          DECIMAL(10,2) NOT NULL DEFAULT 0,
    misc_fee             DECIMAL(10,2) NOT NULL DEFAULT 0,
    tuition_coverage_pct DECIMAL(5,2)  NOT NULL DEFAULT 100.00,
    misc_coverage_pct    DECIMAL(5,2)  NOT NULL DEFAULT 70.00,
    updated_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_benefit (sa_profile_id, semester_id),
    CONSTRAINT fk_benefit_sa FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_benefit_semester FOREIGN KEY (semester_id) REFERENCES semesters(id),
    CONSTRAINT chk_fees CHECK (tuition_fee >= 0 AND misc_fee >= 0)
) ENGINE=InnoDB;

INSERT INTO semesters (academic_year, term, start_date, end_date, status)
VALUES ('2026-2027', '1ST', '2026-08-17', '2026-12-19', 'ACTIVE');

INSERT INTO allowance_rates (semester_id, hourly_rate) VALUES (1, 8.00);

CREATE TABLE class_schedules (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id    INT UNSIGNED NOT NULL,
    sa_profile_id  INT UNSIGNED NOT NULL,
    student_id     VARCHAR(20)  NOT NULL,          
    day_of_week    ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
    start_time     TIME         NOT NULL,
    end_time       TIME         NOT NULL,
    subject        VARCHAR(60)  NOT NULL,
    section        VARCHAR(40)  NULL,
    archived_at    TIMESTAMP    NULL,             
    imported_by    INT UNSIGNED NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_class (semester_id, sa_profile_id, day_of_week, start_time, subject),
    INDEX idx_class_conflict (semester_id, sa_profile_id, day_of_week),
    CONSTRAINT fk_class_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_class_sa FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_class_importer FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_class_times CHECK (end_time > start_time)
) ENGINE=InnoDB;

CREATE TABLE duty_preferences (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id    INT UNSIGNED NOT NULL,
    sa_profile_id  INT UNSIGNED NOT NULL,
    day_of_week    ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
    start_time     TIME         NOT NULL,
    end_time       TIME         NOT NULL,
    imported_by    INT UNSIGNED NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_preference (semester_id, sa_profile_id, day_of_week, start_time),
    INDEX idx_preference_sa (semester_id, sa_profile_id),
    CONSTRAINT fk_pref_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_pref_sa FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_pref_user FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_pref_times CHECK (end_time > start_time)
) ENGINE=InnoDB;

CREATE TABLE class_change_documents (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id   INT UNSIGNED NOT NULL,
    sa_profile_id INT UNSIGNED NOT NULL,
    class_id      INT UNSIGNED NULL,               
    action        ENUM('ADDED','UPDATED','DELETED','ARCHIVED','RESTORED') NOT NULL,
    detail        VARCHAR(200) NOT NULL,           
    reason        VARCHAR(200) NOT NULL,
    file_name     VARCHAR(160) NOT NULL,           
    stored_name   VARCHAR(80)  NOT NULL,           
    mime_type     VARCHAR(60)  NOT NULL,
    file_size     INT UNSIGNED NOT NULL,
    uploaded_by   INT UNSIGNED NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_classdoc_sa (sa_profile_id, created_at),
    CONSTRAINT fk_classdoc_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_classdoc_sa FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_classdoc_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE rooms (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(40)  NOT NULL,
    building    VARCHAR(60)  NOT NULL DEFAULT 'Unknown',
    description VARCHAR(160) NULL,
    room_type   ENUM('COMPUTER_LAB','LABORATORY','LECTURE','OTHER') NOT NULL DEFAULT 'OTHER',
    capacity    INT UNSIGNED NULL DEFAULT 40,
    is_active   TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_room_code (code)
) ENGINE=InnoDB;

CREATE TABLE room_utilization (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id INT UNSIGNED NOT NULL,
    room_id     INT UNSIGNED NOT NULL,
    day_of_week ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
    start_time  TIME         NOT NULL,
    end_time    TIME         NOT NULL,
    class_name  VARCHAR(120) NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_utilization (semester_id, room_id, day_of_week, start_time, end_time),
    CONSTRAINT fk_utilization_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_utilization_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE room_requirements (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id     INT UNSIGNED NOT NULL,
    department_type ENUM('ACADS','ITO') NOT NULL,
    room            VARCHAR(40)  NOT NULL,          
    room_id         INT UNSIGNED NULL,               
    room_ids        VARCHAR(120) NULL,               
    day_of_week     ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
    start_time      TIME         NOT NULL,
    end_time        TIME         NOT NULL,
    class_name      VARCHAR(120) NULL,               
    required_sa     TINYINT UNSIGNED NOT NULL DEFAULT 1,
    notes           VARCHAR(160) NULL,
    created_by      INT UNSIGNED NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_room_period (semester_id, department_type, room, day_of_week, start_time),
    INDEX idx_room_semester (semester_id, department_type),
    CONSTRAINT fk_room_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_room_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_room_times CHECK (end_time > start_time),
    CONSTRAINT chk_room_required CHECK (required_sa BETWEEN 1 AND 20)
) ENGINE=InnoDB;

CREATE TABLE office_requirements (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id         INT UNSIGNED NOT NULL,
    office_id           INT UNSIGNED NOT NULL,
    required_sa         TINYINT UNSIGNED NOT NULL,
    operating_start     TIME         NOT NULL,
    operating_end       TIME         NOT NULL,
    weekly_target_hours DECIMAL(4,1) NOT NULL DEFAULT 35.0,
    notes               VARCHAR(160) NULL,
    created_by          INT UNSIGNED NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_office_requirement (semester_id, office_id),
    CONSTRAINT fk_officereq_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_officereq_office FOREIGN KEY (office_id) REFERENCES offices(id),
    CONSTRAINT fk_officereq_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_office_hours CHECK (operating_end > operating_start),
    CONSTRAINT chk_office_required CHECK (required_sa BETWEEN 1 AND 20)
) ENGINE=InnoDB;

CREATE TABLE assignment_reviews (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id   INT UNSIGNED NOT NULL,
    sa_profile_id INT UNSIGNED NOT NULL,
    decision      ENUM('CONTINUE','REASSIGN','POOL','HOLD') NOT NULL,
    reason        VARCHAR(200) NULL,
    decided_by    INT UNSIGNED NULL,
    decided_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_review (semester_id, sa_profile_id),
    INDEX idx_review_decision (semester_id, decision),
    CONSTRAINT fk_review_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_sa FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_user FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE matching_runs (
    id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id       INT UNSIGNED NOT NULL,
    pool_count        SMALLINT UNSIGNED NOT NULL DEFAULT 0,   
    room_slots        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    office_slots      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    recommended       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    needs_review      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    coverage_gaps     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    preserved_count   SMALLINT UNSIGNED NOT NULL DEFAULT 0,   
    run_by            INT UNSIGNED NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_run_semester (semester_id, created_at),
    CONSTRAINT fk_run_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_run_user FOREIGN KEY (run_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE match_slots (
    id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id                 INT UNSIGNED NOT NULL,
    requirement_type       ENUM('ROOM','OFFICE') NOT NULL,
    room_requirement_id    INT UNSIGNED NULL,
    office_requirement_id  INT UNSIGNED NULL,
    slot_no                TINYINT UNSIGNED NOT NULL DEFAULT 1,
    label                  VARCHAR(120) NOT NULL,             
    department             VARCHAR(40)  NOT NULL,
    day_of_week            ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NULL,  
    start_time             TIME         NULL,
    end_time               TIME         NULL,
    status                 ENUM('RECOMMENDED','REVIEW','COVERAGE_GAP') NOT NULL,
    decision               ENUM('PENDING','ACCEPTED','OVERRIDDEN') NOT NULL DEFAULT 'PENDING',
    assigned_sa_profile_id INT UNSIGNED NULL,
    override_reason        TEXT         NULL,
    decided_by             INT UNSIGNED NULL,
    decided_at             DATETIME     NULL,
    INDEX idx_slot_run (run_id, status),
    CONSTRAINT fk_slot_run FOREIGN KEY (run_id) REFERENCES matching_runs(id) ON DELETE CASCADE,
    CONSTRAINT fk_slot_room FOREIGN KEY (room_requirement_id) REFERENCES room_requirements(id) ON DELETE CASCADE,
    CONSTRAINT fk_slot_office FOREIGN KEY (office_requirement_id) REFERENCES office_requirements(id) ON DELETE CASCADE,
    CONSTRAINT fk_slot_sa FOREIGN KEY (assigned_sa_profile_id) REFERENCES sa_profiles(id) ON DELETE SET NULL,
    CONSTRAINT fk_slot_user FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE match_candidates (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    slot_id         INT UNSIGNED NOT NULL,
    sa_profile_id   INT UNSIGNED NOT NULL,
    rank_no         TINYINT UNSIGNED NOT NULL,
    score           DECIMAL(5,1) NOT NULL,
    duty_hours      DECIMAL(5,1) NOT NULL,      
    projected_hours DECIMAL(5,1) NOT NULL,      
    status          ENUM('RECOMMENDED','REVIEW') NOT NULL,
    checks          TEXT         NULL,          
    duty_pattern    TEXT         NULL,          
    UNIQUE KEY uq_candidate (slot_id, sa_profile_id),
    INDEX idx_candidate_rank (slot_id, rank_no),
    CONSTRAINT fk_candidate_slot FOREIGN KEY (slot_id) REFERENCES match_slots(id) ON DELETE CASCADE,
    CONSTRAINT fk_candidate_sa FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE schedule_publications (
    semester_id   INT UNSIGNED NOT NULL PRIMARY KEY,
    status        ENUM('DRAFT','REVIEW','FINALIZED','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    finalized_by  INT UNSIGNED NULL,
    finalized_at  DATETIME     NULL,
    published_by  INT UNSIGNED NULL,
    published_at  DATETIME     NULL,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_pub_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_pub_finalizer FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pub_publisher FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE schedule_assignments (
    id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    semester_id            INT UNSIGNED NOT NULL,
    sa_profile_id          INT UNSIGNED NOT NULL,
    requirement_type       ENUM('ROOM', 'OFFICE') NOT NULL DEFAULT 'ROOM',
    room_requirement_id    INT UNSIGNED NULL,
    office_requirement_id  INT UNSIGNED NULL,
    match_slot_id          INT UNSIGNED NULL,
    department             VARCHAR(50)  NOT NULL,
    location               VARCHAR(100) NOT NULL,
    supervisor_id          INT UNSIGNED NULL,
    day_of_week            ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
    start_time             TIME         NOT NULL,
    end_time               TIME         NOT NULL,
    source                 ENUM('MATCHING','MANUAL','CHANGE') NOT NULL DEFAULT 'MANUAL',
    created_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sa_sem (semester_id, sa_profile_id),
    INDEX idx_sa_profile (sa_profile_id),
    INDEX idx_semester (semester_id),
    CONSTRAINT fk_sa_asg_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_sa_asg_profile FOREIGN KEY (sa_profile_id) REFERENCES sa_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;