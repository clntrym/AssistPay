<?php
/**
 * S.A. Performance Evaluation Workflow Helpers:
 * - Database schema & migration (`ensure_evaluation_tables`)
 * - School-day deadline calculation excluding weekends and `school_holidays`
 * - In-app + Email notification dispatcher with delivery logging & duplicate prevention
 * - Automated 5-school-day acknowledgment reminders (Day 0, Day 2, Day 4, Day 5, Overdue)
 * - Immutable workflow action history logger (`evaluation_action_history`)
 */

const EVAL_DEFAULT_ACK_SCHOOL_DAYS = 5;
const EVAL_DEFAULT_EXTENSION_SCHOOL_DAYS = 3;

const EVAL_EXTENSION_REASON_CATEGORIES = [
    'Class or examination conflict',
    'Scheduled duty conflict',
    'Illness',
    'Emergency or urgent personal situation',
    'Absence from campus',
    'Technical or account access problem',
    'Other valid reason',
];

const EVAL_ACK_STATUSES = [
    'PENDING' => 'Pending',
    'SIGNED' => 'Signed',
    'EXTENSION_REQUESTED' => 'Extension Requested',
    'EXTENDED' => 'Extended',
    'OVERDUE_AWAITING_SA' => 'Overdue — Awaiting S.A.',
    'OVERDUE_AWAITING_COORDINATOR' => 'Overdue — Awaiting Coordinator Review',
    'CONCERN_SUBMITTED' => 'Concern/Dispute Submitted',
    'ACKNOWLEDGMENT_DECLINED' => 'Acknowledgment Declined',
    'UNABLE_TO_ACKNOWLEDGE' => 'Unable to Acknowledge',
    'RETURNED_FOR_REVISION' => 'Returned for Revision',
];

