<?php
/**
 * AssistPay Request Management Module API Endpoint
 *
 * Workflow:
 *   Student Assistant submits -> Immediate Supervisor reviews -> S.A. Coordinator verifies and records.
 *
 * Supported Request Types:
 *   - EXCUSE_SLIP (Excuse Slip)
 *   - OVERTIME    (Overtime / OT Form)
 *   - UNDERTIME   (Undertime Form)
 */

require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_sa.php';
require __DIR__ . '/_scheduling.php';
require_once __DIR__ . '/_requests.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Method not allowed.', 405);
}
require_csrf();
$user = require_auth();

ensure_request_tables($pdo);

$in = input();
$action = trim((string) ($in['action'] ?? ''));

$activeSem = active_semester();
$defaultSemId = (int) ($activeSem['id'] ?? 1);



// ============================================================================
// ACTION: options — Metadata for Request Forms & Filters
// ============================================================================
if ($action === 'options') {
    $cStmt = $pdo->prepare("SELECT id, cutoff_code, cutoff_name, start_date, end_date, status FROM allowance_cutoffs WHERE semester_id = ? ORDER BY start_date ASC");
    $cStmt->execute([$defaultSemId]);
    $cutoffs = $cStmt->fetchAll(PDO::FETCH_ASSOC);

    $resp = [
        'success'          => true,
        'requestTypes'     => REQUEST_TYPES,
        'requestStatuses'  => REQUEST_STATUSES,
        'reasonCategories' => REQUEST_REASON_CATEGORIES,
        'activeSemester'   => $activeSem,
        'serverTime'          => date('Y-m-d H:i:s'),
        'serverDate'          => date('Y-m-d'),
        'cutoffs'             => $cutoffs,
        'excuseSlipGraceDays' => (int) get_system_setting($pdo, 'excuseSlipGraceDays', 2),
        'overtimeGraceDays'   => (int) get_system_setting($pdo, 'overtimeGraceDays', 2),
    ];

    if ($user['role'] === 'SA') {
        $saCtx = resolve_sa_requester_context($pdo, (int) $user['id'], $defaultSemId);
        $asgnStmt = $pdo->prepare("
            SELECT id, day_of_week, start_time, end_time, department, location
              FROM schedule_assignments
             WHERE sa_profile_id = ? AND semester_id = ?
             ORDER BY FIELD(day_of_week, 'MON','TUE','WED','THU','FRI','SAT'), start_time ASC
        ");
        $asgnStmt->execute([$saCtx['saProfileId'], $defaultSemId]);
        $resp['assignments'] = array_map(static function (array $a): array {
            return [
                'id'         => (int) $a['id'],
                'dayOfWeek'  => $a['day_of_week'],
                'startTime'  => substr((string) $a['start_time'], 0, 5),
                'endTime'    => substr((string) $a['end_time'], 0, 5),
                'department' => $a['department'],
                'location'   => $a['location'],
            ];
        }, $asgnStmt->fetchAll());
        $coordName = $pdo->query("SELECT full_name FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id ASC LIMIT 1")->fetchColumn() ?: 'Ansherina A Sudario';
        $resp['saContext'] = [
            'saProfileId'          => $saCtx['saProfileId'],
            'fullName'             => $saCtx['fullName'],
            'studentId'            => $saCtx['studentId'],
            'saNumber'             => $saCtx['saNumber'],
            'course'               => $saCtx['course'],
            'yearLevel'            => $saCtx['yearLevel'],
            'saCategory'           => $saCtx['saCategory'],
            'department'           => $saCtx['department'],
            'location'             => $saCtx['location'],
            'assignedSupervisorId' => $saCtx['assignedSupervisorId'],
            'supervisorName'       => $saCtx['supervisorName'],
            'coordinatorName'      => $coordName,
        ];
    }

    respond($resp);
}

// ============================================================================
// ACTION: get — View a single request and its complete immutable history
// ============================================================================
if ($action === 'get') {
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));
    if ($reqId <= 0) {
        fail('Please specify a valid request ID.', 422);
    }

    $row = fetch_sa_request_by_id($pdo, $reqId);
    if (!$row) {
        fail('Request record not found.', 404);
    }

    if ($user['role'] === 'SA') {
        if ((int) $row['sa_user_id'] !== (int) $user['id']) {
            audit('REQUEST_UNAUTHORIZED_ACCESS', "SA user #{$user['id']} attempted to view request #{$reqId} owned by user #{$row['sa_user_id']}");
            fail('You are not authorized to view another Student Assistant\'s request.', 403);
        }
    } elseif ($user['role'] === 'SUPERVISOR') {
        if ($row['status'] === 'DRAFT' || !can_supervisor_access_sa_request($pdo, $user, $row)) {
            audit('REQUEST_UNAUTHORIZED_ACCESS', "Supervisor #{$user['id']} attempted to view out-of-scope or draft request #{$reqId}");
            fail('You are not authorized to view this Student Assistant\'s request.', 403);
        }
    } elseif ($user['role'] === 'ADMIN') {
        // Coordinator can inspect any submitted request; drafts remain private to the S.A.
        if ($row['status'] === 'DRAFT') {
            fail('Draft requests have not yet been submitted by the Student Assistant.', 403);
        }
    } else {
        fail('You do not have access to this module.', 403);
    }

    $fmt = format_sa_request_row($pdo, $row, true);
    respond([
        'success' => true,
        'request' => $fmt,
        'history' => $fmt['history'] ?? [],
    ]);
}

