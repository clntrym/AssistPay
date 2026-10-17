<?php
/**
 * Shared Attendance Violation, Three-Level Warning, Memo Letter,
 * and Under Agreement Management domain logic for AssistPay.
 */

require_once __DIR__ . '/_sa.php';

const VIOLATION_CATEGORIES = [
    'LATES' => [
        'code'            => 'LATES',
        'label'           => 'Lates',
        'default_chances' => 6,
        'policy_ref'      => 'NCST S.A. Handbook Sec. 4.1 — Punctuality and Tardiness Policy',
        'description'     => 'Reporting for scheduled duty beyond the official grace period.',
    ],
    'EXCUSE_SLIP' => [
        'code'            => 'EXCUSE_SLIP',
        'label'           => 'Excuse Slip',
        'default_chances' => 6,
        'policy_ref'      => 'NCST S.A. Handbook Sec. 4.2 — Excused Absence & Leave Filing Limit',
        'description'     => 'Approved or filed excuse slips within a single semester.',
    ],
    'AWOL' => [
        'code'            => 'AWOL',
        'label'           => 'AWOL',
        'default_chances' => 2,
        'policy_ref'      => 'NCST S.A. Handbook Sec. 4.3 — Absence Without Official Leave (AWOL)',
        'description'     => 'Failure to report for scheduled duty without prior notice or approved excuse.',
    ],
    'NTI_NTO' => [
        'code'            => 'NTI_NTO',
        'label'           => 'NTI/NTO',
        'default_chances' => 2,
        'policy_ref'      => 'NCST S.A. Handbook Sec. 4.4 — No Time In / No Time Out (DTR Logging)',
        'description'     => 'Failure to log Time-In or Time-Out on the official attendance record.',
    ],
    'UNDERTIME' => [
        'code'            => 'UNDERTIME',
        'label'           => 'Undertime',
        'default_chances' => 3,
        'policy_ref'      => 'NCST S.A. Handbook Sec. 4.5 — Undertime and Early Departure Policy',
        'description'     => 'Leaving the assigned duty post before the end of the scheduled shift.',
    ],
];

const WARNING_LEVEL_ORDER = [
    'FIRST_WARNING'  => 1,
    'SECOND_WARNING' => 2,
    'THIRD_WARNING'  => 3,
];

const WARNING_LEVEL_LABELS = [
    'FIRST_WARNING'  => 'First Warning',
    'SECOND_WARNING' => 'Second Warning',
    'THIRD_WARNING'  => 'Third Warning',
];

/**
 * Ensures all tables and columns required for Attendance Violations, Warnings,
 * Memos, and Under Agreement management exist in the database.
 */