function ensure_evaluation_tables(PDO $pdo): void
{
    static $ensured = false;
    if ($ensured) {
        return;
    }
    $ensured = true;

    if (function_exists('schema_guard_ready') && schema_guard_ready('evaluation_tables_v2', 86400)) {
        return;
    }

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS evaluation_campaigns (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            semester_id INT UNSIGNED NOT NULL,
            title VARCHAR(180) NOT NULL,
            academic_term VARCHAR(120) NOT NULL,
            instructions TEXT NULL,
            deadline DATE NULL,
            status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
            created_by INT UNSIGNED NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            closed_at DATETIME NULL,
            INDEX idx_sem (semester_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS sa_evaluations (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            campaign_id INT UNSIGNED NOT NULL,
            semester_id INT UNSIGNED NOT NULL,
            sa_profile_id INT UNSIGNED NOT NULL,
            supervisor_id INT UNSIGNED NULL,
            sa_user_id INT UNSIGNED NULL,
            student_name VARCHAR(160) NOT NULL,
            position_title VARCHAR(160) NOT NULL,
            department VARCHAR(160) NOT NULL,
            supervisor_name VARCHAR(160) NOT NULL,
            evaluation_period VARCHAR(120) NOT NULL,
            eval_date DATE NULL,
            c1 TINYINT UNSIGNED NULL,
            c2 TINYINT UNSIGNED NULL,
            c3 TINYINT UNSIGNED NULL,
            c4 TINYINT UNSIGNED NULL,
            c5 TINYINT UNSIGNED NULL,
            c6 TINYINT UNSIGNED NULL,
            c7 TINYINT UNSIGNED NULL,
            c8 TINYINT UNSIGNED NULL,
            c9 TINYINT UNSIGNED NULL,
            c10 TINYINT UNSIGNED NULL,
            total_score INT UNSIGNED NOT NULL DEFAULT 0,
            average_score DECIMAL(4,2) NOT NULL DEFAULT 0.00,
            rating_label VARCHAR(40) NOT NULL DEFAULT 'Pending Assessment',
            strengths_weaknesses TEXT NULL,
            standard_remarks VARCHAR(255) NULL,
            recommendation ENUM('PENDING','RECOMMENDED','NOT_RECOMMENDED') NOT NULL DEFAULT 'PENDING',
            supervisor_signature MEDIUMTEXT NULL,
            supervisor_title VARCHAR(100) NULL DEFAULT 'Immediate Supervisor',
            supervisor_sign_date DATE NULL,
            student_signature MEDIUMTEXT NULL,
            student_role VARCHAR(100) NULL DEFAULT 'Student Assistant',
            student_sign_date DATE NULL,
            sa_comments TEXT NULL,
            sa_concern_text TEXT NULL,
            sa_has_dispute TINYINT(1) NOT NULL DEFAULT 0,
            sa_exception_reason TEXT NULL,
            sa_acknowledged_at DATETIME NULL,
            acknowledgment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
            ack_released_at DATETIME NULL,
            ack_due_date DATE NULL,
            original_ack_due_date DATE NULL,
            extension_status ENUM('NONE','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'NONE',
            extension_reason_category VARCHAR(100) NULL,
            extension_explanation TEXT NULL,
            extension_requested_at DATETIME NULL,
            extension_requested_days INT UNSIGNED NOT NULL DEFAULT 3,
            extension_decided_by INT UNSIGNED NULL,
            extension_decided_by_name VARCHAR(160) NULL,
            extension_decided_at DATETIME NULL,
            extension_decision_reason TEXT NULL,
            revision_count INT UNSIGNED NOT NULL DEFAULT 0,
            last_return_reason TEXT NULL,
            returned_by INT UNSIGNED NULL,
            returned_by_name VARCHAR(160) NULL,
            returned_at DATETIME NULL,
            supervisor_revision_request TEXT NULL,
            supervisor_revision_requested_at DATETIME NULL,
            coordinator_decision VARCHAR(40) NULL,
            coordinator_reason TEXT NULL,
            effective_date DATE NULL,
            coordinator_id INT UNSIGNED NULL,
            coordinator_name VARCHAR(160) NULL,
            finalized_at DATETIME NULL,
            reopened_by INT UNSIGNED NULL,
            reopened_by_name VARCHAR(160) NULL,
            reopened_at DATETIME NULL,
            reopen_reason TEXT NULL,
            status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
            evaluated_by INT UNSIGNED NULL,
            submitted_at DATETIME NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_camp_sa (campaign_id, sa_profile_id),
            INDEX idx_sup (supervisor_id),
            INDEX idx_sem (semester_id),
            INDEX idx_status (status),
            INDEX idx_ack_status (acknowledgment_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Ensure new columns exist on older table versions
    $alterStatements = [
        "ALTER TABLE sa_evaluations MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'PENDING'",
        "ALTER TABLE sa_evaluations ADD COLUMN sa_user_id INT UNSIGNED NULL AFTER supervisor_id",
        "ALTER TABLE sa_evaluations ADD COLUMN sa_comments TEXT NULL AFTER student_sign_date",
        "ALTER TABLE sa_evaluations ADD COLUMN sa_concern_text TEXT NULL AFTER sa_comments",
        "ALTER TABLE sa_evaluations ADD COLUMN sa_has_dispute TINYINT(1) NOT NULL DEFAULT 0 AFTER sa_concern_text",
        "ALTER TABLE sa_evaluations ADD COLUMN sa_exception_reason TEXT NULL AFTER sa_has_dispute",
        "ALTER TABLE sa_evaluations ADD COLUMN sa_acknowledged_at DATETIME NULL AFTER sa_exception_reason",
        "ALTER TABLE sa_evaluations ADD COLUMN acknowledgment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' AFTER sa_acknowledged_at",
        "ALTER TABLE sa_evaluations ADD COLUMN ack_released_at DATETIME NULL AFTER acknowledgment_status",
        "ALTER TABLE sa_evaluations ADD COLUMN ack_due_date DATE NULL AFTER ack_released_at",
        "ALTER TABLE sa_evaluations ADD COLUMN original_ack_due_date DATE NULL AFTER ack_due_date",
        "ALTER TABLE sa_evaluations ADD COLUMN extension_status ENUM('NONE','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'NONE' AFTER original_ack_due_date",
        "ALTER TABLE sa_evaluations ADD COLUMN extension_reason_category VARCHAR(100) NULL AFTER extension_status",
        "ALTER TABLE sa_evaluations ADD COLUMN extension_explanation TEXT NULL AFTER extension_reason_category",
        "ALTER TABLE sa_evaluations ADD COLUMN extension_requested_at DATETIME NULL AFTER extension_explanation",
        "ALTER TABLE sa_evaluations ADD COLUMN extension_requested_days INT UNSIGNED NOT NULL DEFAULT 3 AFTER extension_requested_at",
        "ALTER TABLE sa_evaluations ADD COLUMN extension_decided_by INT UNSIGNED NULL AFTER extension_requested_days",
        "ALTER TABLE sa_evaluations ADD COLUMN extension_decided_by_name VARCHAR(160) NULL AFTER extension_decided_by",
        "ALTER TABLE sa_evaluations ADD COLUMN extension_decided_at DATETIME NULL AFTER extension_decided_by_name",
        "ALTER TABLE sa_evaluations ADD COLUMN extension_decision_reason TEXT NULL AFTER extension_decided_at",
        "ALTER TABLE sa_evaluations ADD COLUMN revision_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER extension_decision_reason",
        "ALTER TABLE sa_evaluations ADD COLUMN last_return_reason TEXT NULL AFTER revision_count",
        "ALTER TABLE sa_evaluations ADD COLUMN returned_by INT UNSIGNED NULL AFTER last_return_reason",
        "ALTER TABLE sa_evaluations ADD COLUMN returned_by_name VARCHAR(160) NULL AFTER returned_by",
        "ALTER TABLE sa_evaluations ADD COLUMN returned_at DATETIME NULL AFTER returned_by_name",
        "ALTER TABLE sa_evaluations ADD COLUMN supervisor_revision_request TEXT NULL AFTER returned_at",
        "ALTER TABLE sa_evaluations ADD COLUMN supervisor_revision_requested_at DATETIME NULL AFTER supervisor_revision_request",
        "ALTER TABLE sa_evaluations ADD COLUMN coordinator_decision VARCHAR(40) NULL AFTER supervisor_revision_requested_at",
        "ALTER TABLE sa_evaluations ADD COLUMN coordinator_reason TEXT NULL AFTER coordinator_decision",
        "ALTER TABLE sa_evaluations ADD COLUMN effective_date DATE NULL AFTER coordinator_reason",
        "ALTER TABLE sa_evaluations ADD COLUMN coordinator_id INT UNSIGNED NULL AFTER effective_date",
        "ALTER TABLE sa_evaluations ADD COLUMN coordinator_name VARCHAR(160) NULL AFTER coordinator_id",
        "ALTER TABLE sa_evaluations ADD COLUMN finalized_at DATETIME NULL AFTER coordinator_name",
        "ALTER TABLE sa_evaluations ADD COLUMN supervisor_recommendation VARCHAR(40) NULL AFTER recommendation",
        "ALTER TABLE sa_evaluations ADD COLUMN supervisor_reason TEXT NULL AFTER supervisor_recommendation",
        "ALTER TABLE sa_evaluations ADD COLUMN disclosed_feedback TEXT NULL AFTER coordinator_reason",
        "ALTER TABLE sa_evaluations ADD COLUMN rejection_reason TEXT NULL AFTER last_return_reason",
        "ALTER TABLE sa_evaluations ADD COLUMN rejected_at DATETIME NULL AFTER rejection_reason",
        "ALTER TABLE sa_evaluations ADD COLUMN rejected_by INT UNSIGNED NULL AFTER rejected_at",
        "ALTER TABLE sa_evaluations ADD COLUMN rejected_by_name VARCHAR(160) NULL AFTER rejected_by",
        "ALTER TABLE sa_evaluations ADD COLUMN reopened_by INT UNSIGNED NULL AFTER finalized_at",
        "ALTER TABLE sa_evaluations ADD COLUMN reopened_by_name VARCHAR(160) NULL AFTER reopened_by",
        "ALTER TABLE sa_evaluations ADD COLUMN reopened_at DATETIME NULL AFTER reopened_by_name",
        "ALTER TABLE sa_evaluations ADD COLUMN reopen_reason TEXT NULL AFTER reopened_at",
    ];
    foreach ($alterStatements as $sql) {
        try {
            $pdo->exec($sql);
        } catch (Throwable $e) {
            // Column already exists
        }
    }

    // Create school_holidays table for 5-school-day deadline calculation
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS school_holidays (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            holiday_date DATE NOT NULL,
            name VARCHAR(160) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_holiday_date (holiday_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Seed standard Philippine / Academic holidays if table is empty
    try {
        $cnt = (int) $pdo->query("SELECT COUNT(*) FROM school_holidays")->fetchColumn();
        if ($cnt === 0) {
            $defaultHolidays = [
                ['2026-01-01', 'New Year\'s Day'],
                ['2026-02-25', 'EDSA People Power Anniversary'],
                ['2026-04-02', 'Maundy Thursday'],
                ['2026-04-03', 'Good Friday'],
                ['2026-04-04', 'Black Saturday'],
                ['2026-04-09', 'Araw ng Kagitingan'],
                ['2026-05-01', 'Labor Day'],
                ['2026-06-12', 'Independence Day'],
                ['2026-08-21', 'Ninoy Aquino Day'],
                ['2026-08-31', 'National Heroes Day'],
                ['2026-11-01', 'All Saints\' Day'],
                ['2026-11-02', 'All Souls\' Day'],
                ['2026-11-30', 'Bonifacio Day'],
                ['2026-12-08', 'Feast of the Immaculate Conception'],
                ['2026-12-24', 'Christmas Eve'],
                ['2026-12-25', 'Christmas Day'],
                ['2026-12-30', 'Rizal Day'],
                ['2026-12-31', 'New Year\'s Eve'],
            ];
            $insH = $pdo->prepare("INSERT IGNORE INTO school_holidays (holiday_date, name) VALUES (?, ?)");
            foreach ($defaultHolidays as [$hDate, $hName]) {
                $insH->execute([$hDate, $hName]);
            }
        }
    } catch (Throwable $e) {}

    // Create evaluation_action_history table for complete workflow & revision audit trail
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS evaluation_action_history (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            evaluation_id INT UNSIGNED NOT NULL,
            actor_user_id INT UNSIGNED NULL,
            actor_name VARCHAR(160) NOT NULL,
            actor_role VARCHAR(40) NOT NULL,
            action_type VARCHAR(60) NOT NULL,
            from_status VARCHAR(40) NULL,
            to_status VARCHAR(40) NULL,
            ack_status VARCHAR(50) NULL,
            remarks TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_eval (evaluation_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Create evaluation_notification_logs table for in-app & email delivery tracking, outbox retry, + duplicate reminder prevention
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS evaluation_notification_logs (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            evaluation_id INT UNSIGNED NOT NULL,
            recipient_user_id INT UNSIGNED NOT NULL,
            recipient_email VARCHAR(190) NULL,
            event_key VARCHAR(80) NOT NULL,
            channel ENUM('IN_APP','EMAIL') NOT NULL,
            notif_type VARCHAR(80) NULL DEFAULT 'SA_EVALUATION',
            link VARCHAR(255) NULL DEFAULT '#/sa/evaluations',
            sender_id INT UNSIGNED NULL,
            subject VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            delivery_status VARCHAR(40) NOT NULL DEFAULT 'SENT',
            retry_count INT UNSIGNED NOT NULL DEFAULT 0,
            last_retry_at DATETIME NULL,
            error_message VARCHAR(255) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_eval_notif (evaluation_id),
            INDEX idx_eval_event (evaluation_id, recipient_user_id, event_key, channel),
            INDEX idx_delivery_retry (channel, delivery_status, retry_count)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $notifLogAlters = [
        "ALTER TABLE evaluation_notification_logs ADD COLUMN notif_type VARCHAR(80) NULL DEFAULT 'SA_EVALUATION' AFTER channel",
        "ALTER TABLE evaluation_notification_logs ADD COLUMN link VARCHAR(255) NULL DEFAULT '#/sa/evaluations' AFTER notif_type",
        "ALTER TABLE evaluation_notification_logs ADD COLUMN sender_id INT UNSIGNED NULL AFTER link",
        "ALTER TABLE evaluation_notification_logs ADD COLUMN retry_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER delivery_status",
        "ALTER TABLE evaluation_notification_logs ADD COLUMN last_retry_at DATETIME NULL AFTER retry_count",
    ];
    foreach ($notifLogAlters as $nSql) {
        try {
            $pdo->exec($nSql);
        } catch (Throwable $e) {
            // Column already exists
        }
    }

    // Migrate legacy 'COMPLETED' status into the 5-step workflow states
    try {
        $pdo->exec("
            UPDATE sa_evaluations
               SET status = CASE
                   WHEN coordinator_decision IS NOT NULL AND coordinator_decision <> '' THEN 'FINALIZED'
                   WHEN sa_acknowledged_at IS NOT NULL OR (student_signature IS NOT NULL AND student_signature <> '') THEN 'FOR_COORDINATOR_REVIEW'
                   ELSE 'FOR_SA_REVIEW'
               END
             WHERE status = 'COMPLETED'
        ");
        $pdo->exec("
            UPDATE sa_evaluations
               SET acknowledgment_status = 'SIGNED'
             WHERE acknowledgment_status = 'PENDING'
               AND (sa_acknowledged_at IS NOT NULL OR (student_signature IS NOT NULL AND student_signature <> ''))
        ");
        $pdo->exec("
            UPDATE sa_evaluations
               SET ack_released_at = COALESCE(ack_released_at, submitted_at, updated_at)
             WHERE status IN ('FOR_SA_REVIEW', 'FOR_COORDINATOR_REVIEW', 'FINALIZED')
               AND ack_released_at IS NULL
        ");
    } catch (Throwable $e) {}

    if (function_exists('schema_guard_mark_ready')) {
        schema_guard_mark_ready('evaluation_tables_v2');
    }
}

/**
 * Returns a lookup map of configured school holiday dates ('YYYY-MM-DD' => true).
 */
function get_school_holiday_map(PDO $pdo): array
{
    static $map = null;
    if ($map !== null) {
        return $map;
    }
    $map = [];
    try {
        $stmt = $pdo->query("SELECT holiday_date FROM school_holidays");
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $d) {
            $map[(string) $d] = true;
        }
    } catch (Throwable $e) {}
    return $map;
}

/**
 * Checks whether a given YYYY-MM-DD date is a valid school day (Mon-Fri and not in school_holidays).
 */
function is_school_day(PDO $pdo, string $dateYmd): bool
{
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', substr($dateYmd, 0, 10));
    if (!$dt) {
        return true;
    }
    $dow = (int) $dt->format('N'); // 1 (Mon) .. 7 (Sun)
    if ($dow >= 6) {
        return false; // Weekend
    }
    $holidays = get_school_holiday_map($pdo);
    return !isset($holidays[$dt->format('Y-m-d')]);
}

/**
 * Adds $schoolDays school days to $startDate (excluding Saturdays, Sundays, and school_holidays).
 */
function add_school_days(PDO $pdo, string $startDate, int $schoolDays = EVAL_DEFAULT_ACK_SCHOOL_DAYS): string
{
    $ymd = substr(trim($startDate), 0, 10);
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $ymd) ?: new DateTimeImmutable('today');
    $remaining = max(1, $schoolDays);
    $safety = 0;
    while ($remaining > 0 && $safety < 365) {
        $dt = $dt->modify('+1 day');
        $safety++;
        if (is_school_day($pdo, $dt->format('Y-m-d'))) {
            $remaining--;
        }
    }
    return $dt->format('Y-m-d');
}

/**
 * Counts how many school days have elapsed after $startDate up through $endDate.
 * Day 0 is the release date itself; the next school day is Day 1, etc.
 */
function count_elapsed_school_days(PDO $pdo, string $startDate, ?string $endDate = null): int
{
    $startYmd = substr(trim($startDate), 0, 10);
    $endYmd = $endDate ? substr(trim($endDate), 0, 10) : date('Y-m-d');

    $cur = DateTimeImmutable::createFromFormat('Y-m-d', $startYmd);
    $end = DateTimeImmutable::createFromFormat('Y-m-d', $endYmd);
    if (!$cur || !$end || $cur >= $end) {
        return 0;
    }

    $days = 0;
    $safety = 0;
    while ($cur < $end && $safety < 365) {
        $cur = $cur->modify('+1 day');
        $safety++;
        if (is_school_day($pdo, $cur->format('Y-m-d'))) {
            $days++;
        }
    }
    return $days;
}

/**
 * Records an immutable action entry in `evaluation_action_history`.
 */
function log_evaluation_action(
    PDO $pdo,
    int $evaluationId,
    ?int $actorUserId,
    string $actorName,
    string $actorRole,
    string $actionType,
    ?string $fromStatus,
    ?string $toStatus,
    ?string $ackStatus,
    ?string $remarks = null
): void {
    if ($evaluationId <= 0) {
        return;
    }
    try {
        $pdo->prepare("
            INSERT INTO evaluation_action_history (
                evaluation_id, actor_user_id, actor_name, actor_role,
                action_type, from_status, to_status, ack_status, remarks, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ")->execute([
            $evaluationId,
            $actorUserId,
            mb_substr(trim($actorName) ?: 'System', 0, 160),
            mb_substr(trim($actorRole) ?: 'SYSTEM', 0, 40),
            mb_substr(trim($actionType), 0, 60),
            $fromStatus,
            $toStatus,
            $ackStatus,
            $remarks !== null && trim($remarks) !== '' ? trim($remarks) : null,
        ]);
    } catch (Throwable $e) {
        error_log('[AssistPay Eval Action History Error] ' . $e->getMessage());
    }
}

/**
 * Checks whether a specific notification event key was already successfully sent to a user for an evaluation.
 */
function has_evaluation_notification_been_sent(PDO $pdo, int $evaluationId, int $recipientUserId, string $eventKey): bool
{
    try {
        $stmt = $pdo->prepare("
            SELECT COUNT(*) FROM evaluation_notification_logs
             WHERE evaluation_id = ? AND recipient_user_id = ? AND event_key = ? AND channel = 'IN_APP'
               AND delivery_status = 'SENT'
        ");
        $stmt->execute([$evaluationId, $recipientUserId, $eventKey]);
        return ((int) $stmt->fetchColumn()) > 0;
    } catch (Throwable $e) {
        return false;
    }
}

/**
 * Resolves the registered email address for a user (checking `users.email` and `sa_profiles.personal_email`).
 */
function resolve_user_email(PDO $pdo, int $userId): ?string
{
    try {
        $stmt = $pdo->prepare("
            SELECT u.email, p.personal_email
              FROM users u
              LEFT JOIN sa_profiles p ON p.user_id = u.id
             WHERE u.id = ?
             LIMIT 1
        ");
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        $email = trim((string) ($row['email'] ?? ''));
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $email;
        }
        $personal = trim((string) ($row['personal_email'] ?? ''));
        if ($personal !== '' && filter_var($personal, FILTER_VALIDATE_EMAIL)) {
            return $personal;
        }
    } catch (Throwable $e) {}
    return null;
}

/**
 * Checks whether an outgoing mail transport (local SMTP port or sendmail_path) is reachable,
 * and safely attempts email delivery without blocking or failing the in-app workflow.
 *
 * @return array{status: string, error: ?string}
 */
function attempt_evaluation_email(string $toEmail, string $subject, string $plainBody): array
{
    if (!filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
        return ['status' => 'SKIPPED_INVALID_EMAIL', 'error' => 'Recipient does not have a valid email address configured.'];
    }

    // Check if mail transport is explicitly enabled or if local SMTP server is listening
    $smtpHost = ini_get('SMTP') ?: 'localhost';
    $smtpPort = (int) (ini_get('smtp_port') ?: 25);
    $sendmailPath = trim((string) ini_get('sendmail_path'));

    $canConnectSmtp = false;
    if ($sendmailPath !== '') {
        $canConnectSmtp = true;
    } else {
        $fp = @fsockopen($smtpHost, $smtpPort, $errno, $errstr, 0.35);
        if (is_resource($fp)) {
            fclose($fp);
            $canConnectSmtp = true;
        }
    }

    if (!$canConnectSmtp) {
        return [
            'status' => 'FAILED_SMTP_UNAVAILABLE',
            'error' => "Mail server ({$smtpHost}:{$smtpPort}) is not running or configured in XAMPP php.ini; in-app notification remained active.",
        ];
    }

    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'From: AssistPay S.A. Evaluation System <no-reply@ncst.edu.ph>',
        'X-Mailer: AssistPay-NCST/1.0',
    ];
    $ok = @mail($toEmail, $subject, $plainBody, implode("\r\n", $headers));
    if ($ok) {
        return ['status' => 'SENT', 'error' => null];
    }
    $lastErr = error_get_last()['message'] ?? 'PHP mail() returned false.';
    return [
        'status' => 'FAILED_MAIL_SEND',
        'error' => mb_substr($lastErr, 0, 240),
    ];
}

/**
 * Dispatches both an In-App notification (`notifications` table) and an Email notification
 * for an S.A. Performance Evaluation event, recording both attempts in `evaluation_notification_logs`.
 * Isolated from throwing exceptions: any failure is logged to the outbox (`evaluation_notification_logs`)
 * with `PENDING_RETRY` so a notification failure never fails the parent workflow transaction.
 *
 * @return array{inAppSent: bool, emailStatus: string, queuedForRetry: bool}
 */
function send_evaluation_notification(
    PDO $pdo,
    int $evaluationId,
    int $recipientUserId,
    string $eventKey,
    string $title,
    string $inAppMessage,
    string $notifType,
    string $link,
    ?int $senderId = null,
    array $meta = [],
    bool $skipIfDuplicate = false
): array {
    $result = [
        'inAppSent' => false,
        'emailStatus' => 'SKIPPED',
        'queuedForRetry' => false,
    ];

    if ($recipientUserId <= 0) {
        return $result;
    }

    try {
        if ($skipIfDuplicate && $evaluationId > 0 && has_evaluation_notification_been_sent($pdo, $evaluationId, $recipientUserId, $eventKey)) {
            $result['inAppSent'] = true;
            $result['emailStatus'] = 'ALREADY_SENT';
            return $result;
        }

        // 1. Create In-App Notification (isolated in try/catch with outbox fallback)
        $notifId = null;
        $inAppError = null;
        try {
            if (!empty($meta['simulateNotificationFailure'])) {
                throw new RuntimeException('Simulated notification transport error for outbox verification.');
            }
            $notifId = create_notification($recipientUserId, $title, $inAppMessage, $notifType, $link, $senderId);
            if (!$notifId) {
                $inAppError = 'Could not insert into notifications table; queued in outbox for retry.';
            }
        } catch (Throwable $notifEx) {
            $notifId = null;
            $inAppError = mb_substr($notifEx->getMessage(), 0, 240);
            error_log('[AssistPay Eval In-App Notification Error] ' . $notifEx->getMessage());
        }

        $result['inAppSent'] = (bool) $notifId;
        $result['queuedForRetry'] = !$result['inAppSent'];
        $recipientEmail = resolve_user_email($pdo, $recipientUserId);

        if ($evaluationId > 0) {
            try {
                // Check if an outbox entry for this exact (evaluation_id, recipient_user_id, event_key, IN_APP) already exists in PENDING_RETRY/FAILED_DB
                $existingOutboxId = 0;
                if ($skipIfDuplicate) {
                    $chkStmt = $pdo->prepare("
                        SELECT id FROM evaluation_notification_logs
                         WHERE evaluation_id = ? AND recipient_user_id = ? AND event_key = ? AND channel = 'IN_APP'
                         ORDER BY id DESC LIMIT 1
                    ");
                    $chkStmt->execute([$evaluationId, $recipientUserId, $eventKey]);
                    $existingOutboxId = (int) $chkStmt->fetchColumn();
                }

                $inAppStatus = $notifId ? 'SENT' : 'PENDING_RETRY';
                if ($existingOutboxId > 0) {
                    $pdo->prepare("
                        UPDATE evaluation_notification_logs
                           SET delivery_status = ?,
                               error_message = ?,
                               last_retry_at = NOW()
                         WHERE id = ?
                    ")->execute([$inAppStatus, $inAppError, $existingOutboxId]);
                } else {
                    $pdo->prepare("
                        INSERT INTO evaluation_notification_logs (
                            evaluation_id, recipient_user_id, recipient_email, event_key,
                            channel, notif_type, link, sender_id, subject, message,
                            delivery_status, retry_count, error_message, created_at
                        ) VALUES (?, ?, ?, ?, 'IN_APP', ?, ?, ?, ?, ?, ?, 0, ?, NOW())
                    ")->execute([
                        $evaluationId,
                        $recipientUserId,
                        $recipientEmail,
                        $eventKey,
                        mb_substr($notifType ?: 'SA_EVALUATION', 0, 80),
                        mb_substr($link ?: '#/sa/evaluations', 0, 255),
                        $senderId,
                        mb_substr($title, 0, 255),
                        $inAppMessage,
                        $inAppStatus,
                        $inAppError,
                    ]);
                }
            } catch (Throwable $logEx) {
                error_log('[AssistPay Eval Notif Outbox Log Error] ' . $logEx->getMessage());
            }
        }

        // 2. Build Safe Email Body (Evaluation Reference, Required Action, Status, Due Date, Secure Link)
        $evalRef = $meta['evalRef'] ?? ($evaluationId > 0 ? "EVAL-#{$evaluationId}" : 'S.A. Performance Evaluation');
        $requiredAction = $meta['requiredAction'] ?? $title;
        $currentStatus = $meta['currentStatus'] ?? 'In Progress';
        $dueDate = !empty($meta['dueDate']) ? $meta['dueDate'] : 'N/A';

        $emailLines = [
            "NCST AssistPay — Student Assistant Performance Evaluation Notification",
            "---------------------------------------------------------------------",
            "Evaluation Reference : {$evalRef}",
            "Current Status       : {$currentStatus}",
            "Required Action      : {$requiredAction}",
            "Due Date             : {$dueDate}",
            "Portal Link          : {$link}",
            "",
            "Details:",
            $inAppMessage,
            "",
            "Note: Please sign in to your official AssistPay account ({$link}) to view or complete this action.",
            "For security, never share your password. AssistPay will never include passwords or authentication tokens in emails.",
        ];
        $emailBody = implode("\r\n", $emailLines);

        if (!$recipientEmail) {
            $result['emailStatus'] = 'SKIPPED_NO_EMAIL';
            if ($evaluationId > 0) {
                try {
                    $pdo->prepare("
                        INSERT INTO evaluation_notification_logs (
                            evaluation_id, recipient_user_id, recipient_email, event_key,
                            channel, notif_type, link, sender_id, subject, message,
                            delivery_status, retry_count, error_message, created_at
                        ) VALUES (?, ?, NULL, ?, 'EMAIL', ?, ?, ?, ?, ?, 'SKIPPED_NO_EMAIL', 0, ?, NOW())
                    ")->execute([
                        $evaluationId,
                        $recipientUserId,
                        $eventKey,
                        mb_substr($notifType ?: 'SA_EVALUATION', 0, 80),
                        mb_substr($link ?: '#/sa/evaluations', 0, 255),
                        $senderId,
                        mb_substr($title, 0, 255),
                        $emailBody,
                        'User account has no registered email address; in-app notification active.',
                    ]);
                } catch (Throwable $e) {}
            }
            return $result;
        }

        $emailResult = attempt_evaluation_email($recipientEmail, "[AssistPay] {$title}", $emailBody);
        $result['emailStatus'] = $emailResult['status'];
        if ($evaluationId > 0) {
            try {
                $pdo->prepare("
                    INSERT INTO evaluation_notification_logs (
                        evaluation_id, recipient_user_id, recipient_email, event_key,
                        channel, notif_type, link, sender_id, subject, message,
                        delivery_status, retry_count, error_message, created_at
                    ) VALUES (?, ?, ?, ?, 'EMAIL', ?, ?, ?, ?, ?, ?, 0, ?, NOW())
                ")->execute([
                    $evaluationId,
                    $recipientUserId,
                    $recipientEmail,
                    $eventKey,
                    mb_substr($notifType ?: 'SA_EVALUATION', 0, 80),
                    mb_substr($link ?: '#/sa/evaluations', 0, 255),
                    $senderId,
                    mb_substr($title, 0, 255),
                    $emailBody,
                    $emailResult['status'],
                    $emailResult['error'],
                ]);
            } catch (Throwable $e) {
                error_log('[AssistPay Eval Email Log Error] ' . $e->getMessage());
            }
        }
    } catch (Throwable $outerEx) {
        error_log('[AssistPay send_evaluation_notification Unexpected Error] ' . $outerEx->getMessage());
        $result['queuedForRetry'] = true;
    }

    return $result;
}

/**
 * Retries any pending or previously failed In-App notifications recorded in `evaluation_notification_logs` (Outbox Pattern).
 */
function retry_pending_evaluation_notifications(PDO $pdo, int $maxBatch = 25): int
{
    $retriedSuccess = 0;
    try {
        $stmt = $pdo->prepare("
            SELECT id, evaluation_id, recipient_user_id, notif_type, link, sender_id, subject, message, retry_count
              FROM evaluation_notification_logs
             WHERE channel = 'IN_APP'
               AND delivery_status IN ('PENDING_RETRY', 'FAILED_DB')
               AND retry_count < 5
             ORDER BY id ASC
             LIMIT {$maxBatch}
        ");
        $stmt->execute();
        $pendingRows = $stmt->fetchAll();

        foreach ($pendingRows as $row) {
            $logId = (int) $row['id'];
            $recipId = (int) $row['recipient_user_id'];
            $nType = $row['notif_type'] ?: 'SA_EVALUATION';
            $nLink = $row['link'] ?: '#/sa/evaluations';
            $senderId = !empty($row['sender_id']) ? (int) $row['sender_id'] : null;

            $notifId = null;
            if (function_exists('create_notification')) {
                $notifId = create_notification($recipId, $row['subject'], $row['message'], $nType, $nLink, $senderId);
            } else {
                try {
                    $insN = $pdo->prepare('
                        INSERT INTO notifications (user_id, sender_id, type, title, message, link, is_read, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, 0, NOW())
                    ');
                    $insN->execute([$recipId, $senderId, $nType, $row['subject'], $row['message'], $nLink]);
                    $notifId = (int) $pdo->lastInsertId();
                } catch (Throwable $e) {
                    $notifId = null;
                }
            }
            if ($notifId) {
                $pdo->prepare("
                    UPDATE evaluation_notification_logs
                       SET delivery_status = 'SENT',
                           retry_count = retry_count + 1,
                           last_retry_at = NOW(),
                           error_message = NULL
                     WHERE id = ?
                ")->execute([$logId]);
                $retriedSuccess++;
            } else {
                $pdo->prepare("
                    UPDATE evaluation_notification_logs
                       SET retry_count = retry_count + 1,
                           last_retry_at = NOW()
                     WHERE id = ?
                ")->execute([$logId]);
            }
        }
    } catch (Throwable $e) {
        error_log('[AssistPay Outbox Retry Error] ' . $e->getMessage());
    }
    return $retriedSuccess;
}

/**
 * Automatically checks all active `FOR_SA_REVIEW` evaluations to:
 * 1. Retry any pending outbox notifications (`evaluation_notification_logs`).
 * 2. Backfill `ack_released_at` and 5-school-day `ack_due_date` if missing.
 * 3. Send scheduled reminders on Day 2, Day 4, and Day 5 (final due-date reminder) if acknowledgment is still pending.
 * 4. Mark overdue evaluations after `ack_due_date` as `OVERDUE_AWAITING_SA` and notify the Coordinator for follow-up
 *    (without applying any automatic penalty or assuming refusal).
 * 5. Stop all reminders once the S.A. signs or the evaluation leaves `FOR_SA_REVIEW`.
 */
function process_evaluation_deadlines_and_reminders(PDO $pdo, ?int $semesterId = null): array
{
    ensure_evaluation_tables($pdo);
    retry_pending_evaluation_notifications($pdo);

    $sql = "
        SELECT e.*, p.user_id AS profile_user_id, p.student_id AS profile_student_id
          FROM sa_evaluations e
          LEFT JOIN sa_profiles p ON p.id = e.sa_profile_id
         WHERE e.status = 'FOR_SA_REVIEW'
           AND e.sa_acknowledged_at IS NULL
           AND (e.student_signature IS NULL OR e.student_signature = '')
    ";
    $params = [];
    if ($semesterId !== null && $semesterId > 0) {
        $sql .= " AND e.semester_id = ?";
        $params[] = $semesterId;
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    if (empty($rows)) {
        return [
            'checked' => 0,
            'remindersSent' => 0,
            'overdueMarked' => 0,
        ];
    }

    $today = date('Y-m-d');
    $coordIds = [];
    try {
        $coordIds = array_map('intval', $pdo->query("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'")->fetchAll(PDO::FETCH_COLUMN));
    } catch (Throwable $e) {}

    $remindersSent = 0;
    $overdueMarked = 0;

    foreach ($rows as $ev) {
        $evalId = (int) $ev['id'];
        $saUserId = !empty($ev['sa_user_id']) ? (int) $ev['sa_user_id'] : (!empty($ev['profile_user_id']) ? (int) $ev['profile_user_id'] : 0);
        $ackStatus = (string) ($ev['acknowledgment_status'] ?? 'PENDING');

        // Stop routine reminders if already resolved/routed
        if (in_array($ackStatus, ['SIGNED', 'CONCERN_SUBMITTED', 'ACKNOWLEDGMENT_DECLINED', 'UNABLE_TO_ACKNOWLEDGE', 'RETURNED_FOR_REVISION'], true)) {
            continue;
        }

        // Ensure release timestamp and 5-school-day due date exist
        $releasedAt = $ev['ack_released_at'] ?: ($ev['submitted_at'] ?: $ev['updated_at'] ?: date('Y-m-d H:i:s'));
        $releaseDate = substr($releasedAt, 0, 10);
        $dueDate = $ev['ack_due_date'];
        if (!$dueDate) {
            $dueDate = add_school_days($pdo, $releaseDate, EVAL_DEFAULT_ACK_SCHOOL_DAYS);
            $pdo->prepare("
                UPDATE sa_evaluations
                   SET ack_released_at = COALESCE(ack_released_at, ?),
                       ack_due_date = ?,
                       original_ack_due_date = COALESCE(original_ack_due_date, ?),
                       sa_user_id = COALESCE(sa_user_id, ?)
                 WHERE id = ?
            ")->execute([$releasedAt, $dueDate, $dueDate, $saUserId ?: null, $evalId]);
        }

        $evalRef = "EVAL-#{$evalId} ({$ev['student_name']} • {$ev['evaluation_period']})";
        $elapsedDays = count_elapsed_school_days($pdo, $releaseDate, $today);

        // Check if past the acknowledgment deadline
        if ($today > $dueDate) {
            if (!in_array($ackStatus, ['OVERDUE_AWAITING_SA', 'OVERDUE_AWAITING_COORDINATOR', 'EXTENSION_REQUESTED'], true)) {
                $pdo->prepare("
                    UPDATE sa_evaluations
                       SET acknowledgment_status = 'OVERDUE_AWAITING_SA'
                     WHERE id = ?
                ")->execute([$evalId]);
                $ackStatus = 'OVERDUE_AWAITING_SA';
                $overdueMarked++;

                log_evaluation_action(
                    $pdo,
                    $evalId,
                    null,
                    'System Scheduler',
                    'SYSTEM',
                    'ACKNOWLEDGMENT_OVERDUE',
                    'FOR_SA_REVIEW',
                    'FOR_SA_REVIEW',
                    'OVERDUE_AWAITING_SA',
                    "Acknowledgment deadline ({$dueDate}) passed without S.A. signature. Marked overdue for Coordinator follow-up."
                );
            }

            // Send one-time overdue notice to S.A.
            if ($saUserId > 0) {
                $wasSent = has_evaluation_notification_been_sent($pdo, $evalId, $saUserId, "OVERDUE_SA_{$dueDate}");
                if (!$wasSent) {
                    send_evaluation_notification(
                        $pdo,
                        $evalId,
                        $saUserId,
                        "OVERDUE_SA_{$dueDate}",
                        "Overdue: S.A. Performance Evaluation Acknowledgment",
                        "Your performance evaluation for {$ev['evaluation_period']} (Due: {$dueDate}) is now past the 5-school-day acknowledgment deadline. Please sign in to review and acknowledge receipt, or submit an emergency extension request if needed.",
                        'SA_EVALUATION_OVERDUE',
                        '#/sa/evaluations',
                        null,
                        [
                            'evalRef' => $evalRef,
                            'requiredAction' => 'Review & Acknowledge Evaluation or Request Extension',
                            'currentStatus' => 'Step 2: Overdue — Awaiting S.A.',
                            'dueDate' => $dueDate,
                        ],
                        true
                    );
                    $remindersSent++;
                }
            }

            // Notify Coordinators for follow-up (never automatic penalty/refusal)
            foreach ($coordIds as $coordId) {
                $wasCoordSent = has_evaluation_notification_been_sent($pdo, $evalId, $coordId, "OVERDUE_COORD_{$dueDate}");
                if (!$wasCoordSent) {
                    send_evaluation_notification(
                        $pdo,
                        $evalId,
                        $coordId,
                        "OVERDUE_COORD_{$dueDate}",
                        "Follow-up Needed: Overdue S.A. Acknowledgment ({$ev['student_name']})",
                        "{$ev['student_name']} ({$ev['department']}) has not yet signed acknowledgment for their {$ev['evaluation_period']} performance evaluation (Due Date: {$dueDate}). Please follow up with the S.A. or review exception options.",
                        'SA_EVALUATION_OVERDUE',
                        '#/admin/evaluations',
                        null,
                        [
                            'evalRef' => $evalRef,
                            'requiredAction' => 'Coordinator Follow-up on Overdue S.A. Acknowledgment',
                            'currentStatus' => 'Step 2: Overdue — Awaiting S.A.',
                            'dueDate' => $dueDate,
                        ],
                        true
                    );
                }
            }
            continue;
        }

        // Not overdue yet: check Day 5 (final due-date reminder), Day 4 (second reminder), Day 2 (first reminder)
        if ($saUserId <= 0) {
            continue;
        }

        if ($today === $dueDate || $elapsedDays >= 5) {
            $eventKey = "REMINDER_DAY_5_{$dueDate}";
            if (!has_evaluation_notification_been_sent($pdo, $evalId, $saUserId, $eventKey)) {
                send_evaluation_notification(
                    $pdo,
                    $evalId,
                    $saUserId,
                    $eventKey,
                    "Final Reminder (Due Today): Acknowledge Your Performance Evaluation",
                    "Today ({$dueDate}) is the 5th school day and final due date to review and sign acknowledgment for your {$ev['evaluation_period']} performance evaluation from {$ev['supervisor_name']}. You may also request an extension if you have a valid conflict.",
                    'SA_EVALUATION_REMINDER',
                    '#/sa/evaluations',
                    null,
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'Sign Evaluation Acknowledgment (Due Today)',
                        'currentStatus' => 'Step 2: Awaiting S.A. Acknowledgment (Day 5 Final Reminder)',
                        'dueDate' => $dueDate,
                    ],
                    true
                );
                $remindersSent++;
            }
        } elseif ($elapsedDays >= 4) {
            $eventKey = "REMINDER_DAY_4_{$dueDate}";
            if (!has_evaluation_notification_been_sent($pdo, $evalId, $saUserId, $eventKey)) {
                send_evaluation_notification(
                    $pdo,
                    $evalId,
                    $saUserId,
                    $eventKey,
                    "2nd Reminder: S.A. Performance Evaluation Acknowledgment Due {$dueDate}",
                    "Reminder (School Day 4 of 5): Your performance evaluation for {$ev['evaluation_period']} is awaiting your review and acknowledgment signature. Due date: {$dueDate}.",
                    'SA_EVALUATION_REMINDER',
                    '#/sa/evaluations',
                    null,
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'Review & Sign Evaluation Acknowledgment',
                        'currentStatus' => 'Step 2: Awaiting S.A. Acknowledgment (Day 4 Reminder)',
                        'dueDate' => $dueDate,
                    ],
                    true
                );
                $remindersSent++;
            }
        } elseif ($elapsedDays >= 2) {
            $eventKey = "REMINDER_DAY_2_{$dueDate}";
            if (!has_evaluation_notification_been_sent($pdo, $evalId, $saUserId, $eventKey)) {
                send_evaluation_notification(
                    $pdo,
                    $evalId,
                    $saUserId,
                    $eventKey,
                    "1st Reminder: Review & Acknowledge Your S.A. Evaluation",
                    "Friendly reminder (School Day 2 of 5): Please review your {$ev['evaluation_period']} performance evaluation submitted by {$ev['supervisor_name']} and sign the acknowledgment receipt on or before {$dueDate}.",
                    'SA_EVALUATION_REMINDER',
                    '#/sa/evaluations',
                    null,
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'Review & Sign Evaluation Acknowledgment',
                        'currentStatus' => 'Step 2: Awaiting S.A. Acknowledgment (Day 2 Reminder)',
                        'dueDate' => $dueDate,
                    ],
                    true
                );
                $remindersSent++;
            }
        }
    }

    return [
        'checkedCount' => count($rows),
        'remindersSent' => $remindersSent,
        'overdueMarked' => $overdueMarked,
    ];
}

/**
 * Computes the 5-step tracker metadata from actual saved database columns.
 */
function build_evaluation_tracker(?array $ev, array $saItem, ?string $campaignDeadline = null): array
{
    $status = $ev['status'] ?? 'PENDING';
    $ackStatus = $ev['acknowledgment_status'] ?? 'PENDING';
    $supName = ($ev['supervisor_name'] ?? '') ?: ($saItem['supervisorName'] ?? 'Immediate Supervisor');
    $saName = ($ev['student_name'] ?? '') ?: ($saItem['studentName'] ?? 'Student Assistant');
    $coordName = ($ev['coordinator_name'] ?? '') ?: 'S.A. Coordinator';
    $dueDate = $ev['ack_due_date'] ?? null;
    $updatedAt = $ev['updated_at'] ?? ($ev['submitted_at'] ?? null);

    $hasDraft = $ev && (
        $ev['c1'] !== null || $ev['c2'] !== null || !empty($ev['strengths_weaknesses'])
    );

    // Default before Supervisor submits Step 1
    $step1Status = $hasDraft ? 'In Progress (Draft)' : 'Awaiting Action';
    $step1Tone = 'active';
    $step2Status = 'Pending';
    $step2Tone = 'pending';
    $step3Status = 'Pending';
    $step3Tone = 'pending';
    $step4Status = 'Pending';
    $step4Tone = 'pending';
    $step5Status = 'Pending';
    $step5Tone = 'pending';

    $currentStep = 1;
    $currentStatusLabel = $hasDraft ? 'Step 1: Supervisor Evaluation (Draft In Progress)' : 'Step 1: Awaiting Supervisor Evaluation';
    $responsibleRole = 'Immediate Supervisor';
    $responsiblePerson = "{$supName} (Immediate Supervisor)";
    $applicableDueDate = $campaignDeadline;

    if ($status === 'RETURNED_FOR_REVISION') {
        $step1Status = 'Returned for Revision';
        $step1Tone = 'warning';
        $step2Status = 'Returned for Revision';
        $step2Tone = 'warning';
        $step3Status = 'Pending Resubmission';
        $step3Tone = 'pending';
        $step4Status = 'Pending';
        $step4Tone = 'pending';
        $step5Status = 'Pending';
        $step5Tone = 'pending';

        $currentStep = 1;
        $currentStatusLabel = 'Returned to Supervisor for Revision';
        $responsibleRole = 'Immediate Supervisor';
        $responsiblePerson = "{$supName} (Immediate Supervisor)";
        $applicableDueDate = $campaignDeadline;
    } elseif ($status === 'FOR_SA_REVIEW') {
        $step1Status = 'Completed';
        $step1Tone = 'done';
        $step2Status = 'Recommendation Submitted';
        $step2Tone = 'done';

        if ($ackStatus === 'EXTENSION_REQUESTED') {
            $step3Status = 'Extension Requested';
            $step3Tone = 'warning';
            $currentStatusLabel = 'Extension Requested (Awaiting Coordinator Decision)';
            $responsibleRole = 'S.A. Coordinator / Student Assistant';
            $responsiblePerson = "S.A. Coordinator / {$saName}";
        } elseif ($ackStatus === 'EXTENDED') {
            $step3Status = 'In Progress (Extended)';
            $step3Tone = 'active';
            $currentStatusLabel = 'Deadline Extended — Awaiting S.A. Acknowledgment';
            $responsibleRole = 'Student Assistant';
            $responsiblePerson = "{$saName} (Student Assistant)";
        } elseif (in_array($ackStatus, ['OVERDUE_AWAITING_SA', 'OVERDUE_AWAITING_COORDINATOR'], true) || (!empty($dueDate) && date('Y-m-d') > $dueDate)) {
            $step3Status = 'Overdue';
            $step3Tone = 'danger';
            $currentStatusLabel = 'Overdue — Awaiting S.A. Acknowledgment';
            $responsibleRole = 'Student Assistant & S.A. Coordinator';
            $responsiblePerson = "{$saName} (S.A.) & S.A. Coordinator";
        } else {
            $step3Status = 'Awaiting S.A. Review';
            $step3Tone = 'active';
            $currentStatusLabel = 'Sent to S.A. for Review & Acknowledgment';
            $responsibleRole = 'Student Assistant';
            $responsiblePerson = "{$saName} (Student Assistant)";
        }

        $step4Status = 'Pending S.A. Acknowledgment';
        $step4Tone = 'pending';
        $step5Status = 'Pending';
        $step5Tone = 'pending';
        $currentStep = 3;
        $applicableDueDate = $dueDate;
    } elseif ($status === 'FOR_COORDINATOR_REVIEW') {
        $step1Status = 'Completed';
        $step1Tone = 'done';
        $step2Status = 'Recommendation Submitted';
        $step2Tone = 'done';
        $step3Status = ($ackStatus === 'CONCERN_SUBMITTED') ? 'Acknowledged with Concern' : 'Signed & Acknowledged';
        $step3Tone = ($ackStatus === 'CONCERN_SUBMITTED') ? 'warning' : 'done';
        $step4Status = 'Awaiting Coordinator Review';
        $step4Tone = 'active';
        $step5Status = 'Pending';
        $step5Tone = 'pending';

        $currentStep = 4;
        $currentStatusLabel = 'Pending Coordinator Review & Approval';
        $responsibleRole = 'S.A. Coordinator';
        $responsiblePerson = "{$coordName} (S.A. Coordinator)";
        $applicableDueDate = null;
    } elseif ($status === 'REJECTED') {
        $step1Status = 'Completed';
        $step1Tone = 'done';
        $step2Status = 'Recommendation Submitted';
        $step2Tone = 'done';
        $step3Status = !empty($ev['sa_acknowledged_at']) ? 'Signed & Acknowledged' : 'Reviewed';
        $step3Tone = 'done';
        $step4Status = 'Rejected by Coordinator';
        $step4Tone = 'danger';
        $step5Status = 'Rejected';
        $step5Tone = 'danger';

        $currentStep = 4;
        $currentStatusLabel = 'Recommendation Rejected by Coordinator';
        $responsibleRole = 'S.A. Coordinator';
        $responsiblePerson = "{$coordName} (S.A. Coordinator)";
        $applicableDueDate = null;
    } elseif ($status === 'FINALIZED') {
        $step1Status = 'Completed';
        $step1Tone = 'done';
        $step2Status = 'Recommendation Submitted';
        $step2Tone = 'done';
        $step3Status = 'Signed & Acknowledged';
        $step3Tone = 'done';
        $step4Status = 'Approved by Coordinator';
        $step4Tone = 'done';
        $step5Status = 'Finalized & Archived';
        $step5Tone = 'done';

        $currentStep = 5;
        $currentStatusLabel = 'Finalized Evaluation';
        $responsibleRole = 'Completed';
        $responsiblePerson = "Authorized by {$coordName}";
        $applicableDueDate = $ev['effective_date'] ?? $dueDate;
    }

    return [
        'currentStep' => $currentStep,
        'currentStatus' => $currentStatusLabel,
        'responsibleRole' => $responsibleRole,
        'responsiblePerson' => $responsiblePerson,
        'lastUpdatedAt' => $updatedAt,
        'dueDate' => $applicableDueDate,
        'steps' => [
            [
                'step' => 1,
                'title' => '1. Supervisor Evaluation',
                'desc' => 'Supervisor completes assessment criteria (1–10) ratings and total score.',
                'statusLabel' => $step1Status,
                'tone' => $step1Tone,
                'actor' => $supName,
                'roleLabel' => 'Immediate Supervisor',
                'timestamp' => $ev['submitted_at'] ?? null,
            ],
            [
                'step' => 2,
                'title' => '2. Recommended Decision',
                'desc' => 'Auto-detected recommendation (Retain, Improvement Plan, Reassignment, or Non-Renewal) with supervisor rationale and e-signature.',
                'statusLabel' => $step2Status,
                'tone' => $step2Tone,
                'actor' => $supName,
                'roleLabel' => 'Immediate Supervisor',
                'timestamp' => $ev['submitted_at'] ?? null,
            ],
            [
                'step' => 3,
                'title' => '3. S.A. Review & Acknowledgment',
                'desc' => 'Student Assistant reviews criteria (1–10) & supervisor assessment, and electronically signs acknowledgment.',
                'statusLabel' => $step3Status,
                'tone' => $step3Tone,
                'actor' => $saName,
                'roleLabel' => 'Student Assistant',
                'timestamp' => $ev['sa_acknowledged_at'] ?? null,
                'dueDate' => $dueDate,
            ],
            [
                'step' => 4,
                'title' => '4. Coordinator Review',
                'desc' => 'Coordinator reviews recommendation and has authority to approve final decision, return for revision, or reject.',
                'statusLabel' => $step4Status,
                'tone' => $step4Tone,
                'actor' => $coordName,
                'roleLabel' => 'S.A. Coordinator',
                'timestamp' => $ev['finalized_at'] ?? ($ev['returned_at'] ?? null),
            ],
            [
                'step' => 5,
                'title' => '5. Finalized Evaluation',
                'desc' => 'System completes, locks, and preserves the finalized evaluation record.',
                'statusLabel' => $step5Status,
                'tone' => $step5Tone,
                'actor' => 'All Parties',
                'roleLabel' => 'System / Official Records',
                'timestamp' => $ev['finalized_at'] ?? null,
            ],
        ],
    ];
}


