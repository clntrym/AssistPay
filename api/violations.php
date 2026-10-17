<?php
// SA Attendance Violation, Disciplinary Warning, Memo, and Under Agreement API
require __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_violations.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user   = require_auth();
$in     = input();
$action = $in['action'] ?? '';

ensure_violation_schema($pdo);

// Helper to resolve which SA profile the current user can view
function resolve_accessible_sa_id(PDO $pdo, array $user, int $requestedSaId): int
{
    if ($user['role'] === 'SA') {
        $stmt = $pdo->prepare('SELECT id FROM sa_profiles WHERE user_id = ? LIMIT 1');
        $stmt->execute([(int) $user['id']]);
        $ownId = (int) $stmt->fetchColumn();
        if (!$ownId) fail('S.A. profile not found.', 404);
        if ($requestedSaId > 0 && $requestedSaId !== $ownId) {
            audit('ACCESS_DENIED', "SA user #{$user['id']} attempted to access SA #{$requestedSaId}", (int) $user['id']);
            fail('You do not have access to this action.', 403);
        }
        return $ownId;
    }
    require_role($user, 'ADMIN', 'SUPERVISOR');
    if ($requestedSaId <= 0) fail('Choose a Student Assistant.');
    return $requestedSaId;
}

switch ($action) {

    // =========================================================================
    // 1. Violation Settings (SA Coordinator Settings)
    // =========================================================================
    case 'get_settings':
        require_role($user, 'ADMIN');
        $semesters = $pdo->query('SELECT * FROM semesters ORDER BY start_date DESC')->fetchAll();
        $activeSem = active_semester();
        $semesterId = (int) ($in['semesterId'] ?? ($activeSem['id'] ?? ($semesters[0]['id'] ?? 0)));
        if ($semesterId <= 0) {
            respond([
                'success'        => true,
                'semesterId'     => 0,
                'semesters'      => [],
                'settings'       => [],
                'escalationMode' => get_warning_escalation_mode($pdo),
                'history'        => [],
            ]);
        }
        respond([
            'success'        => true,
            'semesterId'     => $semesterId,
            'semesters'      => array_map('format_semester', $semesters),
            'settings'       => get_violation_settings($pdo, $semesterId),
            'escalationMode' => get_warning_escalation_mode($pdo),
            'history'        => get_violation_settings_history($pdo, $semesterId),
        ]);

    case 'save_settings':
        require_role($user, 'ADMIN');
        $activeSem = active_semester();
        $semesterId = (int) ($in['semesterId'] ?? ($activeSem['id'] ?? 0));
        if ($semesterId <= 0) fail('Select a valid semester.');

        $categoriesInput = is_array($in['categories'] ?? null) ? $in['categories'] : [];
        $escalationMode  = isset($in['escalationMode']) ? (string) $in['escalationMode'] : null;
        $reason          = isset($in['reason']) ? trim((string) $in['reason']) : null;

        $res = save_violation_settings($pdo, $semesterId, $categoriesInput, $escalationMode, (int) $user['id'], $reason);
        if (!$res['success']) {
            fail($res['message'], 422, ['errors' => $res['errors'] ?? []]);
        }
        respond($res);

    // =========================================================================
    // 2. SA Disciplinary Profile (Warnings, Memos, Incidents, Agreements)
    // =========================================================================
    case 'sa_disciplinary_profile':
        $saId = resolve_accessible_sa_id($pdo, $user, (int) ($in['saProfileId'] ?? 0));
        $semId = isset($in['semesterId']) && (int) $in['semesterId'] > 0 ? (int) $in['semesterId'] : null;
        $semesters = $pdo->query('SELECT * FROM semesters ORDER BY start_date DESC')->fetchAll();
        $profile = get_sa_disciplinary_profile($pdo, $saId, $semId);
        if (!$profile['success']) fail($profile['message'], 404);
        $profile['semesters'] = array_map('format_semester', $semesters);
        respond($profile);

    // =========================================================================
    // 3. Attendance Violation Incidents & Evaluation
    // =========================================================================
    case 'record_incident':
        require_role($user, 'ADMIN');
        $res = record_attendance_incident($pdo, $in, (int) $user['id']);
        if (!$res['success']) fail($res['message'], 422);
        $saId  = (int) ($in['saProfileId'] ?? 0);
        $semId = (int) ($in['semesterId'] ?? 0) ?: null;
        respond($res + ['profile' => get_sa_disciplinary_profile($pdo, $saId, $semId)]);

    case 'update_incident':
        require_role($user, 'ADMIN');
        $incidentId = (int) ($in['incidentId'] ?? 0);
        if ($incidentId <= 0) fail('Select an attendance incident.');
        $res = update_attendance_incident($pdo, $incidentId, $in, (int) $user['id']);
        if (!$res['success']) fail($res['message'], 422);

        $incStmt = $pdo->prepare('SELECT sa_profile_id, semester_id FROM sa_attendance_incidents WHERE id = ?');
        $incStmt->execute([$incidentId]);
        $incRow = $incStmt->fetch();
        $profile = $incRow ? get_sa_disciplinary_profile($pdo, (int) $incRow['sa_profile_id'], (int) $incRow['semester_id']) : null;
        respond($res + ['profile' => $profile]);

    case 'evaluate_sa':
        require_role($user, 'ADMIN');
        $saId = (int) ($in['saProfileId'] ?? 0);
        $activeSem = active_semester();
        $semId = (int) ($in['semesterId'] ?? ($activeSem['id'] ?? 0));
        if ($saId <= 0 || $semId <= 0) fail('Specify both S.A. and semester.');
        $eval = evaluate_sa_violations($pdo, $saId, $semId, (int) $user['id']);
        if (!$eval['success']) fail($eval['message'], 422);
        respond($eval + ['profile' => get_sa_disciplinary_profile($pdo, $saId, $semId)]);

    // =========================================================================
    // 4. Warning Review, Memo Editing, Approval & Acknowledgment
    // =========================================================================
    case 'update_memo':
        require_role($user, 'ADMIN');
        $memoId = (int) ($in['memoId'] ?? 0);
        if ($memoId <= 0) fail('Select a memo document.');
        $res = update_warning_memo($pdo, $memoId, $in, (int) $user['id']);
        if (!$res['success']) fail($res['message'], 422);
        respond($res);

    case 'approve_warning':
        require_role($user, 'ADMIN');
        $warningId = (int) ($in['warningId'] ?? 0);
        if ($warningId <= 0) fail('Select a warning evaluation to approve.');
        $res = approve_and_issue_warning($pdo, $warningId, $in, (int) $user['id']);
        if (!$res['success']) fail($res['message'], 422);
        respond($res);

    case 'acknowledge_memo':
        $memoId = (int) ($in['memoId'] ?? 0);
        if ($memoId <= 0) fail('Select a memo to acknowledge.');

        if ($user['role'] === 'SA') {
            $ownStmt = $pdo->prepare('
                SELECT m.id FROM sa_warning_memos m
                JOIN sa_profiles p ON p.id = m.sa_profile_id
                WHERE m.id = ? AND p.user_id = ?
            ');
            $ownStmt->execute([$memoId, (int) $user['id']]);
            if (!$ownStmt->fetchColumn()) {
                audit('ACCESS_DENIED', "SA user #{$user['id']} attempted to acknowledge Memo #{$memoId}", (int) $user['id']);
                fail('You can only acknowledge memos issued to your own profile.', 403);
            }
        } else {
            require_role($user, 'ADMIN');
        }

        $ackDate = isset($in['acknowledgedDate']) ? (string) $in['acknowledgedDate'] : null;
        $res = acknowledge_warning_memo($pdo, $memoId, (int) $user['id'], $ackDate);
        if (!$res['success']) fail($res['message'], 422);
        respond($res);

    // =========================================================================
    // 5. Under Agreement Management
    // =========================================================================
    case 'approve_under_agreement':
        require_role($user, 'ADMIN');
        $agreementId = (int) ($in['agreementId'] ?? 0);
        if ($agreementId <= 0) fail('Select an Under Agreement record.');
        $res = approve_under_agreement($pdo, $agreementId, $in, (int) $user['id']);
        if (!$res['success']) fail($res['message'], 422);
        respond($res);

    case 'update_agreement_status':
        $agreementId = (int) ($in['agreementId'] ?? 0);
        $newStatus   = (string) ($in['status'] ?? '');
        if ($agreementId <= 0) fail('Select an Under Agreement record.');

        if ($user['role'] === 'SA') {
            // SA may only mark their own PENDING_SIGNATURE agreement as SIGNED
            $ownStmt = $pdo->prepare('
                SELECT ua.status FROM sa_under_agreements ua
                JOIN sa_profiles p ON p.id = ua.sa_profile_id
                WHERE ua.id = ? AND p.user_id = ?
            ');
            $ownStmt->execute([$agreementId, (int) $user['id']]);
            $curStatus = $ownStmt->fetchColumn();
            if (!$curStatus || strtoupper(trim($newStatus)) !== 'SIGNED') {
                audit('ACCESS_DENIED', "SA user #{$user['id']} attempted to change Agreement #{$agreementId} to {$newStatus}", (int) $user['id']);
                fail('You do not have access to this action.', 403);
            }
        } else {
            require_role($user, 'ADMIN');
        }

        $remarks    = isset($in['remarks']) ? trim((string) $in['remarks']) : null;
        $actionDate = isset($in['actionDate']) ? trim((string) $in['actionDate']) : null;
        $res = update_under_agreement_status($pdo, $agreementId, $newStatus, (int) $user['id'], $remarks, $actionDate);
        if (!$res['success']) fail($res['message'], 422);
        respond($res);

    // =========================================================================
    // 6. Coordinator Disciplinary & Under Agreement Overview
    // =========================================================================
    case 'overview':
        require_role($user, 'ADMIN');
        $activeSem = active_semester();
        $semesterId = (int) ($in['semesterId'] ?? ($activeSem['id'] ?? 0));

        // All warnings across semesters with optional filter
        $wStmt = $pdo->query("
            SELECT w.*,
                   p.student_id, p.sa_number, p.first_name, p.last_name, p.suffix,
                   p.course, p.year_level, p.sa_category, p.department_type,
                   p.assignment_status, p.disciplinary_status,
                   o.name AS office_name,
                   s.academic_year, s.term,
                   COALESCE(NULLIF(TRIM(app.full_name), ''), app.username) AS approved_by_name,
                   m.id AS memo_id, m.memo_ref_no, m.issued_date, m.subject_line,
                   m.recipient_name, m.student_number, m.sa_number AS memo_sa_number,
                   m.course_year, m.assigned_office, m.semester_label AS memo_semester_label,
                   m.attendance_records_text, m.previous_warnings_text,
                   m.explanation_body, m.applicable_policy AS memo_policy,
                   m.corrective_action AS memo_corrective_action,
                   m.coordinator_name, m.coordinator_title,
                   m.status AS memo_status, m.acknowledged_at,
                   ua.id AS ua_id, ua.agreement_ref_no, ua.effective_date AS ua_effective_date,
                   ua.end_date AS ua_end_date, ua.reason AS ua_reason,
                   ua.conditions_text AS ua_conditions_text, ua.status AS ua_status,
                   ua.approver_name AS ua_approver_name, ua.signed_at AS ua_signed_at,
                   ua.completed_at AS ua_completed_at, ua.remarks AS ua_remarks
            FROM sa_disciplinary_warnings w
            JOIN sa_profiles p ON p.id = w.sa_profile_id
            JOIN semesters s ON s.id = w.semester_id
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN users app ON app.id = w.approved_by
            LEFT JOIN sa_warning_memos m ON m.warning_id = w.id
            LEFT JOIN sa_under_agreements ua ON ua.third_warning_id = w.id
            ORDER BY w.evaluated_at DESC, w.id DESC
        ");

        $warnings = [];
        foreach ($wStmt->fetchAll() as $r) {
            $incDates = json_decode($r['incident_dates_json'] ?: '[]', true) ?: [];
            $saName = sa_full_name($r);
            $uaObj = !empty($r['ua_id']) ? [
                'id'             => (int) $r['ua_id'],
                'warningId'      => (int) $r['id'],
                'saProfileId'    => (int) $r['sa_profile_id'],
                'saName'         => $saName,
                'studentNumber'  => $r['student_id'],
                'saNumber'       => $r['sa_number'],
                'courseYear'     => $r['course'] . ' - Year ' . $r['year_level'],
                'assignedOffice' => $r['office_name'] ?: $r['department_type'],
                'semesterLabel'  => semester_label($r),
                'agreementRefNo' => $r['agreement_ref_no'],
                'effectiveDate'  => $r['ua_effective_date'],
                'endDate'        => $r['ua_end_date'],
                'reason'         => $r['ua_reason'],
                'conditionsText' => $r['ua_conditions_text'],
                'status'         => $r['ua_status'],
                'approverName'   => $r['ua_approver_name'] ?: ($r['approved_by_name'] ?: 'Pending Approval'),
                'signedAt'       => $r['ua_signed_at'],
                'completedAt'    => $r['ua_completed_at'],
                'remarks'        => $r['ua_remarks'],
            ] : null;

            $warnings[] = [
                'id'                     => (int) $r['id'],
                'saProfileId'            => (int) $r['sa_profile_id'],
                'saName'                 => $saName,
                'studentId'              => $r['student_id'],
                'saNumber'               => $r['sa_number'],
                'course'                 => $r['course'],
                'yearLevel'              => (int) $r['year_level'],
                'assignedOffice'         => $r['office_name'] ?: $r['department_type'],
                'assignmentStatus'       => $r['assignment_status'],
                'disciplinaryStatus'     => $r['disciplinary_status'],
                'semesterId'             => (int) $r['semester_id'],
                'semesterLabel'          => semester_label($r),
                'academicYear'           => $r['academic_year'],
                'warningLevel'           => $r['warning_level'],
                'warningLevelLabel'      => WARNING_LEVEL_LABELS[$r['warning_level']] ?? $r['warning_level'],
                'violationCategory'      => $r['violation_category'],
                'violationCategoryLabel' => VIOLATION_CATEGORIES[$r['violation_category']]['label'] ?? $r['violation_category'],
                'allowedChances'         => (int) $r['allowed_chances'],
                'recordedOccurrences'    => (int) $r['recorded_occurrences'],
                'incidentDates'          => $incDates,
                'latestIncidentDate'     => $incDates ? end($incDates) : substr($r['evaluated_at'], 0, 10),
                'evaluationStatus'       => $r['evaluation_status'],
                'requiresUnderAgreement' => (bool) $r['requires_under_agreement'],
                'approvedByName'         => $r['approved_by_name'],
                'approvedAt'             => $r['approved_at'],
                'memo' => $r['memo_id'] ? [
                    'id'                    => (int) $r['memo_id'],
                    'warningId'             => (int) $r['id'],
                    'memoRefNo'             => $r['memo_ref_no'],
                    'warningLevel'          => $r['warning_level'],
                    'warningLevelLabel'     => WARNING_LEVEL_LABELS[$r['warning_level']] ?? $r['warning_level'],
                    'violationCategory'     => $r['violation_category'],
                    'violationCategoryLabel'=> VIOLATION_CATEGORIES[$r['violation_category']]['label'] ?? $r['violation_category'],
                    'issuedDate'            => $r['issued_date'],
                    'subjectLine'           => $r['subject_line'],
                    'recipientName'         => $r['recipient_name'],
                    'studentNumber'         => $r['student_number'],
                    'saNumber'              => $r['memo_sa_number'],
                    'courseYear'            => $r['course_year'],
                    'assignedOffice'        => $r['assigned_office'],
                    'semesterLabel'         => $r['memo_semester_label'],
                    'allowedChances'        => (int) $r['allowed_chances'],
                    'recordedOccurrences'   => (int) $r['recorded_occurrences'],
                    'incidentDates'         => $incDates,
                    'attendanceRecordsText' => $r['attendance_records_text'],
                    'previousWarningsText'  => $r['previous_warnings_text'],
                    'explanationBody'       => $r['explanation_body'],
                    'applicablePolicy'      => $r['memo_policy'],
                    'correctiveAction'      => $r['memo_corrective_action'],
                    'coordinatorName'       => $r['coordinator_name'],
                    'coordinatorTitle'      => $r['coordinator_title'],
                    'status'                => $r['memo_status'],
                    'acknowledgedAt'        => $r['acknowledged_at'],
                ] : null,
                'underAgreement' => $uaObj,
            ];
        }

        // SAs currently Under Agreement
        $uaSaStmt = $pdo->query("
            SELECT p.id, p.student_id, p.sa_number, p.first_name, p.last_name, p.suffix,
                   p.course, p.year_level, p.sa_category, p.department_type,
                   p.sa_status, p.assignment_status, p.disciplinary_status, p.under_agreement_at,
                   o.name AS office_name
            FROM sa_profiles p
            LEFT JOIN offices o ON o.id = p.office_id
            WHERE p.disciplinary_status = 'UNDER_AGREEMENT' AND p.archived_at IS NULL
            ORDER BY p.under_agreement_at DESC, p.last_name ASC
        ");
        $underAgreementSas = array_map(fn($r) => [
            'id'                 => (int) $r['id'],
            'name'               => sa_full_name($r),
            'studentId'          => $r['student_id'],
            'saNumber'           => $r['sa_number'],
            'course'             => $r['course'],
            'yearLevel'          => (int) $r['year_level'],
            'office'             => $r['office_name'] ?: $r['department_type'],
            'saStatus'           => $r['sa_status'],
            'assignmentStatus'   => $r['assignment_status'],
            'disciplinaryStatus' => $r['disciplinary_status'],
            'underAgreementAt'   => $r['under_agreement_at'],
        ], $uaSaStmt->fetchAll());

        respond([
            'success'           => true,
            'warnings'          => $warnings,
            'underAgreementSas' => $underAgreementSas,
        ]);

    default:
        fail('Unknown action.', 404);
}