function ensure_violation_schema(PDO $pdo): void
{
    static $ensured = false;
    if ($ensured) return;
    $ensured = true;

    if (function_exists('schema_guard_ready') && schema_guard_ready('violation_schema_v2', 86400)) {
        return;
    }

    // 1. Check sa_profiles.disciplinary_status
    $colCheck = $pdo->query("SHOW COLUMNS FROM sa_profiles LIKE 'disciplinary_status'")->fetch();
    if (!$colCheck) {
        $pdo->exec("
            ALTER TABLE sa_profiles
                ADD COLUMN disciplinary_status ENUM('GOOD_STANDING','FIRST_WARNING','SECOND_WARNING','UNDER_AGREEMENT') NOT NULL DEFAULT 'GOOD_STANDING' AFTER assignment_status,
                ADD COLUMN under_agreement_at DATE NULL DEFAULT NULL AFTER disciplinary_status
        ");
    }

    // 2. Run table creations idempotently
    $sqlFile = __DIR__ . '/../database/migrations/2026_10_11_attendance_violations.sql';
    if (is_file($sqlFile)) {
        $sql = file_get_contents($sqlFile);
        $statements = array_filter(array_map('trim', explode(';', $sql)));
        foreach ($statements as $stmt) {
            // Skip ALTER TABLE if already handled above
            if (stripos($stmt, 'ALTER TABLE sa_profiles') !== false) continue;
            if ($stmt !== '') {
                $pdo->exec($stmt);
            }
        }
    }

    // 3. Ensure system_settings exists for cross-semester escalation policy
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key   VARCHAR(64) PRIMARY KEY,
            setting_value VARCHAR(255) NOT NULL,
            updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    ");
    $pdo->exec("
        INSERT IGNORE INTO system_settings (setting_key, setting_value)
        VALUES ('warning_escalation_mode', 'CONTINUE_ACROSS_SEMESTERS')
    ");

    if (function_exists('schema_guard_mark_ready')) {
        schema_guard_mark_ready('violation_schema_v2');
    }
}

/**
 * Returns the configured cross-semester warning escalation mode:
 * - 'CONTINUE_ACROSS_SEMESTERS' (default): Warning levels continue across semesters unless manually reset.
 * - 'RESET_PER_SEMESTER': Warning level sequence starts at First Warning in a new semester (while keeping history).
 */
function get_warning_escalation_mode(PDO $pdo): string
{
    static $cachedMode = null;
    if ($cachedMode !== null && PHP_SAPI !== 'cli') {
        return $cachedMode;
    }
    ensure_violation_schema($pdo);
    $stmt = $pdo->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'warning_escalation_mode'");
    $stmt->execute();
    $val = $stmt->fetchColumn();
    $cachedMode = in_array($val, ['CONTINUE_ACROSS_SEMESTERS', 'RESET_PER_SEMESTER'], true)
        ? $val
        : 'CONTINUE_ACROSS_SEMESTERS';
    return $cachedMode;
}

/**
 * Ensures a semester has all 5 violation category settings initialized.
 */
function ensure_violation_settings(PDO $pdo, int $semesterId, ?int $actorId = null): void
{
    ensure_violation_schema($pdo);
    if ($semesterId <= 0) return;

    static $ensuredSem = [];
    if (!empty($ensuredSem[$semesterId])) return;
    $ensuredSem[$semesterId] = true;

    $cntStmt = $pdo->prepare('SELECT COUNT(*) FROM attendance_violation_settings WHERE semester_id = ?');
    $cntStmt->execute([$semesterId]);
    if ((int) $cntStmt->fetchColumn() >= count(VIOLATION_CATEGORIES)) {
        return;
    }

    $ins = $pdo->prepare('
        INSERT IGNORE INTO attendance_violation_settings
            (semester_id, category, category_label, allowed_chances, policy_reference, description, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ');
    foreach (VIOLATION_CATEGORIES as $cat => $meta) {
        $ins->execute([
            $semesterId,
            $cat,
            $meta['label'],
            $meta['default_chances'],
            $meta['policy_ref'],
            $meta['description'],
            $actorId,
        ]);
    }
}

/**
 * Fetches violation settings for a given semester (initializing defaults if needed).
 */
function get_violation_settings(PDO $pdo, int $semesterId): array
{
    static $cacheBySem = [];
    if (isset($cacheBySem[$semesterId]) && PHP_SAPI !== 'cli') {
        return $cacheBySem[$semesterId];
    }

    ensure_violation_schema($pdo);

    $stmt = $pdo->prepare('
        SELECT avs.*,
               COALESCE(NULLIF(TRIM(u.full_name), ""), u.username) AS updated_by_name
        FROM attendance_violation_settings avs
        LEFT JOIN users u ON u.id = avs.updated_by
        WHERE avs.semester_id = ?
        ORDER BY FIELD(avs.category, "LATES", "EXCUSE_SLIP", "AWOL", "NTI_NTO", "UNDERTIME")
    ');
    $stmt->execute([$semesterId]);
    $rows = $stmt->fetchAll();

    if (count($rows) < count(VIOLATION_CATEGORIES)) {
        ensure_violation_settings($pdo, $semesterId);
        $stmt->execute([$semesterId]);
        $rows = $stmt->fetchAll();
    }

    $items = [];
    foreach ($rows as $r) {
        $cat = $r['category'];
        $meta = VIOLATION_CATEGORIES[$cat] ?? [];
        $items[] = [
            'id'              => (int) $r['id'],
            'semesterId'      => (int) $r['semester_id'],
            'category'        => $cat,
            'label'           => $r['category_label'] ?: ($meta['label'] ?? $cat),
            'defaultChances'  => $meta['default_chances'] ?? 6,
            'allowedChances'  => (int) $r['allowed_chances'],
            'policyReference' => $r['policy_reference'] ?: ($meta['policy_ref'] ?? ''),
            'description'     => $r['description'] ?: ($meta['description'] ?? ''),
            'updatedBy'       => $r['updated_by'] ? (int) $r['updated_by'] : null,
            'updatedByName'   => $r['updated_by_name'] ?? 'System Default',
            'updatedAt'       => $r['updated_at'],
        ];
    }
    return $items;
}

/**
 * Returns the configuration change history for a semester.
 */
function get_violation_settings_history(PDO $pdo, int $semesterId, int $limit = 30): array
{
    ensure_violation_schema($pdo);
    $stmt = $pdo->prepare('
        SELECT h.*,
               COALESCE(NULLIF(TRIM(u.full_name), ""), u.username, "System") AS changed_by_name,
               s.academic_year, s.term
        FROM attendance_violation_settings_history h
        LEFT JOIN users u ON u.id = h.changed_by
        LEFT JOIN semesters s ON s.id = h.semester_id
        WHERE h.semester_id = ?
        ORDER BY h.changed_at DESC, h.id DESC
        LIMIT ' . max(1, min(100, $limit))
    );
    $stmt->execute([$semesterId]);
    return array_map(fn($r) => [
        'id'                => (int) $r['id'],
        'semesterId'        => (int) $r['semester_id'],
        'semesterLabel'     => $r['term'] ? semester_label($r) : '',
        'category'          => $r['category'],
        'categoryLabel'     => VIOLATION_CATEGORIES[$r['category']]['label'] ?? $r['category'],
        'oldAllowedChances' => $r['old_allowed_chances'],
        'newAllowedChances' => $r['new_allowed_chances'],
        'changeReason'      => $r['change_reason'],
        'changedBy'         => $r['changed_by'] ? (int) $r['changed_by'] : null,
        'changedByName'     => $r['changed_by_name'],
        'changedAt'         => $r['changed_at'],
    ], $stmt->fetchAll());
}

/**
 * Validates and saves semester-specific Attendance Violation Settings and escalation policy.
 * Records history in attendance_violation_settings_history and audit_logs.
 */
function save_violation_settings(
    PDO $pdo,
    int $semesterId,
    array $categoriesInput,
    ?string $escalationMode,
    int $actorId,
    ?string $reason = null
): array {
    ensure_violation_settings($pdo, $semesterId, $actorId);

    // Check semester exists
    $semStmt = $pdo->prepare('SELECT * FROM semesters WHERE id = ?');
    $semStmt->execute([$semesterId]);
    $sem = $semStmt->fetch();
    if (!$sem) {
        return ['success' => false, 'message' => 'Selected semester was not found.'];
    }

    $errors = [];
    $cleanChances = [];
    $cleanPolicies = [];

    foreach (VIOLATION_CATEGORIES as $cat => $meta) {
        if (!array_key_exists($cat, $categoriesInput)) {
            continue;
        }
        $entry = $categoriesInput[$cat];
        $val = is_array($entry) ? ($entry['allowedChances'] ?? $entry['allowed_chances'] ?? null) : $entry;

        if ($val === '' || $val === null || !is_numeric($val) || (int) $val != $val) {
            $errors[$cat] = "{$meta['label']} allowed chances must be a whole number.";
            continue;
        }
        $intVal = (int) $val;
        if ($intVal < 0 || $intVal > 50) {
            $errors[$cat] = "{$meta['label']} allowed chances must be between 0 and 50.";
            continue;
        }
        $cleanChances[$cat] = $intVal;

        if (is_array($entry) && isset($entry['policyReference'])) {
            $pol = trim((string) $entry['policyReference']);
            $cleanPolicies[$cat] = $pol !== '' ? mb_substr($pol, 0, 160) : $meta['policy_ref'];
        }
    }

    if ($escalationMode !== null && !in_array($escalationMode, ['CONTINUE_ACROSS_SEMESTERS', 'RESET_PER_SEMESTER'], true)) {
        $errors['escalationMode'] = 'Invalid warning escalation mode.';
    }

    if ($errors) {
        return ['success' => false, 'message' => reset($errors), 'errors' => $errors];
    }

    // Load current values for change comparison
    $currentMap = [];
    foreach (get_violation_settings($pdo, $semesterId) as $row) {
        $currentMap[$row['category']] = $row;
    }
    $oldEscMode = get_warning_escalation_mode($pdo);

    $ownTx = !$pdo->inTransaction();
    if ($ownTx) $pdo->beginTransaction();

    try {
        $updStmt = $pdo->prepare('
            UPDATE attendance_violation_settings
            SET allowed_chances = ?, policy_reference = ?, updated_by = ?, updated_at = NOW()
            WHERE semester_id = ? AND category = ?
        ');
        $histStmt = $pdo->prepare('
            INSERT INTO attendance_violation_settings_history
                (semester_id, category, old_allowed_chances, new_allowed_chances, change_reason, changed_by)
            VALUES (?, ?, ?, ?, ?, ?)
        ');

        $changesSummary = [];
        foreach ($cleanChances as $cat => $newVal) {
            $oldVal = (int) ($currentMap[$cat]['allowedChances'] ?? VIOLATION_CATEGORIES[$cat]['default_chances']);
            $newPol = $cleanPolicies[$cat] ?? ($currentMap[$cat]['policyReference'] ?? VIOLATION_CATEGORIES[$cat]['policy_ref']);
            $oldPol = $currentMap[$cat]['policyReference'] ?? '';

            if ($newVal !== $oldVal || $newPol !== $oldPol) {
                $updStmt->execute([$newVal, $newPol, $actorId, $semesterId, $cat]);
                if ($newVal !== $oldVal) {
                    $histStmt->execute([
                        $semesterId,
                        $cat,
                        (string) $oldVal,
                        (string) $newVal,
                        $reason ?: 'Updated via SA Coordinator Settings',
                        $actorId,
                    ]);
                    $changesSummary[] = "{$cat}: {$oldVal} -> {$newVal}";
                }
            }
        }

        if ($escalationMode !== null && $escalationMode !== $oldEscMode) {
            $pdo->prepare("
                INSERT INTO system_settings (setting_key, setting_value)
                VALUES ('warning_escalation_mode', ?)
                ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
            ")->execute([$escalationMode]);

            $histStmt->execute([
                $semesterId,
                'ESCALATION_POLICY',
                $oldEscMode,
                $escalationMode,
                $reason ?: 'Updated cross-semester warning escalation policy',
                $actorId,
            ]);
            $changesSummary[] = "Escalation: {$oldEscMode} -> {$escalationMode}";
        }

        if ($ownTx) $pdo->commit();

        if ($changesSummary) {
            audit('VIOLATION_SETTINGS_UPDATED', 'Sem #' . $semesterId . ' (' . implode(', ', $changesSummary) . ')', $actorId);
        }

        return [
            'success'        => true,
            'settings'       => get_violation_settings($pdo, $semesterId),
            'escalationMode' => get_warning_escalation_mode($pdo),
            'history'        => get_violation_settings_history($pdo, $semesterId),
        ];
    } catch (Throwable $e) {
        if ($ownTx && $pdo->inTransaction()) $pdo->rollBack();
        return ['success' => false, 'message' => 'Failed to save violation settings: ' . $e->getMessage()];
    }
}

/**
 * Generates a unique official Memo Reference Number, e.g. "NCST-SAMEMO-2026-0001".
 */
function generate_memo_ref_no(PDO $pdo, int $warningId): string
{
    $year = date('Y');
    return sprintf('NCST-SAMEMO-%s-%04d', $year, $warningId);
}

/**
 * Generates a unique official Under Agreement Reference Number, e.g. "NCST-SAUA-2026-0001".
 */
function generate_agreement_ref_no(PDO $pdo, int $warningId): string
{
    $year = date('Y');
    return sprintf('NCST-SAUA-%s-%04d', $year, $warningId);
}

/**
 * Formats an incident row into a human-readable evidence line for a memo.
 */
function format_incident_evidence_line(array $inc): string
{
    $dateStr = date('M j, Y', strtotime($inc['incident_date']));
    $parts = [$dateStr];
    if (!empty($inc['scheduled_start']) && !empty($inc['scheduled_end'])) {
        $parts[] = 'Shift: ' . date('g:i A', strtotime($inc['scheduled_start'])) . '–' . date('g:i A', strtotime($inc['scheduled_end']));
    }
    if (!empty($inc['actual_time_in']) || !empty($inc['actual_time_out'])) {
        $inStr  = !empty($inc['actual_time_in'])  ? date('g:i A', strtotime($inc['actual_time_in']))  : 'No Time-In';
        $outStr = !empty($inc['actual_time_out']) ? date('g:i A', strtotime($inc['actual_time_out'])) : 'No Time-Out';
        $parts[] = "Logged: {$inStr} / {$outStr}";
    }
    if (!empty($inc['minutes_affected']) && (int) $inc['minutes_affected'] > 0) {
        $parts[] = ((int) $inc['minutes_affected']) . ' min(s)';
    }
    if (!empty($inc['evidence_notes'])) {
        $parts[] = trim($inc['evidence_notes']);
    }
    return implode(' | ', $parts);
}

/**
 * Recomputes an SA's disciplinary_status on sa_profiles based on approved/issued warnings
 * and approved Under Agreement records. Never modifies assignment_status.
 */
function sync_sa_disciplinary_status(PDO $pdo, int $saProfileId): string
{
    // Check if there is an active approved Under Agreement (PENDING_SIGNATURE, SIGNED, or COMPLETED)
    $uaStmt = $pdo->prepare("
        SELECT effective_date
        FROM sa_under_agreements
        WHERE sa_profile_id = ?
          AND status IN ('PENDING_SIGNATURE', 'SIGNED', 'COMPLETED')
        ORDER BY id DESC
        LIMIT 1
    ");
    $uaStmt->execute([$saProfileId]);
    $ua = $uaStmt->fetch();

    if ($ua) {
        $pdo->prepare("
            UPDATE sa_profiles
            SET disciplinary_status = 'UNDER_AGREEMENT',
                under_agreement_at = COALESCE(under_agreement_at, ?)
            WHERE id = ?
        ")->execute([$ua['effective_date'], $saProfileId]);
        return 'UNDER_AGREEMENT';
    }

    // Otherwise check highest approved/issued/acknowledged warning
    $escalationMode = get_warning_escalation_mode($pdo);
    $semFilterSql = '';
    $params = [$saProfileId];

    if ($escalationMode === 'RESET_PER_SEMESTER') {
        $activeSem = active_semester();
        if ($activeSem) {
            $semFilterSql = ' AND semester_id = ?';
            $params[] = (int) $activeSem['id'];
        }
    }

    $wStmt = $pdo->prepare("
        SELECT warning_level
        FROM sa_disciplinary_warnings
        WHERE sa_profile_id = ?
          AND evaluation_status IN ('APPROVED', 'ISSUED', 'ACKNOWLEDGED')
          {$semFilterSql}
    ");
    $wStmt->execute($params);
    $levels = $wStmt->fetchAll(PDO::FETCH_COLUMN);

    $highest = 'GOOD_STANDING';
    if (in_array('SECOND_WARNING', $levels, true) || in_array('THIRD_WARNING', $levels, true)) {
        // Note: Third Warning only transitions to UNDER_AGREEMENT once Under Agreement is approved by Coordinator
        $highest = 'SECOND_WARNING';
    } elseif (in_array('FIRST_WARNING', $levels, true)) {
        $highest = 'FIRST_WARNING';
    }

    // Important: Do not automatically downgrade an existing UNDER_AGREEMENT status when a new semester starts
    $curStmt = $pdo->prepare('SELECT disciplinary_status FROM sa_profiles WHERE id = ?');
    $curStmt->execute([$saProfileId]);
    $currentStatus = $curStmt->fetchColumn() ?: 'GOOD_STANDING';
    if ($currentStatus === 'UNDER_AGREEMENT') {
        return 'UNDER_AGREEMENT';
    }

    $rank = ['GOOD_STANDING' => 0, 'FIRST_WARNING' => 1, 'SECOND_WARNING' => 2, 'UNDER_AGREEMENT' => 3];
    if ($escalationMode === 'RESET_PER_SEMESTER' && ($rank[$currentStatus] ?? 0) > ($rank[$highest] ?? 0)) {
        // Preserve existing disciplinary status on new semester unless explicitly changed
        $highest = $currentStatus;
    }

    $pdo->prepare('UPDATE sa_profiles SET disciplinary_status = ? WHERE id = ?')
        ->execute([$highest, $saProfileId]);
    return $highest;
}

/**
 * Evaluates an SA's attendance violation counts for a specific semester against the
 * semester's configured allowed chances.
 *
 * Rules enforced:
 * 1. If valid occurrences <= allowed_chances: no warning is issued. Any still-pending
 *    warning for that category that is no longer supported by valid occurrences is
 *    marked RECALLED (preserving audit trail).
 * 2. If valid occurrences > allowed_chances:
 *    - Checks if this breach is already covered by an existing non-recalled warning
 *      for this category in this semester.
 *    - If an existing warning is PENDING_REVIEW for this category, updates its snapshot
 *      in-place (idempotent — duplicate attendance processing never creates duplicate warnings/memos).
 *    - If an existing warning for this category was already APPROVED/ISSUED/ACKNOWLEDGED:
 *      only triggers the NEXT warning level if the SA has committed additional valid occurrences
 *      beyond the `recorded_occurrences` already covered by that prior warning!
 *    - Escalates through FIRST_WARNING -> SECOND_WARNING -> THIRD_WARNING in order.
 *    - When THIRD_WARNING is created, sets `requires_under_agreement = 1` and creates a
 *      corresponding `sa_under_agreements` record in `PENDING_APPROVAL` status.
 */
function evaluate_sa_violations(PDO $pdo, int $saProfileId, int $semesterId, ?int $actorId = null): array
{
    ensure_violation_settings($pdo, $semesterId, $actorId);

    // Fetch SA details for memo generation
    $saStmt = $pdo->prepare(SA_SELECT . ' WHERE p.id = ?');
    $saStmt->execute([$saProfileId]);
    $saRow = $saStmt->fetch();
    if (!$saRow) {
        return ['success' => false, 'message' => 'Student Assistant profile not found.'];
    }

    $semStmt = $pdo->prepare('SELECT * FROM semesters WHERE id = ?');
    $semStmt->execute([$semesterId]);
    $semRow = $semStmt->fetch();
    if (!$semRow) {
        return ['success' => false, 'message' => 'Semester not found.'];
    }
    $semLabel = semester_label($semRow);

    // Coordinator info for memo signature block
    $coordName = 'S.A. Coordinator';
    if ($actorId) {
        $uStmt = $pdo->prepare('SELECT COALESCE(NULLIF(TRIM(full_name), ""), username) FROM users WHERE id = ?');
        $uStmt->execute([$actorId]);
        $cName = $uStmt->fetchColumn();
        if ($cName) $coordName = $cName;
    } else {
        $uStmt = $pdo->query("SELECT COALESCE(NULLIF(TRIM(full_name), ''), username) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id ASC LIMIT 1");
        $cName = $uStmt ? $uStmt->fetchColumn() : null;
        if ($cName) $coordName = $cName;
    }

    // Load semester settings keyed by category
    $settingsMap = [];
    foreach (get_violation_settings($pdo, $semesterId) as $s) {
        $settingsMap[$s['category']] = $s;
    }

    // Load all VALID incidents for this SA in this semester
    $incStmt = $pdo->prepare("
        SELECT *
        FROM sa_attendance_incidents
        WHERE sa_profile_id = ? AND semester_id = ? AND status = 'VALID'
        ORDER BY incident_date ASC, id ASC
    ");
    $incStmt->execute([$saProfileId, $semesterId]);
    $incidentsByCat = [];
    foreach ( array_keys(VIOLATION_CATEGORIES) as $cat ) {
        $incidentsByCat[$cat] = [];
    }
    foreach ($incStmt->fetchAll() as $inc) {
        $incidentsByCat[$inc['category']][] = $inc;
    }

    // Step A: Check if any existing warnings in this semester need to be RECALLED
    // due to corrected/voided attendance records (Scenario 9).
    $existingSemWarningsStmt = $pdo->prepare("
        SELECT *
        FROM sa_disciplinary_warnings
        WHERE sa_profile_id = ? AND semester_id = ? AND evaluation_status != 'RECALLED'
        ORDER BY FIELD(warning_level, 'FIRST_WARNING', 'SECOND_WARNING', 'THIRD_WARNING') ASC
    ");
    $existingSemWarningsStmt->execute([$saProfileId, $semesterId]);
    $existingSemWarnings = $existingSemWarningsStmt->fetchAll();

    // Group active warnings by category in this semester to verify each one still has enough occurrences
    $catWarnings = [];
    foreach ($existingSemWarnings as $w) {
        $catWarnings[$w['violation_category']][] = $w;
    }

    $recalledWarnings = [];
    foreach ($catWarnings as $cat => $wList) {
        $allowed = (int) ($settingsMap[$cat]['allowedChances'] ?? VIOLATION_CATEGORIES[$cat]['default_chances']);
        $validCount = count($incidentsByCat[$cat] ?? []);

        foreach ($wList as $idx => $w) {
            // The 1st warning in a category requires at least ($allowed + 1) occurrences;
            // a 2nd warning in the SAME category requires at least ($prevRecorded + 1) occurrences.
            $minRequired = ($idx === 0)
                ? ($allowed + 1)
                : ((int) $wList[$idx - 1]['recorded_occurrences'] + 1);

            if ($validCount < $minRequired) {
                // Attendance was corrected/voided so this warning is no longer supported
                $recallReason = "Recalled automatically after attendance correction: valid {$cat} occurrences ({$validCount}) is below threshold ({$minRequired}).";
                $pdo->prepare("
                    UPDATE sa_disciplinary_warnings
                    SET evaluation_status = 'RECALLED',
                        recall_reason = ?,
                        reviewed_by = COALESCE(?, reviewed_by),
                        reviewed_at = NOW()
                    WHERE id = ?
                ")->execute([$recallReason, $actorId, $w['id']]);

                $pdo->prepare("
                    UPDATE sa_warning_memos
                    SET status = 'SUPERSEDED', updated_by = ?
                    WHERE warning_id = ?
                ")->execute([$actorId, $w['id']]);

                $pdo->prepare("
                    UPDATE sa_under_agreements
                    SET status = 'REVOKED', remarks = ?
                    WHERE third_warning_id = ? AND status IN ('PENDING_APPROVAL', 'PENDING_SIGNATURE')
                ")->execute([$recallReason, $w['id']]);

                audit('WARNING_RECALLED_ON_CORRECTION', "Warning #{$w['id']} ({$w['warning_level']} - {$cat}) recalled for SA #{$saProfileId}", $actorId);
                $recalledWarnings[] = (int) $w['id'];
            }
        }
    }

    // Step B: Reload active (non-recalled) warnings after any recalls
    $escalationMode = get_warning_escalation_mode($pdo);
    if ($escalationMode === 'CONTINUE_ACROSS_SEMESTERS') {
        $allActiveWarningsStmt = $pdo->prepare("
            SELECT *
            FROM sa_disciplinary_warnings
            WHERE sa_profile_id = ? AND evaluation_status != 'RECALLED'
            ORDER BY evaluated_at ASC, id ASC
        ");
        $allActiveWarningsStmt->execute([$saProfileId]);
    } else {
        $allActiveWarningsStmt = $pdo->prepare("
            SELECT *
            FROM sa_disciplinary_warnings
            WHERE sa_profile_id = ? AND semester_id = ? AND evaluation_status != 'RECALLED'
            ORDER BY evaluated_at ASC, id ASC
        ");
        $allActiveWarningsStmt->execute([$saProfileId, $semesterId]);
    }
    $activeWarningsPool = $allActiveWarningsStmt->fetchAll();

    // Also index current semester's non-recalled warnings by category
    $semWarningsByCat = [];
    foreach ($activeWarningsPool as $w) {
        if ((int) $w['semester_id'] === $semesterId) {
            $semWarningsByCat[$w['violation_category']][] = $w;
        }
    }

    $createdOrUpdated = [];

    // Step C: Evaluate each category in order
    foreach (VIOLATION_CATEGORIES as $cat => $meta) {
        $setting = $settingsMap[$cat];
        $allowed = (int) $setting['allowedChances'];
        $validIncidents = $incidentsByCat[$cat] ?? [];
        $recorded = count($validIncidents);

        // Scenario 1: Within allowed chances -> no warning
        if ($recorded <= $allowed) {
            continue;
        }

        // Build incident snapshot data from actual records
        $incidentIds   = array_map(fn($i) => (int) $i['id'], $validIncidents);
        $incidentDates = array_map(fn($i) => $i['incident_date'], $validIncidents);
        $evidenceLines = array_map('format_incident_evidence_line', $validIncidents);
        $evidenceText  = implode("\n", $evidenceLines);
        $policyText    = $setting['policyReference'] . ' — Maximum allowed chances per semester: ' . $allowed . '.';

        $catActiveList = $semWarningsByCat[$cat] ?? [];
        $latestCatWarning = $catActiveList ? end($catActiveList) : null;

        // Case 1: There is already a PENDING_REVIEW warning for this category in this semester.
        // Update its snapshot in-place (Scenario 7: idempotent, no duplicate warning or memo).
        if ($latestCatWarning && $latestCatWarning['evaluation_status'] === 'PENDING_REVIEW') {
            $wId = (int) $latestCatWarning['id'];
            $wLevel = $latestCatWarning['warning_level'];
            $explanation = build_warning_explanation($saRow, $semLabel, $meta['label'], $wLevel, $allowed, $recorded, $incidentDates);
            $corrective  = build_corrective_action($wLevel, $meta['label']);

            $pdo->prepare("
                UPDATE sa_disciplinary_warnings
                SET allowed_chances = ?,
                    recorded_occurrences = ?,
                    incident_ids_json = ?,
                    incident_dates_json = ?,
                    attendance_evidence = ?,
                    applicable_policy = ?,
                    explanation = ?,
                    corrective_action = ?
                WHERE id = ?
            ")->execute([
                $allowed,
                $recorded,
                json_encode($incidentIds),
                json_encode($incidentDates),
                $evidenceText,
                $policyText,
                $explanation,
                $corrective,
                $wId,
            ]);

            // Sync draft/pending_review memo snapshot
            $pdo->prepare("
                UPDATE sa_warning_memos
                SET allowed_chances = ?,
                    recorded_occurrences = ?,
                    incident_dates_json = ?,
                    attendance_records_text = ?,
                    explanation_body = ?,
                    applicable_policy = ?,
                    corrective_action = ?
                WHERE warning_id = ? AND status IN ('DRAFT', 'PENDING_REVIEW')
            ")->execute([
                $allowed,
                $recorded,
                json_encode($incidentDates),
                $evidenceText,
                $explanation,
                $policyText,
                $corrective,
                $wId,
            ]);

            $createdOrUpdated[] = $wId;
            continue;
        }

        // Case 2: Latest warning in this category was already APPROVED / ISSUED / ACKNOWLEDGED.
        // Only issue a new escalated warning if new occurrences were recorded AFTER that warning's count!
        if ($latestCatWarning && $recorded <= (int) $latestCatWarning['recorded_occurrences']) {
            continue;
        }

        // Determine the next Warning Level to issue for this SA
        // Check which warning levels already exist in the active pool (and in this semester)
        $semLevelsTaken = [];
        foreach ($activeWarningsPool as $aw) {
            if ((int) $aw['semester_id'] === $semesterId) {
                $semLevelsTaken[$aw['warning_level']] = true;
            }
        }
        $poolLevelsTaken = [];
        foreach ($activeWarningsPool as $aw) {
            $poolLevelsTaken[$aw['warning_level']] = true;
        }

        $nextLevel = null;
        foreach (['FIRST_WARNING', 'SECOND_WARNING', 'THIRD_WARNING'] as $candidateLevel) {
            if (!isset($poolLevelsTaken[$candidateLevel]) && !isset($semLevelsTaken[$candidateLevel])) {
                $nextLevel = $candidateLevel;
                break;
            }
        }

        // If all 3 warning levels have already been reached, do not create a 4th warning automatically
        if ($nextLevel === null) {
            continue;
        }

        // Gather previous warnings for Second/Third Warning context
        $prevIds = array_map(fn($aw) => (int) $aw['id'], $activeWarningsPool);
        $prevSummaryLines = [];
        foreach ($activeWarningsPool as $aw) {
            $awCatLabel = VIOLATION_CATEGORIES[$aw['violation_category']]['label'] ?? $aw['violation_category'];
            $awLevelLabel = WARNING_LEVEL_LABELS[$aw['warning_level']] ?? $aw['warning_level'];
            $prevSummaryLines[] = sprintf(
                '%s (%s — %d/%d chances, evaluated on %s)',
                $awLevelLabel,
                $awCatLabel,
                (int) $aw['recorded_occurrences'],
                (int) $aw['allowed_chances'],
                date('M j, Y', strtotime($aw['evaluated_at']))
            );
        }
        $prevWarningsText = $prevSummaryLines ? implode('; ', $prevSummaryLines) : 'None on record.';

        $requiresUa = ($nextLevel === 'THIRD_WARNING') ? 1 : 0;
        $explanation = build_warning_explanation($saRow, $semLabel, $meta['label'], $nextLevel, $allowed, $recorded, $incidentDates, $prevWarningsText);
        $corrective  = build_corrective_action($nextLevel, $meta['label']);

        // Check if there is a RECALLED row for (semester_id, sa_profile_id, warning_level) due to unique key
        $recalledCheck = $pdo->prepare("
            SELECT id FROM sa_disciplinary_warnings
            WHERE semester_id = ? AND sa_profile_id = ? AND warning_level = ? AND evaluation_status = 'RECALLED'
            LIMIT 1
        ");
        $recalledCheck->execute([$semesterId, $saProfileId, $nextLevel]);
        $recalledId = $recalledCheck->fetchColumn();

        if ($recalledId) {
            $warningId = (int) $recalledId;
            $pdo->prepare("
                UPDATE sa_disciplinary_warnings
                SET violation_category = ?,
                    allowed_chances = ?,
                    recorded_occurrences = ?,
                    incident_ids_json = ?,
                    incident_dates_json = ?,
                    attendance_evidence = ?,
                    applicable_policy = ?,
                    explanation = ?,
                    corrective_action = ?,
                    previous_warning_ids = ?,
                    evaluation_status = 'PENDING_REVIEW',
                    requires_under_agreement = ?,
                    recall_reason = NULL,
                    evaluated_at = NOW(),
                    reviewed_by = NULL,
                    reviewed_at = NULL,
                    approved_by = NULL,
                    approved_at = NULL
                WHERE id = ?
            ")->execute([
                $cat,
                $allowed,
                $recorded,
                json_encode($incidentIds),
                json_encode($incidentDates),
                $evidenceText,
                $policyText,
                $explanation,
                $corrective,
                $prevIds ? implode(',', $prevIds) : null,
                $requiresUa,
                $warningId,
            ]);
        } else {
            $insW = $pdo->prepare("
                INSERT INTO sa_disciplinary_warnings
                    (semester_id, sa_profile_id, warning_level, violation_category,
                     allowed_chances, recorded_occurrences, incident_ids_json, incident_dates_json,
                     attendance_evidence, applicable_policy, explanation, corrective_action,
                     previous_warning_ids, evaluation_status, requires_under_agreement, evaluated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', ?, NOW())
            ");
            $insW->execute([
                $semesterId,
                $saProfileId,
                $nextLevel,
                $cat,
                $allowed,
                $recorded,
                json_encode($incidentIds),
                json_encode($incidentDates),
                $evidenceText,
                $policyText,
                $explanation,
                $corrective,
                $prevIds ? implode(',', $prevIds) : null,
                $requiresUa,
            ]);
            $warningId = (int) $pdo->lastInsertId();
        }

        // Generate or refresh the official Warning Memo record
        $memoRef = generate_memo_ref_no($pdo, $warningId);
        $levelLabel = WARNING_LEVEL_LABELS[$nextLevel];
        $subjectLine = strtoupper($levelLabel) . ' MEMORANDUM — ATTENDANCE VIOLATION (' . strtoupper($meta['label']) . ')';
        $recipientName = sa_full_name($saRow);
        $courseYear = $saRow['course'] . ' - Year ' . (int) $saRow['year_level'];
        $assignedOffice = $saRow['office_name'] ?: $saRow['department_type'];

        $insMemo = $pdo->prepare("
            INSERT INTO sa_warning_memos
                (warning_id, semester_id, sa_profile_id, memo_ref_no, warning_level, violation_category,
                 issued_date, subject_line, recipient_name, student_number, sa_number, course_year,
                 assigned_office, semester_label, allowed_chances, recorded_occurrences,
                 incident_dates_json, attendance_records_text, previous_warnings_text,
                 explanation_body, applicable_policy, corrective_action,
                 coordinator_name, coordinator_title, status, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'S.A. Coordinator', 'PENDING_REVIEW', ?, ?)
            ON DUPLICATE KEY UPDATE
                warning_level = VALUES(warning_level),
                violation_category = VALUES(violation_category),
                subject_line = VALUES(subject_line),
                allowed_chances = VALUES(allowed_chances),
                recorded_occurrences = VALUES(recorded_occurrences),
                incident_dates_json = VALUES(incident_dates_json),
                attendance_records_text = VALUES(attendance_records_text),
                previous_warnings_text = VALUES(previous_warnings_text),
                explanation_body = VALUES(explanation_body),
                applicable_policy = VALUES(applicable_policy),
                corrective_action = VALUES(corrective_action),
                status = 'PENDING_REVIEW',
                updated_by = VALUES(updated_by)
        ");
        $insMemo->execute([
            $warningId,
            $semesterId,
            $saProfileId,
            $memoRef,
            $nextLevel,
            $cat,
            $subjectLine,
            $recipientName,
            $saRow['student_id'],
            $saRow['sa_number'] ?? null,
            $courseYear,
            $assignedOffice,
            $semLabel,
            $allowed,
            $recorded,
            json_encode($incidentDates),
            $evidenceText,
            $prevWarningsText,
            $explanation,
            $policyText,
            $corrective,
            $coordName,
            $actorId,
            $actorId,
        ]);

        // If Third Warning: flag SA for Under Agreement review workflow
        if ($nextLevel === 'THIRD_WARNING') {
            $uaRef = generate_agreement_ref_no($pdo, $warningId);
            $uaReason = "Reached Third Disciplinary Warning due to {$meta['label']} attendance violations ({$recorded} occurrences vs. {$allowed} allowed chances in {$semLabel}).";
            $uaConditions = build_default_under_agreement_conditions($saRow, $semLabel, $meta['label']);

            $pdo->prepare("
                INSERT INTO sa_under_agreements
                    (sa_profile_id, semester_id, third_warning_id, agreement_ref_no,
                     effective_date, end_date, reason, conditions_text, status)
                VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?, 'PENDING_APPROVAL')
                ON DUPLICATE KEY UPDATE
                    reason = VALUES(reason),
                    conditions_text = VALUES(conditions_text),
                    status = IF(status = 'REVOKED', 'PENDING_APPROVAL', status)
            ")->execute([
                $saProfileId,
                $semesterId,
                $warningId,
                $uaRef,
                $semRow['end_date'] ?? null,
                $uaReason,
                $uaConditions,
            ]);
        }

        audit(
            'WARNING_EVALUATION_CREATED',
            "Created {$nextLevel} evaluation (#{$warningId}) for SA #{$saProfileId} ({$cat}: {$recorded}/{$allowed})",
            $actorId
        );

        // Append newly created warning to in-memory active pool so another breached category
        // in the same evaluation pass escalates properly to the next warning level!
        $newRowStmt = $pdo->prepare('SELECT * FROM sa_disciplinary_warnings WHERE id = ?');
        $newRowStmt->execute([$warningId]);
        $newRow = $newRowStmt->fetch();
        if ($newRow) {
            $activeWarningsPool[] = $newRow;
            $semWarningsByCat[$cat][] = $newRow;
        }

        $createdOrUpdated[] = $warningId;
    }

    sync_sa_disciplinary_status($pdo, $saProfileId);

    return [
        'success'           => true,
        'evaluatedWarnings' => $createdOrUpdated,
        'recalledWarnings'  => $recalledWarnings,
    ];
}

/**
 * Builds accurate explanation body from actual incident records.
 */
function build_warning_explanation(
    array $saRow,
    string $semLabel,
    string $catLabel,
    string $warningLevel,
    int $allowed,
    int $recorded,
    array $incidentDates,
    string $prevWarningsText = ''
): string {
    $levelTitle = WARNING_LEVEL_LABELS[$warningLevel] ?? $warningLevel;
    $formattedDates = array_map(fn($d) => date('M j, Y', strtotime($d)), $incidentDates);
    $dateList = implode(', ', $formattedDates);
    $saName = sa_full_name($saRow);

    $text = "Official attendance records for {$semLabel} show that Student Assistant {$saName} ({$saRow['student_id']}) "
          . "has accumulated {$recorded} recorded occurrence(s) under the {$catLabel} category on the following date(s): {$dateList}. "
          . "This exceeds the maximum allowed threshold of {$allowed} chance(s) per semester established under the NCST Student Assistantship Disciplinary Policy, "
          . "warranting the issuance of this {$levelTitle}.";

    if ($warningLevel === 'SECOND_WARNING' && $prevWarningsText && $prevWarningsText !== 'None on record.') {
        $text .= " Prior disciplinary record considered: {$prevWarningsText}.";
    } elseif ($warningLevel === 'THIRD_WARNING') {
        if ($prevWarningsText && $prevWarningsText !== 'None on record.') {
            $text .= " Prior disciplinary records considered: {$prevWarningsText}.";
        }
        $text .= " Because this constitutes a Third Warning, the Student Assistant is now subject to Under Agreement status review and probationary compliance conditions.";
    }

    return $text;
}

/**
 * Builds standard corrective action text for each warning level.
 */
function build_corrective_action(string $warningLevel, string $catLabel): string
{
    switch ($warningLevel) {
        case 'FIRST_WARNING':
            return "1. Strictly observe your approved duty schedule and avoid any further {$catLabel} infractions.\n"
                 . "2. Coordinate with your Immediate Supervisor and the S.A. Coordinator regarding any valid scheduling conflict in advance.\n"
                 . "3. Acknowledge and sign this First Warning Memorandum within three (3) working days from receipt.";
        case 'SECOND_WARNING':
            return "1. Immediately rectify attendance compliance and maintain zero additional {$catLabel} or other attendance violations.\n"
                 . "2. Report to the S.A. Coordinator's Office for mandatory attendance counseling and schedule review.\n"
                 . "3. Be advised that any subsequent qualifying violation will result in a Third Warning and placement under formal Under Agreement status.";
        case 'THIRD_WARNING':
        default:
            return "1. Appear before the S.A. Coordinator for formal Under Agreement orientation and compliance review.\n"
                 . "2. Review, execute, and strictly comply with the terms of the Student Assistant Under Agreement Contract.\n"
                 . "3. Maintain 100% attendance and DTR compliance for the remainder of the semester in accordance with institutional policy.";
    }
}

/**
 * Builds default Under Agreement terms and conditions based on actual records.
 */
function build_default_under_agreement_conditions(array $saRow, string $semLabel, string $catLabel): string
{
    $saName = sa_full_name($saRow);
    $office = $saRow['office_name'] ?: $saRow['department_type'];
    return "1. Student Assistant {$saName} ({$saRow['student_id']}), assigned to {$office} for {$semLabel}, is placed under formal UNDER AGREEMENT disciplinary status following the issuance of a Third Warning for {$catLabel}.\n"
         . "2. The Student Assistant shall retain their current duty assignment subject to strict compliance with all daily time record (DTR), punctuality, and attendance regulations.\n"
         . "3. The Student Assistant must not incur any unexcused absence (AWOL), tardiness, undertime, or unlogged DTR entry during the effectivity of this Agreement.\n"
         . "4. Weekly attendance monitoring shall be endorsed by the Immediate Supervisor to the S.A. Coordinator.\n"
         . "5. Any violation of the conditions stipulated herein shall be elevated to the Office of Student Affairs / S.A. Committee for formal administrative review in accordance with institutional policy.";
}

/**
 * Records a new attendance violation incident (or updates an existing one) and triggers evaluation.
 */
function record_attendance_incident(PDO $pdo, array $in, int $actorId): array
{
    ensure_violation_schema($pdo);

    $saProfileId = (int) ($in['saProfileId'] ?? 0);
    $semesterId  = (int) ($in['semesterId'] ?? 0);
    $category    = strtoupper(trim((string) ($in['category'] ?? '')));
    $incidentDate = trim((string) ($in['incidentDate'] ?? ''));
    $scheduledStart = !empty($in['scheduledStart']) ? trim((string) $in['scheduledStart']) : null;
    $scheduledEnd   = !empty($in['scheduledEnd'])   ? trim((string) $in['scheduledEnd'])   : null;
    $actualTimeIn   = !empty($in['actualTimeIn'])   ? trim((string) $in['actualTimeIn'])   : null;
    $actualTimeOut  = !empty($in['actualTimeOut'])  ? trim((string) $in['actualTimeOut'])  : null;
    $minutesAffected = max(0, (int) ($in['minutesAffected'] ?? 0));
    $evidenceNotes   = !empty($in['evidenceNotes']) ? mb_substr(trim((string) $in['evidenceNotes']), 0, 255) : null;

    if ($saProfileId <= 0) {
        return ['success' => false, 'message' => 'Select a Student Assistant.'];
    }
    if ($semesterId <= 0) {
        $active = active_semester();
        $semesterId = $active ? (int) $active['id'] : 0;
    }
    if ($semesterId <= 0) {
        return ['success' => false, 'message' => 'Select a valid semester.'];
    }
    if (!isset(VIOLATION_CATEGORIES[$category])) {
        return ['success' => false, 'message' => 'Select a valid violation category.'];
    }
    if (!valid_date($incidentDate)) {
        return ['success' => false, 'message' => 'Enter a valid incident date (YYYY-MM-DD).'];
    }

    ensure_violation_settings($pdo, $semesterId, $actorId);

    // Check if an incident for (semester_id, sa_profile_id, category, incident_date) already exists
    $dupCheck = $pdo->prepare('
        SELECT id, status FROM sa_attendance_incidents
        WHERE semester_id = ? AND sa_profile_id = ? AND category = ? AND incident_date = ?
        LIMIT 1
    ');
    $dupCheck->execute([$semesterId, $saProfileId, $category, $incidentDate]);
    $existing = $dupCheck->fetch();

    $ownTx = !$pdo->inTransaction();
    if ($ownTx) $pdo->beginTransaction();

    try {
        $wasDuplicate = false;
        if ($existing) {
            $incidentId = (int) $existing['id'];
            if ($existing['status'] === 'VALID') {
                // Idempotent duplicate attendance processing (Scenario 7)
                $wasDuplicate = true;
                $pdo->prepare('
                    UPDATE sa_attendance_incidents
                    SET scheduled_start = COALESCE(?, scheduled_start),
                        scheduled_end = COALESCE(?, scheduled_end),
                        actual_time_in = COALESCE(?, actual_time_in),
                        actual_time_out = COALESCE(?, actual_time_out),
                        minutes_affected = ?,
                        evidence_notes = COALESCE(?, evidence_notes),
                        updated_by = ?
                    WHERE id = ?
                ')->execute([
                    $scheduledStart, $scheduledEnd, $actualTimeIn, $actualTimeOut,
                    $minutesAffected, $evidenceNotes, $actorId, $incidentId
                ]);
            } else {
                // Re-activating a previously voided/corrected date if explicitly re-recorded
                $pdo->prepare("
                    UPDATE sa_attendance_incidents
                    SET status = 'VALID',
                        scheduled_start = ?,
                        scheduled_end = ?,
                        actual_time_in = ?,
                        actual_time_out = ?,
                        minutes_affected = ?,
                        evidence_notes = ?,
                        correction_notes = NULL,
                        updated_by = ?
                    WHERE id = ?
                ")->execute([
                    $scheduledStart, $scheduledEnd, $actualTimeIn, $actualTimeOut,
                    $minutesAffected, $evidenceNotes, $actorId, $incidentId
                ]);
            }
        } else {
            $ins = $pdo->prepare("
                INSERT INTO sa_attendance_incidents
                    (semester_id, sa_profile_id, category, incident_date,
                     scheduled_start, scheduled_end, actual_time_in, actual_time_out,
                     minutes_affected, evidence_notes, status, recorded_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID', ?, ?)
            ");
            $ins->execute([
                $semesterId, $saProfileId, $category, $incidentDate,
                $scheduledStart, $scheduledEnd, $actualTimeIn, $actualTimeOut,
                $minutesAffected, $evidenceNotes, $actorId, $actorId
            ]);
            $incidentId = (int) $pdo->lastInsertId();
        }

        if (!$wasDuplicate) {
            audit('ATTENDANCE_INCIDENT_RECORDED', "SA #{$saProfileId} Sem #{$semesterId} {$category} on {$incidentDate}", $actorId);
        }

        $evalResult = evaluate_sa_violations($pdo, $saProfileId, $semesterId, $actorId);

        if ($ownTx) $pdo->commit();

        return [
            'success'      => true,
            'incidentId'   => $incidentId,
            'wasDuplicate' => $wasDuplicate,
            'evaluation'   => $evalResult,
        ];
    } catch (Throwable $e) {
        if ($ownTx && $pdo->inTransaction()) $pdo->rollBack();
        return ['success' => false, 'message' => 'Could not record attendance incident: ' . $e->getMessage()];
    }
}

/**
 * Updates or corrects/voids an attendance incident (Scenario 9) and re-evaluates warnings
 * without deleting historical records or the audit trail.
 */
function update_attendance_incident(PDO $pdo, int $incidentId, array $in, int $actorId): array
{
    ensure_violation_schema($pdo);

    $stmt = $pdo->prepare('SELECT * FROM sa_attendance_incidents WHERE id = ?');
    $stmt->execute([$incidentId]);
    $inc = $stmt->fetch();
    if (!$inc) {
        return ['success' => false, 'message' => 'Attendance incident record not found.'];
    }

    $newStatus = strtoupper(trim((string) ($in['status'] ?? $inc['status'])));
    if (!in_array($newStatus, ['VALID', 'CORRECTED', 'VOIDED'], true)) {
        return ['success' => false, 'message' => 'Invalid incident status.'];
    }

    $correctionNotes = isset($in['correctionNotes'])
        ? mb_substr(trim((string) $in['correctionNotes']), 0, 255)
        : $inc['correction_notes'];
    $evidenceNotes = isset($in['evidenceNotes'])
        ? mb_substr(trim((string) $in['evidenceNotes']), 0, 255)
        : $inc['evidence_notes'];
    $minutesAffected = isset($in['minutesAffected'])
        ? max(0, (int) $in['minutesAffected'])
        : (int) $inc['minutes_affected'];

    if (in_array($newStatus, ['CORRECTED', 'VOIDED'], true) && empty($correctionNotes)) {
        return ['success' => false, 'message' => 'Provide a reason/note when correcting or voiding an attendance record.'];
    }

    $ownTx = !$pdo->inTransaction();
    if ($ownTx) $pdo->beginTransaction();

    try {
        $pdo->prepare('
            UPDATE sa_attendance_incidents
            SET status = ?,
                correction_notes = ?,
                evidence_notes = ?,
                minutes_affected = ?,
                updated_by = ?
            WHERE id = ?
        ')->execute([
            $newStatus,
            $correctionNotes,
            $evidenceNotes,
            $minutesAffected,
            $actorId,
            $incidentId,
        ]);

        audit(
            'ATTENDANCE_INCIDENT_' . $newStatus,
            "Incident #{$incidentId} ({$inc['category']} on {$inc['incident_date']}) for SA #{$inc['sa_profile_id']} set to {$newStatus}: {$correctionNotes}",
            $actorId
        );

        $evalResult = evaluate_sa_violations($pdo, (int) $inc['sa_profile_id'], (int) $inc['semester_id'], $actorId);

        if ($ownTx) $pdo->commit();

        return [
            'success'    => true,
            'incidentId' => $incidentId,
            'status'     => $newStatus,
            'evaluation' => $evalResult,
        ];
    } catch (Throwable $e) {
        if ($ownTx && $pdo->inTransaction()) $pdo->rollBack();
        return ['success' => false, 'message' => 'Failed to update attendance incident: ' . $e->getMessage()];
    }
}

/**
 * Coordinator reviews, optionally edits memo content, and approves/issues a Warning & Memo.
 * When approving First or Second Warning, updates SA's disciplinary_status accordingly.
 * When approving Third Warning, issues the Third Warning Memo and keeps Under Agreement
 * ready for explicit Coordinator approval (or approves it together if approveUnderAgreement = true).
 */
function approve_and_issue_warning(PDO $pdo, int $warningId, array $in, int $actorId): array
{
    ensure_violation_schema($pdo);

    $stmt = $pdo->prepare('SELECT * FROM sa_disciplinary_warnings WHERE id = ?');
    $stmt->execute([$warningId]);
    $warning = $stmt->fetch();
    if (!$warning) {
        return ['success' => false, 'message' => 'Warning record not found.'];
    }
    if ($warning['evaluation_status'] === 'RECALLED') {
        return ['success' => false, 'message' => 'Cannot approve a recalled warning evaluation.'];
    }

    $memoStmt = $pdo->prepare('SELECT * FROM sa_warning_memos WHERE warning_id = ?');
    $memoStmt->execute([$warningId]);
    $memo = $memoStmt->fetch();
    if (!$memo) {
        return ['success' => false, 'message' => 'Associated warning memo not found.'];
    }

    // Coordinator name
    $uStmt = $pdo->prepare('SELECT COALESCE(NULLIF(TRIM(full_name), ""), username) FROM users WHERE id = ?');
    $uStmt->execute([$actorId]);
    $coordName = $uStmt->fetchColumn() ?: $memo['coordinator_name'];

    $explanationBody  = isset($in['explanationBody'])  && trim((string) $in['explanationBody'])  !== '' ? trim((string) $in['explanationBody'])  : $memo['explanation_body'];
    $applicablePolicy = isset($in['applicablePolicy']) && trim((string) $in['applicablePolicy']) !== '' ? trim((string) $in['applicablePolicy']) : $memo['applicable_policy'];
    $correctiveAction = isset($in['correctiveAction']) && trim((string) $in['correctiveAction']) !== '' ? trim((string) $in['correctiveAction']) : $memo['corrective_action'];
    $issuedDate       = !empty($in['issuedDate']) && valid_date($in['issuedDate']) ? $in['issuedDate'] : date('Y-m-d');
    $targetStatus     = (!empty($in['status']) && in_array($in['status'], ['APPROVED', 'ISSUED'], true)) ? $in['status'] : 'ISSUED';

    $ownTx = !$pdo->inTransaction();
    if ($ownTx) $pdo->beginTransaction();

    try {
        $pdo->prepare("
            UPDATE sa_disciplinary_warnings
            SET explanation = ?,
                applicable_policy = ?,
                corrective_action = ?,
                evaluation_status = ?,
                reviewed_by = COALESCE(reviewed_by, ?),
                reviewed_at = COALESCE(reviewed_at, NOW()),
                approved_by = ?,
                approved_at = NOW()
            WHERE id = ?
        ")->execute([
            $explanationBody,
            $applicablePolicy,
            $correctiveAction,
            $targetStatus,
            $actorId,
            $actorId,
            $warningId,
        ]);

        $pdo->prepare("
            UPDATE sa_warning_memos
            SET issued_date = ?,
                explanation_body = ?,
                applicable_policy = ?,
                corrective_action = ?,
                coordinator_name = ?,
                status = ?,
                updated_by = ?
            WHERE warning_id = ?
        ")->execute([
            $issuedDate,
            $explanationBody,
            $applicablePolicy,
            $correctiveAction,
            $coordName,
            $targetStatus,
            $actorId,
            $warningId,
        ]);

        // Notify the SA in-app
        $saUserStmt = $pdo->prepare('SELECT user_id FROM sa_profiles WHERE id = ?');
        $saUserStmt->execute([(int) $warning['sa_profile_id']]);
        $saUserId = (int) $saUserStmt->fetchColumn();
        if ($saUserId > 0) {
            $lvlLabel = WARNING_LEVEL_LABELS[$warning['warning_level']] ?? $warning['warning_level'];
            $catLabel = VIOLATION_CATEGORIES[$warning['violation_category']]['label'] ?? $warning['violation_category'];
            create_notification(
                $saUserId,
                "{$lvlLabel} Memo Issued ({$memo['memo_ref_no']})",
                "A {$lvlLabel} Memorandum for {$catLabel} has been issued by the S.A. Coordinator. Please review and acknowledge your memo.",
                'WARNING_MEMO',
                '/sa/profile',
                $actorId
            );
        }

        // If Coordinator also explicitly approved the Under Agreement in the same step
        if ($warning['warning_level'] === 'THIRD_WARNING' && !empty($in['approveUnderAgreement'])) {
            $uaStmt = $pdo->prepare('SELECT id FROM sa_under_agreements WHERE third_warning_id = ?');
            $uaStmt->execute([$warningId]);
            $uaId = (int) $uaStmt->fetchColumn();
            if ($uaId > 0) {
                approve_under_agreement($pdo, $uaId, $in, $actorId);
            }
        }

        $newDiscStatus = sync_sa_disciplinary_status($pdo, (int) $warning['sa_profile_id']);

        audit(
            'WARNING_APPROVED_AND_ISSUED',
            "Approved {$warning['warning_level']} (#{$warningId}, Memo {$memo['memo_ref_no']}) for SA #{$warning['sa_profile_id']}",
            $actorId
        );

        if ($ownTx) $pdo->commit();

        return [
            'success'            => true,
            'warningId'          => $warningId,
            'memoRefNo'          => $memo['memo_ref_no'],
            'status'             => $targetStatus,
            'disciplinaryStatus' => $newDiscStatus,
        ];
    } catch (Throwable $e) {
        if ($ownTx && $pdo->inTransaction()) $pdo->rollBack();
        return ['success' => false, 'message' => 'Failed to approve warning memo: ' . $e->getMessage()];
    }
}

/**
 * Allows the Coordinator to save edits to a Draft / Pending Review Memo before final issuance.
 */
function update_warning_memo(PDO $pdo, int $memoId, array $in, int $actorId): array
{
    ensure_violation_schema($pdo);

    $stmt = $pdo->prepare('SELECT * FROM sa_warning_memos WHERE id = ?');
    $stmt->execute([$memoId]);
    $memo = $stmt->fetch();
    if (!$memo) {
        return ['success' => false, 'message' => 'Memo document not found.'];
    }

    $subjectLine      = isset($in['subjectLine'])      && trim((string) $in['subjectLine'])      !== '' ? mb_substr(trim((string) $in['subjectLine']), 0, 200) : $memo['subject_line'];
    $explanationBody  = isset($in['explanationBody'])  && trim((string) $in['explanationBody'])  !== '' ? trim((string) $in['explanationBody'])  : $memo['explanation_body'];
    $applicablePolicy = isset($in['applicablePolicy']) && trim((string) $in['applicablePolicy']) !== '' ? trim((string) $in['applicablePolicy']) : $memo['applicable_policy'];
    $correctiveAction = isset($in['correctiveAction']) && trim((string) $in['correctiveAction']) !== '' ? trim((string) $in['correctiveAction']) : $memo['corrective_action'];
    $coordinatorName  = isset($in['coordinatorName'])  && trim((string) $in['coordinatorName'])  !== '' ? mb_substr(trim((string) $in['coordinatorName']), 0, 150) : $memo['coordinator_name'];
    $coordinatorTitle = isset($in['coordinatorTitle']) && trim((string) $in['coordinatorTitle']) !== '' ? mb_substr(trim((string) $in['coordinatorTitle']), 0, 100) : $memo['coordinator_title'];
    $issuedDate       = !empty($in['issuedDate']) && valid_date($in['issuedDate']) ? $in['issuedDate'] : $memo['issued_date'];
    $status           = !empty($in['status']) && in_array($in['status'], ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ISSUED'], true)
                        ? $in['status']
                        : $memo['status'];

    $pdo->prepare("
        UPDATE sa_warning_memos
        SET subject_line = ?,
            issued_date = ?,
            explanation_body = ?,
            applicable_policy = ?,
            corrective_action = ?,
            coordinator_name = ?,
            coordinator_title = ?,
            status = ?,
            updated_by = ?
        WHERE id = ?
    ")->execute([
        $subjectLine,
        $issuedDate,
        $explanationBody,
        $applicablePolicy,
        $correctiveAction,
        $coordinatorName,
        $coordinatorTitle,
        $status,
        $actorId,
        $memoId,
    ]);

    $pdo->prepare("
        UPDATE sa_disciplinary_warnings
        SET explanation = ?,
            applicable_policy = ?,
            corrective_action = ?,
            reviewed_by = ? ,
            reviewed_at = NOW()
        WHERE id = ?
    ")->execute([
        $explanationBody,
        $applicablePolicy,
        $correctiveAction,
        $actorId,
        (int) $memo['warning_id'],
    ]);

    audit('WARNING_MEMO_UPDATED', "Updated Memo #{$memoId} ({$memo['memo_ref_no']})", $actorId);

    return ['success' => true, 'memoId' => $memoId];
}

/**
 * Marks an issued Warning Memo as Acknowledged (by the SA or recorded by the Coordinator).
 */
function acknowledge_warning_memo(PDO $pdo, int $memoId, int $actorId, ?string $acknowledgedDate = null): array
{
    ensure_violation_schema($pdo);

    $stmt = $pdo->prepare('SELECT * FROM sa_warning_memos WHERE id = ?');
    $stmt->execute([$memoId]);
    $memo = $stmt->fetch();
    if (!$memo) {
        return ['success' => false, 'message' => 'Memo not found.'];
    }
    if (!in_array($memo['status'], ['APPROVED', 'ISSUED', 'ACKNOWLEDGED'], true)) {
        return ['success' => false, 'message' => 'Only approved or issued memos can be acknowledged.'];
    }

    $ackDate = ($acknowledgedDate && valid_date($acknowledgedDate)) ? $acknowledgedDate : date('Y-m-d');

    $pdo->prepare("
        UPDATE sa_warning_memos
        SET status = 'ACKNOWLEDGED',
            acknowledged_at = ?,
            acknowledged_by_user_id = ?,
            updated_by = ?
        WHERE id = ?
    ")->execute([$ackDate, $actorId, $actorId, $memoId]);

    $pdo->prepare("
        UPDATE sa_disciplinary_warnings
        SET evaluation_status = 'ACKNOWLEDGED'
        WHERE id = ?
    ")->execute([(int) $memo['warning_id']]);

    audit('WARNING_MEMO_ACKNOWLEDGED', "Memo {$memo['memo_ref_no']} acknowledged on {$ackDate}", $actorId);

    return ['success' => true, 'memoId' => $memoId, 'acknowledgedAt' => $ackDate];
}

/**
 * Coordinator reviews and approves the Under Agreement action triggered by a Third Warning.
 * Sets SA's disciplinary_status = 'UNDER_AGREEMENT' and agreement status = 'PENDING_SIGNATURE' (or 'SIGNED'),
 * while preserving the SA's existing assignment_status (never automatically setting INACTIVE).
 */
function approve_under_agreement(PDO $pdo, int $agreementId, array $in, int $actorId): array
{
    ensure_violation_schema($pdo);

    $stmt = $pdo->prepare('SELECT * FROM sa_under_agreements WHERE id = ?');
    $stmt->execute([$agreementId]);
    $ua = $stmt->fetch();
    if (!$ua) {
        return ['success' => false, 'message' => 'Under Agreement record not found.'];
    }

    // Ensure the Third Warning itself is approved/issued if it was still PENDING_REVIEW
    $wStmt = $pdo->prepare('SELECT * FROM sa_disciplinary_warnings WHERE id = ?');
    $wStmt->execute([(int) $ua['third_warning_id']]);
    $warning = $wStmt->fetch();
    if ($warning && $warning['evaluation_status'] === 'PENDING_REVIEW') {
        approve_and_issue_warning($pdo, (int) $warning['id'], [], $actorId);
    }

    $uStmt = $pdo->prepare('SELECT COALESCE(NULLIF(TRIM(full_name), ""), username) FROM users WHERE id = ?');
    $uStmt->execute([$actorId]);
    $approverName = $uStmt->fetchColumn() ?: 'S.A. Coordinator';

    $effectiveDate  = (!empty($in['effectiveDate']) && valid_date($in['effectiveDate'])) ? $in['effectiveDate'] : $ua['effective_date'];
    $endDate        = (!empty($in['endDate']) && valid_date($in['endDate'])) ? $in['endDate'] : $ua['end_date'];
    $reason         = (!empty($in['reason']) && trim((string) $in['reason']) !== '') ? trim((string) $in['reason']) : $ua['reason'];
    $conditionsText = (!empty($in['conditionsText']) && trim((string) $in['conditionsText']) !== '') ? trim((string) $in['conditionsText']) : $ua['conditions_text'];
    $remarks        = isset($in['remarks']) ? mb_substr(trim((string) $in['remarks']), 0, 255) : $ua['remarks'];
    $targetStatus   = (!empty($in['agreementStatus']) && in_array($in['agreementStatus'], ['PENDING_SIGNATURE', 'SIGNED', 'COMPLETED'], true))
                      ? $in['agreementStatus']
                      : 'PENDING_SIGNATURE';

    $signedAt    = ($targetStatus === 'SIGNED' || $targetStatus === 'COMPLETED') ? ($ua['signed_at'] ?: date('Y-m-d')) : $ua['signed_at'];
    $completedAt = ($targetStatus === 'COMPLETED') ? ($ua['completed_at'] ?: date('Y-m-d')) : $ua['completed_at'];

    $ownTx = !$pdo->inTransaction();
    if ($ownTx) $pdo->beginTransaction();

    try {
        $pdo->prepare("
            UPDATE sa_under_agreements
            SET effective_date = ?,
                end_date = ?,
                reason = ?,
                conditions_text = ?,
                status = ?,
                approved_by = ?,
                approved_at = NOW(),
                approver_name = ?,
                signed_at = ?,
                completed_at = ?,
                remarks = ?
            WHERE id = ?
        ")->execute([
            $effectiveDate,
            $endDate,
            $reason,
            $conditionsText,
            $targetStatus,
            $actorId,
            $approverName,
            $signedAt,
            $completedAt,
            $remarks,
            $agreementId,
        ]);

        // Set SA disciplinary_status = 'UNDER_AGREEMENT' WITHOUT touching assignment_status
        $pdo->prepare("
            UPDATE sa_profiles
            SET disciplinary_status = 'UNDER_AGREEMENT',
                under_agreement_at = ?
            WHERE id = ?
        ")->execute([$effectiveDate, (int) $ua['sa_profile_id']]);

        // Notify SA
        $saUserStmt = $pdo->prepare('SELECT user_id FROM sa_profiles WHERE id = ?');
        $saUserStmt->execute([(int) $ua['sa_profile_id']]);
        $saUserId = (int) $saUserStmt->fetchColumn();
        if ($saUserId > 0) {
            create_notification(
                $saUserId,
                "Under Agreement Status Approved ({$ua['agreement_ref_no']})",
                "Following a Third Attendance Warning, your disciplinary status is now Under Agreement effective {$effectiveDate}. Please review and sign the Under Agreement document.",
                'UNDER_AGREEMENT',
                '/sa/profile',
                $actorId
            );
        }

        audit(
            'UNDER_AGREEMENT_APPROVED',
            "Approved Under Agreement {$ua['agreement_ref_no']} (status: {$targetStatus}) for SA #{$ua['sa_profile_id']} effective {$effectiveDate}",
            $actorId
        );

        if ($ownTx) $pdo->commit();

        return [
            'success'            => true,
            'agreementId'        => $agreementId,
            'agreementRefNo'     => $ua['agreement_ref_no'],
            'status'             => $targetStatus,
            'disciplinaryStatus' => 'UNDER_AGREEMENT',
            'effectiveDate'      => $effectiveDate,
        ];
    } catch (Throwable $e) {
        if ($ownTx && $pdo->inTransaction()) $pdo->rollBack();
        return ['success' => false, 'message' => 'Failed to approve Under Agreement: ' . $e->getMessage()];
    }
}

/**
 * Updates the tracking status of an Under Agreement document (PENDING_SIGNATURE, SIGNED, COMPLETED).
 */
function update_under_agreement_status(PDO $pdo, int $agreementId, string $newStatus, int $actorId, ?string $remarks = null, ?string $actionDate = null): array
{
    ensure_violation_schema($pdo);

    $stmt = $pdo->prepare('SELECT * FROM sa_under_agreements WHERE id = ?');
    $stmt->execute([$agreementId]);
    $ua = $stmt->fetch();
    if (!$ua) {
        return ['success' => false, 'message' => 'Under Agreement record not found.'];
    }

    $newStatus = strtoupper(trim($newStatus));
    if (!in_array($newStatus, ['PENDING_SIGNATURE', 'SIGNED', 'COMPLETED'], true)) {
        return ['success' => false, 'message' => 'Choose a valid agreement status (Pending Signature, Signed, or Completed).'];
    }

    $dateVal = ($actionDate && valid_date($actionDate)) ? $actionDate : date('Y-m-d');
    $signedAt = $ua['signed_at'];
    $completedAt = $ua['completed_at'];

    if ($newStatus === 'SIGNED' && !$signedAt) {
        $signedAt = $dateVal;
    } elseif ($newStatus === 'COMPLETED') {
        if (!$signedAt) $signedAt = $dateVal;
        $completedAt = $dateVal;
    }

    $pdo->prepare("
        UPDATE sa_under_agreements
        SET status = ?,
            signed_at = ?,
            completed_at = ?,
            remarks = COALESCE(?, remarks)
        WHERE id = ?
    ")->execute([$newStatus, $signedAt, $completedAt, $remarks, $agreementId]);

    sync_sa_disciplinary_status($pdo, (int) $ua['sa_profile_id']);

    audit('UNDER_AGREEMENT_STATUS_UPDATED', "Under Agreement {$ua['agreement_ref_no']} updated to {$newStatus}", $actorId);

    return [
        'success'      => true,
        'agreementId'  => $agreementId,
        'status'       => $newStatus,
        'signedAt'     => $signedAt,
        'completedAt'  => $completedAt,
    ];
}

/**
 * Returns the complete Disciplinary & Attendance Violation profile for an SA:
 * - Current / selected semester chances vs. recorded occurrences per category
 * - Attendance incidents list (filterable by semester)
 * - Full historical warnings & memos across all semesters (never overwritten on semester reset)
 * - Under Agreement records
 */
function get_sa_disciplinary_profile(PDO $pdo, int $saProfileId, ?int $semesterId = null): array
{
    ensure_violation_schema($pdo);

    $saStmt = $pdo->prepare('
        SELECT p.id, p.student_id, p.sa_number, p.first_name, p.last_name, p.suffix,
               p.course, p.year_level, p.sa_category, p.department_type, p.office_id,
               p.sa_status, p.assignment_status, p.disciplinary_status, p.under_agreement_at,
               p.semester_id, o.name AS office_name
        FROM sa_profiles p
        LEFT JOIN offices o ON o.id = p.office_id
        WHERE p.id = ?
    ');
    $saStmt->execute([$saProfileId]);
    $sa = $saStmt->fetch();
    if (!$sa) {
        return ['success' => false, 'message' => 'S.A. profile not found.'];
    }

    if (!$semesterId || $semesterId <= 0) {
        $active = active_semester();
        $semesterId = $active ? (int) $active['id'] : (int) $sa['semester_id'];
    }

    ensure_violation_settings($pdo, $semesterId);
    $settings = get_violation_settings($pdo, $semesterId);

    // Count VALID incidents in the selected semester
    $cntStmt = $pdo->prepare("
        SELECT category, COUNT(*) AS cnt
        FROM sa_attendance_incidents
        WHERE sa_profile_id = ? AND semester_id = ? AND status = 'VALID'
        GROUP BY category
    ");
    $cntStmt->execute([$saProfileId, $semesterId]);
    $countsMap = [];
    foreach ($cntStmt->fetchAll() as $r) {
        $countsMap[$r['category']] = (int) $r['cnt'];
    }

    $categorySummary = [];
    foreach ($settings as $s) {
        $cat = $s['category'];
        $recorded = $countsMap[$cat] ?? 0;
        $allowed  = (int) $s['allowedChances'];
        $remaining = max(0, $allowed - $recorded);
        $exceeded  = $recorded > $allowed;

        $categorySummary[] = [
            'category'        => $cat,
            'label'           => $s['label'],
            'allowedChances'  => $allowed,
            'recordedCount'   => $recorded,
            'remainingChances'=> $remaining,
            'exceeded'        => $exceeded,
            'policyReference' => $s['policyReference'],
            'description'     => $s['description'],
        ];
    }

    // Fetch all attendance incidents for this SA (across all semesters so history is preserved, ordered newest first)
    $incStmt = $pdo->prepare("
        SELECT i.*,
               s.academic_year, s.term,
               COALESCE(NULLIF(TRIM(u.full_name), ''), u.username, 'System') AS recorded_by_name
        FROM sa_attendance_incidents i
        JOIN semesters s ON s.id = i.semester_id
        LEFT JOIN users u ON u.id = i.recorded_by
        WHERE i.sa_profile_id = ?
        ORDER BY i.incident_date DESC, i.id DESC
    ");
    $incStmt->execute([$saProfileId]);
    $incidents = array_map(fn($r) => [
        'id'              => (int) $r['id'],
        'semesterId'      => (int) $r['semester_id'],
        'semesterLabel'   => semester_label($r),
        'academicYear'    => $r['academic_year'],
        'term'            => $r['term'],
        'category'        => $r['category'],
        'categoryLabel'   => VIOLATION_CATEGORIES[$r['category']]['label'] ?? $r['category'],
        'incidentDate'    => $r['incident_date'],
        'scheduledStart'  => $r['scheduled_start'] ? substr($r['scheduled_start'], 0, 5) : null,
        'scheduledEnd'    => $r['scheduled_end']   ? substr($r['scheduled_end'], 0, 5)   : null,
        'actualTimeIn'    => $r['actual_time_in']  ? substr($r['actual_time_in'], 0, 5)  : null,
        'actualTimeOut'   => $r['actual_time_out'] ? substr($r['actual_time_out'], 0, 5) : null,
        'minutesAffected' => (int) $r['minutes_affected'],
        'evidenceNotes'   => $r['evidence_notes'],
        'correctionNotes' => $r['correction_notes'],
        'status'          => $r['status'],
        'recordedByName'  => $r['recorded_by_name'],
        'createdAt'       => $r['created_at'],
    ], $incStmt->fetchAll());

    // Fetch all warnings + memos + under agreements across all semesters (never overwritten)
    $wStmt = $pdo->prepare("
        SELECT w.*,
               s.academic_year, s.term,
               COALESCE(NULLIF(TRIM(app.full_name), ''), app.username) AS approved_by_name,
               COALESCE(NULLIF(TRIM(rev.full_name), ''), rev.username) AS reviewed_by_name,
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
               ua.approver_name AS ua_approver_name, ua.approved_at AS ua_approved_at,
               ua.signed_at AS ua_signed_at, ua.completed_at AS ua_completed_at,
               ua.remarks AS ua_remarks
        FROM sa_disciplinary_warnings w
        JOIN semesters s ON s.id = w.semester_id
        LEFT JOIN users app ON app.id = w.approved_by
        LEFT JOIN users rev ON rev.id = w.reviewed_by
        LEFT JOIN sa_warning_memos m ON m.warning_id = w.id
        LEFT JOIN sa_under_agreements ua ON ua.third_warning_id = w.id
        WHERE w.sa_profile_id = ?
        ORDER BY w.evaluated_at DESC, w.id DESC
    ");
    $wStmt->execute([$saProfileId]);
    $warnings = [];
    $agreements = [];

    foreach ($wStmt->fetchAll() as $r) {
        $incDates = json_decode($r['incident_dates_json'] ?: '[]', true) ?: [];
        $latestIncDate = $incDates ? end($incDates) : substr($r['evaluated_at'], 0, 10);

        $uaObj = null;
        if (!empty($r['ua_id'])) {
            $uaObj = [
                'id'             => (int) $r['ua_id'],
                'warningId'      => (int) $r['id'],
                'semesterId'     => (int) $r['semester_id'],
                'semesterLabel'  => semester_label($r),
                'academicYear'   => $r['academic_year'],
                'agreementRefNo' => $r['agreement_ref_no'],
                'effectiveDate'  => $r['ua_effective_date'],
                'endDate'        => $r['ua_end_date'],
                'reason'         => $r['ua_reason'],
                'conditionsText' => $r['ua_conditions_text'],
                'status'         => $r['ua_status'],
                'approverName'   => $r['ua_approver_name'] ?: ($r['approved_by_name'] ?: 'Pending Approval'),
                'approvedAt'     => $r['ua_approved_at'],
                'signedAt'       => $r['ua_signed_at'],
                'completedAt'    => $r['ua_completed_at'],
                'remarks'        => $r['ua_remarks'],
                'saName'         => $r['recipient_name'] ?: sa_full_name($sa),
                'studentNumber'  => $r['student_number'] ?: $sa['student_id'],
                'saNumber'       => $r['memo_sa_number'] ?: $sa['sa_number'],
                'courseYear'     => $r['course_year'] ?: ($sa['course'] . ' - Year ' . $sa['year_level']),
                'assignedOffice' => $r['assigned_office'] ?: ($sa['office_name'] ?: $sa['department_type']),
            ];
            $agreements[] = $uaObj;
        }

        $warnings[] = [
            'id'                     => (int) $r['id'],
            'semesterId'             => (int) $r['semester_id'],
            'semesterLabel'          => semester_label($r),
            'academicYear'           => $r['academic_year'],
            'term'                   => $r['term'],
            'warningLevel'           => $r['warning_level'],
            'warningLevelLabel'      => WARNING_LEVEL_LABELS[$r['warning_level']] ?? $r['warning_level'],
            'violationCategory'      => $r['violation_category'],
            'violationCategoryLabel' => VIOLATION_CATEGORIES[$r['violation_category']]['label'] ?? $r['violation_category'],
            'allowedChances'         => (int) $r['allowed_chances'],
            'recordedOccurrences'    => (int) $r['recorded_occurrences'],
            'incidentDates'          => $incDates,
            'latestIncidentDate'     => $latestIncDate,
            'attendanceEvidence'     => $r['attendance_evidence'],
            'applicablePolicy'       => $r['applicable_policy'],
            'explanation'            => $r['explanation'],
            'correctiveAction'       => $r['corrective_action'],
            'evaluationStatus'       => $r['evaluation_status'],
            'requiresUnderAgreement' => (bool) $r['requires_under_agreement'],
            'recallReason'           => $r['recall_reason'],
            'evaluatedAt'            => $r['evaluated_at'],
            'approvedBy'             => $r['approved_by'] ? (int) $r['approved_by'] : null,
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

    return [
        'success'            => true,
        'saProfileId'        => (int) $sa['id'],
        'disciplinaryStatus' => $sa['disciplinary_status'] ?? 'GOOD_STANDING',
        'underAgreementAt'   => $sa['under_agreement_at'],
        'assignmentStatus'   => $sa['assignment_status'],
        'selectedSemesterId' => $semesterId,
        'escalationMode'     => get_warning_escalation_mode($pdo),
        'categorySummary'    => $categorySummary,
        'incidents'          => $incidents,
        'warnings'           => $warnings,
        'agreements'         => $agreements,
    ];
}

