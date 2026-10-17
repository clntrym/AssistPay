<?php
require __DIR__ . '/../_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
require_role($user, 'REGISTRAR', 'ADMIN');

$action = input()['action'] ?? '';

if ($action === 'list_pending') {
    $stmt = $pdo->query("
        SELECT d.id, d.file_name, d.file_size, d.status,
               DATE_FORMAT(d.created_at, '%b %d, %Y %h:%i %p') AS uploaded_at,
               s.student_id, s.student_number,
               CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS student_name,
               u.full_name AS uploaded_by
        FROM student_cor_documents d
        JOIN students s ON s.student_id = d.student_id
        LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE d.status = 'PENDING'
        ORDER BY d.id DESC
    ");
    respond(['success' => true, 'docs' => $stmt->fetchAll()]);
}

if ($action === 'get_detail') {
    $id = (int) (input()['id'] ?? 0);
    if (!$id) fail('Which document?', 422);

    $stmt = $pdo->prepare("
        SELECT d.id, d.file_name, d.file_size, d.status, d.student_id,
               DATE_FORMAT(d.created_at, '%b %d, %Y %h:%i %p') AS uploaded_at,
               s.student_number, s.curriculum_id, s.course_id,
               s.first_name, s.middle_name, s.last_name,
               CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS student_name,
               s.gender, s.contact_no, s.address,
               c.course_code
        FROM student_cor_documents d
        JOIN students s ON s.student_id = d.student_id
        JOIN courses c ON c.course_id = s.course_id
        WHERE d.id = ?
    ");
    $stmt->execute([$id]);
    $doc = $stmt->fetch() ?: fail('Document not found.', 404);

    $terms = $pdo->query(
        "SELECT term_id, school_year, semester FROM academic_terms ORDER BY school_year DESC, semester"
    )->fetchAll();

    // Fetch curriculum subjects for quick-lookup when registrar enters codes
    $stmt = $pdo->prepare("
        SELECT subject_id, subject_code, description, units, year_level, semester
        FROM subjects
        WHERE curriculum_id = ?
        ORDER BY subject_code
    ");
    $stmt->execute([$doc['curriculum_id']]);
    $subjects = $stmt->fetchAll();

    respond(['success' => true, 'doc' => $doc, 'terms' => $terms, 'subjects' => $subjects]);
}

if ($action === 'approve') {
    $in         = input();
    $corId      = (int) ($in['corId']      ?? 0);
    $studentId  = (int) ($in['studentId']  ?? 0);
    $refNo      = trim($in['referenceNo']  ?? '');
    $schoolYear = trim($in['schoolYear']   ?? '');
    $semester   = trim($in['semester']     ?? '');
    $subjects   = (array) ($in['subjects'] ?? []);
    $fees       = (array) ($in['fees']     ?? []);

    if (!$corId || !$studentId)    fail('Missing document or student.', 422);
    if (!$refNo)                   fail('Reference number is required.', 422);
    if (!$schoolYear || !$semester) fail('School year and semester are required.', 422);

    $stmt = $pdo->prepare('SELECT curriculum_id FROM students WHERE student_id = ?');
    $stmt->execute([$studentId]);
    $student = $stmt->fetch() ?: fail('Student not found.', 404);
    $curriculumId = $student['curriculum_id'];

    $pdo->beginTransaction();
    try {
        // 1. Find or create academic term
        $stmt = $pdo->prepare('SELECT term_id FROM academic_terms WHERE school_year = ? AND semester = ?');
        $stmt->execute([$schoolYear, $semester]);
        $term = $stmt->fetch();
        if ($term) {
            $termId = $term['term_id'];
        } else {
            $pdo->prepare('INSERT INTO academic_terms (school_year, semester, is_active) VALUES (?, ?, FALSE)')
                ->execute([$schoolYear, $semester]);
            $termId = (int) $pdo->lastInsertId();
        }

        // 2. Create or update enrollment
        $stmt = $pdo->prepare('SELECT enrollment_id FROM enrollments WHERE student_id = ? AND term_id = ?');
        $stmt->execute([$studentId, $termId]);
        $existing = $stmt->fetch();
        if ($existing) {
            $enrollmentId = $existing['enrollment_id'];
            $pdo->prepare("UPDATE enrollments SET reference_no=?, status='Enrolled' WHERE enrollment_id=?")
                ->execute([$refNo, $enrollmentId]);
        } else {
            $pdo->prepare("INSERT INTO enrollments (reference_no, student_id, term_id, status) VALUES (?, ?, ?, 'Enrolled')")
                ->execute([$refNo, $studentId, $termId]);
            $enrollmentId = (int) $pdo->lastInsertId();
        }

        // 3. Process subjects
        foreach ($subjects as $row) {
            $code       = strtoupper(trim($row['code']        ?? ''));
            $desc       = trim($row['description'] ?? '');
            $units      = max(0.5, floatval($row['units']     ?? 3));
            $type       = in_array($row['type'] ?? '', ['Lec','Lab','Lec/Lab']) ? $row['type'] : 'Lec';
            $days       = trim($row['days']       ?? '');
            $startTime  = trim($row['start_time'] ?? '08:00');
            $endTime    = trim($row['end_time']   ?? '09:00');
            $section    = trim($row['section']    ?? '');
            $room       = trim($row['room']       ?? '');
            $instructor = trim($row['instructor'] ?? '');

            if (!$code && !$desc) continue;

            // Find or create subject in the student's curriculum
            $stmt = $pdo->prepare('SELECT subject_id FROM subjects WHERE curriculum_id = ? AND subject_code = ?');
            $stmt->execute([$curriculumId, $code]);
            $subject = $stmt->fetch();
            if ($subject) {
                $subjectId = $subject['subject_id'];
            } else {
                $pdo->prepare('INSERT INTO subjects (curriculum_id, subject_code, description, units, year_level, semester) VALUES (?, ?, ?, ?, 1, 1)')
                    ->execute([$curriculumId, $code, $desc ?: $code, $units]);
                $subjectId = (int) $pdo->lastInsertId();
            }

            // Find or create subject schedule for this term
            $stmt = $pdo->prepare(
                'SELECT schedule_id FROM subject_schedules
                  WHERE term_id=? AND subject_id=? AND type=? AND days=? AND start_time=? AND section_code=?'
            );
            $stmt->execute([$termId, $subjectId, $type, $days, $startTime, $section]);
            $sched = $stmt->fetch();
            if ($sched) {
                $scheduleId = $sched['schedule_id'];
            } else {
                $pdo->prepare(
                    'INSERT INTO subject_schedules
                     (term_id, subject_id, section_code, type, units, days, start_time, end_time, room, instructor)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([$termId, $subjectId, $section, $type, $units, $days, $startTime, $endTime, $room, $instructor]);
                $scheduleId = (int) $pdo->lastInsertId();
            }

            // Link to enrollment
            $stmt = $pdo->prepare('SELECT detail_id FROM enrollment_details WHERE enrollment_id=? AND schedule_id=?');
            $stmt->execute([$enrollmentId, $scheduleId]);
            if (!$stmt->fetch()) {
                $pdo->prepare('INSERT INTO enrollment_details (enrollment_id, schedule_id) VALUES (?, ?)')
                    ->execute([$enrollmentId, $scheduleId]);
            }
        }

        // 4. Save fee assessment
        $tf  = floatval($fees['tuition_fee']         ?? 0);
        $lf  = floatval($fees['lab_fee']             ?? 0);
        $mf  = floatval($fees['misc_fee']            ?? 0);
        $lms = floatval($fees['lms_fee']             ?? 0);
        $ns  = floatval($fees['nstp_fee']            ?? 0);
        $omr = floatval($fees['omr_fee']             ?? 0);
        $ct  = $tf + $lf + $mf + $lms + $ns + $omr;
        $ic  = floatval($fees['installment_charge']  ?? 0);
        $it  = $ct + $ic;

        $stmt = $pdo->prepare('SELECT assessment_id FROM fee_assessments WHERE enrollment_id=?');
        $stmt->execute([$enrollmentId]);
        if ($stmt->fetch()) {
            $pdo->prepare(
                'UPDATE fee_assessments SET tuition_fee=?, lab_fee=?, misc_fee=?, lms_fee=?, nstp_fee=?, omr_fee=?,
                 cash_total=?, installment_charge=?, installment_total=? WHERE enrollment_id=?'
            )->execute([$tf, $lf, $mf, $lms, $ns, $omr, $ct, $ic, $it, $enrollmentId]);
        } else {
            $pdo->prepare(
                'INSERT INTO fee_assessments
                 (enrollment_id, tuition_fee, lab_fee, misc_fee, lms_fee, nstp_fee, omr_fee, cash_total, installment_charge, installment_total)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$enrollmentId, $tf, $lf, $mf, $lms, $ns, $omr, $ct, $ic, $it]);
        }

        // 5. Mark COR as APPROVED
        $pdo->prepare("UPDATE student_cor_documents SET status='APPROVED' WHERE id=?")->execute([$corId]);
        audit('APPROVE_COR', "COR $corId approved → enrollment $enrollmentId", $user['id']);

        $pdo->commit();
        respond(['success' => true, 'enrollmentId' => $enrollmentId]);
    } catch (Exception $e) {
        $pdo->rollBack();
        fail('Could not save the enrollment: ' . $e->getMessage(), 500);
    }
}

if ($action === 'reject') {
    $corId = (int) (input()['corId'] ?? 0);
    if (!$corId) fail('Which document?', 422);
    $pdo->prepare("UPDATE student_cor_documents SET status='REJECTED' WHERE id=?")->execute([$corId]);
    audit('REJECT_COR', "COR $corId rejected", $user['id']);
    respond(['success' => true]);
}

fail('Unknown action.', 400);