// ============================================================================
// ACTION: my_requests — List authenticated Student Assistant's own requests
// ============================================================================
if ($action === 'my_requests') {
    require_role($user, 'SA');
    $semId = (int) ($in['semesterId'] ?? $defaultSemId);
    $saCtx = resolve_sa_requester_context($pdo, (int) $user['id'], $semId);

    $sql = "
        SELECT r.*,
               p.sa_number, p.student_id,
               p.first_name AS sa_first_name, p.middle_name AS sa_middle_name,
               p.last_name AS sa_last_name, p.suffix AS sa_suffix,
               p.course AS sa_course, p.year_level AS sa_year_level,
               sup.full_name AS assigned_supervisor_name
          FROM sa_requests r
          JOIN sa_profiles p ON p.id = r.sa_profile_id
          LEFT JOIN users sup ON sup.id = r.assigned_supervisor_id
         WHERE r.sa_profile_id = ?
           AND r.semester_id = ?
    ";
    $params = [$saCtx['saProfileId'], $semId];

    if (!empty($in['requestType']) && isset(REQUEST_TYPES[$in['requestType']])) {
        $sql .= " AND r.request_type = ?";
        $params[] = $in['requestType'];
    }
    if (!empty($in['status']) && isset(REQUEST_STATUSES[$in['status']])) {
        $sql .= " AND r.status = ?";
        $params[] = $in['status'];
    }

    $sql .= " ORDER BY r.created_at DESC, r.id DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $includeHistory = !empty($in['includeHistory']);
    $requests = array_map(static fn(array $r) => format_sa_request_row($pdo, $r, $includeHistory), $rows);

    $asgnStmt = $pdo->prepare("
        SELECT id, day_of_week, start_time, end_time, department, location
          FROM schedule_assignments
         WHERE sa_profile_id = ? AND semester_id = ?
         ORDER BY FIELD(day_of_week, 'MON','TUE','WED','THU','FRI','SAT'), start_time ASC
    ");
    $asgnStmt->execute([$saCtx['saProfileId'], $semId]);
    $scheduleSlots = array_map(static function (array $a): array {
        return [
            'id'         => (int) $a['id'],
            'dayOfWeek'  => $a['day_of_week'],
            'startTime'  => substr((string) $a['start_time'], 0, 5),
            'endTime'    => substr((string) $a['end_time'], 0, 5),
            'department' => $a['department'],
            'location'   => $a['location'],
        ];
    }, $asgnStmt->fetchAll());

    $cStmt = $pdo->prepare("SELECT id, cutoff_code, cutoff_name, start_date, end_date, status FROM allowance_cutoffs WHERE semester_id = ? ORDER BY start_date ASC");
    $cStmt->execute([$semId]);
    $cutoffs = $cStmt->fetchAll(PDO::FETCH_ASSOC);

    $coordName = $pdo->query("SELECT full_name FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id ASC LIMIT 1")->fetchColumn() ?: 'Ansherina A Sudario';
    respond([
        'success'    => true,
        'requests'   => $requests,
        'summary'    => compute_request_summary_counts($requests),
        'serverTime' => date('Y-m-d H:i:s'),
        'serverDate'          => date('Y-m-d'),
        'cutoffs'             => $cutoffs,
        'excuseSlipGraceDays' => (int) get_system_setting($pdo, 'excuseSlipGraceDays', 2),
        'overtimeGraceDays'   => (int) get_system_setting($pdo, 'overtimeGraceDays', 2),
        'saContext'           => [
            'saProfileId'          => $saCtx['saProfileId'],
            'fullName'             => $saCtx['fullName'],
            'studentId'            => $saCtx['studentId'],
            'saNumber'             => $saCtx['saNumber'],
            'course'               => $saCtx['course'],
            'yearLevel'            => $saCtx['yearLevel'],
            'saCategory'           => $saCtx['saCategory'],
            'department'           => $saCtx['department'],
            'location'             => $saCtx['location'],
            'assignedSupervisorId' => $saCtx['assignedSupervisorId'],
            'supervisorName'       => $saCtx['supervisorName'],
            'coordinatorName'      => $coordName,
            'semesterId'           => $semId,
            'semesterLabel'        => $activeSem['label'] ?? '',
            'scheduleSlots'        => $scheduleSlots,
        ],
    ]);
}

// ============================================================================
// ACTION: save_draft / create_draft / update_draft — S.A. creates or updates a DRAFT request
// ============================================================================
if (in_array($action, ['save_draft', 'create_draft', 'update_draft'], true)) {
    require_role($user, 'SA');
    $semId = (int) ($in['semesterId'] ?? $defaultSemId);
    $saCtx = resolve_sa_requester_context($pdo, (int) $user['id'], $semId);
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));

    $existing = null;
    if ($reqId > 0) {
        $existing = fetch_sa_request_by_id($pdo, $reqId);
        if (!$existing) {
            fail('Draft request not found.', 404);
        }
        if ((int) $existing['sa_user_id'] !== (int) $user['id']) {
            audit('REQUEST_UNAUTHORIZED_EDIT', "SA user #{$user['id']} attempted to edit draft #{$reqId} owned by user #{$existing['sa_user_id']}");
            fail('You are not authorized to modify another Student Assistant\'s request.', 403);
        }
    }

    $prevStatus = $existing ? (string) $existing['status'] : null;
    assert_valid_request_transition('SA_SAVE_DRAFT', $user['role'], $prevStatus);

    $payload = validate_and_extract_sa_request_payload($pdo, $in, $saCtx, $semId, true, $existing);

    $pdo->beginTransaction();
    try {
        if ($existing) {
            $upd = $pdo->prepare("
                UPDATE sa_requests
                   SET request_type = ?,
                       undertime_type = ?,
                       date_filed = ?,
                       assigned_supervisor_id = ?,
                       department = ?,
                       location = ?,
                       request_date = ?,
                       request_end_date = ?,
                       day_of_week = ?,
                       assignment_id = ?,
                       scheduled_start = ?,
                       scheduled_end = ?,
                       requested_start = ?,
                       requested_end = ?,
                       actual_time = ?,
                       minutes_affected = ?,
                       hours_affected = ?,
                       reason_category = ?,
                       explanation = ?,
                       notes = ?,
                       overtime_rows_json = ?,
                       proof_file_name = ?,
                       proof_stored_name = ?,
                       proof_mime_type = ?,
                       proof_file_size = ?,
                       sa_signature = ?,
                       sa_sign_date = ?,
                       status = 'DRAFT'
                 WHERE id = ?
            ");
            $upd->execute([
                $payload['requestType'],
                $payload['undertimeType'],
                $payload['dateFiled'],
                $saCtx['assignedSupervisorId'],
                $payload['department'],
                $payload['location'],
                $payload['requestDate'],
                $payload['requestEndDate'],
                $payload['dayOfWeek'],
                $payload['assignmentId'],
                $payload['scheduledStart'],
                $payload['scheduledEnd'],
                $payload['requestedStart'],
                $payload['requestedEnd'],
                $payload['actualTime'],
                $payload['minutesAffected'],
                $payload['hoursAffected'],
                $payload['reasonCategory'],
                $payload['explanation'],
                $payload['notes'],
                $payload['overtimeRowsJson'],
                $payload['proofFileName'],
                $payload['proofStoredName'],
                $payload['proofMimeType'],
                $payload['proofFileSize'],
                $payload['saSignature'],
                $payload['saSignDate'],
                $reqId,
            ]);
        } else {
            $refNo = generate_request_ref_no($pdo);
            $ins = $pdo->prepare("
                INSERT INTO sa_requests (
                    request_ref_no, request_type, undertime_type, date_filed, semester_id, sa_profile_id, sa_user_id,
                    assigned_supervisor_id, department, location, request_date, request_end_date, day_of_week,
                    assignment_id, scheduled_start, scheduled_end, requested_start, requested_end, actual_time,
                    minutes_affected, hours_affected, reason_category, explanation, notes, overtime_rows_json,
                    proof_file_name, proof_stored_name, proof_mime_type, proof_file_size,
                    sa_signature, sa_sign_date, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
            ");
            $ins->execute([
                $refNo,
                $payload['requestType'],
                $payload['undertimeType'],
                $payload['dateFiled'],
                $semId,
                $saCtx['saProfileId'],
                $saCtx['saUserId'],
                $saCtx['assignedSupervisorId'],
                $payload['department'],
                $payload['location'],
                $payload['requestDate'],
                $payload['requestEndDate'],
                $payload['dayOfWeek'],
                $payload['assignmentId'],
                $payload['scheduledStart'],
                $payload['scheduledEnd'],
                $payload['requestedStart'],
                $payload['requestedEnd'],
                $payload['actualTime'],
                $payload['minutesAffected'],
                $payload['hoursAffected'],
                $payload['reasonCategory'],
                $payload['explanation'],
                $payload['notes'],
                $payload['overtimeRowsJson'],
                $payload['proofFileName'],
                $payload['proofStoredName'],
                $payload['proofMimeType'],
                $payload['proofFileSize'],
                $payload['saSignature'],
                $payload['saSignDate'],
            ]);
            $reqId = (int) $pdo->lastInsertId();
        }

        record_request_history_entry(
            $pdo,
            $reqId,
            (int) $user['id'],
            (string) $user['full_name'],
            'SA',
            $prevStatus,
            'DRAFT',
            'SA_SAVE_DRAFT',
            'Saved request as draft.'
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Request Save Draft Error] ' . $e->getMessage());
        fail('Failed to save request draft due to a database error. No changes were saved.', 500);
    }

    $fresh = fetch_sa_request_by_id($pdo, $reqId);
    audit('REQUEST_DRAFT_SAVED', "Saved draft {$fresh['request_ref_no']} ({$fresh['request_type']})");

    respond([
        'success' => true,
        'message' => 'Request draft saved.',
        'request' => format_sa_request_row($pdo, $fresh, true),
    ]);
}

// ============================================================================
// ACTION: delete_draft — S.A. deletes an unsubmitted DRAFT request
// ============================================================================
if ($action === 'delete_draft' || $action === 'delete') {
    require_role($user, 'SA');
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));
    if ($reqId <= 0) {
        fail('Please specify a valid request ID to delete.', 422);
    }

    $existing = fetch_sa_request_by_id($pdo, $reqId);
    if (!$existing) {
        fail('Draft request not found.', 404);
    }

    if ((int) $existing['sa_user_id'] !== (int) $user['id'] && $user['role'] !== 'ADMIN') {
        audit('REQUEST_UNAUTHORIZED_DELETE', "User #{$user['id']} attempted to delete request #{$reqId} owned by user #{$existing['sa_user_id']}");
        fail('You are not authorized to delete this request.', 403);
    }

    // STRICT SAFETY CHECK: Only unsubmitted DRAFT requests can be deleted!
    if ($existing['status'] !== 'DRAFT') {
        fail('Only unsubmitted draft requests can be deleted. Submitted requests cannot be deleted to preserve the institutional audit trail.', 422);
    }

    // Clean up stored proof document file from disk if present
    if (!empty($existing['proof_stored_name'])) {
        $filePath = dirname(__DIR__) . '/uploads/request-documents/' . $existing['proof_stored_name'];
        if (file_exists($filePath)) {
            @unlink($filePath);
        }
    }

    $refNo = (string) ($existing['request_ref_no'] ?? "#{$reqId}");
    $reqType = (string) ($existing['request_type'] ?? 'REQUEST');

    $pdo->beginTransaction();
    try {
        $delHist = $pdo->prepare("DELETE FROM sa_request_history WHERE request_id = ?");
        $delHist->execute([$reqId]);

        $delReq = $pdo->prepare("DELETE FROM sa_requests WHERE id = ? AND status = 'DRAFT'");
        $delReq->execute([$reqId]);

        audit('REQUEST_DRAFT_DELETED', "S.A. user #{$user['id']} deleted draft request #{$reqId} ({$refNo}, {$reqType})");
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Request Delete Draft Error] ' . $e->getMessage());
        fail('Failed to delete draft request due to a database error.', 500);
    }

    respond([
        'success'   => true,
        'message'   => "Draft request {$refNo} deleted successfully.",
        'deletedId' => $reqId,
    ]);
}

