<?php
require __DIR__ . '/../_bootstrap.php';
require_once __DIR__ . '/../_sa.php';
require_once __DIR__ . '/../_scheduling.php';
require_once __DIR__ . '/../_matching.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
require_role($user, 'REGISTRAR', 'ADMIN');

$action = input()['action'] ?? '';

if ($action === 'list_enrolled') {
    $stmt = $pdo->query("
        SELECT
            s.student_id AS id,
            s.student_number,
            CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS name,
            c.course_code AS course,
            (SELECT ss.section_code 
               FROM enrollment_details ed 
               JOIN subject_schedules ss ON ss.schedule_id = ed.schedule_id 
              WHERE ed.enrollment_id = e.enrollment_id 
              LIMIT 1) AS section,
            e.reference_no,
            e.enrollment_id,
            t.school_year,
            t.semester,
            e.status AS enrollment_status,
            DATE_FORMAT(e.enrollment_date, '%b %d, %Y') AS enrollment_date,
            (SELECT COUNT(*) FROM student_cor_documents d WHERE d.student_id = s.student_id) AS cor_count
        FROM students s
        LEFT JOIN courses c ON c.course_id = s.course_id
        LEFT JOIN enrollments e ON e.student_id = s.student_id
        LEFT JOIN academic_terms t ON t.term_id = e.term_id
        ORDER BY s.last_name, s.first_name, e.enrollment_id DESC
    ");
    respond(['success' => true, 'students' => $stmt->fetchAll()]);
}

if ($action === 'get_enrollment') {
    $enrollmentId = (int) (input()['enrollmentId'] ?? 0);
    if (!$enrollmentId) fail('Which enrollment?', 422);

    $stmt = $pdo->prepare("
        SELECT e.*, t.school_year, t.semester,
               s.student_number, s.student_id,
               CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS student_name,
               CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS name,
               s.gender, s.contact_no, s.address,
               c.course_code AS course,
               (SELECT ss.section_code 
                  FROM enrollment_details ed 
                  JOIN subject_schedules ss ON ss.schedule_id = ed.schedule_id 
                 WHERE ed.enrollment_id = e.enrollment_id 
                 LIMIT 1) AS section
        FROM enrollments e
        JOIN students s ON s.student_id = e.student_id
        JOIN academic_terms t ON t.term_id = e.term_id
        JOIN courses c ON c.course_id = s.course_id
        WHERE e.enrollment_id = ?
    ");
    $stmt->execute([$enrollmentId]);
    $enroll = $stmt->fetch() ?: fail('Enrollment not found.', 404);

    $details = $pdo->prepare("
        SELECT ed.detail_id, ss.schedule_id, ss.section_code, ss.type, ss.units, ss.days,
               TIME_FORMAT(ss.start_time, '%h:%i %p') AS start_time,
               TIME_FORMAT(ss.end_time, '%h:%i %p') AS end_time,
               ss.room, ss.instructor,
               sub.subject_id, sub.subject_code, sub.description, sub.classification
        FROM enrollment_details ed
        JOIN subject_schedules ss ON ss.schedule_id = ed.schedule_id
        JOIN subjects sub ON sub.subject_id = ss.subject_id
        WHERE ed.enrollment_id = ?
        ORDER BY ss.days, ss.start_time
    ");
    $details->execute([$enrollmentId]);
    $subjects = $details->fetchAll();

    $fees = $pdo->prepare("SELECT * FROM fee_assessments WHERE enrollment_id = ?");
    $fees->execute([$enrollmentId]);
    $assessment = $fees->fetch() ?: null;

    // COR documents for this student
    $cors = $pdo->prepare("
        SELECT d.id, d.file_name, d.file_size, d.mime_type,
               DATE_FORMAT(d.created_at, '%b %d, %Y %h:%i %p') AS uploaded_at,
               u.full_name AS uploaded_by
        FROM student_cor_documents d
        LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE d.student_id = ?
        ORDER BY d.id DESC
    ");
    $cors->execute([$enroll['student_id']]);
    $corDocs = $cors->fetchAll();

    respond(['success' => true, 'enrollment' => $enroll, 'subjects' => $subjects,
             'assessment' => $assessment, 'corDocs' => $corDocs]);
}

if ($action === 'list_available_schedules') {
    $enrollmentId = (int) (input()['enrollmentId'] ?? 0);
    if (!$enrollmentId) fail('Which enrollment?', 422);

    $stmt = $pdo->prepare("SELECT term_id FROM enrollments WHERE enrollment_id = ?");
    $stmt->execute([$enrollmentId]);
    $termId = $stmt->fetchColumn();
    if (!$termId) fail('Enrollment not found.', 404);

    $stmt = $pdo->prepare("
        SELECT ss.schedule_id, ss.section_code, ss.type, ss.units, ss.days,
               TIME_FORMAT(ss.start_time, '%h:%i %p') AS start_time,
               TIME_FORMAT(ss.end_time, '%h:%i %p') AS end_time,
               ss.room, ss.instructor,
               sub.subject_id, sub.subject_code, sub.description, sub.classification
        FROM subject_schedules ss
        JOIN subjects sub ON sub.subject_id = ss.subject_id
        WHERE ss.term_id = ?
          AND ss.schedule_id NOT IN (
              SELECT ed.schedule_id FROM enrollment_details ed WHERE ed.enrollment_id = ?
          )
        ORDER BY sub.subject_code, ss.type
    ");
    $stmt->execute([$termId, $enrollmentId]);
    respond(['success' => true, 'schedules' => $stmt->fetchAll()]);
}

function notify_coordinator_if_sa(int $enrollmentId, string $subjectDetail, string $changeType, string $reason, array $user): array {
    global $pdo;
    $stmt = $pdo->prepare('
        SELECT e.student_id, s.student_number, s.first_name, s.last_name,
               p.id AS sa_profile_id, p.semester_id
        FROM enrollments e
        JOIN students s ON s.student_id = e.student_id
        JOIN sa_profiles p ON p.student_id = s.student_number AND p.sa_status = "ACTIVE"
        WHERE e.enrollment_id = ?
        LIMIT 1
    ');
    $stmt->execute([$enrollmentId]);
    $sa = $stmt->fetch();
    if (!$sa) return ['isSa' => false, 'clashes' => []];

    // Re-sync class_schedules for this S.A. directly from updated Registrar enrollment
    sync_sa_from_registrar((int) $sa['sa_profile_id'], true);

    // Check if any duty clash exists
    $clashes = duty_class_clashes((int) $sa['semester_id'], (int) $sa['sa_profile_id']);
    $saName = trim($sa['first_name'] . ' ' . $sa['last_name']);
    $clashNotice = !empty($clashes) ? ' [WARNING: Conflict detected with current duty schedule!]' : '';
    $notifMsg = "The Registrar updated the class schedule of {$saName} ({$subjectDetail}). Reason: {$reason}.{$clashNotice} Please check the duty schedule for possible conflicts.";

    $admins = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN'")->fetchAll(PDO::FETCH_COLUMN);
    $targetLink = '#/admin/sa-management/' . (int) $sa['sa_profile_id'] . '?tab=CLASSES';
    foreach ($admins as $adminId) {
        $pdo->prepare('
            INSERT INTO notifications (user_id, sender_id, type, title, message, link, is_read, created_at)
            VALUES (?, ?, "CLASS_SCHEDULE_CHANGED", "Class Schedule Updated by Registrar", ?, ?, 0, NOW())
        ')->execute([$adminId, $user['id'], $notifMsg, $targetLink]);
    }

    return ['isSa' => true, 'clashes' => $clashes, 'saName' => $saName];
}

function to_schedule_time_str(string $val): string {
    $val = trim($val);
    if (preg_match('/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i', $val, $m)) {
        $h = (int) $m[1];
        $min = (int) $m[2];
        $ampm = strtolower($m[3] ?? '');
        if ($ampm === 'pm' && $h < 12) $h += 12;
        if ($ampm === 'am' && $h === 12) $h = 0;
        return sprintf('%02d:%02d:00', $h, $min);
    }
    $ts = strtotime($val);
    return $ts ? date('H:i:s', $ts) : '00:00:00';
}

if ($action === 'update_subject_schedule') {
    $in = input();
    $enrollmentId = (int) ($in['enrollmentId'] ?? 0);
    $detailId     = (int) ($in['detailId'] ?? 0);
    $scheduleId   = (int) ($in['scheduleId'] ?? 0);
    $days         = trim((string) ($in['days'] ?? ''));
    $startTimeRaw = trim((string) ($in['startTime'] ?? ''));
    $endTimeRaw   = trim((string) ($in['endTime'] ?? ''));
    $room         = trim((string) ($in['room'] ?? ''));
    $sectionCode  = trim((string) ($in['section'] ?? ''));
    $type         = trim((string) ($in['type'] ?? 'Lec'));
    $reason       = trim((string) ($in['reason'] ?? ''));

    if (!$enrollmentId || !$detailId || !$scheduleId) fail('Missing schedule identifiers.', 422);
    if ($days === '') fail('Choose or enter schedule days.', 422);
    if ($startTimeRaw === '') fail('Enter start time.', 422);
    if ($endTimeRaw === '') fail('Enter end time.', 422);
    if (mb_strlen($reason) < 3) fail('Please provide a reason for this schedule change (at least 3 characters).', 422);

    $startTime = to_schedule_time_str($startTimeRaw);
    $endTime   = to_schedule_time_str($endTimeRaw);
    if ($startTime >= $endTime) fail('End time must be after start time.', 422);

    $origSched = $pdo->prepare('SELECT ss.*, sub.subject_code, sub.description FROM subject_schedules ss JOIN subjects sub ON sub.subject_id = ss.subject_id WHERE ss.schedule_id = ?');
    $origSched->execute([$scheduleId]);
    $orig = $origSched->fetch() ?: fail('Subject schedule not found.', 404);

    $countUsage = $pdo->prepare('SELECT COUNT(*) FROM enrollment_details WHERE schedule_id = ?');
    $countUsage->execute([$scheduleId]);
    $inUse = (int) $countUsage->fetchColumn();

    $pdo->beginTransaction();
    try {
        if ($inUse > 1) {
            $insSched = $pdo->prepare('
                INSERT INTO subject_schedules (term_id, subject_id, section_code, type, units, days, start_time, end_time, room, instructor)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ');
            $insSched->execute([
                $orig['term_id'], $orig['subject_id'], $sectionCode ?: $orig['section_code'],
                $type ?: $orig['type'], $orig['units'], $days, $startTime, $endTime, $room ?: $orig['room'], $orig['instructor']
            ]);
            $newSchedId = (int) $pdo->lastInsertId();
            $pdo->prepare('UPDATE enrollment_details SET schedule_id = ? WHERE detail_id = ?')
                ->execute([$newSchedId, $detailId]);
        } else {
            $pdo->prepare('
                UPDATE subject_schedules
                   SET days = ?, start_time = ?, end_time = ?, room = ?, section_code = ?, type = ?
                 WHERE schedule_id = ?
            ')->execute([$days, $startTime, $endTime, $room, $sectionCode ?: $orig['section_code'], $type ?: $orig['type'], $scheduleId]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Failed to update class schedule: ' . $e->getMessage(), 500);
    }

    $subjectDetail = "{$orig['subject_code']} · {$days} " . format_time(parse_time($startTime)) . ' – ' . format_time(parse_time($endTime)) . ($room ? " Room {$room}" : "");
    $notifResult = notify_coordinator_if_sa($enrollmentId, $subjectDetail, 'UPDATED', $reason, $user);

    audit('REGISTRAR_CLASS_SCHEDULE_UPDATED', "Enrollment #{$enrollmentId}: {$subjectDetail}; reason: {$reason}", $user['id']);

    respond([
        'success' => true,
        'message' => 'Class schedule updated successfully.' . ($notifResult['isSa'] ? ' S.A. Coordinator has been notified.' : ''),
        'isSa' => $notifResult['isSa'],
        'clashes' => $notifResult['clashes']
    ]);
}

if ($action === 'add_subject') {
    $enrollmentId = (int) (input()['enrollmentId'] ?? 0);
    $scheduleId   = (int) (input()['scheduleId'] ?? 0);
    if (!$enrollmentId || !$scheduleId) fail('Enrollment and schedule required.', 422);

    $check = $pdo->prepare("SELECT detail_id FROM enrollment_details WHERE enrollment_id = ? AND schedule_id = ?");
    $check->execute([$enrollmentId, $scheduleId]);
    if ($check->fetch()) fail('Subject already enrolled.', 422);

    $pdo->prepare("INSERT INTO enrollment_details (enrollment_id, schedule_id) VALUES (?, ?)")
        ->execute([$enrollmentId, $scheduleId]);

    $schedInfo = $pdo->prepare('SELECT ss.*, sub.subject_code FROM subject_schedules ss JOIN subjects sub ON sub.subject_id = ss.subject_id WHERE ss.schedule_id = ?');
    $schedInfo->execute([$scheduleId]);
    $sRow = $schedInfo->fetch();
    $subDesc = $sRow ? "{$sRow['subject_code']} ({$sRow['days']} {$sRow['start_time']}-{$sRow['end_time']})" : "Schedule #$scheduleId";

    notify_coordinator_if_sa($enrollmentId, $subDesc, 'ADDED', 'Subject added by Registrar', $user);
    audit('ADD_ENROLLED_SUBJECT', "Schedule $scheduleId added to enrollment $enrollmentId", $user['id']);
    respond(['success' => true]);
}

if ($action === 'drop_subject') {
    $enrollmentId = (int) (input()['enrollmentId'] ?? 0);
    $scheduleId   = (int) (input()['scheduleId'] ?? 0);
    if (!$enrollmentId || !$scheduleId) fail('Enrollment and schedule required.', 422);

    $schedInfo = $pdo->prepare('SELECT ss.*, sub.subject_code FROM subject_schedules ss JOIN subjects sub ON sub.subject_id = ss.subject_id WHERE ss.schedule_id = ?');
    $schedInfo->execute([$scheduleId]);
    $sRow = $schedInfo->fetch();
    $subDesc = $sRow ? "{$sRow['subject_code']} ({$sRow['days']})" : "Schedule #$scheduleId";

    $pdo->prepare("DELETE FROM enrollment_details WHERE enrollment_id = ? AND schedule_id = ?")
        ->execute([$enrollmentId, $scheduleId]);

    notify_coordinator_if_sa($enrollmentId, $subDesc, 'DROPPED', 'Subject dropped by Registrar', $user);
    audit('DROP_ENROLLED_SUBJECT', "Schedule $scheduleId dropped from enrollment $enrollmentId", $user['id']);
    respond(['success' => true]);
}

if ($action === 'update_status') {
    $enrollmentId = (int) (input()['enrollmentId'] ?? 0);
    $status = trim(input()['status'] ?? '');
    if (!$enrollmentId || !$status) fail('Enrollment and status required.', 422);

    $allowed = ['Enrolled', 'Pending', 'Dropped', 'Cancelled'];
    if (!in_array($status, $allowed)) fail('Invalid status.', 422);

    $pdo->prepare("UPDATE enrollments SET status = ? WHERE enrollment_id = ?")
        ->execute([$status, $enrollmentId]);

    audit('UPDATE_ENROLLMENT_STATUS', "Enrollment $enrollmentId status changed to $status", $user['id']);
    respond(['success' => true]);
}

if ($action === 'update_fee_assessment') {
    $in = input();
    $enrollmentId = (int) ($in['enrollmentId'] ?? 0);
    if (!$enrollmentId) fail('Enrollment ID is required.', 422);

    $chkEnroll = $pdo->prepare('SELECT enrollment_id, student_id FROM enrollments WHERE enrollment_id = ?');
    $chkEnroll->execute([$enrollmentId]);
    $enrollRow = $chkEnroll->fetch() ?: fail('Enrollment record not found.', 404);

    $parseAmt = function ($val, string $label): float {
        if ($val === '' || $val === null) return 0.0;
        if (!is_numeric($val)) fail("{$label} must be a valid amount.", 422);
        $num = round((float) $val, 2);
        if ($num < 0 || $num > 9999999.99) fail("{$label} must be between 0.00 and 9,999,999.99.", 422);
        return $num;
    };

    $tuitionFee        = $parseAmt($in['tuition_fee'] ?? 0, 'Tuition Fee');
    $labFee            = $parseAmt($in['lab_fee'] ?? 0, 'Laboratory Fee');
    $miscFee           = $parseAmt($in['misc_fee'] ?? 0, 'Miscellaneous Fee');
    $lmsFee            = $parseAmt($in['lms_fee'] ?? 0, 'LMS Fee');
    $nstpFee           = $parseAmt($in['nstp_fee'] ?? 0, 'NSTP/ROTC Fee');
    $omrFee            = $parseAmt($in['omr_fee'] ?? 0, 'OMR Fee');
    $installmentCharge = $parseAmt($in['installment_charge'] ?? 0, 'Installment Charge');

    $cashTotal        = round($tuitionFee + $labFee + $miscFee + $lmsFee + $nstpFee + $omrFee, 2);
    $installmentTotal = round($cashTotal + $installmentCharge, 2);

    $existingStmt = $pdo->prepare('SELECT assessment_id FROM fee_assessments WHERE enrollment_id = ? LIMIT 1');
    $existingStmt->execute([$enrollmentId]);
    $existingId = (int) $existingStmt->fetchColumn();

    $pdo->beginTransaction();
    try {
        if ($existingId > 0) {
            $pdo->prepare('
                UPDATE fee_assessments
                   SET tuition_fee = ?, lab_fee = ?, misc_fee = ?, lms_fee = ?,
                       nstp_fee = ?, omr_fee = ?, cash_total = ?,
                       installment_charge = ?, installment_total = ?
                 WHERE assessment_id = ?
            ')->execute([
                $tuitionFee, $labFee, $miscFee, $lmsFee,
                $nstpFee, $omrFee, $cashTotal,
                $installmentCharge, $installmentTotal,
                $existingId
            ]);
        } else {
            $pdo->prepare('
                INSERT INTO fee_assessments
                    (enrollment_id, tuition_fee, lab_fee, misc_fee, lms_fee, nstp_fee, omr_fee, cash_total, installment_charge, installment_total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ')->execute([
                $enrollmentId, $tuitionFee, $labFee, $miscFee, $lmsFee,
                $nstpFee, $omrFee, $cashTotal, $installmentCharge, $installmentTotal
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        fail('Failed to update fee assessment: ' . $e->getMessage(), 500);
    }

    // If this student is an active Student Assistant, immediately sync updated tuition/misc fees to sa_benefits
    $saStmt = $pdo->prepare('
        SELECT p.id AS sa_profile_id, p.semester_id, s.student_number, s.first_name, s.last_name
          FROM students s
          JOIN sa_profiles p ON p.student_id = s.student_number AND p.sa_status = "ACTIVE"
         WHERE s.student_id = ?
         LIMIT 1
    ');
    $saStmt->execute([(int) $enrollRow['student_id']]);
    $saRow = $saStmt->fetch();
    if ($saRow) {
        sync_sa_from_registrar((int) $saRow['sa_profile_id'], false);
        $saName = trim($saRow['first_name'] . ' ' . $saRow['last_name']);
        $notifMsg = sprintf(
            'The Registrar updated the Assessment of Fees for %s (%s): Tuition ₱%s, Misc ₱%s, Cash Total ₱%s.',
            $saName,
            $saRow['student_number'],
            number_format($tuitionFee, 2),
            number_format($miscFee, 2),
            number_format($cashTotal, 2)
        );
        $admins = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN'")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($admins as $adminId) {
            $pdo->prepare('
                INSERT INTO notifications (user_id, sender_id, type, title, message, link, is_read, created_at)
                VALUES (?, ?, "FEE_ASSESSMENT_UPDATED", "Tuition & Fee Assessment Updated by Registrar", ?, ?, 0, NOW())
            ')->execute([$adminId, $user['id'], $notifMsg, '#/admin/sa-management/' . (int) $saRow['sa_profile_id']]);
        }
    }

    $feesStmt = $pdo->prepare('SELECT * FROM fee_assessments WHERE enrollment_id = ? LIMIT 1');
    $feesStmt->execute([$enrollmentId]);
    $updatedAssessment = $feesStmt->fetch() ?: null;

    audit(
        'REGISTRAR_FEE_ASSESSMENT_UPDATED',
        sprintf('Enrollment #%d: Tuition=₱%s, Misc=₱%s, CashTotal=₱%s, InstallmentTotal=₱%s',
            $enrollmentId,
            number_format($tuitionFee, 2),
            number_format($miscFee, 2),
            number_format($cashTotal, 2),
            number_format($installmentTotal, 2)
        ),
        $user['id']
    );

    respond([
        'success' => true,
        'message' => 'Tuition and Assessment of Fees updated successfully.' . ($saRow ? ' S.A. benefits have been synced.' : ''),
        'assessment' => $updatedAssessment,
    ]);
}

fail('Unknown action.', 400);
