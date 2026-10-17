<?php
require __DIR__ . '/../_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
require_role($user, 'REGISTRAR', 'ADMIN');

// Self-install school_years table
$pdo->exec("CREATE TABLE IF NOT EXISTS school_years (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_year     VARCHAR(20) UNIQUE NOT NULL,
    is_active       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

// Self-install tuition fees table
$pdo->exec("CREATE TABLE IF NOT EXISTS tuition_fees (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id      INT UNSIGNED NOT NULL,
    school_year     VARCHAR(20) NOT NULL,
    semester        VARCHAR(50) NOT NULL,
    tuition_fee     DECIMAL(10,2) DEFAULT 0,
    lab_fee         DECIMAL(10,2) DEFAULT 0,
    misc_fee        DECIMAL(10,2) DEFAULT 0,
    lms_fee         DECIMAL(10,2) DEFAULT 0,
    nstp_fee        DECIMAL(10,2) DEFAULT 0,
    omr_fee         DECIMAL(10,2) DEFAULT 0,
    cash_total      DECIMAL(10,2) DEFAULT 0,
    installment_charge DECIMAL(10,2) DEFAULT 0,
    installment_total DECIMAL(10,2) DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tuition_student_term (student_id, school_year, semester),
    CONSTRAINT fk_tuition_student FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$action = input()['action'] ?? '';

if ($action === 'get_school_years') {
    $stmt = $pdo->query("SELECT school_year FROM school_years ORDER BY school_year DESC");
    respond(['success' => true, 'school_years' => $stmt->fetchAll(PDO::FETCH_COLUMN)]);
}

if ($action === 'list_students') {
    $stmt = $pdo->query("
        SELECT DISTINCT
            s.student_id AS id,
            s.student_number,
            CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS name,
            c.course_code AS course,
            (SELECT COUNT(*) FROM tuition_fees t WHERE t.student_id = s.student_id) AS fee_count
        FROM students s
        LEFT JOIN courses c ON c.course_id = s.course_id
        ORDER BY s.last_name, s.first_name
    ");
    respond(['success' => true, 'students' => $stmt->fetchAll()]);
}

if ($action === 'list_for_student') {
    $studentId = (int) (input()['studentId'] ?? 0);
    if (!$studentId) fail('Which student?', 422);

    $stmt = $pdo->prepare("
        SELECT * FROM tuition_fees
        WHERE student_id = ?
        ORDER BY school_year DESC, FIELD(semester, '1st Semester', '2nd Semester', 'Summer')
    ");
    $stmt->execute([$studentId]);
    respond(['success' => true, 'fees' => $stmt->fetchAll()]);
}

if ($action === 'get_detail') {
    $feeId = (int) (input()['feeId'] ?? 0);
    if (!$feeId) fail('Which fee?', 422);

    $stmt = $pdo->prepare("
        SELECT * FROM tuition_fees WHERE id = ?
    ");
    $stmt->execute([$feeId]);
    $fee = $stmt->fetch() ?: fail('Fee record not found.', 404);

    respond(['success' => true, 'fee' => $fee]);
}

if ($action === 'save_fee') {
    $studentId = (int) (input()['studentId'] ?? 0);
    $schoolYear = trim(input()['schoolYear'] ?? '');
    $semester = trim(input()['semester'] ?? '');
    $tuitionFee = floatval(input()['tuitionFee'] ?? 0);
    $labFee = floatval(input()['labFee'] ?? 0);
    $miscFee = floatval(input()['miscFee'] ?? 0);
    $lmsFee = floatval(input()['lmsFee'] ?? 0);
    $nstpFee = floatval(input()['nstpFee'] ?? 0);
    $omrFee = floatval(input()['omrFee'] ?? 0);
    $installmentCharge = floatval(input()['installmentCharge'] ?? 0);

    if (!$studentId || !$schoolYear || !$semester) fail('Student, school year, and semester required.', 422);

    $cashTotal = $tuitionFee + $labFee + $miscFee + $lmsFee + $nstpFee + $omrFee;
    $installmentTotal = $cashTotal + $installmentCharge;

    // Check if student exists
    $stmt = $pdo->prepare('SELECT student_id FROM students WHERE student_id = ?');
    $stmt->execute([$studentId]);
    if (!$stmt->fetch()) fail('Student not found.', 404);

    // Insert or update
    $stmt = $pdo->prepare('SELECT id FROM tuition_fees WHERE student_id = ? AND school_year = ? AND semester = ?');
    $stmt->execute([$studentId, $schoolYear, $semester]);
    if ($stmt->fetch()) {
        $pdo->prepare('
            UPDATE tuition_fees
            SET tuition_fee=?, lab_fee=?, misc_fee=?, lms_fee=?, nstp_fee=?, omr_fee=?,
                cash_total=?, installment_charge=?, installment_total=?
            WHERE student_id=? AND school_year=? AND semester=?
        ')->execute([$tuitionFee, $labFee, $miscFee, $lmsFee, $nstpFee, $omrFee,
                     $cashTotal, $installmentCharge, $installmentTotal,
                     $studentId, $schoolYear, $semester]);
    } else {
        $pdo->prepare('
            INSERT INTO tuition_fees
            (student_id, school_year, semester, tuition_fee, lab_fee, misc_fee, lms_fee, nstp_fee, omr_fee,
             cash_total, installment_charge, installment_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ')->execute([$studentId, $schoolYear, $semester, $tuitionFee, $labFee, $miscFee, $lmsFee, $nstpFee, $omrFee,
                     $cashTotal, $installmentCharge, $installmentTotal]);
    }

    audit('SAVE_TUITION_FEE', "Tuition fees saved for student $studentId - $schoolYear $semester", $user['id']);
    respond(['success' => true]);
}

if ($action === 'delete_fee') {
    $feeId = (int) (input()['feeId'] ?? 0);
    if (!$feeId) fail('Which fee?', 422);

    $stmt = $pdo->prepare('SELECT student_id, school_year, semester FROM tuition_fees WHERE id = ?');
    $stmt->execute([$feeId]);
    $fee = $stmt->fetch() ?: fail('Fee record not found.', 404);

    $pdo->prepare('DELETE FROM tuition_fees WHERE id = ?')->execute([$feeId]);
    audit('DELETE_TUITION_FEE', "Tuition fee deleted for student {$fee['student_id']} - {$fee['school_year']} {$fee['semester']}", $user['id']);
    respond(['success' => true]);
}

fail('Unknown action.', 400);