// ============================================================================
// ACTION: submit — S.A. submits a new or DRAFT request for Supervisor Review
// ============================================================================
if ($action === 'submit') {
    require_role($user, 'SA');
    $semId = (int) ($in['semesterId'] ?? $defaultSemId);
    $saCtx = resolve_sa_requester_context($pdo, (int) $user['id'], $semId);
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));

    $existing = null;
    if ($reqId > 0) {
        $existing = fetch_sa_request_by_id($pdo, $reqId);
        if (!$existing) {
            fail('Request record not found.', 404);
        }
        if ((int) $existing['sa_user_id'] !== (int) $user['id']) {
            audit('REQUEST_UNAUTHORIZED_SUBMIT', "SA user #{$user['id']} attempted to submit request #{$reqId} owned by user #{$existing['sa_user_id']}");
            fail('You are not authorized to submit another Student Assistant\'s request.', 403);
        }
        // Idempotent handling if the exact same draft was already submitted to Supervisor Review
        if ($existing['status'] === 'PENDING_SUPERVISOR_REVIEW') {
            respond([
                'success'          => true,
                'alreadyProcessed' => true,
                'message'          => 'This request has already been submitted and is pending Supervisor review.',
                'request'          => format_sa_request_row($pdo, $existing, true),
            ]);
        }
    }

    $prevStatus = $existing ? (string) $existing['status'] : null;
    assert_valid_request_transition('SA_SUBMIT', $user['role'], $prevStatus);

    $payload = validate_and_extract_sa_request_payload($pdo, $in, $saCtx, $semId, false, $existing);

    // Enforce date validation, schedule matching, whole hours, and cutoff checks
    if ($payload['requestType'] === 'EXCUSE_SLIP') {
        validate_excuse_slip_policy(
            $pdo,
            $saCtx['saProfileId'],
            $semId,
            $payload['requestDate'],
            $payload['requestEndDate'],
            $reqId > 0 ? $reqId : null
        );
    } elseif ($payload['requestType'] === 'OVERTIME') {
        $otPolicy = validate_overtime_request_policy(
            $pdo,
            $saCtx['saProfileId'],
            $semId,
            $payload,
            $reqId > 0 ? $reqId : null
        );
        $payload['overtimeRowsJson'] = json_encode($otPolicy['validatedRows'], JSON_UNESCAPED_UNICODE);
        $payload['minutesAffected'] = $otPolicy['totalOtMinutes'];
        $payload['hoursAffected'] = $otPolicy['totalOtHours'];
    } else {
        assert_no_duplicate_active_request(
            $pdo,
            $saCtx['saProfileId'],
            $payload['requestType'],
            $payload['requestDate'],
            $payload['requestedStart'],
            $payload['requestedEnd'],
            $reqId > 0 ? $reqId : null
        );
    }

    $pdo->beginTransaction();
    try {
        if ($existing) {
            $upd = $pdo->prepare("
                UPDATE sa_requests
                   SET request_type = ?,
                       undertime_type = ?,
                       date_filed = ?,
                       assigned_supervisor_id = ?,
                       department = ?,
                       location = ?,
                       request_date = ?,
                       request_end_date = ?,
                       day_of_week = ?,
                       assignment_id = ?,
                       scheduled_start = ?,
                       scheduled_end = ?,
                       requested_start = ?,
                       requested_end = ?,
                       actual_time = ?,
                       minutes_affected = ?,
                       hours_affected = ?,
                       reason_category = ?,
                       explanation = ?,
                       notes = ?,
                       overtime_rows_json = ?,
                       proof_file_name = ?,
                       proof_stored_name = ?,
                       proof_mime_type = ?,
                       proof_file_size = ?,
                       sa_signature = ?,
                       sa_sign_date = ?,
                       status = 'PENDING_SUPERVISOR_REVIEW',
                       submitted_at = NOW()
                 WHERE id = ?
            ");
            $upd->execute([
                $payload['requestType'],
                $payload['undertimeType'],
                $payload['dateFiled'],
                $saCtx['assignedSupervisorId'],
                $payload['department'],
                $payload['location'],
                $payload['requestDate'],
                $payload['requestEndDate'],
                $payload['dayOfWeek'],
                $payload['assignmentId'],
                $payload['scheduledStart'],
                $payload['scheduledEnd'],
                $payload['requestedStart'],
                $payload['requestedEnd'],
                $payload['actualTime'],
                $payload['minutesAffected'],
                $payload['hoursAffected'],
                $payload['reasonCategory'],
                $payload['explanation'],
                $payload['notes'],
                $payload['overtimeRowsJson'],
                $payload['proofFileName'],
                $payload['proofStoredName'],
                $payload['proofMimeType'],
                $payload['proofFileSize'],
                $payload['saSignature'],
                $payload['saSignDate'],
                $reqId,
            ]);
        } else {
            $refNo = generate_request_ref_no($pdo);
            $ins = $pdo->prepare("
                INSERT INTO sa_requests (
                    request_ref_no, request_type, undertime_type, date_filed, semester_id, sa_profile_id, sa_user_id,
                    assigned_supervisor_id, department, location, request_date, request_end_date, day_of_week,
                    assignment_id, scheduled_start, scheduled_end, requested_start, requested_end, actual_time,
                    minutes_affected, hours_affected, reason_category, explanation, notes, overtime_rows_json,
                    proof_file_name, proof_stored_name, proof_mime_type, proof_file_size,
                    sa_signature, sa_sign_date,
                    status, submitted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SUPERVISOR_REVIEW', NOW())
            ");
            $ins->execute([
                $refNo,
                $payload['requestType'],
                $payload['undertimeType'],
                $payload['dateFiled'],
                $semId,
                $saCtx['saProfileId'],
                $saCtx['saUserId'],
                $saCtx['assignedSupervisorId'],
                $payload['department'],
                $payload['location'],
                $payload['requestDate'],
                $payload['requestEndDate'],
                $payload['dayOfWeek'],
                $payload['assignmentId'],
                $payload['scheduledStart'],
                $payload['scheduledEnd'],
                $payload['requestedStart'],
                $payload['requestedEnd'],
                $payload['actualTime'],
                $payload['minutesAffected'],
                $payload['hoursAffected'],
                $payload['reasonCategory'],
                $payload['explanation'],
                $payload['notes'],
                $payload['overtimeRowsJson'],
                $payload['proofFileName'],
                $payload['proofStoredName'],
                $payload['proofMimeType'],
                $payload['proofFileSize'],
                $payload['saSignature'],
                $payload['saSignDate'],
            ]);
            $reqId = (int) $pdo->lastInsertId();
        }

        record_request_history_entry(
            $pdo,
            $reqId,
            (int) $user['id'],
            (string) $user['full_name'],
            'SA',
            $prevStatus,
            'PENDING_SUPERVISOR_REVIEW',
            'SA_SUBMIT',
            $payload['explanation']
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Request Submit Error] ' . $e->getMessage());
        fail('Failed to submit request due to a database error. Your changes were rolled back.', 500);
    }

    $fresh = fetch_sa_request_by_id($pdo, $reqId);
    audit('REQUEST_SUBMITTED', "Submitted {$fresh['request_ref_no']} ({$fresh['request_type']}) for {$fresh['request_date']}");
    notify_request_workflow_transition($pdo, $fresh, 'SA_SUBMIT', $user, $payload['explanation']);

    respond([
        'success' => true,
        'message' => 'Request submitted to your Immediate Supervisor for review.',
        'request' => format_sa_request_row($pdo, $fresh, true),
    ]);
}

// ============================================================================
// ACTION: resubmit — S.A. corrects and resubmits a returned request
// ============================================================================
if ($action === 'resubmit') {
    require_role($user, 'SA');
    $semId = (int) ($in['semesterId'] ?? $defaultSemId);
    $saCtx = resolve_sa_requester_context($pdo, (int) $user['id'], $semId);
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));
    if ($reqId <= 0) {
        fail('Please specify the request ID to resubmit.', 422);
    }

    $existing = fetch_sa_request_by_id($pdo, $reqId);
    if (!$existing) {
        fail('Request record not found.', 404);
    }
    if ((int) $existing['sa_user_id'] !== (int) $user['id']) {
        audit('REQUEST_UNAUTHORIZED_RESUBMIT', "SA user #{$user['id']} attempted to resubmit request #{$reqId} owned by user #{$existing['sa_user_id']}");
        fail('You are not authorized to resubmit another Student Assistant\'s request.', 403);
    }

    $prevStatus = (string) $existing['status'];
    assert_valid_request_transition('SA_RESUBMIT', $user['role'], $prevStatus);

    $payload = validate_and_extract_sa_request_payload($pdo, $in, $saCtx, (int) $existing['semester_id'], false, $existing);

    // Enforce date validation, schedule matching, whole hours, and cutoff checks
    if ($payload['requestType'] === 'EXCUSE_SLIP') {
        validate_excuse_slip_policy(
            $pdo,
            $saCtx['saProfileId'],
            (int) $existing['semester_id'],
            $payload['requestDate'],
            $payload['requestEndDate'],
            $reqId
        );
    } elseif ($payload['requestType'] === 'OVERTIME') {
        $otPolicy = validate_overtime_request_policy(
            $pdo,
            $saCtx['saProfileId'],
            (int) $existing['semester_id'],
            $payload,
            $reqId
        );
        $payload['overtimeRowsJson'] = json_encode($otPolicy['validatedRows'], JSON_UNESCAPED_UNICODE);
        $payload['minutesAffected'] = $otPolicy['totalOtMinutes'];
        $payload['hoursAffected'] = $otPolicy['totalOtHours'];
    } else {
        assert_no_duplicate_active_request(
            $pdo,
            $saCtx['saProfileId'],
            $payload['requestType'],
            $payload['requestDate'],
            $payload['requestedStart'],
            $payload['requestedEnd'],
            $reqId
        );
    }

    $resubmitRemarks = trim((string) ($in['remarks'] ?? ($in['resubmitNote'] ?? 'Corrected and resubmitted by Student Assistant.')));

    $pdo->beginTransaction();
    try {
        $upd = $pdo->prepare("
            UPDATE sa_requests
               SET request_type = ?,
                   undertime_type = ?,
                   date_filed = ?,
                   assigned_supervisor_id = ?,
                   department = ?,
                   location = ?,
                   request_date = ?,
                   request_end_date = ?,
                   day_of_week = ?,
                   assignment_id = ?,
                   scheduled_start = ?,
                   scheduled_end = ?,
                   requested_start = ?,
                   requested_end = ?,
                   actual_time = ?,
                   minutes_affected = ?,
                   hours_affected = ?,
                   reason_category = ?,
                   explanation = ?,
                   notes = ?,
                   overtime_rows_json = ?,
                   proof_file_name = ?,
                   proof_stored_name = ?,
                   proof_mime_type = ?,
                   proof_file_size = ?,
                   sa_signature = ?,
                   sa_sign_date = ?,
                   status = 'PENDING_SUPERVISOR_REVIEW',
                   clarification_target = NULL,
                   submitted_at = NOW()
             WHERE id = ?
        ");
        $upd->execute([
            $payload['requestType'],
            $payload['undertimeType'],
            $payload['dateFiled'],
            $saCtx['assignedSupervisorId'],
            $payload['department'],
            $payload['location'],
            $payload['requestDate'],
            $payload['requestEndDate'],
            $payload['dayOfWeek'],
            $payload['assignmentId'],
            $payload['scheduledStart'],
            $payload['scheduledEnd'],
            $payload['requestedStart'],
            $payload['requestedEnd'],
            $payload['actualTime'],
            $payload['minutesAffected'],
            $payload['hoursAffected'],
            $payload['reasonCategory'],
            $payload['explanation'],
            $payload['notes'],
            $payload['overtimeRowsJson'],
            $payload['proofFileName'],
            $payload['proofStoredName'],
            $payload['proofMimeType'],
            $payload['proofFileSize'],
            $payload['saSignature'],
            $payload['saSignDate'],
            $reqId,
        ]);

        record_request_history_entry(
            $pdo,
            $reqId,
            (int) $user['id'],
            (string) $user['full_name'],
            'SA',
            $prevStatus,
            'PENDING_SUPERVISOR_REVIEW',
            'SA_RESUBMIT',
            $resubmitRemarks
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Request Resubmit Error] ' . $e->getMessage());
        fail('Failed to resubmit request due to a database error. Your changes were rolled back.', 500);
    }

    $fresh = fetch_sa_request_by_id($pdo, $reqId);
    audit('REQUEST_RESUBMITTED', "Resubmitted {$fresh['request_ref_no']} ({$fresh['request_type']})");
    notify_request_workflow_transition($pdo, $fresh, 'SA_RESUBMIT', $user, $resubmitRemarks);

    respond([
        'success' => true,
        'message' => 'Corrected request resubmitted to your Immediate Supervisor for review.',
        'request' => format_sa_request_row($pdo, $fresh, true),
    ]);
}

// ============================================================================
// ACTION: team_requests — Immediate Supervisor lists scoped S.A. requests
// ============================================================================
if ($action === 'team_requests') {
    require_role($user, 'SUPERVISOR');
    $semId = (int) ($in['semesterId'] ?? $defaultSemId);

    $sql = "
        SELECT r.*,
               p.sa_number, p.student_id,
               p.first_name AS sa_first_name, p.middle_name AS sa_middle_name,
               p.last_name AS sa_last_name, p.suffix AS sa_suffix,
               p.course AS sa_course, p.year_level AS sa_year_level,
               p.sa_category, p.office_id AS sa_office_id,
               sup.full_name AS assigned_supervisor_name
          FROM sa_requests r
          JOIN sa_profiles p ON p.id = r.sa_profile_id
          LEFT JOIN users sup ON sup.id = r.assigned_supervisor_id
         WHERE r.semester_id = ?
           AND r.status != 'DRAFT'
    ";
    $params = [$semId];

    if (!empty($in['requestType']) && isset(REQUEST_TYPES[$in['requestType']])) {
        $sql .= " AND r.request_type = ?";
        $params[] = $in['requestType'];
    }
    if (!empty($in['status']) && isset(REQUEST_STATUSES[$in['status']])) {
        $sql .= " AND r.status = ?";
        $params[] = $in['status'];
    }

    $sql .= " ORDER BY FIELD(r.status, 'PENDING_SUPERVISOR_REVIEW', 'RETURNED_FOR_CLARIFICATION', 'RETURNED_TO_SA', 'PENDING_COORDINATOR_RECORDING', 'RECORDED', 'REJECTED_BY_SUPERVISOR'), r.submitted_at DESC, r.id DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $allRows = $stmt->fetchAll();

    $includeHistory = !empty($in['includeHistory']);
    $scopedRequests = [];
    foreach ($allRows as $row) {
        if (can_supervisor_access_sa_request($pdo, $user, $row)) {
            $scopedRequests[] = format_sa_request_row($pdo, $row, $includeHistory);
        }
    }

    respond([
        'success'  => true,
        'requests' => $scopedRequests,
        'summary'  => compute_request_summary_counts($scopedRequests),
    ]);
}

// ============================================================================
// ACTION: supervisor_approve — Immediate Supervisor approves request
// ============================================================================
if ($action === 'supervisor_approve') {
    require_role($user, 'SUPERVISOR');
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));
    if ($reqId <= 0) {
        fail('Please specify a valid request ID.', 422);
    }

    $existing = fetch_sa_request_by_id($pdo, $reqId);
    if (!$existing) {
        fail('Request record not found.', 404);
    }

    // Anti-falsification security check: Supervisors cannot submit signatures for the Coordinator
    if (!empty($in['coordinatorSignature'])) {
        fail('Falsification Restricted: Supervisors cannot sign on behalf of the S.A. Coordinator.', 403);
    }
    $supervisorSig = isset($in['supervisorSignature']) ? trim((string) $in['supervisorSignature']) : ($existing['supervisor_signature'] ?? null);
    $supervisorSignDate = $supervisorSig ? ($existing['supervisor_sign_date'] ?? date('Y-m-d')) : null;
    $remarks = trim((string) ($in['remarks'] ?? ($in['reason'] ?? '')));

    if (!can_supervisor_access_sa_request($pdo, $user, $existing)) {
        audit('REQUEST_UNAUTHORIZED_SUPERVISOR', "Supervisor #{$user['id']} attempted to approve out-of-scope request #{$reqId}");
        fail('You are not authorized to review or approve requests for this Student Assistant.', 403);
    }

    // Idempotent handling if already approved and waiting for Coordinator recording
    if ($existing['status'] === 'PENDING_COORDINATOR_RECORDING' && $existing['supervisor_decision'] === 'APPROVED') {
        respond([
            'success'          => true,
            'alreadyProcessed' => true,
            'message'          => 'This request has already been approved and is awaiting S.A. Coordinator recording.',
            'request'          => format_sa_request_row($pdo, $existing, true),
        ]);
    }

    $prevStatus = (string) $existing['status'];
    assert_valid_request_transition('SUPERVISOR_APPROVE', $user['role'], $prevStatus, $remarks);

    $pdo->beginTransaction();
    try {
        $locked = fetch_sa_request_by_id($pdo, $reqId, true);
        if (!$locked || $locked['status'] !== $prevStatus) {
            $pdo->rollBack();
            fail('Request status changed concurrently. Please refresh and try again.', 409);
        }

        $upd = $pdo->prepare("
            UPDATE sa_requests
               SET status = 'PENDING_COORDINATOR_RECORDING',
                   clarification_target = NULL,
                   supervisor_acted_by_id = ?,
                   supervisor_name = ?,
                   supervisor_decision = 'APPROVED',
                   supervisor_remarks = ?,
                   supervisor_acted_at = NOW(),
                   supervisor_signature = ?,
                   supervisor_sign_date = ?
             WHERE id = ?
        ");
        $upd->execute([
            (int) $user['id'],
            (string) $user['full_name'],
            $remarks !== '' ? $remarks : null,
            $supervisorSig,
            $supervisorSignDate,
            $reqId,
        ]);

        record_request_history_entry(
            $pdo,
            $reqId,
            (int) $user['id'],
            (string) $user['full_name'],
            'SUPERVISOR',
            $prevStatus,
            'PENDING_COORDINATOR_RECORDING',
            'SUPERVISOR_APPROVE',
            $remarks
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Supervisor Approve Error] ' . $e->getMessage());
        fail('Failed to approve request due to a database error. Changes were rolled back.', 500);
    }

    $fresh = fetch_sa_request_by_id($pdo, $reqId);
    audit('REQUEST_SUPERVISOR_APPROVED', "Supervisor approved {$fresh['request_ref_no']} -> PENDING_COORDINATOR_RECORDING");
    notify_request_workflow_transition($pdo, $fresh, 'SUPERVISOR_APPROVE', $user, $remarks);

    respond([
        'success' => true,
        'message' => 'Request approved and forwarded to the S.A. Coordinator for verification and recording.',
        'request' => format_sa_request_row($pdo, $fresh, true),
    ]);
}

