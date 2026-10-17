<?php
/**
 * AssistPay Request Management Module — Shared Workflow & Domain Foundation
 *
 * Supports:
 *   1. Excuse Slip (EXCUSE_SLIP)
 *   2. Overtime Form (OVERTIME)
 *   3. Undertime Form (UNDERTIME)
 *
 * Complete Business Workflow:
 *   Student Assistant submits -> Immediate Supervisor reviews -> S.A. Coordinator verifies and records.
 */

const REQUEST_TYPES = [
    'EXCUSE_SLIP' => 'Excuse Slip',
    'OVERTIME'    => 'Overtime (OT) Form',
    'UNDERTIME'   => 'Undertime Form',
    'CORRECTION'  => 'Attendance Correction',
];

const REQUEST_STATUSES = [
    'DRAFT'                         => 'Draft',
    'PENDING_SUPERVISOR_REVIEW'     => 'Pending Supervisor Review',
    'RETURNED_TO_SA'                => 'Returned to S.A.',
    'PENDING_COORDINATOR_RECORDING' => 'Pending Coordinator Recording',
    'RETURNED_FOR_CLARIFICATION'    => 'Returned for Clarification',
    'REJECTED_BY_SUPERVISOR'        => 'Rejected by Supervisor',
    'RECORDED'                      => 'Recorded',
];

const REQUEST_REASON_CATEGORIES = [
    'EXCUSE_SLIP' => [
        'Medical / Illness',
        'Academic / Examination Conflict',
        'Official School Representation',
        'Family / Personal Emergency',
        'Severe Weather / Transport Disruption',
        'Other Valid Reason',
    ],
    'OVERTIME' => [
        'Peak Office Workload / Enrollment Support',
        'Special Campus Event / Institutional Activity',
        'Urgent System / Technical Maintenance',
        'Reliever Coverage for Absent S.A.',
        'Supervisor-Assigned Extended Duty',
        'Other Authorized Overtime',
    ],
    'UNDERTIME' => [
        'Medical / Clinic Consultation',
        'Sudden Illness During Duty',
        'Urgent Academic / Faculty Consultation',
        'Family / Personal Emergency',
        'Supervisor-Permitted Early Release',
        'Other Valid Reason',
    ],
    'CORRECTION' => [
        'Biometric Machine Latency / Hardware Glitch',
        'Power Outage / Network Interruption',
        'Emergency Duty Deployment before Punch',
        'Official Off-Campus Assignment',
        'Forgot to Punch In / Out',
        'Other Valid Correction',
    ],
];

/**
 * Valid workflow transition matrix:
 * Maps each action key to:
 *   - allowedRoles: Roles permitted to execute this transition
 *   - fromStatuses: Valid current statuses from which this transition may occur
 *   - toStatus: Resulting status after transition
 *   - requiresRemarks: Whether a non-empty reason/comment is mandatory
 */
const REQUEST_TRANSITION_MATRIX = [
    'SA_SAVE_DRAFT' => [
        'allowedRoles'    => ['SA'],
        'fromStatuses'    => [null, 'DRAFT'],
        'toStatus'        => 'DRAFT',
        'requiresRemarks' => false,
    ],
    'SA_SUBMIT' => [
        'allowedRoles'    => ['SA'],
        'fromStatuses'    => [null, 'DRAFT'],
        'toStatus'        => 'PENDING_SUPERVISOR_REVIEW',
        'requiresRemarks' => false,
    ],
    'SA_RESUBMIT' => [
        'allowedRoles'    => ['SA'],
        'fromStatuses'    => ['RETURNED_TO_SA', 'RETURNED_FOR_CLARIFICATION'],
        'toStatus'        => 'PENDING_SUPERVISOR_REVIEW',
        'requiresRemarks' => false,
    ],
    'SUPERVISOR_APPROVE' => [
        'allowedRoles'    => ['SUPERVISOR'],
        'fromStatuses'    => ['PENDING_SUPERVISOR_REVIEW'],
        'toStatus'        => 'PENDING_COORDINATOR_RECORDING',
        'requiresRemarks' => false,
    ],
    'SUPERVISOR_RETURN' => [
        'allowedRoles'    => ['SUPERVISOR'],
        'fromStatuses'    => ['PENDING_SUPERVISOR_REVIEW', 'RETURNED_FOR_CLARIFICATION'],
        'toStatus'        => 'RETURNED_TO_SA',
        'requiresRemarks' => true,
    ],
    'SUPERVISOR_REJECT' => [
        'allowedRoles'    => ['SUPERVISOR'],
        'fromStatuses'    => ['PENDING_SUPERVISOR_REVIEW'],
        'toStatus'        => 'REJECTED_BY_SUPERVISOR',
        'requiresRemarks' => true,
    ],
    'SUPERVISOR_RESUBMIT_CLARIFICATION' => [
        'allowedRoles'    => ['SUPERVISOR'],
        'fromStatuses'    => ['RETURNED_FOR_CLARIFICATION'],
        'toStatus'        => 'PENDING_COORDINATOR_RECORDING',
        'requiresRemarks' => true,
    ],
    'COORDINATOR_RETURN_CLARIFICATION' => [
        'allowedRoles'    => ['ADMIN'],
        'fromStatuses'    => ['PENDING_COORDINATOR_RECORDING'],
        'toStatus'        => 'RETURNED_FOR_CLARIFICATION',
        'requiresRemarks' => true,
    ],
    'COORDINATOR_RECORD' => [
        'allowedRoles'    => ['ADMIN'],
        'fromStatuses'    => ['PENDING_COORDINATOR_RECORDING'],
        'toStatus'        => 'RECORDED',
        'requiresRemarks' => false,
    ],
];

/**
 * Ensures the `sa_requests` and `sa_request_history` tables exist.
 * Uses the lightweight schema guard so DDL checks run once per schema version.
 */
