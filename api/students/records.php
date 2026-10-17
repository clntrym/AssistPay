<?php
require __DIR__ . '/../_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
require_role($user, 'REGISTRAR', 'ADMIN');

$action = input()['action'] ?? '';

if ($action === 'get_detail') {
    $studentId = (int) (input()['studentId'] ?? 0);
    if (!$studentId) fail('Which student?', 422);

    $activeTerm = $pdo->query("SELECT term_id, school_year, semester FROM academic_terms WHERE is_active = 1 LIMIT 1")->fetch();
    if (!$activeTerm) {
        $sem = $pdo->query("SELECT * FROM semesters WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1")->fetch();
        if ($sem) {
            $semLabel = ($sem['term'] === '1ST') ? '1st Semester' : (($sem['term'] === '2ND') ? '2nd Semester' : 'Summer');
            $stmt = $pdo->prepare("SELECT term_id, school_year, semester FROM academic_terms WHERE school_year = ? AND semester = ? LIMIT 1");
            $stmt->execute([$sem['academic_year'], $semLabel]);
            $activeTerm = $stmt->fetch();
        }
    }
    $activeTermId = $activeTerm ? (int) $activeTerm['term_id'] : 0;

    $stmt = $pdo->prepare("
        SELECT s.*, c.course_code, c.course_title,
               (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.student_id) AS enrollment_count,
               (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.student_id AND e.term_id = ? AND e.status = 'Enrolled') AS current_term_enrolled,
               (SELECT MAX(sub.year_level) 
                  FROM enrollment_details ed 
                  JOIN subject_schedules ss ON ss.schedule_id = ed.schedule_id 
                  JOIN subjects sub ON sub.subject_id = ss.subject_id 
                  JOIN enrollments e ON e.enrollment_id = ed.enrollment_id
                 WHERE e.student_id = s.student_id AND e.term_id = ?) as curriculum_enrolled_year,
               (SELECT COUNT(*) FROM student_cor_documents d WHERE d.student_id = s.student_id AND d.status = 'PENDING') AS pending_cor_count,
               (SELECT COUNT(*) FROM student_cor_documents d WHERE d.student_id = s.student_id AND d.status = 'APPROVED') AS approved_cor_count
        FROM students s
        JOIN courses c ON c.course_id = s.course_id
        WHERE s.student_id = ?
    ");
    $stmt->execute([$activeTermId, $activeTermId, $studentId]);
    $student = $stmt->fetch() ?: fail('Student not found.', 404);

    if ((int) $student['current_term_enrolled'] > 0) {
        $currentStatus = 'Enrolled';
    } elseif ((int) $student['pending_cor_count'] > 0) {
        $currentStatus = 'Pending Review';
    } else {
        $currentStatus = 'Not Enrolled';
    }
    $student['current_enrollment_status'] = $currentStatus;

    $yearMap = [1 => '1st Year', 2 => '2nd Year', 3 => '3rd Year', 4 => '4th Year', 5 => '5th Year'];
    if (!empty($student['curriculum_enrolled_year']) && isset($yearMap[(int)$student['curriculum_enrolled_year']])) {
        $yearLevel = $yearMap[(int)$student['curriculum_enrolled_year']];
    } elseif (!empty($student['year_level'])) {
        $yearLevel = $student['year_level'];
    } else {
        $yearLevel = '1st Year';
    }
    $student['year'] = $yearLevel;
    $student['year_level'] = $yearLevel;

    respond(['success' => true, 'student' => $student, 'activeTerm' => $activeTerm]);
}

if ($action === 'update_info') {
    $studentId = (int) (input()['studentId'] ?? 0);
    $firstName = trim(input()['firstName'] ?? '');
    $middleName = trim(input()['middleName'] ?? '');
    $lastName = trim(input()['lastName'] ?? '');
    $suffix = trim(input()['suffix'] ?? '');
    $address = trim(input()['address'] ?? '');
    $zipCode = trim(input()['zipCode'] ?? '');
    $status = trim(input()['status'] ?? 'Active');

    if (!$studentId) fail('Which student?', 422);
    if (!$firstName || !$lastName) fail('First and last name required.', 422);

    if (!in_array($status, ['Active', 'Transfer', 'Graduated', 'Dropped', 'On-Leave'])) {
        fail('Invalid status.', 422);
    }

    $stmt = $pdo->prepare('SELECT student_id FROM students WHERE student_id = ?');
    $stmt->execute([$studentId]);
    if (!$stmt->fetch()) fail('Student not found.', 404);

    $pdo->prepare(
        'UPDATE students SET first_name=?, middle_name=?, last_name=?, suffix=?, address=?, zip_code=?, status=? WHERE student_id=?'
    )->execute([$firstName, $middleName, $lastName, $suffix, $address, $zipCode, $status, $studentId]);

    audit('UPDATE_STUDENT', "Updated student $studentId info and status to $status", $user['id']);
    respond(['success' => true]);
}

fail('Unknown action.', 400);