// ============================================================================
// ACTION: supervisor_return — Immediate Supervisor returns request to S.A.
// ============================================================================
if ($action === 'supervisor_return') {
    require_role($user, 'SUPERVISOR');
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));
    if ($reqId <= 0) {
        fail('Please specify a valid request ID.', 422);
    }

    $remarks = trim((string) ($in['remarks'] ?? ($in['reason'] ?? '')));
    if ($remarks === '') {
        fail('Please provide a comment explaining what needs to be corrected before returning this request.', 422, ['code' => 'REMARKS_REQUIRED']);
    }

    $existing = fetch_sa_request_by_id($pdo, $reqId);
    if (!$existing) {
        fail('Request record not found.', 404);
    }
    if (!can_supervisor_access_sa_request($pdo, $user, $existing)) {
        audit('REQUEST_UNAUTHORIZED_SUPERVISOR', "Supervisor #{$user['id']} attempted to return out-of-scope request #{$reqId}");
        fail('You are not authorized to review or return requests for this Student Assistant.', 403);
    }

    $prevStatus = (string) $existing['status'];
    assert_valid_request_transition('SUPERVISOR_RETURN', $user['role'], $prevStatus, $remarks);

    $pdo->beginTransaction();
    try {
        $upd = $pdo->prepare("
            UPDATE sa_requests
               SET status = 'RETURNED_TO_SA',
                   clarification_target = 'SA',
                   supervisor_acted_by_id = ?,
                   supervisor_name = ?,
                   supervisor_decision = 'RETURNED',
                   supervisor_remarks = ?,
                   supervisor_acted_at = NOW()
             WHERE id = ?
        ");
        $upd->execute([
            (int) $user['id'],
            (string) $user['full_name'],
            $remarks,
            $reqId,
        ]);

        record_request_history_entry(
            $pdo,
            $reqId,
            (int) $user['id'],
            (string) $user['full_name'],
            'SUPERVISOR',
            $prevStatus,
            'RETURNED_TO_SA',
            'SUPERVISOR_RETURN',
            $remarks
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Supervisor Return Error] ' . $e->getMessage());
        fail('Failed to return request due to a database error. Changes were rolled back.', 500);
    }

    $fresh = fetch_sa_request_by_id($pdo, $reqId);
    audit('REQUEST_SUPERVISOR_RETURNED', "Supervisor returned {$fresh['request_ref_no']} to S.A. | Reason: {$remarks}");
    notify_request_workflow_transition($pdo, $fresh, 'SUPERVISOR_RETURN', $user, $remarks);

    respond([
        'success' => true,
        'message' => 'Request returned to the Student Assistant for correction.',
        'request' => format_sa_request_row($pdo, $fresh, true),
    ]);
}

