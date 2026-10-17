<?php
/**
 * One-time seed: insert enrollment + tuition data for Daizy Salva Magpantay
 * Run: php database/seed-daizy.php
 */
require __DIR__ . '/../api/_bootstrap.php';

$studentNumber = '2024-58030';
$schoolYear    = '2026-2027';
$semester      = '1st Semester';

// 1. Find the student
$stmt = $pdo->prepare('SELECT student_id, curriculum_id FROM students WHERE student_number = ?');
$stmt->execute([$studentNumber]);
$student = $stmt->fetch();
if (!$student) { echo "Student $studentNumber not found.\n"; exit(1); }
$studentId    = $student['student_id'];
$curriculumId = $student['curriculum_id'];
echo "Found student ID $studentId (curriculum $curriculumId)\n";

// 2. Ensure academic_term exists
$pdo->exec("INSERT IGNORE INTO academic_terms (school_year, semester, is_active)
            VALUES ('$schoolYear', '$semester', TRUE)");
$termId = $pdo->query("SELECT term_id FROM academic_terms
                        WHERE school_year='$schoolYear' AND semester='$semester'")->fetchColumn();
echo "Academic term ID: $termId\n";

// 3. Ensure subjects exist in the curriculum
$subjectDefs = [
    ['IT 301', 'Human Computer Interaction 2',          3, 3, 1],
    ['IT 302', 'Systems Integration and Architecture 1', 3, 3, 1],
    ['IT 303', 'Networking 2',                          3, 3, 1],
    ['IT 304', 'Quantitative Method',                   3, 3, 1],
    ['IT 305', 'Social Issues and Professional Practice',3, 3, 1],
    ['IT 306', 'Integrative Programming Technologies 2', 3, 3, 1],
];

$subjectIds = [];
foreach ($subjectDefs as [$code, $desc, $units, $year, $sem]) {
    $row = $pdo->prepare("SELECT subject_id FROM subjects
                          WHERE curriculum_id=? AND subject_code=?");
    $row->execute([$curriculumId, $code]);
    $id = $row->fetchColumn();
    if (!$id) {
        $pdo->prepare("INSERT INTO subjects (curriculum_id, subject_code, description, units, year_level, semester)
                        VALUES (?, ?, ?, ?, ?, ?)")
             ->execute([$curriculumId, $code, $desc, $units, $year, $sem]);
        $id = $pdo->lastInsertId();
        echo "  Created subject: $code ($desc) → ID $id\n";
    } else {
        echo "  Subject exists: $code → ID $id\n";
    }
    $subjectIds[$code] = $id;
}

// 4. Create subject_schedules (10 rows from the COR)
$schedules = [
    ['IT 306', 'BSIT-3A', 'Lec', 2.00, 'F',   '12:00:00', '14:00:00', '2211', 'TBA'],
    ['IT 301', 'BSIT-3A', 'Lec', 2.00, 'F',   '17:00:00', '19:00:00', '2206', 'TBA'],
    ['IT 303', 'BSIT-3A', 'Lec', 2.00, 'M',   '07:00:00', '09:00:00', '2310', 'TBA'],
    ['IT 305', 'BSIT-3A', 'Lec', 3.00, 'MWF', '11:00:00', '12:00:00', '1401', 'TBA'],
    ['IT 304', 'BSIT-3A', 'Lec', 3.00, 'S',   '10:00:00', '13:00:00', '5301', 'TBA'],
    ['IT 306', 'BSIT-3A', 'Lab', 1.00, 'S',   '14:00:00', '17:00:00', '2211', 'TBA'],
    ['IT 301', 'BSIT-3A', 'Lab', 1.00, 'S',   '19:00:00', '22:00:00', '1108', 'TBA'],
    ['IT 303', 'BSIT-3A', 'Lab', 1.00, 'T',   '09:00:00', '12:00:00', '2304', 'TBA'],
    ['IT 302', 'BSIT-3A', 'Lab', 1.00, 'TH',  '17:00:00', '19:00:00', '1107', 'TBA'],
    ['IT 302', 'BSIT-3A', 'Lec', 2.00, 'W',   '14:00:00', '17:00:00', '1108', 'TBA'],
];

$scheduleIds = [];
foreach ($schedules as [$code, $section, $type, $units, $days, $start, $end, $room, $instructor]) {
    $subjectId = $subjectIds[$code];
    // Check if already exists
    $check = $pdo->prepare("SELECT schedule_id FROM subject_schedules
                            WHERE term_id=? AND subject_id=? AND type=? AND days=? AND start_time=?");
    $check->execute([$termId, $subjectId, $type, $days, $start]);
    $existingId = $check->fetchColumn();
    if ($existingId) {
        $scheduleIds[] = $existingId;
        echo "  Schedule exists: $code $type $days → ID $existingId\n";
    } else {
        $pdo->prepare("INSERT INTO subject_schedules
                        (term_id, subject_id, section_code, type, units, days, start_time, end_time, room, instructor)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
             ->execute([$termId, $subjectId, $section, $type, $units, $days, $start, $end, $room, $instructor]);
        $id = $pdo->lastInsertId();
        $scheduleIds[] = $id;
        echo "  Created schedule: $code $type $days → ID $id\n";
    }
}

// 5. Create enrollment
$refNo = 'ENR-' . $schoolYear . '-' . str_pad($studentId, 5, '0', STR_PAD_LEFT);
$check = $pdo->prepare("SELECT enrollment_id FROM enrollments WHERE student_id=? AND term_id=?");
$check->execute([$studentId, $termId]);
$enrollmentId = $check->fetchColumn();
if (!$enrollmentId) {
    $pdo->prepare("INSERT INTO enrollments (reference_no, student_id, term_id, status)
                    VALUES (?, ?, ?, 'Enrolled')")
         ->execute([$refNo, $studentId, $termId]);
    $enrollmentId = $pdo->lastInsertId();
    echo "Created enrollment ID: $enrollmentId (ref: $refNo)\n";
} else {
    echo "Enrollment already exists: ID $enrollmentId\n";
}

// 6. Link enrollment to schedules
foreach ($scheduleIds as $schedId) {
    $pdo->exec("INSERT IGNORE INTO enrollment_details (enrollment_id, schedule_id)
                VALUES ($enrollmentId, $schedId)");
}
echo "Linked " . count($scheduleIds) . " schedule(s) to enrollment.\n";

// 7. Insert fee_assessment
$fees = [
    'tuition_fee'        => 11627.10,
    'lab_fee'            => 4104.00,
    'misc_fee'           => 4743.49,
    'lms_fee'            => 2053.20,
    'nstp_fee'           => 0.00,
    'omr_fee'            => 278.40,
    'cash_total'         => 22806.19,
    'installment_charge' => 1825.95,
    'installment_total'  => 24632.14,
];

$check = $pdo->prepare("SELECT assessment_id FROM fee_assessments WHERE enrollment_id=?");
$check->execute([$enrollmentId]);
if (!$check->fetchColumn()) {
    $pdo->prepare("INSERT INTO fee_assessments
                    (enrollment_id, tuition_fee, lab_fee, misc_fee, lms_fee, nstp_fee, omr_fee,
                     cash_total, installment_charge, installment_total)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
         ->execute([$enrollmentId, $fees['tuition_fee'], $fees['lab_fee'], $fees['misc_fee'],
                    $fees['lms_fee'], $fees['nstp_fee'], $fees['omr_fee'],
                    $fees['cash_total'], $fees['installment_charge'], $fees['installment_total']]);
    echo "Created fee_assessment for enrollment $enrollmentId\n";
} else {
    echo "Fee assessment already exists.\n";
}

// 8. Insert into tuition_fees table (the standalone one for Student Records modal)
$pdo->exec("CREATE TABLE IF NOT EXISTS tuition_fees (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id INT UNSIGNED NOT NULL,
    school_year VARCHAR(20) NOT NULL,
    semester VARCHAR(50) NOT NULL,
    tuition_fee DECIMAL(10,2) DEFAULT 0,
    lab_fee DECIMAL(10,2) DEFAULT 0,
    misc_fee DECIMAL(10,2) DEFAULT 0,
    lms_fee DECIMAL(10,2) DEFAULT 0,
    nstp_fee DECIMAL(10,2) DEFAULT 0,
    omr_fee DECIMAL(10,2) DEFAULT 0,
    cash_total DECIMAL(10,2) DEFAULT 0,
    installment_charge DECIMAL(10,2) DEFAULT 0,
    installment_total DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tuition_student_term (student_id, school_year, semester)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$pdo->prepare("INSERT INTO tuition_fees
    (student_id, school_year, semester, tuition_fee, lab_fee, misc_fee, lms_fee, nstp_fee, omr_fee,
     cash_total, installment_charge, installment_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
        tuition_fee=VALUES(tuition_fee), lab_fee=VALUES(lab_fee), misc_fee=VALUES(misc_fee),
        lms_fee=VALUES(lms_fee), nstp_fee=VALUES(nstp_fee), omr_fee=VALUES(omr_fee),
        cash_total=VALUES(cash_total), installment_charge=VALUES(installment_charge),
        installment_total=VALUES(installment_total)")
     ->execute([$studentId, $schoolYear, $semester,
                $fees['tuition_fee'], $fees['lab_fee'], $fees['misc_fee'],
                $fees['lms_fee'], $fees['nstp_fee'], $fees['omr_fee'],
                $fees['cash_total'], $fees['installment_charge'], $fees['installment_total']]);
echo "Inserted tuition_fees for $schoolYear $semester\n";

// 9. Ensure school_years table has this year
$pdo->exec("CREATE TABLE IF NOT EXISTS school_years (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_year VARCHAR(20) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
$pdo->exec("INSERT IGNORE INTO school_years (school_year, is_active) VALUES ('$schoolYear', TRUE)");

echo "\nDone! Daizy ($studentNumber) now has:\n";
echo "  - Enrollment for $schoolYear $semester with 10 subject schedules\n";
echo "  - Fee assessment: Cash Total ₱22,806.19 / Installment Total ₱24,632.14\n";
echo "  - Tuition fees record in tuition_fees table\n";
