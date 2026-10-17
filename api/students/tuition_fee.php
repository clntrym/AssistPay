<?php
require __DIR__ . '/../_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
require_role($user, 'REGISTRAR', 'ADMIN');

$action = input()['action'] ?? '';

if ($action === 'list_students') {
    $termId = (int) (input()['termId'] ?? 0);

    $stmt = $pdo->prepare("
        SELECT DISTINCT
            s.student_id, s.student_number,
            CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS name,
            c.course_code,
            (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.student_id AND e.term_id = ?) AS has_enrollment
        FROM students s
        JOIN courses c ON c.course_id = s.course_id
        ORDER BY s.last_name, s.first_name
    ");
    $stmt->execute([$termId]);
    respond(['success' => true, 'students' => $stmt->fetchAll()]);
}

if ($action === 'get_assessment') {
    $enrollmentId = (int) (input()['enrollmentId'] ?? 0);
    if (!$enrollmentId) fail('Which enrollment?', 422);

    $stmt = $pdo->prepare("
        SELECT e.enrollment_id, e.reference_no, e.student_id,
               s.student_number,
               CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS student_name,
               c.course_code,
               t.school_year, t.semester,
               fa.tuition_fee, fa.lab_fee, fa.misc_fee, fa.lms_fee, fa.nstp_fee, fa.omr_fee,
               fa.cash_total, fa.installment_charge, fa.installment_total
        FROM enrollments e
        JOIN students s ON s.student_id = e.student_id
        JOIN courses c ON c.course_id = s.course_id
        JOIN academic_terms t ON t.term_id = e.term_id
        LEFT JOIN fee_assessments fa ON fa.enrollment_id = e.enrollment_id
        WHERE e.enrollment_id = ?
    ");
    $stmt->execute([$enrollmentId]);
    $data = $stmt->fetch() ?: fail('Enrollment not found.', 404);

    respond(['success' => true, 'enrollment' => $data]);
}

fail('Unknown action.', 400);