// ============================================================================
// ACTION: supervisor_reject — Immediate Supervisor rejects request
// ============================================================================
if ($action === 'supervisor_reject') {
    require_role($user, 'SUPERVISOR');
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));
    if ($reqId <= 0) {
        fail('Please specify a valid request ID.', 422);
    }

    $remarks = trim((string) ($in['remarks'] ?? ($in['reason'] ?? '')));
    if ($remarks === '') {
        fail('A reason for rejection is mandatory. Please provide a clear explanation before rejecting.', 422, ['code' => 'REJECTION_REASON_REQUIRED']);
    }

    $existing = fetch_sa_request_by_id($pdo, $reqId);
    if (!$existing) {
        fail('Request record not found.', 404);
    }

    // Anti-falsification security check: Supervisors cannot submit signatures for the Coordinator
    if (!empty($in['coordinatorSignature'])) {
        fail('Falsification Restricted: Supervisors cannot sign on behalf of the S.A. Coordinator.', 403);
    }
    $supervisorSig = isset($in['supervisorSignature']) ? trim((string) $in['supervisorSignature']) : ($existing['supervisor_signature'] ?? null);
    $supervisorSignDate = $supervisorSig ? ($existing['supervisor_sign_date'] ?? date('Y-m-d')) : null;
    if (!can_supervisor_access_sa_request($pdo, $user, $existing)) {
        audit('REQUEST_UNAUTHORIZED_SUPERVISOR', "Supervisor #{$user['id']} attempted to reject out-of-scope request #{$reqId}");
        fail('You are not authorized to review or reject requests for this Student Assistant.', 403);
    }

    // Idempotent handling if already rejected by Supervisor
    if ($existing['status'] === 'REJECTED_BY_SUPERVISOR') {
        respond([
            'success'          => true,
            'alreadyProcessed' => true,
            'message'          => 'This request has already been rejected.',
            'request'          => format_sa_request_row($pdo, $existing, true),
        ]);
    }

    $prevStatus = (string) $existing['status'];
    assert_valid_request_transition('SUPERVISOR_REJECT', $user['role'], $prevStatus, $remarks);

    $pdo->beginTransaction();
    try {
        $upd = $pdo->prepare("
            UPDATE sa_requests
               SET status = 'REJECTED_BY_SUPERVISOR',
                   clarification_target = NULL,
                   supervisor_acted_by_id = ?,
                   supervisor_name = ?,
                   supervisor_decision = 'REJECTED',
                   supervisor_remarks = ?,
                   supervisor_acted_at = NOW(),
                   supervisor_signature = ?,
                   supervisor_sign_date = ?
             WHERE id = ?
        ");
        $upd->execute([
            (int) $user['id'],
            (string) $user['full_name'],
            $remarks,
            $supervisorSig,
            $supervisorSignDate,
            $reqId,
        ]);

        record_request_history_entry(
            $pdo,
            $reqId,
            (int) $user['id'],
            (string) $user['full_name'],
            'SUPERVISOR',
            $prevStatus,
            'REJECTED_BY_SUPERVISOR',
            'SUPERVISOR_REJECT',
            $remarks
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Supervisor Reject Error] ' . $e->getMessage());
        fail('Failed to reject request due to a database error. Changes were rolled back.', 500);
    }

    $fresh = fetch_sa_request_by_id($pdo, $reqId);
    audit('REQUEST_SUPERVISOR_REJECTED', "Supervisor rejected {$fresh['request_ref_no']} | Reason: {$remarks}");
    notify_request_workflow_transition($pdo, $fresh, 'SUPERVISOR_REJECT', $user, $remarks);

    respond([
        'success' => true,
        'message' => 'Request has been rejected.',
        'request' => format_sa_request_row($pdo, $fresh, true),
    ]);
}