function ensure_request_tables(PDO $pdo): void
{
    static $ensured = false;
    if ($ensured) {
        return;
    }
    $ensured = true;

    if (function_exists('schema_guard_ready') && schema_guard_ready('request_tables_v3', 86400)) {
        return;
    }

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS sa_requests (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            request_ref_no VARCHAR(40) NOT NULL UNIQUE,
            request_type ENUM('EXCUSE_SLIP','OVERTIME','UNDERTIME','CORRECTION') NOT NULL,
            undertime_type VARCHAR(60) NULL DEFAULT NULL,
            date_filed DATE NULL DEFAULT NULL,
            semester_id INT UNSIGNED NOT NULL,
            sa_profile_id INT UNSIGNED NOT NULL,
            sa_user_id INT UNSIGNED NOT NULL,
            assigned_supervisor_id INT UNSIGNED NULL DEFAULT NULL,
            department VARCHAR(80) NOT NULL DEFAULT '',
            location VARCHAR(120) NOT NULL DEFAULT '',
            request_date DATE NOT NULL,
            request_end_date DATE NULL DEFAULT NULL,
            day_of_week ENUM('MON','TUE','WED','THU','FRI','SAT') NOT NULL,
            assignment_id INT UNSIGNED NULL DEFAULT NULL,
            scheduled_start TIME NULL DEFAULT NULL,
            scheduled_end TIME NULL DEFAULT NULL,
            requested_start TIME NULL DEFAULT NULL,
            requested_end TIME NULL DEFAULT NULL,
            actual_time TIME NULL DEFAULT NULL,
            minutes_affected INT UNSIGNED NOT NULL DEFAULT 0,
            hours_affected DECIMAL(5,2) NOT NULL DEFAULT 0.00,
            reason_category VARCHAR(120) NOT NULL DEFAULT '',
            explanation TEXT NOT NULL,
            notes TEXT NULL DEFAULT NULL,
            overtime_rows_json LONGTEXT NULL DEFAULT NULL,
            proof_file_name VARCHAR(255) NULL DEFAULT NULL,
            proof_stored_name VARCHAR(255) NULL DEFAULT NULL,
            proof_mime_type VARCHAR(100) NULL DEFAULT NULL,
            proof_file_size INT UNSIGNED NULL DEFAULT NULL,
            status ENUM(
                'DRAFT',
                'PENDING_SUPERVISOR_REVIEW',
                'RETURNED_TO_SA',
                'PENDING_COORDINATOR_RECORDING',
                'RETURNED_FOR_CLARIFICATION',
                'REJECTED_BY_SUPERVISOR',
                'RECORDED'
            ) NOT NULL DEFAULT 'DRAFT',
            clarification_target ENUM('SA','SUPERVISOR') NULL DEFAULT NULL,
            submitted_at DATETIME NULL DEFAULT NULL,
            supervisor_acted_by_id INT UNSIGNED NULL DEFAULT NULL,
            supervisor_name VARCHAR(160) NULL DEFAULT NULL,
            supervisor_decision ENUM('APPROVED','RETURNED','REJECTED') NULL DEFAULT NULL,
            supervisor_remarks TEXT NULL DEFAULT NULL,
            supervisor_acted_at DATETIME NULL DEFAULT NULL,
            coordinator_id INT UNSIGNED NULL DEFAULT NULL,
            coordinator_name VARCHAR(160) NULL DEFAULT NULL,
            coordinator_decision ENUM('RECORDED','RETURNED_FOR_CLARIFICATION') NULL DEFAULT NULL,
            coordinator_remarks TEXT NULL DEFAULT NULL,
            coordinator_acted_at DATETIME NULL DEFAULT NULL,
            recorded_at DATETIME NULL DEFAULT NULL,
            linked_incident_id INT UNSIGNED NULL DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_sa_req_profile_sem (sa_profile_id, semester_id, status),
            INDEX idx_sa_req_user_status (sa_user_id, status),
            INDEX idx_sa_req_sup_status (assigned_supervisor_id, status, request_date),
            INDEX idx_sa_req_dept_status (department, status, request_date),
            INDEX idx_sa_req_status_date (status, request_date),
            INDEX idx_sa_req_dup_check (sa_profile_id, request_type, request_date, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    try {
        $pdo->exec("
            ALTER TABLE sa_requests
                MODIFY COLUMN request_type ENUM('EXCUSE_SLIP','OVERTIME','UNDERTIME','CORRECTION') NOT NULL,
                ADD COLUMN IF NOT EXISTS undertime_type VARCHAR(60) NULL DEFAULT NULL AFTER request_type,
                ADD COLUMN IF NOT EXISTS date_filed DATE NULL DEFAULT NULL AFTER undertime_type,
                ADD COLUMN IF NOT EXISTS request_end_date DATE NULL DEFAULT NULL AFTER request_date,
                ADD COLUMN IF NOT EXISTS actual_time TIME NULL DEFAULT NULL AFTER requested_end,
                ADD COLUMN IF NOT EXISTS overtime_rows_json LONGTEXT NULL DEFAULT NULL AFTER notes
        ");
    } catch (Throwable $e) {
        // Ignore if columns already exist
    }

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS sa_request_history (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            request_id INT UNSIGNED NOT NULL,
            actor_user_id INT UNSIGNED NULL DEFAULT NULL,
            actor_name VARCHAR(160) NOT NULL,
            actor_role VARCHAR(40) NOT NULL,
            previous_status VARCHAR(50) NULL DEFAULT NULL,
            new_status VARCHAR(50) NOT NULL,
            action_performed VARCHAR(80) NOT NULL,
            remarks TEXT NULL DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sa_req_hist_req (request_id, created_at),
            INDEX idx_sa_req_hist_actor (actor_user_id),
            CONSTRAINT fk_sa_req_hist_request FOREIGN KEY (request_id) REFERENCES sa_requests(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    if (function_exists('schema_guard_mark_ready')) {
        schema_guard_mark_ready('request_tables_v3');
    }
}

/**
 * Generates a unique, sequential reference number for a request (e.g. NCST-REQ-2026-0001).
 */
function generate_request_ref_no(PDO $pdo): string
{
    $year = date('Y');
    $prefix = "NCST-REQ-{$year}-";
    $stmt = $pdo->prepare("SELECT request_ref_no FROM sa_requests WHERE request_ref_no LIKE ? ORDER BY id DESC LIMIT 1");
    $stmt->execute([$prefix . '%']);
    $last = $stmt->fetchColumn();
    if ($last && preg_match('/-(\d+)$/', (string) $last, $m)) {
        $seq = (int) $m[1] + 1;
    } else {
        $seq = 1;
    }
    return $prefix . str_pad((string) $seq, 4, '0', STR_PAD_LEFT);
}

/**
 * Validates whether a transition action is allowed for the actor's role and the request's current status.
 * Throws a domain error via fail() if invalid.
 */
function assert_valid_request_transition(
    string $transitionKey,
    string $actorRole,
    ?string $currentStatus,
    ?string $remarks = ''
): array {
    $remarks = (string) ($remarks ?? '');
    $rule = REQUEST_TRANSITION_MATRIX[$transitionKey] ?? null;
    if (!$rule) {
        fail("Unknown workflow transition '{$transitionKey}'.", 422);
    }

    if (!in_array($actorRole, $rule['allowedRoles'], true)) {
        audit('REQUEST_UNAUTHORIZED_ROLE', "Role {$actorRole} attempted {$transitionKey}");
        fail('You do not have permission to perform this workflow action.', 403);
    }

    if (!in_array($currentStatus, $rule['fromStatuses'], true)) {
        $fromLabel = $currentStatus === null ? 'NEW' : (REQUEST_STATUSES[$currentStatus] ?? $currentStatus);
        $toLabel = REQUEST_STATUSES[$rule['toStatus']] ?? $rule['toStatus'];
        fail(
            "Invalid workflow status transition: cannot perform {$transitionKey} (-> {$toLabel}) when request is in '{$fromLabel}' status.",
            409,
            ['code' => 'INVALID_STATUS_TRANSITION', 'currentStatus' => $currentStatus, 'targetStatus' => $rule['toStatus']]
        );
    }

    if (!empty($rule['requiresRemarks']) && trim($remarks) === '') {
        fail('A reason or remark is required for this action.', 422, ['code' => 'REMARKS_REQUIRED']);
    }

    return $rule;
}

/**
 * Resolves the authenticated Student Assistant's active profile, department, location, and assigned supervisor.
 */
function resolve_sa_requester_context(PDO $pdo, int $userId, int $semesterId): array
{
    $stmt = $pdo->prepare("
        SELECT p.*, o.name AS office_name, o.code AS office_code
          FROM sa_profiles p
          LEFT JOIN offices o ON o.id = p.office_id
         WHERE p.user_id = ? AND p.archived_at IS NULL
         LIMIT 1
    ");
    $stmt->execute([$userId]);
    $profile = $stmt->fetch();
    if (!$profile) {
        fail('No active Student Assistant profile is linked to your account.', 403);
    }
    if (($profile['sa_status'] ?? 'ACTIVE') !== 'ACTIVE') {
        fail('Your Student Assistant profile is currently inactive.', 403);
    }

    $saProfileId = (int) $profile['id'];
    $cat = strtoupper((string) ($profile['sa_category'] ?? 'OFFICE'));
    $rawOffice = ($profile['office_name'] ?? '') === 'PRMD' ? 'PRD' : (string) ($profile['office_name'] ?? '');

    $deptLabel = $rawOffice;
    if ($rawOffice === 'HR') $deptLabel = 'Human Resources (HR)';
    elseif ($rawOffice === 'REGISTRAR' || $rawOffice === 'RECORDS') $deptLabel = "Registrar's Office";
    elseif ($rawOffice === 'LIBRARY') $deptLabel = 'Library';
    elseif ($rawOffice === 'OSA') $deptLabel = 'Student Affairs Office (SAO)';
    elseif ($rawOffice === 'ACAD_OFFICE') $deptLabel = 'Academic Affairs (ACADS)';
    elseif ($rawOffice === 'ITO_OFFICE' || $rawOffice === 'ITJPO' || $cat === 'ITO') $deptLabel = 'IT Office (ITO)';
    elseif ($rawOffice === 'TOOLS ROOM') $deptLabel = 'Tools Room';
    elseif ($rawOffice === 'HRM BAR') $deptLabel = 'HRM Bar';
    elseif ($rawOffice === 'PURCHASING') $deptLabel = 'Purchasing Office';
    elseif ($rawOffice === 'FMO') $deptLabel = 'Finance & Management Office';
    elseif ($rawOffice === 'SHS OFFICE' || $rawOffice === 'SHS-TVL') $deptLabel = 'Senior High School Office';
    elseif ($rawOffice === 'PSMO') $deptLabel = 'Physical Support & Maintenance Office (PSMO)';
    elseif ($rawOffice === 'OCM') $deptLabel = 'Office of the Campus Ministry (OCM)';
    elseif ($rawOffice === '') {
        if ($cat === 'LAB' || $cat === 'ROOM') $deptLabel = 'Computer Laboratory';
        elseif ($cat === 'ACADS') $deptLabel = 'Academic Affairs (ACADS)';
        elseif ($cat === 'ITO') $deptLabel = 'IT Office (ITO)';
        else $deptLabel = 'General Administrative Office';
    }

    $department = $deptLabel;
    $location = $deptLabel;

    // Check active schedule_assignments for more specific department/location/supervisor if present
    $asgnStmt = $pdo->prepare("
        SELECT department, location, supervisor_id
          FROM schedule_assignments
         WHERE semester_id = ? AND sa_profile_id = ?
         ORDER BY id DESC LIMIT 1
    ");
    $asgnStmt->execute([$semesterId, $saProfileId]);
    $firstAsgn = $asgnStmt->fetch();
    if ($firstAsgn) {
        if (!empty($firstAsgn['location']) && !in_array($firstAsgn['location'], ['OFFICE', 'ROOM'], true)) {
            $loc = (string) $firstAsgn['location'];
            if ($loc === 'HR') $loc = 'Human Resources (HR)';
            $location = $loc;
            $department = $loc;
        } elseif (!empty($firstAsgn['department']) && !in_array($firstAsgn['department'], ['OFFICE', 'ROOM'], true)) {
            $department = (string) $firstAsgn['department'];
            $location = $department;
        }
    }

    // Resolve Immediate Supervisor ID
    $assignedSupervisorId = !empty($profile['supervisor_id'])
        ? (int) $profile['supervisor_id']
        : (!empty($firstAsgn['supervisor_id']) ? (int) $firstAsgn['supervisor_id'] : null);
    if (!$assignedSupervisorId) {
        // Resolve by office_id or supervisor_category (ITO / ACADS / OFFICE)
        $officeId = !empty($profile['office_id']) ? (int) $profile['office_id'] : null;
        if ($officeId) {
            $supStmt = $pdo->prepare("
                SELECT u.id
                  FROM users u
                  LEFT JOIN supervisor_offices so ON so.supervisor_id = u.id
                 WHERE u.role = 'SUPERVISOR'
                   AND u.status IN ('ACTIVE', 'PENDING_ACTIVATION')
                   AND (u.office_id = ? OR so.office_id = ?)
                 ORDER BY u.id ASC LIMIT 1
            ");
            $supStmt->execute([$officeId, $officeId]);
            $foundSup = $supStmt->fetchColumn();
            if ($foundSup) {
                $assignedSupervisorId = (int) $foundSup;
            }
        }
        if (!$assignedSupervisorId && in_array($cat, ['ITO', 'ACADS'], true)) {
            $supStmt = $pdo->prepare("
                SELECT id FROM users
                 WHERE role = 'SUPERVISOR'
                   AND status IN ('ACTIVE', 'PENDING_ACTIVATION')
                   AND supervisor_category = ?
                 ORDER BY id ASC LIMIT 1
            ");
            $supStmt->execute([$cat]);
            $foundSup = $supStmt->fetchColumn();
            if ($foundSup) {
                $assignedSupervisorId = (int) $foundSup;
            }
        }
    }

    $supervisorName = null;
    if ($assignedSupervisorId) {
        $snStmt = $pdo->prepare("SELECT full_name FROM users WHERE id = ? LIMIT 1");
        $snStmt->execute([$assignedSupervisorId]);
        $supervisorName = $snStmt->fetchColumn() ?: null;
    }

    $fullName = trim(implode(' ', array_filter([
        $profile['first_name'] ?? '',
        $profile['middle_name'] ?? '',
        $profile['last_name'] ?? '',
        $profile['suffix'] ?? '',
    ])));

    return [
        'profile'              => $profile,
        'saProfileId'          => $saProfileId,
        'saUserId'             => $userId,
        'fullName'             => $fullName,
        'studentId'            => $profile['student_id'] ?? null,
        'saNumber'             => $profile['sa_number'] ?? null,
        'course'               => $profile['course'] ?? null,
        'yearLevel'            => isset($profile['year_level']) ? (int) $profile['year_level'] : null,
        'saCategory'           => $cat,
        'department'           => $department,
        'location'             => $location,
        'assignedSupervisorId' => $assignedSupervisorId,
        'supervisorName'       => $supervisorName,
    ];
}

/**
 * Resolves a Supervisor's authorized scope (category, office IDs, office names).
 */
function resolve_supervisor_request_scope(PDO $pdo, array $supervisorUser): array
{
    $supId = (int) ($supervisorUser['id'] ?? 0);
    $category = strtoupper((string) ($supervisorUser['supervisor_category'] ?? 'OFFICE'));
    $officeIds = [];
    $officeNames = [];

    if (!empty($supervisorUser['office_id'])) {
        $officeIds[] = (int) $supervisorUser['office_id'];
    }

    $stmt = $pdo->prepare("
        SELECT o.id, o.name
          FROM offices o
         WHERE o.id = ?
         UNION
        SELECT o.id, o.name
          FROM supervisor_offices so
          JOIN offices o ON o.id = so.office_id
         WHERE so.supervisor_id = ?
    ");
    $stmt->execute([(int) ($supervisorUser['office_id'] ?? 0), $supId]);
    foreach ($stmt->fetchAll() as $row) {
        $oid = (int) $row['id'];
        if (!in_array($oid, $officeIds, true)) {
            $officeIds[] = $oid;
        }
        $oname = $row['name'] === 'PRMD' ? 'PRD' : (string) $row['name'];
        if ($oname !== '' && !in_array($oname, $officeNames, true)) {
            $officeNames[] = $oname;
            if ($row['name'] === 'PRMD' && !in_array('PRMD', $officeNames, true)) {
                $officeNames[] = 'PRMD';
            }
        }
    }

    return [
        'supervisorId' => $supId,
        'category'     => $category,
        'officeIds'    => $officeIds,
        'officeNames'  => $officeNames,
    ];
}

/**
 * Checks whether a Supervisor user is authorized to view and act on a specific request row.
 * Uses server-side session & database relations (never trusts client-submitted supervisor IDs).
 */
function can_supervisor_access_sa_request(PDO $pdo, array $supervisorUser, array $requestRow): bool
{
    if (($supervisorUser['role'] ?? '') !== 'SUPERVISOR') {
        return false;
    }

    $supId = (int) $supervisorUser['id'];
    if (!empty($requestRow['assigned_supervisor_id']) && (int) $requestRow['assigned_supervisor_id'] === $supId) {
        return true;
    }

    $scope = resolve_supervisor_request_scope($pdo, $supervisorUser);

    // Fetch the S.A. profile for authoritative supervisor_id, sa_category, and office_id checks
    $stmt = $pdo->prepare("SELECT supervisor_id, sa_category, office_id FROM sa_profiles WHERE id = ? LIMIT 1");
    $stmt->execute([(int) ($requestRow['sa_profile_id'] ?? 0)]);
    $saProfile = $stmt->fetch();
    if (!$saProfile) {
        return false;
    }

    if (!empty($saProfile['supervisor_id']) && (int) $saProfile['supervisor_id'] === $supId) {
        return true;
    }

    $saCat = strtoupper((string) ($saProfile['sa_category'] ?? ''));
    $reqDept = strtoupper((string) ($requestRow['department'] ?? ''));

    if ($scope['category'] === 'ITO' && ($saCat === 'ITO' || $reqDept === 'ITO')) {
        return true;
    }
    if ($scope['category'] === 'ACADS' && ($saCat === 'ACADS' || $reqDept === 'ACADS')) {
        return true;
    }

    $saOfficeId = !empty($saProfile['office_id']) ? (int) $saProfile['office_id'] : null;
    if ($saOfficeId && in_array($saOfficeId, $scope['officeIds'], true)) {
        return true;
    }

    if ($reqDept !== '' && in_array($reqDept, $scope['officeNames'], true)) {
        return true;
    }

    $reqLoc = (string) ($requestRow['location'] ?? '');
    if ($reqLoc !== '' && in_array($reqLoc, $scope['officeNames'], true)) {
        return true;
    }

    return false;
}

/**
 * Returns all Supervisor user IDs who should be notified for a given S.A. request.
 */
function get_notifiable_supervisor_ids_for_request(PDO $pdo, array $requestRow): array
{
    $ids = [];
    if (!empty($requestRow['assigned_supervisor_id'])) {
        $ids[] = (int) $requestRow['assigned_supervisor_id'];
    }

    $stmt = $pdo->query("SELECT * FROM users WHERE role = 'SUPERVISOR' AND status IN ('ACTIVE', 'PENDING_ACTIVATION')");
    foreach ($stmt->fetchAll() as $supUser) {
        $sid = (int) $supUser['id'];
        if (!in_array($sid, $ids, true) && can_supervisor_access_sa_request($pdo, $supUser, $requestRow)) {
            $ids[] = $sid;
        }
    }
    return $ids;
}

/**
 * Converts a YYYY-MM-DD date string to AssistPay's 3-letter day enum (MON..SAT).
 * Rejects invalid dates or Sundays (since duty schedules run Monday–Saturday).
 */
function resolve_request_day_of_week(string $dateStr): string
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateStr)) {
        fail('Please provide a valid request date (YYYY-MM-DD).', 422);
    }
    $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $dateStr);
    if (!$dt || $dt->format('Y-m-d') !== $dateStr) {
        fail('The request date is not a valid calendar date.', 422);
    }
    $dowNum = (int) $dt->format('N'); // 1 (Mon) .. 7 (Sun)
    $map = [
        1 => 'MON',
        2 => 'TUE',
        3 => 'WED',
        4 => 'THU',
        5 => 'FRI',
        6 => 'SAT',
    ];
    if (!isset($map[$dowNum])) {
        fail('Requests cannot be filed for Sunday as duty schedules run Monday through Saturday.', 422);
    }
    return $map[$dowNum];
}

/**
 * Parses and validates a time string (HH:MM or HH:MM:SS), returning normalized HH:MM:SS and minutes since midnight.
 */
function parse_request_time(?string $timeStr, string $fieldLabel, bool $required = false): ?array
{
    $trimmed = trim((string) $timeStr);
    if ($trimmed === '') {
        if ($required) {
            fail("{$fieldLabel} is required.", 422);
        }
        return null;
    }
    if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/', $trimmed, $m)) {
        fail("{$fieldLabel} must be a valid 24-hour time (HH:MM).", 422);
    }
    $hh = (int) $m[1];
    $mm = (int) $m[2];
    $ss = isset($m[3]) ? (int) $m[3] : 0;
    return [
        'sql'     => sprintf('%02d:%02d:%02d', $hh, $mm, $ss),
        'minutes' => ($hh * 60) + $mm,
    ];
}

/**
 * Validates and saves a base64-encoded supporting proof document to `uploads/request-documents/`.
 * Allowed formats: PDF, JPG/JPEG, PNG, WEBP (max 5 MB).
 */
function store_request_proof_upload(string $base64Data, string $originalFileName, int $saProfileId): array
{
    $raw = trim($base64Data);
    if ($raw === '') {
        fail('Supporting proof file data is empty.', 422);
    }
    if (preg_match('/^data:([^;]+);base64,(.*)$/s', $raw, $m)) {
        $raw = $m[2];
    }
    $binary = base64_decode($raw, true);
    if ($binary === false || strlen($binary) === 0) {
        fail('Supporting proof could not be decoded. Please upload a valid PDF, JPG, PNG, or WEBP file.', 422);
    }

    $size = strlen($binary);
    if ($size > 5 * 1024 * 1024) {
        fail('Supporting proof file exceeds the 5 MB maximum size limit.', 422);
    }

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $detectedMime = (string) $finfo->buffer($binary);
    $allowedMimes = [
        'application/pdf' => 'pdf',
        'image/jpeg'      => 'jpg',
        'image/png'       => 'png',
        'image/webp'      => 'webp',
    ];
    if (!isset($allowedMimes[$detectedMime])) {
        fail('Unsupported supporting proof format. Only PDF, JPG, PNG, and WEBP files are accepted.', 422);
    }

    $ext = $allowedMimes[$detectedMime];
    $cleanOriginal = trim(preg_replace('/[^\w.\- ()]/u', '_', basename($originalFileName ?: ("proof.{$ext}"))));
    if ($cleanOriginal === '') {
        $cleanOriginal = "proof.{$ext}";
    }

    $dir = dirname(__DIR__) . '/uploads/request-documents';
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        fail('Server storage directory for request documents could not be prepared.', 500);
    }

    $storedName = sprintf('req_sa%d_%s_%s.%s', $saProfileId, date('Ymd_His'), bin2hex(random_bytes(6)), $ext);
    $fullPath = $dir . '/' . $storedName;
    if (file_put_contents($fullPath, $binary) === false) {
        fail('Could not write the supporting proof file to disk.', 500);
    }

    return [
        'fileName'   => mb_substr($cleanOriginal, 0, 255),
        'storedName' => $storedName,
        'mimeType'   => $detectedMime,
        'fileSize'   => $size,
    ];
}

/**
 * Inserts an immutable workflow history entry into `sa_request_history`.
 * IMPORTANT: Must be called inside an active database transaction. Throws an exception if insertion fails
 * so the caller's transaction rolls back completely and no status transition persists without history.
 */
function record_request_history_entry(
    PDO $pdo,
    int $requestId,
    ?int $actorUserId,
    string $actorName,
    string $actorRole,
    ?string $previousStatus,
    string $newStatus,
    string $actionPerformed,
    ?string $remarks = null
): int {
    // Allow deterministic test simulation of a history-insert failure to verify transaction rollback
    if (PHP_SAPI === 'cli' && !empty($GLOBALS['__TEST_SIMULATE_HISTORY_FAILURE'])) {
        throw new RuntimeException('Simulated sa_request_history insertion failure.');
    }

    if ($requestId <= 0) {
        throw new InvalidArgumentException('Invalid request_id for history entry.');
    }

    $stmt = $pdo->prepare("
        INSERT INTO sa_request_history (
            request_id, actor_user_id, actor_name, actor_role,
            previous_status, new_status, action_performed, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $ok = $stmt->execute([
        $requestId,
        $actorUserId,
        mb_substr(trim($actorName) ?: 'System', 0, 160),
        mb_substr(trim($actorRole) ?: 'SYSTEM', 0, 40),
        $previousStatus,
        $newStatus,
        mb_substr(trim($actionPerformed), 0, 80),
        $remarks !== null && trim($remarks) !== '' ? trim($remarks) : null,
    ]);

    $histId = (int) $pdo->lastInsertId();
    if (!$ok || $histId <= 0) {
        throw new RuntimeException('Failed to persist immutable request history entry.');
    }
    return $histId;
}

/**
 * Checks whether the S.A. already has an active/recorded request of the same type on the same date/period
 * with overlapping hours or dates (excluding the current request ID when editing/resubmitting).
 */
function assert_no_duplicate_active_request(
    PDO $pdo,
    int $saProfileId,
    string $requestType,
    string $requestDate,
    ?string $requestedStartSql,
    ?string $requestedEndSql,
    ?int $excludeRequestId = null,
    ?string $requestEndDate = null
): void {
    // Specialized overlap check for multi-day Excuse Slips
    if ($requestType === 'EXCUSE_SLIP') {
        $toDate = ($requestEndDate !== null && trim($requestEndDate) !== '') ? trim($requestEndDate) : $requestDate;
        $sql = "
            SELECT id, request_ref_no, status, request_date, request_end_date
              FROM sa_requests
             WHERE sa_profile_id = ?
               AND request_type = 'EXCUSE_SLIP'
               AND status IN (
                   'PENDING_SUPERVISOR_REVIEW',
                   'RETURNED_TO_SA',
                   'PENDING_COORDINATOR_RECORDING',
                   'RETURNED_FOR_CLARIFICATION',
                   'RECORDED'
               )
               AND request_date <= ?
               AND COALESCE(request_end_date, request_date) >= ?
        ";
        $params = [$saProfileId, $toDate, $requestDate];
        if ($excludeRequestId !== null && $excludeRequestId > 0) {
            $sql .= " AND id != ?";
            $params[] = $excludeRequestId;
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $existingRows = $stmt->fetchAll();

        foreach ($existingRows as $row) {
            $exStart = $row['request_date'];
            $exEnd = !empty($row['request_end_date']) ? $row['request_end_date'] : $exStart;
            $rangeText = $exStart === $exEnd ? $exStart : "{$exStart} to {$exEnd}";
            fail(
                "An active Excuse Slip ({$row['request_ref_no']}) already covers an overlapping absence period ({$rangeText}) with status '" . (REQUEST_STATUSES[$row['status']] ?? $row['status']) . "'. Duplicate or overlapping excuse requests are not permitted.",
                409,
                ['code' => 'DUPLICATE_REQUEST', 'existingRequestId' => (int) $row['id'], 'existingRefNo' => $row['request_ref_no']]
            );
        }
        return;
    }

    $sql = "
        SELECT id, request_ref_no, status, requested_start, requested_end
          FROM sa_requests
         WHERE sa_profile_id = ?
           AND request_type = ?
           AND request_date = ?
           AND status IN (
               'PENDING_SUPERVISOR_REVIEW',
               'RETURNED_TO_SA',
               'PENDING_COORDINATOR_RECORDING',
               'RETURNED_FOR_CLARIFICATION',
               'RECORDED'
           )
    ";
    $params = [$saProfileId, $requestType, $requestDate];
    if ($excludeRequestId !== null && $excludeRequestId > 0) {
        $sql .= " AND id != ?";
        $params[] = $excludeRequestId;
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $existingRows = $stmt->fetchAll();

    foreach ($existingRows as $row) {
        $exStart = $row['requested_start'];
        $exEnd = $row['requested_end'];
        // If either request has no specific start/end window or their time intervals overlap, reject as duplicate
        if (!$requestedStartSql || !$requestedEndSql || !$exStart || !$exEnd) {
            fail(
                "A {$requestType} request ({$row['request_ref_no']}) already exists for {$requestDate} with status '" . (REQUEST_STATUSES[$row['status']] ?? $row['status']) . "'.",
                409,
                ['code' => 'DUPLICATE_REQUEST', 'existingRequestId' => (int) $row['id'], 'existingRefNo' => $row['request_ref_no']]
            );
        }
        if ($requestedStartSql < $exEnd && $requestedEndSql > $exStart) {
            fail(
                "An overlapping {$requestType} request ({$row['request_ref_no']}) already exists for {$requestDate} ({$exStart}–{$exEnd}).",
                409,
                ['code' => 'DUPLICATE_REQUEST', 'existingRequestId' => (int) $row['id'], 'existingRefNo' => $row['request_ref_no']]
            );
        }
    }
}

/**
 * Strict Excuse Slip Date & Cutoff Validation Policy
 *
 * Enforces institutional date rules for Student Assistant Excuse Slips:
 * 1. Asia/Manila server timestamp enforcement (never trusts browser clock or date_filed).
 * 2. Advance excuse requests:
 *    - Must be filed at least three calendar days before the from_date of the absence period.
 *    - Calculated using exact server Asia/Manila timestamp and absence start date (00:00:00).
 *    - Example: absence on Oct 21, 2026, filing on Oct 17 is valid for submission.
 * 3. Sudden or retrospective absence:
 *    - If absence has already occurred or occurs today, allowed if submitted within the configured
 *      cutoff period covering that absence in allowance_cutoffs.
 *    - Normal submissions accepted only until 11:59:59 PM Philippine time on cutoff end_date.
 * 4. Expired cutoff:
 *    - If filing is past the cutoff submission deadline, reject normal submission with exact message:
 *      "The submission deadline for this absence has passed. This excuse slip can no longer be submitted through the normal approval process."
 *    - Records audit log EXCUSE_SLIP_CUTOFF_EXPIRED and prevents creating pending approval records.
 * 5. Date range validation:
 *    - from_date <= to_date, valid calendar dates, Monday–Saturday duty days.
 *    - Entire absence range must fall within a single configured cutoff period.
 *    - If dates cross cutoffs, institutional policy rejects and instructs to file per cutoff.
 *    - Prevents duplicate or overlapping active excuse requests for the same S.A.
 */
function validate_excuse_slip_policy(
    PDO $pdo,
    int $saProfileId,
    int $semesterId,
    string $fromDate,
    ?string $toDate = null,
    ?int $excludeRequestId = null,
    ?DateTimeImmutable $overrideNow = null
): array {
    $tz = new DateTimeZone('Asia/Manila');
    $serverNow = $overrideNow ?: new DateTimeImmutable('now', $tz);
    $serverNow = $serverNow->setTimezone($tz);
    $nowDate = $serverNow->format('Y-m-d');
    $nowTimestamp = $serverNow->getTimestamp();

    // 1. Date format and day of week validation
    $fromDow = resolve_request_day_of_week($fromDate);
    $cleanToDate = ($toDate !== null && trim($toDate) !== '') ? trim($toDate) : $fromDate;
    $toDow = resolve_request_day_of_week($cleanToDate);

    if ($cleanToDate < $fromDate) {
        fail('Absence end date cannot be earlier than absence start date.', 422);
    }

    // 2. Fetch all configured cutoffs for this semester
    $cStmt = $pdo->prepare("
        SELECT id, semester_id, cutoff_code, cutoff_name, start_date, end_date, status
          FROM allowance_cutoffs
         WHERE semester_id = ?
         ORDER BY start_date ASC
    ");
    $cStmt->execute([$semesterId]);
    $cutoffs = $cStmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($cutoffs)) {
        fail('No allowance cutoff periods are configured for the current semester.', 500);
    }

    // Find cutoff covering fromDate
    $fromCutoff = null;
    foreach ($cutoffs as $c) {
        if ($fromDate >= $c['start_date'] && $fromDate <= $c['end_date']) {
            $fromCutoff = $c;
            break;
        }
    }

    // Find cutoff covering toDate
    $toCutoff = null;
    foreach ($cutoffs as $c) {
        if ($cleanToDate >= $c['start_date'] && $cleanToDate <= $c['end_date']) {
            $toCutoff = $c;
            break;
        }
    }

    if (!$fromCutoff) {
        fail("The absence start date ({$fromDate}) is not covered by any configured cutoff period for this semester.", 422);
    }
    if (!$toCutoff) {
        fail("The absence end date ({$cleanToDate}) is not covered by any configured cutoff period for this semester.", 422);
    }

    // Cross-cutoff validation: institutional policy processes allowance cutoffs separately
    if ((int) $fromCutoff['id'] !== (int) $toCutoff['id']) {
        fail(
            "The requested absence range ({$fromDate} to {$cleanToDate}) crosses multiple cutoff periods ({$fromCutoff['cutoff_name']} and {$toCutoff['cutoff_name']}). In accordance with institutional payroll policy, please file separate excuse slips for each cutoff period.",
            422,
            ['code' => 'CROSS_CUTOFF_RANGE', 'fromCutoff' => $fromCutoff, 'toCutoff' => $toCutoff]
        );
    }

    $applicableCutoff = $fromCutoff;

    // 3. Check Advance vs Same-Day vs Retrospective rule
    $isAdvance = ($fromDate > $nowDate);
    $isSameDayOrOngoing = ($fromDate === $nowDate || ($fromDate < $nowDate && $cleanToDate >= $nowDate));

    if ($isSameDayOrOngoing) {
        audit(
            'EXCUSE_SLIP_SAME_DAY_BLOCKED',
            "SA profile #{$saProfileId} attempted same-day excuse slip for {$fromDate} to {$cleanToDate} on server date {$nowDate} Asia/Manila"
        );
        fail(
            "Excuse slips cannot be filed on the same day as the absence ({$fromDate}). Advance excuse requests require at least three (3) calendar days notice, while retrospective requests may only be filed starting the day after the absence has concluded.",
            422,
            [
                'code'            => 'SAME_DAY_FILING_NOT_ALLOWED',
                'fromDate'        => $fromDate,
                'toDate'          => $cleanToDate,
                'serverDate'      => $nowDate,
                'serverTimestamp' => $serverNow->format('Y-m-d H:i:s'),
            ]
        );
    }

    if ($isAdvance) {
        // Rule B: Advance excuse requests
        // Must be filed at least three calendar days before the from_date of the absence period.
        // Start of absence is fromDate 00:00:00 Asia/Manila.
        // Deadline to meet the 3 calendar days requirement is 3 calendar days prior at 23:59:59.
        $absenceStartDt = new DateTimeImmutable($fromDate . ' 00:00:00', $tz);
        $advanceDeadlineDt = $absenceStartDt->modify('-3 days')->setTime(23, 59, 59);

        if ($serverNow > $advanceDeadlineDt) {
            $daysDiff = (int) floor(($absenceStartDt->getTimestamp() - $nowTimestamp) / 86400);
            audit(
                'EXCUSE_SLIP_ADVANCE_NOTICE_INSUFFICIENT',
                "SA profile #{$saProfileId} attempted advance filing for {$fromDate} on {$serverNow->format('Y-m-d H:i:s')} Asia/Manila ({$daysDiff} calendar day(s) notice; minimum 3 days required)"
            );
            fail(
                "Advance excuse requests must be filed at least three (3) calendar days prior to the start of the absence period ({$fromDate}).",
                422,
                [
                    'code'            => 'ADVANCE_NOTICE_INSUFFICIENT',
                    'advanceDeadline' => $advanceDeadlineDt->format('Y-m-d H:i:s'),
                    'serverTimestamp' => $serverNow->format('Y-m-d H:i:s'),
                    'daysNotice'      => $daysDiff,
                ]
            );
        }
    } else {
        // Rule C & D: Sudden or Retrospective absence
        // Absence occurred today or in the past.
        // Retrieve configurable grace period (default: 2 calendar days)
        $graceDays = (int) get_system_setting($pdo, 'excuseSlipGraceDays', 2);
        if ($graceDays < 0) {
            $graceDays = 2;
        }

        // Must be submitted on or before 11:59:59 PM Philippine time on cutoff end_date + grace period
        $cutoffEndDt = new DateTimeImmutable($applicableCutoff['end_date'] . ' 00:00:00', $tz);
        $cutoffDeadlineDt = $cutoffEndDt->modify("+{$graceDays} days")->setTime(23, 59, 59);

        if ($serverNow > $cutoffDeadlineDt) {
            // Cutoff submission deadline has passed!
            audit(
                'EXCUSE_SLIP_CUTOFF_EXPIRED',
                "Blocked submission for SA profile #{$saProfileId}: absence {$fromDate} in cutoff {$applicableCutoff['cutoff_code']} ({$applicableCutoff['start_date']} to {$applicableCutoff['end_date']}) expired on {$cutoffDeadlineDt->format('Y-m-d H:i:s')} Asia/Manila (grace period: {$graceDays} days). Submission attempted at {$serverNow->format('Y-m-d H:i:s')} Asia/Manila."
            );
            fail(
                "The submission deadline for this absence has passed. Submissions for cutoff {$applicableCutoff['cutoff_name']} closed on " . $cutoffDeadlineDt->format('F j, Y \a\t g:i:s A') . ". This excuse slip can no longer be submitted through the normal approval process.",
                422,
                [
                    'code'            => 'CUTOFF_EXPIRED',
                    'cutoff'          => $applicableCutoff,
                    'graceDays'       => $graceDays,
                    'cutoffDeadline'  => $cutoffDeadlineDt->format('Y-m-d H:i:s'),
                    'serverTimestamp' => $serverNow->format('Y-m-d H:i:s'),
                ]
            );
        }
    }

    // 4. Rule E: Prevent duplicate or overlapping active excuse requests
    assert_no_duplicate_active_request(
        $pdo,
        $saProfileId,
        'EXCUSE_SLIP',
        $fromDate,
        null,
        null,
        $excludeRequestId,
        $cleanToDate
    );

    return [
        'isAdvance'        => $isAdvance,
        'serverNow'        => $serverNow,
        'dateFiled'        => $nowDate,
        'fromDate'         => $fromDate,
        'toDate'           => $cleanToDate,
        'applicableCutoff' => $applicableCutoff,
        'graceDays'        => $graceDays ?? 0,
        'cutoffDeadline'   => isset($cutoffDeadlineDt) ? $cutoffDeadlineDt->format('Y-m-d H:i:s') : ($applicableCutoff['end_date'] . ' 23:59:59'),
    ];
}

/**
 * Detects blank, whitespace-only, or meaningless placeholder text.
 */
function is_meaningless_placeholder_text(string $text): bool
{
    $clean = trim($text);
    if (mb_strlen($clean) < 4) {
        return true;
    }
    $lower = strtolower($clean);
    $placeholders = [
        'ot work', 'ot', 'overtime', 'none', 'n/a', 'na', 'asdf', 'test',
        'testing', 'work', 'sample', 'xxx', 'duty', 'duty work', 'none.',
        'n / a', 'not applicable', 'no reason', 'n.a.', 'n.a', 'whatever',
        'something', 'nothing', 'regular duty', 'extra work', 'etc', 'etc.'
    ];
    if (in_array($lower, $placeholders, true)) {
        return true;
    }
    if (preg_match('/^(.)\1{3,}$/', $lower)) {
        return true;
    }
    return false;
}

/**
 * Strict Overtime Request Validation Policy
 *
 * Enforces institutional date, duty schedule, cutoff, and whole-hour rules for Student Assistant Overtime Forms:
 * 1. Asia/Manila authoritative server time. Never trusts client-submitted timestamp or browser clock.
 * 2. Published Duty Schedule Validation:
 *    - Authoritative regular duty hours retrieved from schedule_assignments for the S.A.
 *    - Overtime must occur strictly outside regular duty hours and must not overlap scheduled duty.
 *    - Rejects future OT dates or future OT hours on today's date (work must be completed).
 *    - If schedule is missing for the date's day of week, blocks submission with verification requirement.
 * 3. Whole-Hour Increments Only:
 *    - OT duration must be a positive whole integer of hours (1, 2, 3, etc.).
 *    - Fractional durations (e.g. 30m, 1.5h, 2.5h) are rejected.
 * 4. Required Task & Justification:
 *    - Meaningful "Task to Accomplish" required for every OT row (rejects placeholder text like "OT work", "test", etc.).
 *    - Meaningful request-level "Reason / Justification" required (minimum 10 characters, not placeholder text).
 * 5. Cutoff-Based Filing Rules & 2-Calendar-Day Grace Period:
 *    - Evaluated against allowance_cutoffs configured for the semester.
 *    - Submissions accepted only until 11:59:59 PM Philippine time on (cutoff end_date + 2 calendar days).
 *    - At 12:00:00 AM of the 3rd day, filing is strictly rejected, logged as OVERTIME_CUTOFF_EXPIRED in audit log,
 *      and prevented from entering normal approval queue.
 *    - All rows in a submission must belong to the same eligible cutoff period.
 * 6. Overlap Prevention:
 *    - Rejects overlapping OT rows within the same submission.
 *    - Rejects overlapping OT hours against existing active or recorded OT requests in sa_requests.
 */
function validate_overtime_request_policy(
    PDO $pdo,
    int $saProfileId,
    int $semesterId,
    array $payload,
    ?int $excludeRequestId = null,
    ?DateTimeImmutable $overrideNow = null
): array {
    $tz = new DateTimeZone('Asia/Manila');
    $serverNow = $overrideNow ?: new DateTimeImmutable('now', $tz);
    $serverNow = $serverNow->setTimezone($tz);
    $nowDate = $serverNow->format('Y-m-d');
    $nowTimeMinutes = ((int) $serverNow->format('H')) * 60 + ((int) $serverNow->format('i'));
    $nowTimeDisplay = $serverNow->format('h:i A');

    // 1. Required Reason / Justification
    $explanation = trim((string) ($payload['explanation'] ?? ''));
    if (mb_strlen($explanation) < 10 || is_meaningless_placeholder_text($explanation)) {
        fail('Please provide a detailed Reason / Justification for this overtime request (at least 10 characters, not placeholder text).', 422);
    }

    // 2. Extract OT rows to validate
    $rawRows = [];
    if (!empty($payload['overtimeRows']) && is_array($payload['overtimeRows'])) {
        $rawRows = $payload['overtimeRows'];
    } elseif (!empty($payload['overtimeRowsJson'])) {
        $decoded = json_decode((string) $payload['overtimeRowsJson'], true);
        if (is_array($decoded)) {
            $rawRows = $decoded;
        }
    }

    // If no multi-row array was provided, synthesize single row from request payload
    if (empty($rawRows)) {
        $reqDate = trim((string) ($payload['requestDate'] ?? ''));
        $reqStart = trim((string) ($payload['requestedStart'] ?? ''));
        $reqEnd = trim((string) ($payload['requestedEnd'] ?? ''));
        if ($reqDate !== '' && $reqStart !== '' && $reqEnd !== '') {
            $rawRows[] = [
                'date'    => $reqDate,
                'task'    => $explanation,
                'otStart' => substr($reqStart, 0, 5),
                'otEnd'   => substr($reqEnd, 0, 5),
            ];
        }
    }

    if (empty($rawRows)) {
        fail('Please provide at least one Overtime Details row.', 422);
    }

    // 3. Fetch all cutoffs for semester
    $cStmt = $pdo->prepare("
        SELECT id, semester_id, cutoff_code, cutoff_name, start_date, end_date, status
          FROM allowance_cutoffs
         WHERE semester_id = ?
         ORDER BY start_date ASC
    ");
    $cStmt->execute([$semesterId]);
    $cutoffs = $cStmt->fetchAll(PDO::FETCH_ASSOC);
    if (empty($cutoffs)) {
        fail('No allowance cutoff periods are configured for the current semester.', 500);
    }

    $validatedRows = [];
    $totalOtMinutes = 0;
    $assignedCutoff = null;
    $assignedDeadlineDt = null;

    // 4. Validate each row
    foreach ($rawRows as $idx => $row) {
        $rowNum = $idx + 1;
        $rDate = trim((string) ($row['date'] ?? ''));
        if ($rDate === '') {
            fail("Row #{$rowNum}: Overtime date is required.", 422);
        }

        $rDow = resolve_request_day_of_week($rDate);

        // Future date check
        if ($rDate > $nowDate) {
            fail("Row #{$rowNum}: Cannot file overtime for a future date ({$rDate}). Overtime may only be filed for completed work dates.", 422);
        }

        // Meaningful task check
        $rTask = trim((string) ($row['task'] ?? ''));
        if (mb_strlen($rTask) < 4 || is_meaningless_placeholder_text($rTask)) {
            fail("Row #{$rowNum}: Please provide a meaningful Task to Accomplish (not placeholder text like '{$rTask}').", 422);
        }

        // Authoritative published schedule check
        $sStmt = $pdo->prepare("
            SELECT id, day_of_week, start_time, end_time, department, location
              FROM schedule_assignments
             WHERE sa_profile_id = ? AND semester_id = ? AND day_of_week = ?
             ORDER BY start_time ASC
        ");
        $sStmt->execute([$saProfileId, $semesterId, $rDow]);
        $dutyAssignments = $sStmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($dutyAssignments)) {
            fail("Row #{$rowNum}: No published regular duty schedule found for {$rDate} ({$rDow}). Overtime must be validated against your authoritative duty schedule. Please contact your coordinator to verify your schedule.", 422);
        }

        $earliestReg = parse_request_time((string) $dutyAssignments[0]['start_time'], 'Scheduled start', true);
        $latestReg = parse_request_time((string) $dutyAssignments[count($dutyAssignments) - 1]['end_time'], 'Scheduled end', true);

        // Parse OT times
        $rOtStart = trim((string) ($row['otStart'] ?? ''));
        $rOtEnd = trim((string) ($row['otEnd'] ?? ''));
        $parsedOtS = parse_request_time($rOtStart, "Row #{$rowNum} O.T. start time", true);
        $parsedOtE = parse_request_time($rOtEnd, "Row #{$rowNum} O.T. end time", true);

        if ($parsedOtE['minutes'] <= $parsedOtS['minutes']) {
            fail("Row #{$rowNum}: Overtime end time must be later than overtime start time.", 422);
        }

        // Whole-hour rule check
        $otDurationMinutes = $parsedOtE['minutes'] - $parsedOtS['minutes'];
        if (($otDurationMinutes % 60) !== 0) {
            $durationHours = round($otDurationMinutes / 60, 2);
            fail(
                "Overtime must be filed in whole-hour increments only.",
                422,
                [
                    'code'            => 'WHOLE_HOURS_ONLY',
                    'row'             => $rowNum,
                    'durationMinutes' => $otDurationMinutes,
                    'durationHours'   => $durationHours,
                ]
            );
        }

        // Today's future hours check
        if ($rDate === $nowDate && $parsedOtE['minutes'] > $nowTimeMinutes) {
            fail("Row #{$rowNum}: Overtime end time (" . substr($parsedOtE['sql'], 0, 5) . ") cannot be in the future for today's date ({$rDate}). Current server time is {$nowTimeDisplay} Asia/Manila. Overtime may only be filed after the work hours have been completed.", 422);
        }

        // Overlap with regular duty schedule check
        foreach ($dutyAssignments as $asgn) {
            $pAsgnS = parse_request_time((string) $asgn['start_time'], 'Assignment start', true);
            $pAsgnE = parse_request_time((string) $asgn['end_time'], 'Assignment end', true);
            if ($parsedOtS['minutes'] < $pAsgnE['minutes'] && $parsedOtE['minutes'] > $pAsgnS['minutes']) {
                $asgnStartDisp = substr($pAsgnS['sql'], 0, 5);
                $asgnEndDisp = substr($pAsgnE['sql'], 0, 5);
                $otStartDisp = substr($parsedOtS['sql'], 0, 5);
                $otEndDisp = substr($parsedOtE['sql'], 0, 5);
                fail("Row #{$rowNum}: Overtime ({$otStartDisp}–{$otEndDisp}) overlaps with scheduled regular duty hours ({$asgnStartDisp}–{$asgnEndDisp}) on {$rDate}. Overtime must occur strictly outside regular duty hours.", 422);
            }
        }

        // Cutoff matching
        $rowCutoff = null;
        foreach ($cutoffs as $c) {
            if ($rDate >= $c['start_date'] && $rDate <= $c['end_date']) {
                $rowCutoff = $c;
                break;
            }
        }
        if (!$rowCutoff) {
            fail("Row #{$rowNum}: Overtime date ({$rDate}) is not covered by any configured cutoff period for this semester.", 422);
        }

        if ($assignedCutoff === null) {
            $assignedCutoff = $rowCutoff;
            $otGraceDays = (int) get_system_setting($pdo, 'overtimeGraceDays', 2);
            if ($otGraceDays < 0) {
                $otGraceDays = 2;
            }
            $cutoffEndDt = new DateTimeImmutable($assignedCutoff['end_date'] . ' 00:00:00', $tz);
            $assignedDeadlineDt = $cutoffEndDt->modify("+{$otGraceDays} days")->setTime(23, 59, 59);
        } elseif ((int) $assignedCutoff['id'] !== (int) $rowCutoff['id']) {
            fail("Row #{$rowNum}: All overtime dates in a submission must belong to the same cutoff period ({$assignedCutoff['cutoff_name']}). Date {$rDate} belongs to {$rowCutoff['cutoff_name']}. Please file separate overtime requests for each cutoff.", 422);
        }

        // Deadline check: 2 calendar days after cutoff end date through 11:59:59 PM
        if ($serverNow > $assignedDeadlineDt) {
            audit(
                'OVERTIME_CUTOFF_EXPIRED',
                "Blocked overtime submission for SA profile #{$saProfileId}: OT date {$rDate} in cutoff {$assignedCutoff['cutoff_code']} ({$assignedCutoff['start_date']} to {$assignedCutoff['end_date']}) expired on {$assignedDeadlineDt->format('Y-m-d H:i:s')} Asia/Manila. Submission attempted at {$serverNow->format('Y-m-d H:i:s')} Asia/Manila."
            );
            fail(
                "The filing deadline for this overtime date ({$rDate}) has passed. Submissions for cutoff {$assignedCutoff['cutoff_name']} closed on " . $assignedDeadlineDt->format('F j, Y \a\t g:i:s A') . ". This overtime request can no longer be submitted through the normal approval process.",
                422,
                [
                    'code'            => 'CUTOFF_EXPIRED',
                    'cutoff'          => $assignedCutoff,
                    'cutoffDeadline'  => $assignedDeadlineDt->format('Y-m-d H:i:s'),
                    'serverTimestamp' => $serverNow->format('Y-m-d H:i:s'),
                ]
            );
        }

        $regMins = max(0, $latestReg['minutes'] - $earliestReg['minutes']);
        $validatedRows[] = [
            'date'         => $rDate,
            'task'         => $rTask,
            'regularStart' => substr($earliestReg['sql'], 0, 5),
            'regularEnd'   => substr($latestReg['sql'], 0, 5),
            'otStart'      => substr($parsedOtS['sql'], 0, 5),
            'otEnd'        => substr($parsedOtE['sql'], 0, 5),
            'regularHours' => round($regMins / 60, 2),
            'otHours'      => round($otDurationMinutes / 60, 2),
            'otStartMins'  => $parsedOtS['minutes'],
            'otEndMins'    => $parsedOtE['minutes'],
        ];
        $totalOtMinutes += $otDurationMinutes;
    }

    // 5. Check intra-request overlapping rows
    $rowCount = count($validatedRows);
    for ($i = 0; $i < $rowCount; $i++) {
        for ($j = $i + 1; $j < $rowCount; $j++) {
            if ($validatedRows[$i]['date'] === $validatedRows[$j]['date']) {
                $iS = $validatedRows[$i]['otStartMins'];
                $iE = $validatedRows[$i]['otEndMins'];
                $jS = $validatedRows[$j]['otStartMins'];
                $jE = $validatedRows[$j]['otEndMins'];
                if ($iS < $jE && $iE > $jS) {
                    fail("Row #" . ($i + 1) . " and Row #" . ($j + 1) . " have overlapping overtime hours on {$validatedRows[$i]['date']}.", 422);
                }
            }
        }
    }

    // 6. Check existing active or recorded OT requests in database
    $exSql = "
        SELECT id, request_ref_no, status, request_date, requested_start, requested_end, overtime_rows_json
          FROM sa_requests
         WHERE sa_profile_id = ?
           AND request_type = 'OVERTIME'
           AND status IN (
               'PENDING_SUPERVISOR_REVIEW',
               'RETURNED_TO_SA',
               'PENDING_COORDINATOR_RECORDING',
               'RETURNED_FOR_CLARIFICATION',
               'RECORDED'
           )
    ";
    $exParams = [$saProfileId];
    if ($excludeRequestId !== null && $excludeRequestId > 0) {
        $exSql .= " AND id != ?";
        $exParams[] = $excludeRequestId;
    }
    $exStmt = $pdo->prepare($exSql);
    $exStmt->execute($exParams);
    $existingRequests = $exStmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($existingRequests as $exReq) {
        $existingRows = [];
        if (!empty($exReq['overtime_rows_json'])) {
            $decoded = json_decode((string) $exReq['overtime_rows_json'], true);
            if (is_array($decoded)) {
                $existingRows = $decoded;
            }
        }
        if (empty($existingRows) && !empty($exReq['request_date'])) {
            $existingRows[] = [
                'date'    => $exReq['request_date'],
                'otStart' => substr((string) $exReq['requested_start'], 0, 5),
                'otEnd'   => substr((string) $exReq['requested_end'], 0, 5),
            ];
        }

        foreach ($validatedRows as $vIdx => $vRow) {
            $vRowDate = $vRow['date'];
            $vRowStart = $vRow['otStartMins'];
            $vRowEnd = $vRow['otEndMins'];

            foreach ($existingRows as $exRow) {
                $exDate = $exRow['date'] ?? '';
                if ($exDate !== $vRowDate) {
                    continue;
                }
                $pExS = parse_request_time((string) ($exRow['otStart'] ?? ''), 'Existing OT start', false);
                $pExE = parse_request_time((string) ($exRow['otEnd'] ?? ''), 'Existing OT end', false);
                if (!$pExS || !$pExE) {
                    continue;
                }
                if ($vRowStart < $pExE['minutes'] && $vRowEnd > $pExS['minutes']) {
                    $statusLabel = REQUEST_STATUSES[$exReq['status']] ?? $exReq['status'];
                    fail(
                        "Row #" . ($vIdx + 1) . ": Overtime on {$vRowDate} ({$vRow['otStart']}–{$vRow['otEnd']}) overlaps with an existing request ({$exReq['request_ref_no']}, status: {$statusLabel}).",
                        409,
                        [
                            'code'              => 'DUPLICATE_OVERTIME',
                            'existingRequestId' => (int) $exReq['id'],
                            'existingRefNo'     => $exReq['request_ref_no'],
                        ]
                    );
                }
            }
        }
    }

    // Clean up temporary helper keys before returning
    foreach ($validatedRows as &$vr) {
        unset($vr['otStartMins'], $vr['otEndMins']);
    }
    unset($vr);

    return [
        'serverNow'        => $serverNow,
        'dateFiled'        => $nowDate,
        'applicableCutoff' => $assignedCutoff,
        'cutoffDeadline'   => $assignedDeadlineDt ? $assignedDeadlineDt->format('Y-m-d H:i:s') : null,
        'validatedRows'    => $validatedRows,
        'totalOtMinutes'   => $totalOtMinutes,
        'totalOtHours'     => round($totalOtMinutes / 60, 2),
    ];
}

/**
 * Helper to validate and extract common request payload fields for S.A. draft/submit/resubmit.
 * Stamping date_filed strictly with current server date in Asia/Manila.
 */
function validate_and_extract_sa_request_payload(
    PDO $pdo,
    array $in,
    array $saContext,
    int $semesterId,
    bool $isDraft = false,
    ?array $existingRow = null
): array {
    $requestType = strtoupper(trim((string) ($in['requestType'] ?? ($existingRow['request_type'] ?? ''))));
    if (!isset(REQUEST_TYPES[$requestType])) {
        fail('Please select a valid request type (Excuse Slip, Overtime Form, or Undertime Form).', 422);
    }

    $undertimeType = null;
    if ($requestType === 'UNDERTIME') {
        $undertimeType = trim((string) ($in['undertimeType'] ?? ($existingRow['undertime_type'] ?? 'Early Departure')));
        $allowedUtTypes = ['Early Departure', 'Late Arrival', 'Other'];
        if ($undertimeType === '' || !in_array($undertimeType, $allowedUtTypes, true)) {
            $undertimeType = 'Early Departure';
        }
    }

    $requestDate = trim((string) ($in['requestDate'] ?? ($existingRow['request_date'] ?? '')));
    if ($requestDate === '' && $isDraft) {
        $requestDate = date('Y-m-d');
    }
    $dayOfWeek = resolve_request_day_of_week($requestDate);

    $requestEndDate = null;
    if ($requestType === 'EXCUSE_SLIP') {
        $rawEndDate = trim((string) ($in['requestEndDate'] ?? ($existingRow['request_end_date'] ?? '')));
        if ($rawEndDate !== '' && $rawEndDate !== $requestDate) {
            resolve_request_day_of_week($rawEndDate);
            if ($rawEndDate < $requestDate) {
                fail('Absence end date cannot be earlier than the absence start date.', 422);
            }
            $requestEndDate = $rawEndDate;
        }
    }

    $reasonCategory = trim((string) ($in['reasonCategory'] ?? ($existingRow['reason_category'] ?? '')));
    $explanation = trim((string) ($in['explanation'] ?? ($existingRow['explanation'] ?? '')));
    $notes = isset($in['notes']) ? trim((string) $in['notes']) : ($existingRow['notes'] ?? null);

    // For simple Undertime Form where the user selects Type (Early Departure / Late Arrival / Other) and enters Reason
    if ($requestType === 'UNDERTIME') {
        if ($reasonCategory === '' && $undertimeType !== null) {
            $reasonCategory = $undertimeType;
        }
        if ($explanation === '' && $reasonCategory !== '') {
            $explanation = $reasonCategory;
        }
    }

    if (!$isDraft) {
        if ($reasonCategory === '') {
            fail('Please select or provide a reason for this request.', 422);
        }
        if (mb_strlen($explanation) < 3) {
            fail('Please provide a clear reason or explanation for this request.', 422);
        }
    }

    $assignmentId = isset($in['assignmentId']) && (int) $in['assignmentId'] > 0
        ? (int) $in['assignmentId']
        : ($existingRow && !empty($existingRow['assignment_id']) ? (int) $existingRow['assignment_id'] : null);

    // Resolve duty assignment for that day if assignmentId was provided or automatically from active schedule
    $schedStartSql = $existingRow['scheduled_start'] ?? null;
    $schedEndSql = $existingRow['scheduled_end'] ?? null;
    $department = $existingRow['department'] ?? ($saContext['department'] ?? null);
    $location = $existingRow['location'] ?? ($saContext['location'] ?? null);

    if ($assignmentId) {
        $aStmt = $pdo->prepare("
            SELECT id, day_of_week, start_time, end_time, department, location
              FROM schedule_assignments
             WHERE id = ? AND sa_profile_id = ? AND semester_id = ?
             LIMIT 1
        ");
        $aStmt->execute([$assignmentId, $saContext['saProfileId'], $semesterId]);
        $asgn = $aStmt->fetch();
        if (!$asgn) {
            fail('The selected duty assignment does not belong to your schedule.', 422);
        }
        $schedStartSql = $asgn['start_time'];
        $schedEndSql = $asgn['end_time'];
        if (!empty($asgn['department'])) {
            $department = strtoupper((string) $asgn['department']);
        }
        if (!empty($asgn['location'])) {
            $location = (string) $asgn['location'];
        }
    } else {
        // Attempt to match an active duty assignment on that day of week
        $aStmt = $pdo->prepare("
            SELECT id, start_time, end_time, department, location
              FROM schedule_assignments
             WHERE sa_profile_id = ? AND semester_id = ? AND day_of_week = ?
             ORDER BY start_time ASC LIMIT 1
        ");
        $aStmt->execute([$saContext['saProfileId'], $semesterId, $dayOfWeek]);
        $autoAsgn = $aStmt->fetch();
        if ($autoAsgn) {
            $assignmentId = (int) $autoAsgn['id'];
            $schedStartSql = $autoAsgn['start_time'];
            $schedEndSql = $autoAsgn['end_time'];
            if (!empty($autoAsgn['department'])) {
                $department = strtoupper((string) $autoAsgn['department']);
            }
            if (!empty($autoAsgn['location'])) {
                $location = (string) $autoAsgn['location'];
            }
        }
    }

    if (isset($in['scheduledStart']) && trim((string) $in['scheduledStart']) !== '') {
        $parsedSchedStart = parse_request_time((string) $in['scheduledStart'], 'Scheduled start time');
        $schedStartSql = $parsedSchedStart['sql'];
    }
    if (isset($in['scheduledEnd']) && trim((string) $in['scheduledEnd']) !== '') {
        $parsedSchedEnd = parse_request_time((string) $in['scheduledEnd'], 'Scheduled end time');
        $schedEndSql = $parsedSchedEnd['sql'];
    }

    $actualTimeSql = null;
    $parsedActualTime = null;
    if ($requestType === 'UNDERTIME') {
        $actualTimeInput = isset($in['actualTime'])
            ? (string) $in['actualTime']
            : ($existingRow['actual_time'] ?? '');
        $parsedActualTime = parse_request_time($actualTimeInput, 'Actual time', false);
        if ($parsedActualTime) {
            $actualTimeSql = $parsedActualTime['sql'];
        }
    }

    $reqStartInput = isset($in['requestedStart'])
        ? (string) $in['requestedStart']
        : ($existingRow['requested_start'] ?? ($schedStartSql ? substr((string) $schedStartSql, 0, 5) : ''));
    $reqEndInput = isset($in['requestedEnd'])
        ? (string) $in['requestedEnd']
        : ($existingRow['requested_end'] ?? ($schedEndSql ? substr((string) $schedEndSql, 0, 5) : ''));

    // If Undertime Form was submitted with actualTime instead of explicit requestedStart/requestedEnd,
    // derive the affected window and minutes from actualTime + scheduled shift when possible.
    if ($requestType === 'UNDERTIME' && $parsedActualTime && (!isset($in['requestedStart']) || !isset($in['requestedEnd']))) {
        $sStart = $schedStartSql ? parse_request_time(substr((string) $schedStartSql, 0, 5), 'Scheduled start') : null;
        $sEnd = $schedEndSql ? parse_request_time(substr((string) $schedEndSql, 0, 5), 'Scheduled end') : null;
        if ($undertimeType === 'Late Arrival' && $sStart && $parsedActualTime['minutes'] > $sStart['minutes']) {
            $reqStartInput = substr($sStart['sql'], 0, 5);
            $reqEndInput = substr($parsedActualTime['sql'], 0, 5);
        } elseif ($sEnd && $parsedActualTime['minutes'] < $sEnd['minutes']) {
            $reqStartInput = substr($parsedActualTime['sql'], 0, 5);
            $reqEndInput = substr($sEnd['sql'], 0, 5);
        } else {
            $reqStartInput = substr($parsedActualTime['sql'], 0, 5);
            $endMin = min(23 * 60 + 59, $parsedActualTime['minutes'] + 60);
            $reqEndInput = sprintf('%02d:%02d', intdiv($endMin, 60), $endMin % 60);
        }
    }

    $parsedReqStart = parse_request_time($reqStartInput, 'Requested start time', false);
    $parsedReqEnd = parse_request_time($reqEndInput, 'Requested end time', false);

    $reqStartSql = $parsedReqStart ? $parsedReqStart['sql'] : null;
    $reqEndSql = $parsedReqEnd ? $parsedReqEnd['sql'] : null;

    $minutesAffected = 0;
    if (isset($in['hoursAffected']) && is_numeric($in['hoursAffected']) && (float) $in['hoursAffected'] > 0 && (!$parsedReqStart || !$parsedReqEnd)) {
        $minutesAffected = (int) round(((float) $in['hoursAffected']) * 60);
    } elseif ($parsedReqStart && $parsedReqEnd) {
        if ($parsedReqEnd['minutes'] <= $parsedReqStart['minutes']) {
            fail('Requested end time must be later than requested start time.', 422);
        }
        $minutesAffected = $parsedReqEnd['minutes'] - $parsedReqStart['minutes'];
    } elseif (isset($in['minutesAffected']) && (int) $in['minutesAffected'] > 0) {
        $minutesAffected = (int) $in['minutesAffected'];
    } elseif ($existingRow && (int) $existingRow['minutes_affected'] > 0) {
        $minutesAffected = (int) $existingRow['minutes_affected'];
    } elseif ($requestType === 'EXCUSE_SLIP') {
        // Default whole-day / shift excuse duration when no specific hours are entered
        $minutesAffected = 240;
    }

    // Strict automatic date_filed generated from server current date in Asia/Manila. Never trust client-submitted date.
    $tzManila = new DateTimeZone('Asia/Manila');
    $serverNow = new DateTimeImmutable('now', $tzManila);
    $dateFiled = $serverNow->format('Y-m-d');

    // Multi-row Overtime Schedule support (matching the Overtime Authorization Form)
    $overtimeRowsJson = $existingRow['overtime_rows_json'] ?? null;
    if ($requestType === 'OVERTIME' && isset($in['overtimeRows']) && is_array($in['overtimeRows'])) {
        $cleanOtRows = [];
        $totalOtMinutes = 0;
        $firstDate = null;
        $firstRegStart = null;
        $firstRegEnd = null;
        $firstOtStart = null;
        $firstOtEnd = null;
        $taskSummaries = [];

        foreach ($in['overtimeRows'] as $idx => $otRow) {
            if (!is_array($otRow)) {
                continue;
            }
            $rDate = trim((string) ($otRow['date'] ?? ''));
            $rTask = trim((string) ($otRow['task'] ?? ''));
            $rOtStart = trim((string) ($otRow['otStart'] ?? ''));
            $rOtEnd = trim((string) ($otRow['otEnd'] ?? ''));

            if ($rDate === '' && $rTask === '' && $rOtStart === '' && $rOtEnd === '') {
                continue;
            }

            $rRegStart = '08:00';
            $rRegEnd = '17:00';
            if ($rDate !== '') {
                $rDow = resolve_request_day_of_week($rDate);
                if ($firstDate === null) {
                    $firstDate = $rDate;
                }
                // Retrieve authoritative published regular duty hours from schedule_assignments
                $sStmt = $pdo->prepare("
                    SELECT start_time, end_time
                      FROM schedule_assignments
                     WHERE sa_profile_id = ? AND semester_id = ? AND day_of_week = ?
                     ORDER BY start_time ASC
                ");
                $sStmt->execute([$saContext['saProfileId'], $semesterId, $rDow]);
                $asgns = $sStmt->fetchAll(PDO::FETCH_ASSOC);
                if (!empty($asgns)) {
                    $rRegStart = substr((string) $asgns[0]['start_time'], 0, 5);
                    $rRegEnd = substr((string) $asgns[count($asgns) - 1]['end_time'], 0, 5);
                }
            }

            $parsedRegS = parse_request_time($rRegStart, 'Regular start time', false);
            $parsedRegE = parse_request_time($rRegEnd, 'Regular end time', false);
            $regMins = ($parsedRegS && $parsedRegE && $parsedRegE['minutes'] > $parsedRegS['minutes'])
                ? ($parsedRegE['minutes'] - $parsedRegS['minutes'])
                : 0;

            $parsedOtS = parse_request_time($rOtStart, 'O.T. start time', false);
            $parsedOtE = parse_request_time($rOtEnd, 'O.T. end time', false);
            $otMins = 0;
            if ($parsedOtS && $parsedOtE) {
                if (!$isDraft && $parsedOtE['minutes'] <= $parsedOtS['minutes']) {
                    fail('Overtime end time must be later than overtime start time on row #' . ($idx + 1) . '.', 422);
                }
                if ($parsedOtE['minutes'] > $parsedOtS['minutes']) {
                    $otMins = $parsedOtE['minutes'] - $parsedOtS['minutes'];
                }
            }
            $totalOtMinutes += $otMins;

            if ($firstOtStart === null && $parsedOtS) {
                $firstOtStart = $parsedOtS['sql'];
            }
            if ($firstOtEnd === null && $parsedOtE) {
                $firstOtEnd = $parsedOtE['sql'];
            }
            if ($firstRegStart === null && $parsedRegS) {
                $firstRegStart = $parsedRegS['sql'];
            }
            if ($firstRegEnd === null && $parsedRegE) {
                $firstRegEnd = $parsedRegE['sql'];
            }
            if ($rTask !== '') {
                $taskSummaries[] = $rTask;
            }

            $cleanOtRows[] = [
                'date'         => $rDate ?: $requestDate,
                'task'         => $rTask,
                'regularStart' => $parsedRegS ? substr($parsedRegS['sql'], 0, 5) : '08:00',
                'regularEnd'   => $parsedRegE ? substr($parsedRegE['sql'], 0, 5) : '17:00',
                'otStart'      => $parsedOtS ? substr($parsedOtS['sql'], 0, 5) : '',
                'otEnd'        => $parsedOtE ? substr($parsedOtE['sql'], 0, 5) : '',
                'regularHours' => round($regMins / 60, 2),
                'otHours'      => round($otMins / 60, 2),
            ];
        }

        if (!empty($cleanOtRows)) {
            $overtimeRowsJson = json_encode($cleanOtRows, JSON_UNESCAPED_UNICODE);
            if ($firstDate !== null) {
                $requestDate = $firstDate;
                $dayOfWeek = resolve_request_day_of_week($requestDate);
            }
            if ($firstOtStart !== null) {
                $reqStartSql = $firstOtStart;
            }
            if ($firstOtEnd !== null) {
                $reqEndSql = $firstOtEnd;
            }
            if ($firstRegStart !== null && !$schedStartSql) {
                $schedStartSql = $firstRegStart;
            }
            if ($firstRegEnd !== null && !$schedEndSql) {
                $schedEndSql = $firstRegEnd;
            }
            if ($totalOtMinutes > 0) {
                $minutesAffected = $totalOtMinutes;
                $hoursAffected = round($minutesAffected / 60, 2);
            }
            if ($reasonCategory === '' && !empty($taskSummaries)) {
                $reasonCategory = mb_substr(implode('; ', $taskSummaries), 0, 115);
            }
        }
    }

    if (!$isDraft && $minutesAffected <= 0) {
        fail('Please specify valid start and end times (or duration) for the request.', 422);
    }
    if ($requestType !== 'OVERTIME' && $minutesAffected > 720) {
        fail('Requested duration cannot exceed 12 hours (720 minutes) in a single day.', 422);
    }

    $hoursAffected = round($minutesAffected / 60, 2);

    // Handle supporting proof upload if provided
    $proofFileName = $existingRow['proof_file_name'] ?? null;
    $proofStoredName = $existingRow['proof_stored_name'] ?? null;
    $proofMimeType = $existingRow['proof_mime_type'] ?? null;
    $proofFileSize = $existingRow && $existingRow['proof_file_size'] !== null ? (int) $existingRow['proof_file_size'] : null;

    $rawProofData = (string) ($in['proofData'] ?? ($in['proofFile'] ?? ($in['attachmentData'] ?? '')));
    if (trim($rawProofData) !== '') {
        $origName = (string) ($in['proofFileName'] ?? ($in['fileName'] ?? 'supporting_proof'));
        $savedProof = store_request_proof_upload($rawProofData, $origName, $saContext['saProfileId']);
        $proofFileName = $savedProof['fileName'];
        $proofStoredName = $savedProof['storedName'];
        $proofMimeType = $savedProof['mimeType'];
        $proofFileSize = $savedProof['fileSize'];
    }
    // Anti-falsification security check: Student Assistants cannot submit supervisor or coordinator signatures
    if (!empty($in['supervisorSignature']) || !empty($in['coordinatorSignature'])) {
        fail('Falsification Restricted: You are not authorized to submit signatures on behalf of the Immediate Supervisor or S.A. Coordinator.', 403);
    }

    $saSignature = isset($in['saSignature']) ? trim((string) $in['saSignature']) : ($existingRow['sa_signature'] ?? null);
    $saSignDate = $saSignature ? ($existingRow['sa_sign_date'] ?? date('Y-m-d')) : null;

    return [
        'requestType'      => $requestType,
        'undertimeType'    => $undertimeType,
        'dateFiled'        => $dateFiled,
        'requestDate'      => $requestDate,
        'requestEndDate'   => $requestEndDate,
        'dayOfWeek'        => $dayOfWeek,
        'assignmentId'     => $assignmentId,
        'department'       => $department,
        'location'         => $location,
        'scheduledStart'   => $schedStartSql,
        'scheduledEnd'     => $schedEndSql,
        'requestedStart'   => $reqStartSql,
        'requestedEnd'     => $reqEndSql,
        'actualTime'       => $actualTimeSql,
        'minutesAffected'  => $minutesAffected,
        'hoursAffected'    => $hoursAffected,
        'reasonCategory'   => $reasonCategory,
        'explanation'      => $explanation,
        'notes'            => $notes,
        'overtimeRows'     => $cleanOtRows ?? [],
        'overtimeRowsJson' => $overtimeRowsJson,
        'proofFileName'    => $proofFileName,
        'proofStoredName'  => $proofStoredName,
        'proofMimeType'    => $proofMimeType,
        'proofFileSize'    => $proofFileSize,
        'saSignature'      => $saSignature,
        'saSignDate'       => $saSignDate,
    ];
}

/**
 * Formats a database row from `sa_requests` into a structured frontend/API response array,
 * optionally embedding its chronological `history` array.
 */
function format_sa_request_row(PDO $pdo, array $row, bool $includeHistory = false): array
{
    $id = (int) $row['id'];
    $hasProof = !empty($row['proof_stored_name']);

    $saFullName = trim(implode(' ', array_filter([
        $row['sa_first_name'] ?? '',
        $row['sa_middle_name'] ?? '',
        $row['sa_last_name'] ?? '',
        $row['sa_suffix'] ?? '',
    ])));

    $overtimeRows = [];
    if (!empty($row['overtime_rows_json'])) {
        $decodedOt = json_decode((string) $row['overtime_rows_json'], true);
        if (is_array($decodedOt)) {
            $overtimeRows = $decodedOt;
        }
    }

    $proofSize = $row['proof_file_size'] !== null ? (int) $row['proof_file_size'] : null;
    $proofUrl = $hasProof ? ("api/document.php?type=request&id={$id}") : null;
    $supName = !empty($row['supervisor_name']) ? $row['supervisor_name'] : ($row['assigned_supervisor_name'] ?? null);

    $formatted = [
        'id'                     => $id,
        'requestRefNo'           => $row['request_ref_no'],
        'requestCode'            => $row['request_ref_no'],
        'requestType'            => $row['request_type'],
        'requestTypeLabel'       => REQUEST_TYPES[$row['request_type']] ?? $row['request_type'],
        'undertimeType'          => $row['undertime_type'] ?? null,
        'dateFiled'              => !empty($row['date_filed']) ? $row['date_filed'] : substr((string) ($row['created_at'] ?? date('Y-m-d')), 0, 10),
        'semesterId'             => (int) $row['semester_id'],
        'saProfileId'            => (int) $row['sa_profile_id'],
        'saUserId'               => (int) $row['sa_user_id'],
        'saNumber'               => $row['sa_number'] ?? null,
        'studentId'              => $row['student_id'] ?? null,
        'saName'                 => $saFullName !== '' ? $saFullName : ($row['sa_name'] ?? null),
        'saCourse'               => $row['sa_course'] ?? null,
        'course'                 => $row['sa_course'] ?? null,
        'saYearLevel'            => isset($row['sa_year_level']) ? (int) $row['sa_year_level'] : null,
        'assignedSupervisorId'   => $row['assigned_supervisor_id'] !== null ? (int) $row['assigned_supervisor_id'] : null,
        'assignedSupervisorName' => $row['assigned_supervisor_name'] ?? null,
        'department'             => $row['department'],
        'location'               => $row['location'],
        'requestDate'            => $row['request_date'],
        'requestEndDate'         => $row['request_end_date'] ?? null,
        'dayOfWeek'              => $row['day_of_week'],
        'assignmentId'           => $row['assignment_id'] !== null ? (int) $row['assignment_id'] : null,
        'scheduledStart'         => $row['scheduled_start'] ? substr((string) $row['scheduled_start'], 0, 5) : null,
        'scheduledEnd'           => $row['scheduled_end'] ? substr((string) $row['scheduled_end'], 0, 5) : null,
        'requestedStart'         => $row['requested_start'] ? substr((string) $row['requested_start'], 0, 5) : null,
        'requestedEnd'           => $row['requested_end'] ? substr((string) $row['requested_end'], 0, 5) : null,
        'actualTime'             => !empty($row['actual_time']) ? substr((string) $row['actual_time'], 0, 5) : null,
        'minutesAffected'        => (int) $row['minutes_affected'],
        'hoursAffected'          => (float) $row['hours_affected'],
        'reasonCategory'         => $row['reason_category'],
        'explanation'            => $row['explanation'],
        'notes'                  => $row['notes'],
        'overtimeRows'           => $overtimeRows,
        'hasProof'               => $hasProof,
        'proofFileName'          => $row['proof_file_name'],
        'proofMimeType'          => $row['proof_mime_type'],
        'proofFileSize'          => $proofSize,
        'proofSizeBytes'         => $proofSize,
        'proofUrl'               => $proofUrl,
        'proofViewUrl'           => $proofUrl,
        'status'                 => $row['status'],
        'statusLabel'            => REQUEST_STATUSES[$row['status']] ?? $row['status'],
        'clarificationTarget'    => $row['clarification_target'],
        'submittedAt'            => $row['submitted_at'],
        'supervisorActedById'    => $row['supervisor_acted_by_id'] !== null ? (int) $row['supervisor_acted_by_id'] : null,
        'supervisorName'         => $supName,
        'supervisorDecision'     => $row['supervisor_decision'],
        'supervisorRemarks'      => $row['supervisor_remarks'],
        'supervisorActedAt'      => $row['supervisor_acted_at'],
        'supervisorReviewedAt'   => $row['supervisor_acted_at'],
        'coordinatorId'          => $row['coordinator_id'] !== null ? (int) $row['coordinator_id'] : null,
        'coordinatorName'        => $row['coordinator_name'],
        'coordinatorDecision'    => $row['coordinator_decision'],
        'coordinatorRemarks'     => $row['coordinator_remarks'],
        'coordinatorActedAt'     => $row['coordinator_acted_at'],
        'recordedAt'             => $row['recorded_at'],
        'coordinatorRecordedAt'  => $row['recorded_at'],
        'linkedIncidentId'       => $row['linked_incident_id'] !== null ? (int) $row['linked_incident_id'] : null,
        'saSignature'            => $row['sa_signature'] ?? null,
        'saSignDate'             => $row['sa_sign_date'] ?? null,
        'supervisorSignature'    => $row['supervisor_signature'] ?? null,
        'supervisorSignDate'     => $row['supervisor_sign_date'] ?? null,
        'coordinatorSignature'   => $row['coordinator_signature'] ?? null,
        'coordinatorSignDate'    => $row['coordinator_sign_date'] ?? null,
        'createdAt'              => $row['created_at'],
        'updatedAt'              => $row['updated_at'],
    ];

    if ($includeHistory) {
        $hStmt = $pdo->prepare("
            SELECT id, request_id, actor_user_id, actor_name, actor_role,
                   previous_status, new_status, action_performed, remarks, created_at
              FROM sa_request_history
             WHERE request_id = ?
             ORDER BY id ASC
        ");
        $hStmt->execute([$id]);
        $formatted['history'] = array_map(static function (array $h): array {
            return [
                'id'              => (int) $h['id'],
                'requestId'       => (int) $h['request_id'],
                'actorUserId'     => $h['actor_user_id'] !== null ? (int) $h['actor_user_id'] : null,
                'actorName'       => $h['actor_name'],
                'actorRole'       => $h['actor_role'],
                'previousStatus'  => $h['previous_status'],
                'fromStatus'      => $h['previous_status'],
                'newStatus'       => $h['new_status'],
                'toStatus'        => $h['new_status'],
                'newStatusLabel'  => REQUEST_STATUSES[$h['new_status']] ?? $h['new_status'],
                'actionPerformed' => $h['action_performed'],
                'action'          => $h['action_performed'],
                'remarks'         => $h['remarks'],
                'createdAt'       => $h['created_at'],
            ];
        }, $hStmt->fetchAll());
    }

    return $formatted;
}

/**
 * Computes summary counts across a list of formatted or raw request items.
 */
function compute_request_summary_counts(array $requests): array
{
    $counts = [
        'total'                       => count($requests),
        'draft'                       => 0,
        'pendingSupervisorReview'     => 0,
        'returnedToSa'                => 0,
        'pendingCoordinatorRecording' => 0,
        'returnedForClarification'    => 0,
        'returned'                    => 0,
        'rejected'                    => 0,
        'recorded'                    => 0,
    ];
    foreach ($requests as $r) {
        $st = $r['status'] ?? '';
        switch ($st) {
            case 'DRAFT':
                $counts['draft']++;
                break;
            case 'PENDING_SUPERVISOR_REVIEW':
                $counts['pendingSupervisorReview']++;
                break;
            case 'RETURNED_TO_SA':
                $counts['returnedToSa']++;
                $counts['returned']++;
                break;
            case 'PENDING_COORDINATOR_RECORDING':
                $counts['pendingCoordinatorRecording']++;
                break;
            case 'RETURNED_FOR_CLARIFICATION':
                $counts['returnedForClarification']++;
                $counts['returned']++;
                break;
            case 'REJECTED_BY_SUPERVISOR':
                $counts['rejected']++;
                break;
            case 'RECORDED':
                $counts['recorded']++;
                break;
        }
    }
    return $counts;
}

/**
 * Fetches a single `sa_requests` row joined with its S.A. profile metadata.
 */
function fetch_sa_request_by_id(PDO $pdo, int $requestId, bool $forUpdate = false): ?array
{
    $lockSql = $forUpdate ? ' FOR UPDATE' : '';
    $stmt = $pdo->prepare("
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
         WHERE r.id = ?
         LIMIT 1{$lockSql}
    ");
    $stmt->execute([$requestId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Sends non-blocking in-app notifications after a request workflow transaction has committed.
 * Wrapped in try/catch so notification issues never corrupt or fail a committed workflow transition.
 */
function notify_request_workflow_transition(PDO $pdo, array $requestRow, string $transitionKey, array $actorUser, ?string $remarks = null): void
{
    try {
        $ref = $requestRow['request_ref_no'];
        $typeLabel = REQUEST_TYPES[$requestRow['request_type']] ?? $requestRow['request_type'];
        $dateStr = $requestRow['request_date'];
        $actorId = (int) ($actorUser['id'] ?? 0);
        $actorName = $actorUser['full_name'] ?? 'User';
        $saUserId = (int) ($requestRow['sa_user_id'] ?? 0);

        if (in_array($transitionKey, ['SA_SUBMIT', 'SA_RESUBMIT'], true)) {
            $verb = $transitionKey === 'SA_RESUBMIT' ? 'resubmitted' : 'submitted';
            $supIds = get_notifiable_supervisor_ids_for_request($pdo, $requestRow);
            foreach ($supIds as $supId) {
                create_notification(
                    $supId,
                    "New {$typeLabel} for Review ({$ref})",
                    "{$actorName} {$verb} a {$typeLabel} for {$dateStr}. Please review and take action.",
                    'ALERT',
                    '/supervisor/requests?ref=' . urlencode($ref),
                    $actorId
                );
            }
        } elseif ($transitionKey === 'SUPERVISOR_APPROVE' || $transitionKey === 'SUPERVISOR_RESUBMIT_CLARIFICATION') {
            if ($saUserId > 0) {
                create_notification(
                    $saUserId,
                    "{$typeLabel} Approved by Supervisor ({$ref})",
                    "Your {$typeLabel} for {$dateStr} was approved by {$actorName} and forwarded to the S.A. Coordinator for recording.",
                    'INFO',
                    '/sa/requests?ref=' . urlencode($ref),
                    $actorId
                );
            }
            // Notify active ADMIN Coordinators
            $adminStmt = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
            foreach ($adminStmt->fetchAll() as $adm) {
                create_notification(
                    (int) $adm['id'],
                    "{$typeLabel} Ready for Recording ({$ref})",
                    "Supervisor {$actorName} approved {$ref} ({$typeLabel} for {$dateStr}). Ready for Coordinator verification and recording.",
                    'ALERT',
                    '/admin/requests?ref=' . urlencode($ref),
                    $actorId
                );
            }
        } elseif ($transitionKey === 'SUPERVISOR_RETURN') {
            if ($saUserId > 0) {
                create_notification(
                    $saUserId,
                    "{$typeLabel} Returned for Correction ({$ref})",
                    "Supervisor {$actorName} returned your {$typeLabel} ({$ref}) for correction. Reason: {$remarks}",
                    'WARNING',
                    '/sa/requests?ref=' . urlencode($ref),
                    $actorId
                );
            }
        } elseif ($transitionKey === 'SUPERVISOR_REJECT') {
            if ($saUserId > 0) {
                create_notification(
                    $saUserId,
                    "{$typeLabel} Rejected by Supervisor ({$ref})",
                    "Supervisor {$actorName} rejected your {$typeLabel} ({$ref}). Reason: {$remarks}",
                    'WARNING',
                    '/sa/requests?ref=' . urlencode($ref),
                    $actorId
                );
            }
        } elseif ($transitionKey === 'COORDINATOR_RETURN_CLARIFICATION') {
            $target = $requestRow['clarification_target'] ?? 'SA';
            if ($target === 'SUPERVISOR' && !empty($requestRow['supervisor_acted_by_id'])) {
                create_notification(
                    (int) $requestRow['supervisor_acted_by_id'],
                    "{$typeLabel} Returned for Clarification ({$ref})",
                    "S.A. Coordinator {$actorName} requested clarification on {$ref}. Remarks: {$remarks}",
                    'WARNING',
                    '/supervisor/requests?ref=' . urlencode($ref),
                    $actorId
                );
            }
            if ($saUserId > 0) {
                create_notification(
                    $saUserId,
                    "{$typeLabel} Returned for Clarification ({$ref})",
                    "S.A. Coordinator {$actorName} returned {$ref} for clarification. Remarks: {$remarks}",
                    'WARNING',
                    '/sa/requests?ref=' . urlencode($ref),
                    $actorId
                );
            }
        } elseif ($transitionKey === 'COORDINATOR_RECORD') {
            if ($saUserId > 0) {
                create_notification(
                    $saUserId,
                    "{$typeLabel} Officially Recorded ({$ref})",
                    "S.A. Coordinator {$actorName} verified and recorded your {$typeLabel} ({$ref}) for {$dateStr}.",
                    'INFO',
                    '/sa/requests?ref=' . urlencode($ref),
                    $actorId
                );
            }
            if (!empty($requestRow['supervisor_acted_by_id'])) {
                create_notification(
                    (int) $requestRow['supervisor_acted_by_id'],
                    "{$typeLabel} Recorded by Coordinator ({$ref})",
                    "S.A. Coordinator {$actorName} recorded {$ref} ({$typeLabel} for {$dateStr}).",
                    'INFO',
                    '/supervisor/requests?ref=' . urlencode($ref),
                    $actorId
                );
            }
        }
    } catch (Throwable $e) {
        error_log('[AssistPay Request Notification Error] ' . $e->getMessage());
    }
}