// ============================================================================
// ACTION: supervisor_resubmit_clarification — Supervisor responds to Coordinator clarification
// ============================================================================
if ($action === 'supervisor_resubmit_clarification') {
    require_role($user, 'SUPERVISOR');
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));
    if ($reqId <= 0) {
        fail('Please specify a valid request ID.', 422);
    }

    $remarks = trim((string) ($in['remarks'] ?? ($in['reason'] ?? '')));

    $existing = fetch_sa_request_by_id($pdo, $reqId);
    if (!$existing) {
        fail('Request record not found.', 404);
    }
    if (!can_supervisor_access_sa_request($pdo, $user, $existing)) {
        audit('REQUEST_UNAUTHORIZED_SUPERVISOR', "Supervisor #{$user['id']} attempted to clarify out-of-scope request #{$reqId}");
        fail('You are not authorized to act on requests for this Student Assistant.', 403);
    }

    $prevStatus = (string) $existing['status'];
    assert_valid_request_transition('SUPERVISOR_RESUBMIT_CLARIFICATION', $user['role'], $prevStatus, $remarks);

    $pdo->beginTransaction();
    try {
        $upd = $pdo->prepare("
            UPDATE sa_requests
               SET status = 'PENDING_COORDINATOR_RECORDING',
                   clarification_target = NULL,
                   supervisor_acted_by_id = ?,
                   supervisor_name = ?,
                   supervisor_decision = 'APPROVED',
                   supervisor_remarks = ?,
                   supervisor_acted_at = NOW()
             WHERE id = ?
        ");
        $upd->execute([
            (int) $user['id'],
            (string) $user['full_name'],
            $remarks,
            $reqId,
        ]);

        record_request_history_entry(
            $pdo,
            $reqId,
            (int) $user['id'],
            (string) $user['full_name'],
            'SUPERVISOR',
            $prevStatus,
            'PENDING_COORDINATOR_RECORDING',
            'SUPERVISOR_RESUBMIT_CLARIFICATION',
            $remarks
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Supervisor Clarification Error] ' . $e->getMessage());
        fail('Failed to submit clarification due to a database error. Changes were rolled back.', 500);
    }

    $fresh = fetch_sa_request_by_id($pdo, $reqId);
    audit('REQUEST_SUPERVISOR_CLARIFIED', "Supervisor clarified and re-endorsed {$fresh['request_ref_no']} -> PENDING_COORDINATOR_RECORDING");
    notify_request_workflow_transition($pdo, $fresh, 'SUPERVISOR_RESUBMIT_CLARIFICATION', $user, $remarks);

    respond([
        'success' => true,
        'message' => 'Clarification submitted and request returned to the S.A. Coordinator for recording.',
        'request' => format_sa_request_row($pdo, $fresh, true),
    ]);
}

// ============================================================================
// ACTION: admin_list — S.A. Coordinator lists requests across departments
// ============================================================================
if ($action === 'admin_list') {
    require_role($user, 'ADMIN');
    $semId = (int) ($in['semesterId'] ?? $defaultSemId);

    $sql = "
        SELECT r.*,
               p.sa_number, p.student_id,
               p.first_name AS sa_first_name, p.middle_name AS sa_middle_name,
               p.last_name AS sa_last_name, p.suffix AS sa_suffix,
               p.course AS sa_course, p.year_level AS sa_year_level,
               sup.full_name AS assigned_supervisor_name
          FROM sa_requests r
          JOIN sa_profiles p ON p.id = r.sa_profile_id
          LEFT JOIN users sup ON sup.id = r.assigned_supervisor_id
         WHERE r.semester_id = ?
           AND r.status != 'DRAFT'
    ";
    $params = [$semId];

    if (!empty($in['requestType']) && isset(REQUEST_TYPES[$in['requestType']])) {
        $sql .= " AND r.request_type = ?";
        $params[] = $in['requestType'];
    }
    if (!empty($in['status']) && isset(REQUEST_STATUSES[$in['status']])) {
        $sql .= " AND r.status = ?";
        $params[] = $in['status'];
    }
    if (!empty($in['department'])) {
        $sql .= " AND r.department = ?";
        $params[] = trim((string) $in['department']);
    }

    $sql .= " ORDER BY FIELD(r.status, 'PENDING_COORDINATOR_RECORDING', 'RETURNED_FOR_CLARIFICATION', 'PENDING_SUPERVISOR_REVIEW', 'RETURNED_TO_SA', 'RECORDED', 'REJECTED_BY_SUPERVISOR'), r.supervisor_acted_at DESC, r.id DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $includeHistory = !empty($in['includeHistory']);
    $requests = array_map(static fn(array $r) => format_sa_request_row($pdo, $r, $includeHistory), $rows);

    respond([
        'success'  => true,
        'requests' => $requests,
        'summary'  => compute_request_summary_counts($requests),
    ]);
}

// ============================================================================
// ACTION: coordinator_return_clarification — S.A. Coordinator returns for clarification
// ============================================================================
if ($action === 'coordinator_return_clarification') {
    require_role($user, 'ADMIN');
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));
    if ($reqId <= 0) {
        fail('Please specify a valid request ID.', 422);
    }

    $remarks = trim((string) ($in['remarks'] ?? ($in['reason'] ?? '')));
    $target = strtoupper(trim((string) ($in['clarificationTarget'] ?? 'SA')));
    if (!in_array($target, ['SA', 'SUPERVISOR'], true)) {
        $target = 'SA';
    }

    $existing = fetch_sa_request_by_id($pdo, $reqId);
    if (!$existing) {
        fail('Request record not found.', 404);
    }

    $prevStatus = (string) $existing['status'];
    assert_valid_request_transition('COORDINATOR_RETURN_CLARIFICATION', $user['role'], $prevStatus, $remarks);

    $coordSig = isset($in['coordinatorSignature']) ? trim((string) $in['coordinatorSignature']) : ($existing['coordinator_signature'] ?? null);
    $coordSignDate = $coordSig ? ($existing['coordinator_sign_date'] ?? date('Y-m-d')) : null;

    $pdo->beginTransaction();
    try {
        $upd = $pdo->prepare("
            UPDATE sa_requests
               SET status = 'RETURNED_FOR_CLARIFICATION',
                   clarification_target = ?,
                   coordinator_id = ?,
                   coordinator_name = ?,
                   coordinator_decision = 'RETURNED_FOR_CLARIFICATION',
                   coordinator_remarks = ?,
                   coordinator_acted_at = NOW(),
                   coordinator_signature = ?,
                   coordinator_sign_date = ?
             WHERE id = ?
        ");
        $upd->execute([
            $target,
            (int) $user['id'],
            (string) $user['full_name'],
            $remarks,
            $coordSig,
            $coordSignDate,
            $reqId,
        ]);

        record_request_history_entry(
            $pdo,
            $reqId,
            (int) $user['id'],
            (string) $user['full_name'],
            'ADMIN',
            $prevStatus,
            'RETURNED_FOR_CLARIFICATION',
            'COORDINATOR_RETURN_CLARIFICATION',
            "[Target: {$target}] {$remarks}"
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Coordinator Return Clarification Error] ' . $e->getMessage());
        fail('Failed to return request for clarification due to a database error. Changes were rolled back.', 500);
    }

    $fresh = fetch_sa_request_by_id($pdo, $reqId);
    audit('REQUEST_COORDINATOR_RETURNED', "Coordinator returned {$fresh['request_ref_no']} for clarification ({$target}) | Reason: {$remarks}");
    notify_request_workflow_transition($pdo, $fresh, 'COORDINATOR_RETURN_CLARIFICATION', $user, $remarks);

    respond([
        'success' => true,
        'message' => 'Request returned for clarification.',
        'request' => format_sa_request_row($pdo, $fresh, true),
    ]);
}

// ============================================================================
// ACTION: coordinator_record — S.A. Coordinator verifies and records a Supervisor-approved request
// ============================================================================
if ($action === 'coordinator_record') {
    require_role($user, 'ADMIN');
    $reqId = (int) ($in['id'] ?? ($in['requestId'] ?? 0));
    if ($reqId <= 0) {
        fail('Please specify a valid request ID.', 422);
    }

    $remarks = trim((string) ($in['remarks'] ?? ($in['reason'] ?? 'Verified and recorded by S.A. Coordinator.')));

    $existing = fetch_sa_request_by_id($pdo, $reqId);
    if (!$existing) {
        fail('Request record not found.', 404);
    }

    // Idempotent handling if already recorded
    if ($existing['status'] === 'RECORDED') {
        respond([
            'success'          => true,
            'alreadyProcessed' => true,
            'message'          => 'This request has already been verified and recorded.',
            'request'          => format_sa_request_row($pdo, $existing, true),
        ]);
    }

    $prevStatus = (string) $existing['status'];
    assert_valid_request_transition('COORDINATOR_RECORD', $user['role'], $prevStatus, $remarks);

    // Extra invariant check: Coordinator cannot record unless an Immediate Supervisor has approved the request
    if (($existing['supervisor_decision'] ?? '') !== 'APPROVED' || empty($existing['supervisor_acted_by_id'])) {
        fail(
            'Coordinator cannot record a request that has not been approved by an authorized Immediate Supervisor.',
            409,
            ['code' => 'SUPERVISOR_APPROVAL_REQUIRED']
        );
    }

    $pdo->beginTransaction();
    try {
        $locked = fetch_sa_request_by_id($pdo, $reqId, true);
        if (!$locked || $locked['status'] !== 'PENDING_COORDINATOR_RECORDING') {
            $pdo->rollBack();
            fail('Request status changed concurrently. Please refresh and try again.', 409);
        }

        // Allow deterministic test simulation of a downstream recording error before commit
        if (PHP_SAPI === 'cli' && !empty($GLOBALS['__TEST_SIMULATE_RECORDING_FAILURE'])) {
            throw new RuntimeException('Simulated downstream recording failure.');
        }

        $coordSig = isset($in['coordinatorSignature']) ? trim((string) $in['coordinatorSignature']) : ($existing['coordinator_signature'] ?? null);
        $coordSignDate = $coordSig ? ($existing['coordinator_sign_date'] ?? date('Y-m-d')) : null;

        $upd = $pdo->prepare("
            UPDATE sa_requests
               SET status = 'RECORDED',
                   clarification_target = NULL,
                   coordinator_id = ?,
                   coordinator_name = ?,
                   coordinator_decision = 'RECORDED',
                   coordinator_remarks = ?,
                   coordinator_acted_at = NOW(),
                   recorded_at = NOW(),
                   coordinator_signature = ?,
                   coordinator_sign_date = ?
             WHERE id = ?
        ");
        $upd->execute([
            (int) $user['id'],
            (string) $user['full_name'],
            $remarks !== '' ? $remarks : null,
            $coordSig,
            $coordSignDate,
            $reqId,
        ]);

        record_request_history_entry(
            $pdo,
            $reqId,
            (int) $user['id'],
            (string) $user['full_name'],
            'ADMIN',
            $prevStatus,
            'RECORDED',
            'COORDINATOR_RECORD',
            $remarks
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[AssistPay Coordinator Record Error] ' . $e->getMessage());
        fail('Failed to record request due to a database error. Status remains Pending Coordinator Recording.', 500);
    }

    $fresh = fetch_sa_request_by_id($pdo, $reqId);
    audit('REQUEST_COORDINATOR_RECORDED', "Coordinator verified and recorded {$fresh['request_ref_no']} ({$fresh['request_type']})");
    notify_request_workflow_transition($pdo, $fresh, 'COORDINATOR_RECORD', $user, $remarks);

    respond([
        'success' => true,
        'message' => 'Request officially verified and recorded.',
        'request' => format_sa_request_row($pdo, $fresh, true),
    ]);
}

fail("Unknown request action '{$action}'.", 422);
