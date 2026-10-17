<?php
// AssistPay — Attendance-Based Allowance Cutoff & Accounting Deduction Endorsement API
// Features:
// - Cutoff Management (Period definition, status, attendance finalization tracking)
// - Attendance-Based Payable Allowance Calculation (Credited Hours × Rate; Scheduled hours used for planning only)
// - Automatic School-Balance Deduction Endorsement for Accounting (Eligible YES authorizations)
// - Multi-S.A. Bulk Edit, Quick Inline Edit, Single S.A. Edit, Standard Base Rate (₱8 - ₱1,000 whole-number validation)
// - Dual Endorsement Documents: Allowance Endorsement Report & School-Balance Deduction Endorsement List

require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_sa.php';
require_once __DIR__ . '/_matching.php';
require_once __DIR__ . '/_scheduling.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
require_role($user, 'ADMIN');
$in = input();
$action = $in['action'] ?? '';

global $pdo;

if (!function_exists('validate_hourly_rate')) {
    /**
     * Strict allowance rate validation helper adhering strictly to system requirements:
     * - Whole numbers only (₱8 to ₱1,000)
     * - Explicitly rejects decimals, negatives, alphabetic input, scientific notation, empty
     */
    function validate_hourly_rate(mixed $rawVal, string $fieldLabel = 'Hourly allowance rate'): float
    {
        if ($rawVal === null || trim((string) $rawVal) === '') {
            fail("{$fieldLabel} is required.", 422);
        }
        $str = trim((string) $rawVal);

        // Reject letters, scientific notation (e.g. 1e2), or malformed symbols
        if (!preg_match('/^-?[0-9]+(\.[0-9]+)?$/', $str)) {
            if ($fieldLabel === 'Standard Base Rate') {
                fail('Standard Base Rate must be a whole number from ₱8 to ₱1,000.', 422);
            }
            fail('Enter a valid whole-number hourly rate.', 422);
        }

        // Reject negative numbers
        if (str_starts_with($str, '-') || (float) $str < 0) {
            fail('Negative allowance rates are not allowed.', 422);
        }

        // Reject decimals (e.g. 8.5, 9.50, 10.25, 999.99)
        if (str_contains($str, '.') || floor((float) $str) != (float) $str) {
            fail('Enter a whole-number rate only. Decimal values are not allowed.', 422);
        }

        $val = (int) $str;
        if ($val < 8) {
            if ($fieldLabel === 'Standard Base Rate') {
                fail('Standard Base Rate must be a whole number from ₱8 to ₱1,000.', 422);
            }
            fail('Hourly allowance rate must be at least ₱8.', 422);
        }
        if ($val > 1000) {
            if ($fieldLabel === 'Standard Base Rate') {
                fail('Standard Base Rate must be a whole number from ₱8 to ₱1,000.', 422);
            }
            fail('Hourly allowance rate cannot exceed ₱1,000.', 422);
        }

        return (float) $val;
    }
}

if (!function_exists('validate_rate_reason')) {
    function validate_rate_reason(mixed $rawReason, string $context = 'rate edit'): string
    {
        $reason = trim((string) ($rawReason ?? ''));
        if (mb_strlen($reason) < 3) {
            fail("Please provide a valid reason for the {$context} (at least 3 characters).", 422);
        }
        if (mb_strlen($reason) > 200) {
            fail('Reason must be 200 characters or fewer.', 422);
        }
        return $reason;
    }
}

if (!function_exists('ensure_allowance_schema')) {
    function ensure_allowance_schema(PDO $pdo): void
    {
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS `sa_rate_history` (
                `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
                `sa_profile_id` INT(10) UNSIGNED NULL,
                `sa_name` VARCHAR(160) NOT NULL,
                `student_id` VARCHAR(30) NULL,
                `semester_id` INT(10) UNSIGNED NULL,
                `previous_rate` DECIMAL(8,2) NULL,
                `new_rate` DECIMAL(8,2) NOT NULL,
                `effective_date` DATE NOT NULL,
                `source` ENUM('INDIVIDUAL_EDIT','INLINE_EDIT','BULK_EDIT','STANDARD_RATE_UPDATE') NOT NULL DEFAULT 'INDIVIDUAL_EDIT',
                `reason` VARCHAR(255) NOT NULL,
                `changed_by` INT(10) UNSIGNED NOT NULL,
                `changed_by_name` VARCHAR(160) NOT NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                KEY `idx_sa_hist` (`sa_profile_id`, `created_at`),
                KEY `idx_sem_hist` (`semester_id`, `created_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );

        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS `allowance_cutoffs` (
                `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
                `semester_id` INT(10) UNSIGNED NOT NULL,
                `cutoff_code` VARCHAR(50) NOT NULL,
                `cutoff_name` VARCHAR(150) NOT NULL,
                `start_date` DATE NOT NULL,
                `end_date` DATE NOT NULL,
                `status` ENUM('DRAFT', 'OPEN_FOR_ATTENDANCE', 'ATTENDANCE_REVIEW', 'READY_FOR_COMPUTATION', 'COMPUTED', 'FOR_REVIEW', 'ENDORSED_TO_ACCOUNTING', 'CLOSED') NOT NULL DEFAULT 'OPEN_FOR_ATTENDANCE',
                `attendance_status` VARCHAR(50) NOT NULL DEFAULT 'PENDING',
                `computation_status` VARCHAR(50) NOT NULL DEFAULT 'UNCOMPUTED',
                `endorsement_status` VARCHAR(50) NOT NULL DEFAULT 'UNENDORSED',
                `total_sas` INT(10) UNSIGNED NOT NULL DEFAULT 0,
                `total_scheduled_hours` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_credited_hours` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_gross_allowance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_deductions` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_net_allowance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `discrepancy_count` INT(10) UNSIGNED NOT NULL DEFAULT 0,
                `last_computed_at` DATETIME NULL,
                `endorsed_at` DATETIME NULL,
                `endorsed_by` INT(10) UNSIGNED NULL,
                `endorsement_ref` VARCHAR(60) NULL,
                `remarks` TEXT NULL,
                `created_by` INT(10) UNSIGNED NOT NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uk_sem_dates` (`semester_id`, `start_date`, `end_date`),
                KEY `idx_sem_status` (`semester_id`, `status`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );

        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS `allowance_cutoff_computations` (
                `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
                `cutoff_id` INT(10) UNSIGNED NOT NULL,
                `sa_profile_id` INT(10) UNSIGNED NOT NULL,
                `semester_id` INT(10) UNSIGNED NOT NULL,
                `hourly_rate` DECIMAL(8,2) NOT NULL,
                `scheduled_hours` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
                `recorded_hours` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
                `credited_hours` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
                `overtime_hours` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
                `gross_allowance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `has_deduction_auth` TINYINT(1) NOT NULL DEFAULT 0,
                `school_balance_before` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `authorized_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `proposed_deduction` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `net_allowance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `expected_balance_after` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `attendance_status` VARCHAR(50) NOT NULL DEFAULT 'AWAITING_ATTENDANCE',
                `computation_status` VARCHAR(50) NOT NULL DEFAULT 'AWAITING_ATTENDANCE',
                `discrepancy_reasons` TEXT NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uk_cutoff_sa` (`cutoff_id`, `sa_profile_id`),
                KEY `idx_cutoff_comp` (`cutoff_id`, `computation_status`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );

        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS `allowance_deduction_endorsements` (
                `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
                `cutoff_id` INT(10) UNSIGNED NOT NULL,
                `sa_profile_id` INT(10) UNSIGNED NOT NULL,
                `semester_id` INT(10) UNSIGNED NOT NULL,
                `campaign_id` INT(10) UNSIGNED NULL,
                `response_id` INT(10) UNSIGNED NULL,
                `student_id` VARCHAR(30) NOT NULL,
                `student_name` VARCHAR(160) NOT NULL,
                `department` VARCHAR(50) NOT NULL,
                `course` VARCHAR(80) NULL,
                `gross_allowance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `school_balance_before` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `authorized_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `proposed_deduction` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `expected_balance_after` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `authorization_date` DATETIME NULL,
                `status` ENUM('PROPOSED_FOR_ACCOUNTING', 'ENDORSED_TO_ACCOUNTING', 'CONFIRMED_PROCESSED', 'RETURNED_FOR_CORRECTION', 'EXCLUDED_NO_ALLOWANCE') NOT NULL DEFAULT 'PROPOSED_FOR_ACCOUNTING',
                `notes` VARCHAR(255) NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uk_cutoff_sa_ded` (`cutoff_id`, `sa_profile_id`),
                KEY `idx_cutoff_status` (`cutoff_id`, `status`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );

        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS `allowance_endorsements` (
                `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
                `semester_id` INT(10) UNSIGNED NOT NULL,
                `cutoff_id` INT(10) UNSIGNED NULL,
                `endorsement_ref` VARCHAR(60) NULL,
                `period_type` ENUM('WEEK','MONTH','SEMESTER','CUSTOM','CUTOFF') NOT NULL DEFAULT 'CUTOFF',
                `period_label` VARCHAR(150) NOT NULL,
                `start_date` DATE NOT NULL,
                `end_date` DATE NOT NULL,
                `status` ENUM('DRAFT','FOR_REVIEW','ENDORSED','RETURNED_FOR_CORRECTION') NOT NULL DEFAULT 'DRAFT',
                `total_sas` INT(10) UNSIGNED NOT NULL DEFAULT 0,
                `total_scheduled_hours` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_credited_hours` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_overtime_hours` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_allowance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_gross_allowance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_deductions` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `total_net_allowance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                `discrepancy_count` INT(10) UNSIGNED NOT NULL DEFAULT 0,
                `remarks` TEXT NULL,
                `coordinator_name` VARCHAR(160) NULL,
                `endorsed_by` INT(10) UNSIGNED NULL,
                `endorsed_at` DATETIME NULL,
                `return_reason` TEXT NULL,
                `created_by` INT(10) UNSIGNED NOT NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                KEY `idx_sem_cutoff` (`semester_id`, `cutoff_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );

        $ensureCol = function(string $table, string $column, string $colDef) use ($pdo) {
            $cols = $pdo->query("SHOW COLUMNS FROM `{$table}` LIKE '{$column}'")->fetchAll();
            if (empty($cols)) {
                $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$colDef}");
            }
        };
        $ensureCol('allowance_endorsements', 'cutoff_id', 'INT(10) UNSIGNED NULL AFTER semester_id');
        $ensureCol('allowance_endorsements', 'endorsement_ref', 'VARCHAR(60) NULL AFTER cutoff_id');
        $ensureCol('allowance_endorsements', 'total_gross_allowance', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_allowance');
        $ensureCol('allowance_endorsements', 'total_deductions', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_gross_allowance');
        $ensureCol('allowance_endorsements', 'total_net_allowance', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_deductions');
        $ensureCol('allowance_endorsements', 'coordinator_name', 'VARCHAR(160) NULL AFTER remarks');
        $ensureCol('allowance_cutoff_computations', 'break_deduction', 'DECIMAL(8,2) NOT NULL DEFAULT 0.00 AFTER recorded_hours');
    }
}

if (!function_exists('seed_default_cutoffs_if_needed')) {
    /**
     * Automatically generates and seeds standard school cutoffs for the semester
     * (1st–15th and 16th–end-of-month) if none have been created yet.
     */
    function seed_default_cutoffs_if_needed(PDO $pdo, array $sem, int $userId): void
    {
        $check = $pdo->prepare('SELECT COUNT(*) FROM allowance_cutoffs WHERE semester_id = ?');
        $check->execute([$sem['id']]);
        if ((int)$check->fetchColumn() > 0) return;

        $start = !empty($sem['start_date']) ? $sem['start_date'] : '2026-08-17';
        $end = !empty($sem['end_date']) ? $sem['end_date'] : '2026-12-19';

        $startDate = new DateTime($start);
        $endDate = new DateTime($end);
        $today = new DateTime(date('Y-m-d'));

        $cur = new DateTime($startDate->format('Y-m-01'));
        $cutoffNo = 1;
        $cutoffsToInsert = [];

        while ($cur <= $endDate) {
            $year = (int)$cur->format('Y');
            $month = (int)$cur->format('m');
            $daysInMonth = (int)$cur->format('t');

            // 1st half: 1st to 15th
            $h1Start = new DateTime(sprintf('%04d-%02d-01', $year, $month));
            $h1End = new DateTime(sprintf('%04d-%02d-15', $year, $month));

            if ($h1End >= $startDate && $h1Start <= $endDate) {
                $actualStart = $h1Start < $startDate ? $startDate : $h1Start;
                $actualEnd = $h1End > $endDate ? $endDate : $h1End;
                $cutoffsToInsert[] = [
                    'code' => sprintf('C%02d-%s-%s', $cutoffNo, $actualStart->format('M'), $actualStart->format('Y')),
                    'name' => sprintf('Cutoff %d: %s – %s', $cutoffNo, $actualStart->format('M d'), $actualEnd->format('M d, Y')),
                    'start_date' => $actualStart->format('Y-m-d'),
                    'end_date' => $actualEnd->format('Y-m-d'),
                    'status' => ($today >= $actualStart && $today <= $actualEnd) ? 'OPEN_FOR_ATTENDANCE' : ($today > $actualEnd ? 'READY_FOR_COMPUTATION' : 'DRAFT')
                ];
                $cutoffNo++;
            }

            // 2nd half: 16th to end of month
            $h2Start = new DateTime(sprintf('%04d-%02d-16', $year, $month));
            $h2End = new DateTime(sprintf('%04d-%02d-%02d', $year, $month, $daysInMonth));

            if ($h2End >= $startDate && $h2Start <= $endDate) {
                $actualStart = $h2Start < $startDate ? $startDate : $h2Start;
                $actualEnd = $h2End > $endDate ? $endDate : $h2End;
                $cutoffsToInsert[] = [
                    'code' => sprintf('C%02d-%s-%s', $cutoffNo, $actualStart->format('M'), $actualStart->format('Y')),
                    'name' => sprintf('Cutoff %d: %s – %s', $cutoffNo, $actualStart->format('M d'), $actualEnd->format('M d, Y')),
                    'start_date' => $actualStart->format('Y-m-d'),
                    'end_date' => $actualEnd->format('Y-m-d'),
                    'status' => ($today >= $actualStart && $today <= $actualEnd) ? 'OPEN_FOR_ATTENDANCE' : ($today > $actualEnd ? 'READY_FOR_COMPUTATION' : 'DRAFT')
                ];
                $cutoffNo++;
            }

            $cur->modify('+1 month');
        }

        $ins = $pdo->prepare('
            INSERT INTO allowance_cutoffs (semester_id, cutoff_code, cutoff_name, start_date, end_date, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE cutoff_name = VALUES(cutoff_name)
        ');
        foreach ($cutoffsToInsert as $c) {
            $ins->execute([
                $sem['id'], $c['code'], $c['name'], $c['start_date'], $c['end_date'], $c['status'], $userId
            ]);
        }
    }
}

ensure_allowance_schema($pdo);

switch ($action) {
    case 'list':
    case 'cutoffs_list':
    case 'compute_cutoff':
        $semId = isset($in['semesterId']) ? (int) $in['semesterId'] : null;
        $sem = target_semester($semId);
        seed_default_cutoffs_if_needed($pdo, $sem, (int)$user['id']);

        // Fetch standard base rate for this semester
        $rateStmt = $pdo->prepare('SELECT hourly_rate FROM allowance_rates WHERE semester_id = ?');
        $rateStmt->execute([$sem['id']]);
        $semRate = (float) ($rateStmt->fetchColumn() ?: DEFAULT_HOURLY_RATE);

        $today = date('Y-m-d');

        // Fetch all cutoffs for semester
        $cStmt = $pdo->prepare('SELECT * FROM allowance_cutoffs WHERE semester_id = ? ORDER BY start_date ASC, id ASC');
        $cStmt->execute([$sem['id']]);
        $rawCutoffs = $cStmt->fetchAll(PDO::FETCH_ASSOC);

        // Dynamically classify cutoffs by server date and configured timezone
        $allCutoffs = [];
        $eligibleCutoffs = [];
        foreach ($rawCutoffs as $c) {
            if ($today >= $c['start_date'] && $today <= $c['end_date']) {
                $c['dateClassification'] = 'CURRENT CUT-OFF';
                $c['isCurrent'] = true;
                $c['isPrevious'] = false;
                $c['isFuture'] = false;
            } elseif ($today > $c['end_date']) {
                $c['dateClassification'] = 'PREVIOUS CUT-OFF';
                $c['isCurrent'] = false;
                $c['isPrevious'] = true;
                $c['isFuture'] = false;
            } else {
                $c['dateClassification'] = 'FUTURE CUT-OFF';
                $c['isCurrent'] = false;
                $c['isPrevious'] = false;
                $c['isFuture'] = true;
            }
            $allCutoffs[] = $c;
            if (!$c['isFuture']) {
                $eligibleCutoffs[] = $c;
            }
        }

        if ($action === 'cutoffs_list') {
            respond([
                'success' => true,
                'cutoffs' => $eligibleCutoffs,
                'semester' => $sem
            ]);
        }

        // Determine target cutoff
        $cutoffId = isset($in['cutoffId']) ? (int)$in['cutoffId'] : 0;
        $activeCutoff = null;

        if ($cutoffId > 0) {
            foreach ($allCutoffs as $c) {
                if ((int)$c['id'] === $cutoffId) {
                    if ($c['isFuture']) {
                        fail('Future cutoff periods cannot be accessed or processed before their start date (' . $c['start_date'] . ').', 422);
                    }
                    $activeCutoff = $c;
                    break;
                }
            }
            if (!$activeCutoff) {
                fail('Specified cutoff period not found.', 404);
            }
        }

        // If not specified, find current cutoff, or the latest eligible previous cutoff
        if (!$activeCutoff && !empty($eligibleCutoffs)) {
            // Priority 1: Current cutoff (today falls between start and end inclusive)
            foreach ($eligibleCutoffs as $c) {
                if ($c['isCurrent']) {
                    $activeCutoff = $c;
                    break;
                }
            }
            // Priority 2: Latest eligible previous cutoff
            if (!$activeCutoff) {
                foreach (array_reverse($eligibleCutoffs) as $c) {
                    if ($c['start_date'] <= $today) {
                        $activeCutoff = $c;
                        break;
                    }
                }
            }
            if (!$activeCutoff) {
                $activeCutoff = $eligibleCutoffs[0] ?? null;
            }
        }

        $cutoffStartDate = $activeCutoff ? $activeCutoff['start_date'] : date('Y-m-01');
        $cutoffEndDate = $activeCutoff ? $activeCutoff['end_date'] : date('Y-m-15');
        $isReadOnly = $activeCutoff && in_array($activeCutoff['status'], ['ENDORSED_TO_ACCOUNTING', 'PROCESSING_CONFIRMED', 'SETTLED', 'CLOSED']);

        if ($action === 'compute_cutoff' && $isReadOnly) {
            fail('Cannot recompute or overwrite a finalized historical cutoff (Ref: ' . ($activeCutoff['endorsement_ref'] ?? 'N/A') . '). Historical records are preserved in read-only mode to protect audit integrity.', 422);
        }

        if ($action === 'list' && $isReadOnly) {
            $checkComp = $pdo->prepare('SELECT COUNT(*) FROM allowance_cutoff_computations WHERE cutoff_id = ?');
            $checkComp->execute([$activeCutoff['id']]);
            if (((int)$checkComp->fetchColumn()) > 0) {
                $histStmt = $pdo->prepare('
                    SELECT c.*, p.student_id, p.first_name, p.last_name, p.course, p.year_level,
                           p.sa_category, p.department_type, o.name AS office_name, sup.full_name AS supervisor_name,
                           dr.choice AS deduction_choice
                      FROM allowance_cutoff_computations c
                      JOIN sa_profiles p ON p.id = c.sa_profile_id
                      LEFT JOIN offices o ON o.id = p.office_id
                      LEFT JOIN users sup ON sup.id = p.supervisor_id
                      LEFT JOIN (
                          SELECT dr_sub.sa_profile_id, dr_sub.choice
                            FROM deduction_responses dr_sub
                            JOIN deduction_campaigns dc_sub ON dc_sub.id = dr_sub.campaign_id
                           WHERE dc_sub.semester_id = ? AND dc_sub.status != "ARCHIVED"
                           ORDER BY dr_sub.id DESC
                      ) dr ON dr.sa_profile_id = p.id
                     WHERE c.cutoff_id = ?
                     GROUP BY c.id
                     ORDER BY p.last_name, p.first_name
                ');
                $histStmt->execute([$sem['id'], $activeCutoff['id']]);
                $histRows = $histStmt->fetchAll(PDO::FETCH_ASSOC);

                $items = [];
                $totalScheduledWeeklyHours = 0.0;
                $totalCreditedHours = 0.0;
                $totalGrossPayableAllowance = 0.0;
                $totalProposedDeductions = 0.0;
                $totalNetAllowance = 0.0;
                $customRateCount = 0;
                $totalDiscrepancyCount = 0;
                $awaitingAttendanceCount = 0;
                $readyForEndorsementCount = 0;
                $authorizedDeductionSasCount = 0;

                foreach ($histRows as $hr) {
                    $hourlyRate = (float)$hr['hourly_rate'];
                    $schedHours = (float)$hr['scheduled_hours'];
                    $credited = (float)$hr['credited_hours'];
                    $gross = (float)$hr['gross_allowance'];
                    $proposedDed = (float)$hr['proposed_deduction'];
                    $net = (float)$hr['net_allowance'];
                    $balBefore = (float)$hr['school_balance_before'];
                    $authAmt = (float)$hr['authorized_amount'];
                    $expBal = (float)$hr['expected_balance_after'];
                    $hasDedAuth = (bool)$hr['has_deduction_auth'];
                    $discrepancies = !empty($hr['discrepancy_reasons']) ? explode('; ', $hr['discrepancy_reasons']) : [];
                    $hasDiscrepancy = count($discrepancies) > 0;

                    if ($hourlyRate != $semRate) $customRateCount++;
                    if ($hasDiscrepancy) $totalDiscrepancyCount++;
                    if ($hr['attendance_status'] === 'AWAITING_ATTENDANCE' || ($credited <= 0 && (float)$hr['recorded_hours'] <= 0)) $awaitingAttendanceCount++;
                    if ($hr['computation_status'] === 'READY_FOR_ENDORSEMENT') $readyForEndorsementCount++;
                    if ($hasDedAuth) $authorizedDeductionSasCount++;

                    $totalScheduledWeeklyHours += $schedHours;
                    $totalCreditedHours += $credited;
                    $totalGrossPayableAllowance += $gross;
                    $totalProposedDeductions += $proposedDed;
                    $totalNetAllowance += $net;

                    $items[] = [
                        'id' => (int)$hr['sa_profile_id'],
                        'studentId' => $hr['student_id'],
                        'name' => $hr['first_name'] . ' ' . $hr['last_name'],
                        'course' => $hr['course'],
                        'yearLevel' => (int)$hr['year_level'],
                        'saCategory' => $hr['sa_category'],
                        'departmentType' => $hr['department_type'],
                        'location' => $hr['office_name'] ?: 'Assigned Post',
                        'supervisor' => $hr['supervisor_name'],
                        'hourlyRate' => $hourlyRate,
                        'effectiveRate' => $hourlyRate,
                        'isCustom' => ($hourlyRate != $semRate),
                        'scheduledHours' => round($schedHours, 1),
                        'recordedHours' => round((float)$hr['recorded_hours'], 1),
                        'creditedHours' => round($credited, 1),
                        'overtimeHours' => round((float)$hr['overtime_hours'], 1),
                        'payableAllowance' => $gross,
                        'weeklyEstimate' => round($schedHours * $hourlyRate, 2),
                        'monthlyEstimate' => round($schedHours * $hourlyRate * 4, 2),
                        'hasDeductionAuth' => $hasDedAuth,
                        'deductionChoice' => $hr['deduction_choice'] ?: ($hasDedAuth ? 'YES' : 'NO'),
                        'schoolBalanceBefore' => $balBefore,
                        'authorizedAmount' => $authAmt,
                        'proposedDeduction' => $proposedDed,
                        'netAllowance' => $net,
                        'expectedBalanceAfter' => $expBal,
                        'attendanceStatus' => $hr['attendance_status'],
                        'computationStatus' => $hr['computation_status'],
                        'endorsementStatus' => 'ENDORSED',
                        'discrepancies' => $discrepancies,
                        'hasDiscrepancy' => $hasDiscrepancy,
                        'isReadOnly' => true
                    ];
                }

                $endorseStmt = $pdo->prepare('SELECT * FROM allowance_endorsements WHERE semester_id = ? AND cutoff_id = ? ORDER BY id DESC LIMIT 1');
                $endorseStmt->execute([$sem['id'], (int)$activeCutoff['id']]);
                $endorsement = $endorseStmt->fetch(PDO::FETCH_ASSOC) ?: null;

                respond([
                    'success' => true,
                    'semester' => $sem,
                    'semRate' => $semRate,
                    'activeCutoff' => $activeCutoff,
                    'cutoffs' => $eligibleCutoffs,
                    'endorsement' => $endorsement,
                    'isReadOnly' => true,
                    'stats' => [
                        'activeCount' => count($items),
                        'customRateCount' => $customRateCount,
                        'standardRateCount' => count($items) - $customRateCount,
                        'scheduledWeeklyLoad' => round($totalScheduledWeeklyHours, 1),
                        'weeklyAllowanceEstimate' => round($totalScheduledWeeklyHours * $semRate, 2),
                        'monthlyProjectedEstimate' => round($totalScheduledWeeklyHours * $semRate * 4, 2),
                        'cutoffCreditedHours' => round($totalCreditedHours, 1),
                        'cutoffPayableAllowance' => round($totalGrossPayableAllowance, 2),
                        'cutoffProposedDeductions' => round($totalProposedDeductions, 2),
                        'cutoffNetAllowance' => round($totalNetAllowance, 2),
                        'awaitingAttendanceCount' => $awaitingAttendanceCount,
                        'discrepancyCount' => $totalDiscrepancyCount,
                        'readyForEndorsementCount' => $readyForEndorsementCount,
                        'authorizedDeductionSasCount' => $authorizedDeductionSasCount
                    ],
                    'items' => $items,
                ]);
            }
        }

        // Fetch recurring weekly scheduled duty hours (Planning duty load)
        $assignedStmt = $pdo->prepare(
            'SELECT sa_profile_id, 
                    COALESCE(SUM(TIMESTAMPDIFF(MINUTE, start_time, end_time)/60), 0) AS hrs,
                    MAX(department) AS dept,
                    MAX(location) AS loc
               FROM schedule_assignments 
              WHERE semester_id = ? 
              GROUP BY sa_profile_id'
        );
        $assignedStmt->execute([$sem['id']]);
        $assignedRows = [];
        foreach ($assignedStmt->fetchAll() as $r) {
            $assignedRows[(int) $r['sa_profile_id']] = [
                'hrs' => (float) $r['hrs'],
                'dept' => $r['dept'],
                'loc' => $r['loc'],
            ];
        }

        // Fetch recommended hours from match_candidates (fallback planning if not finalized)
        $recRows = [];
        $latestRunStmt = $pdo->prepare('SELECT id FROM matching_runs WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
        $latestRunStmt->execute([$sem['id']]);
        $latestRunId = $latestRunStmt->fetchColumn();
        if ($latestRunId) {
            $recStmt = $pdo->prepare(
                'SELECT mc.sa_profile_id, 
                        MAX(mc.projected_hours) AS hrs,
                        GROUP_CONCAT(DISTINCT ms.department SEPARATOR ", ") AS depts,
                        GROUP_CONCAT(DISTINCT ms.label SEPARATOR ", ") AS labels
                   FROM match_candidates mc 
                   JOIN match_slots ms ON ms.id = mc.slot_id 
                  WHERE ms.run_id = ? AND mc.rank_no = 1 
                  GROUP BY mc.sa_profile_id'
            );
            $recStmt->execute([$latestRunId]);
            foreach ($recStmt->fetchAll() as $r) {
                $recRows[(int) $r['sa_profile_id']] = [
                    'hrs' => (float) $r['hrs'],
                    'dept' => $r['depts'],
                    'loc' => $r['labels'],
                ];
            }
        }

        // Fetch finalized attendance records within cutoff date range
        $attendStmt = $pdo->prepare(
            'SELECT sa_profile_id,
                    COALESCE(SUM(credited_hours), 0) AS total_credited,
                    COALESCE(SUM(recorded_hours), 0) AS total_recorded,
                    COALESCE(SUM(break_deduction), 0) AS total_break_deduction,
                    COALESCE(SUM(overtime_hours), 0) AS total_overtime,
                    COUNT(*) AS total_duty_days,
                    SUM(CASE WHEN status IN ("ABSENT", "INCOMPLETE") THEN 1 ELSE 0 END) AS unexcused_count,
                    SUM(CASE WHEN reconciliation_status IN ("DISPUTED", "SYSTEM_GENERATED") THEN 1 ELSE 0 END) AS pending_reconcile_count
               FROM sa_attendance_reconciliations
              WHERE semester_id = ? AND duty_date BETWEEN ? AND ?
              GROUP BY sa_profile_id'
        );
        $attendStmt->execute([$sem['id'], $cutoffStartDate, $cutoffEndDate]);
        $attendRows = [];
        foreach ($attendStmt->fetchAll() as $ar) {
            $recHrs = (float) $ar['total_recorded'];
            $credHrs = (float) $ar['total_credited'];
            $bDed = (float) ($ar['total_break_deduction'] ?? 0);
            if ($bDed <= 0 && $recHrs > $credHrs) {
                $bDed = round($recHrs - $credHrs, 2);
            }
            $attendRows[(int) $ar['sa_profile_id']] = [
                'credited' => $credHrs,
                'recorded' => $recHrs,
                'breakDeduction' => $bDed,
                'overtime' => (float) $ar['total_overtime'],
                'dutyDays' => (int) $ar['total_duty_days'],
                'unexcused' => (int) $ar['unexcused_count'],
                'pendingReconcile' => (int) $ar['pending_reconcile_count'],
            ];
        }

        // Pending attendance correction requests
        $corrStmt = $pdo->prepare(
            'SELECT sa_profile_id, COUNT(*) AS pending_corr
               FROM sa_requests
              WHERE semester_id = ? AND request_type = "CORRECTION" AND status = "PENDING"
              GROUP BY sa_profile_id'
        );
        $corrStmt->execute([$sem['id']]);
        $pendingCorrMap = [];
        foreach ($corrStmt->fetchAll() as $cr) {
            $pendingCorrMap[(int) $cr['sa_profile_id']] = (int) $cr['pending_corr'];
        }

        // Fetch School Balance & Deduction Authorization Data for active semester
        // 1. Deduction campaigns & responses (YES/NO authorizations)
        $dedAuthStmt = $pdo->prepare('
            SELECT dr.sa_profile_id, dr.choice, dr.authorized_amount, dr.amount AS raw_amount,
                   dr.replied_at, dr.status AS response_status, dc.id AS campaign_id, dc.title AS campaign_title
              FROM deduction_responses dr
              JOIN deduction_campaigns dc ON dc.id = dr.campaign_id
             WHERE dc.semester_id = ? AND dc.status != "ARCHIVED"
             ORDER BY dr.id DESC
        ');
        $dedAuthStmt->execute([$sem['id']]);
        $dedAuthMap = [];
        foreach ($dedAuthStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!isset($dedAuthMap[(int)$row['sa_profile_id']])) {
                $dedAuthMap[(int)$row['sa_profile_id']] = $row;
            }
        }

        // 2. Fee assessments & scholarship benefits to compute exact school balance
        $faStmt = $pdo->query('
            SELECT s.student_number, fa.cash_total, fa.tuition_fee, fa.misc_fee, fa.lab_fee, fa.lms_fee, fa.nstp_fee, fa.omr_fee 
              FROM fee_assessments fa
              JOIN enrollments e ON e.enrollment_id = fa.enrollment_id
              JOIN students s ON s.student_id = e.student_id
        ');
        $faMap = [];
        foreach ($faStmt->fetchAll(PDO::FETCH_ASSOC) as $far) {
            $faMap[$far['student_number']] = $far;
        }

        $benStmt = $pdo->prepare('SELECT sa_profile_id, tuition_fee, misc_fee, tuition_coverage_pct, misc_coverage_pct FROM sa_benefits WHERE semester_id = ?');
        $benStmt->execute([$sem['id']]);
        $benMap = [];
        foreach ($benStmt->fetchAll(PDO::FETCH_ASSOC) as $br) {
            $benMap[(int)$br['sa_profile_id']] = $br;
        }

        // 3. Previously processed/confirmed deductions in other cutoffs (to avoid double deduction)
        $prevDedStmt = $pdo->prepare('
            SELECT sa_profile_id, COALESCE(SUM(proposed_deduction), 0) AS previously_deducted
              FROM allowance_deduction_endorsements
             WHERE semester_id = ? AND cutoff_id != ? AND status IN ("CONFIRMED_PROCESSED", "ENDORSED_TO_ACCOUNTING")
             GROUP BY sa_profile_id
        ');
        $prevDedStmt->execute([$sem['id'], (int)($activeCutoff['id'] ?? 0)]);
        $prevDedMap = [];
        foreach ($prevDedStmt->fetchAll(PDO::FETCH_ASSOC) as $pr) {
            $prevDedMap[(int)$pr['sa_profile_id']] = (float)$pr['previously_deducted'];
        }

        // Fetch active Student Assistants
        $stmt = $pdo->query(
            'SELECT p.id, p.student_id, p.first_name, p.last_name, p.course, p.year_level,
                    p.sa_category, p.department_type, p.hourly_rate AS sa_rate,
                    p.weekly_target_hours, p.assignment_status, p.sa_status,
                    o.name AS office_name, sup.full_name AS supervisor_name
               FROM sa_profiles p
               LEFT JOIN offices o ON o.id = p.office_id
               LEFT JOIN users sup ON sup.id = p.supervisor_id
              WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL
              ORDER BY p.last_name, p.first_name'
        );
        $profiles = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $items = [];
        $totalScheduledWeeklyHours = 0.0;
        $totalCreditedHours = 0.0;
        $totalGrossPayableAllowance = 0.0;
        $totalProposedDeductions = 0.0;
        $totalNetAllowance = 0.0;
        $customRateCount = 0;
        $totalDiscrepancyCount = 0;
        $awaitingAttendanceCount = 0;
        $readyForEndorsementCount = 0;
        $authorizedDeductionSasCount = 0;

        foreach ($profiles as $p) {
            $id = (int) $p['id'];
            $sid = $p['student_id'];

            // Planning duty hours
            $isAssigned = isset($assignedRows[$id]) && $assignedRows[$id]['hrs'] > 0;
            $isRecommended = isset($recRows[$id]) && $recRows[$id]['hrs'] > 0;

            if ($isAssigned) {
                $schedHours = $assignedRows[$id]['hrs'];
                $dept = $assignedRows[$id]['dept'] ?: $p['department_type'];
                $location = $assignedRows[$id]['loc'] ?: ($p['office_name'] ?: 'Assigned Post');
            } elseif ($isRecommended) {
                $schedHours = $recRows[$id]['hrs'];
                $dept = $recRows[$id]['dept'] ?: $p['department_type'];
                $location = $recRows[$id]['loc'] ?: ($p['office_name'] ?: 'Recommended Post');
            } else {
                $schedHours = (float) ($p['weekly_target_hours'] ?: 35.0);
                $dept = $p['department_type'];
                $location = $p['office_name'] ?: 'Not Placed Yet';
            }

            $saRate = $p['sa_rate'] !== null ? (float) $p['sa_rate'] : null;
            $effectiveRate = $saRate !== null ? $saRate : $semRate;
            $isCustom = ($saRate !== null);
            if ($isCustom) $customRateCount++;

            // Weekly allowance planning estimate (strictly for planning cards, NOT payable)
            $weeklyEstimate = round($schedHours * $effectiveRate, 2);
            $monthlyEstimate = round($weeklyEstimate * 4, 2);

            // Attendance details for this cutoff
            $hasAttend = isset($attendRows[$id]);
            $creditedHours = $hasAttend ? (float)$attendRows[$id]['credited'] : 0.0;
            $recordedHours = $hasAttend ? (float)$attendRows[$id]['recorded'] : 0.0;
            $breakDeduction = $hasAttend ? (float)$attendRows[$id]['breakDeduction'] : 0.0;
            $overtimeHours = $hasAttend ? (float)$attendRows[$id]['overtime'] : 0.0;
            $unexcusedCount = $hasAttend ? (int)$attendRows[$id]['unexcused'] : 0;
            $pendingReconcileCount = $hasAttend ? (int)$attendRows[$id]['pendingReconcile'] : 0;
            $pendingCorrCount = $pendingCorrMap[$id] ?? 0;

            // CRITICAL BUSINESS RULE:
            // Scheduled duty hours MUST NOT be treated as payable hours!
            // Case A: No attendance records -> Credited Hours: 0, Payable Allowance: ₱0.00
            // Case B: Attendance exists but unresolved -> Mark for Review, do not count unresolved as finalized
            // Case C: Finalized attendance exists -> Payable Allowance = Credited Hours × Rate
            $payableAllowance = 0.00;
            $attendanceStatus = 'AWAITING_ATTENDANCE';
            $computationStatus = 'AWAITING_ATTENDANCE';
            $discrepancies = [];

            if ($effectiveRate < 8.0) {
                $discrepancies[] = 'Rate below minimum allowed floor (₱8.00/hr).';
            }

            if (!$hasAttend || ($recordedHours <= 0 && $creditedHours <= 0)) {
                $attendanceStatus = 'AWAITING_ATTENDANCE';
                $computationStatus = 'AWAITING_ATTENDANCE';
                $payableAllowance = 0.00;
                $awaitingAttendanceCount++;
                $discrepancies[] = 'No attendance punch recorded for this cutoff.';
            } else {
                // Check if attendance has unverified or disputed logs
                if ($pendingReconcileCount > 0) {
                    $discrepancies[] = "{$pendingReconcileCount} duty log(s) awaiting coordinator reconciliation.";
                }
                if ($pendingCorrCount > 0) {
                    $discrepancies[] = "{$pendingCorrCount} unresolved attendance correction request(s).";
                }
                if ($unexcusedCount > 0) {
                    $discrepancies[] = "{$unexcusedCount} unexcused absence(s) or incomplete duty record(s).";
                }

                if (count($discrepancies) > 0) {
                    $attendanceStatus = 'INCOMPLETE';
                    $computationStatus = 'FOR_REVIEW';
                    // We only count verified credited hours if any; unverified are blocked
                    $payableAllowance = round(($creditedHours + $overtimeHours) * $effectiveRate, 2);
                } else {
                    $attendanceStatus = 'FINALIZED';
                    $computationStatus = 'READY_FOR_ENDORSEMENT';
                    $payableAllowance = round(($creditedHours + $overtimeHours) * $effectiveRate, 2);
                    $readyForEndorsementCount++;
                }
            }

            $hasDiscrepancy = count($discrepancies) > 0;
            if ($hasDiscrepancy) $totalDiscrepancyCount++;

            // School Balance & Authorized Deduction Calculation
            $dedAuth = $dedAuthMap[$id] ?? null;
            $choice = $dedAuth ? $dedAuth['choice'] : 'NONE';
            $hasDeductionAuth = ($choice === 'YES');
            if ($hasDeductionAuth) $authorizedDeductionSasCount++;

            // Calculate current authoritative school balance
            $fa = $faMap[$sid] ?? null;
            $ben = $benMap[$id] ?? null;
            $tuition = $fa ? (float) $fa['tuition_fee'] : ($ben ? (float) $ben['tuition_fee'] : 0.0);
            $misc = $fa ? (float) $fa['misc_fee'] : ($ben ? (float) $ben['misc_fee'] : 0.0);
            $lab = $fa ? (float) $fa['lab_fee'] : 0.0;
            $lms = $fa ? (float) $fa['lms_fee'] : 0.0;
            $nstp = $fa ? (float) $fa['nstp_fee'] : 0.0;
            $omr = $fa ? (float) $fa['omr_fee'] : 0.0;
            $cashTotal = $fa ? (float) $fa['cash_total'] : round($tuition + $misc + $lab + $lms + $nstp + $omr, 2);

            // S.A. Benefit (100% Tuition + 70% Misc)
            $tuitionCovered = round($tuition * 1.0, 2);
            $miscCovered = round($misc * 0.7, 2);
            $totalCovered = round($tuitionCovered + $miscCovered, 2);
            $initialSchoolBalance = round(max(0, $cashTotal - $totalCovered), 2);
            $previouslyDeducted = $prevDedMap[$id] ?? 0.00;
            $currentSchoolBalance = round(max(0, $initialSchoolBalance - $previouslyDeducted), 2);

            $authorizedAmount = 0.00;
            $proposedDeduction = 0.00;
            $netAllowance = $payableAllowance;
            $expectedBalanceAfter = $currentSchoolBalance;

            if ($hasDeductionAuth && $currentSchoolBalance > 0) {
                $rawAuth = (float)($dedAuth['authorized_amount'] ?: $dedAuth['raw_amount']);
                $authorizedAmount = $rawAuth > 0 ? $rawAuth : $currentSchoolBalance;

                // Proposed deduction rules:
                // 1. If payable allowance == 0 -> Cannot deduct from 0! Proposed deduction = 0.
                // 2. Cannot exceed current balance or authorized amount.
                // 3. Cannot exceed available payable allowance.
                if ($payableAllowance > 0) {
                    $dedCap = min($authorizedAmount, $currentSchoolBalance);
                    $proposedDeduction = round(min($dedCap, $payableAllowance), 2);
                    $netAllowance = round(max(0, $payableAllowance - $proposedDeduction), 2);
                    $expectedBalanceAfter = round(max(0, $currentSchoolBalance - $proposedDeduction), 2);
                }
            }

            // Endorsement status
            $endorsementStatus = ($activeCutoff && $activeCutoff['status'] === 'ENDORSED_TO_ACCOUNTING') ? 'ENDORSED' : 'UNENDORSED';

            $totalScheduledWeeklyHours += $schedHours;
            $totalCreditedHours += $creditedHours;
            $totalGrossPayableAllowance += $payableAllowance;
            $totalProposedDeductions += $proposedDeduction;
            $totalNetAllowance += $netAllowance;

            $items[] = [
                'id' => $id,
                'studentId' => $p['student_id'],
                'name' => $p['first_name'] . ' ' . $p['last_name'],
                'course' => $p['course'],
                'yearLevel' => (int) $p['year_level'],
                'saCategory' => $p['sa_category'],
                'departmentType' => $dept,
                'location' => $location,
                'supervisor' => $p['supervisor_name'],
                'hourlyRate' => $effectiveRate,
                'effectiveRate' => $effectiveRate,
                'isCustom' => $isCustom,
                'scheduledHours' => round($schedHours, 1),
                'recordedHours' => round($recordedHours, 1),
                'breakDeduction' => round($breakDeduction, 1),
                'creditedHours' => round($creditedHours, 1),
                'overtimeHours' => round($overtimeHours, 1),
                'payableAllowance' => $payableAllowance,
                'weeklyEstimate' => $weeklyEstimate,
                'monthlyEstimate' => $monthlyEstimate,
                'hasDeductionAuth' => $hasDeductionAuth,
                'deductionChoice' => $choice,
                'schoolBalanceBefore' => $currentSchoolBalance,
                'authorizedAmount' => $authorizedAmount,
                'proposedDeduction' => $proposedDeduction,
                'netAllowance' => $netAllowance,
                'expectedBalanceAfter' => $expectedBalanceAfter,
                'attendanceStatus' => $attendanceStatus,
                'computationStatus' => $computationStatus,
                'endorsementStatus' => $endorsementStatus,
                'discrepancies' => $discrepancies,
                'hasDiscrepancy' => $hasDiscrepancy,
            ];
        }

        // If the action was 'compute_cutoff', persist computation snapshots in DB
        if ($action === 'compute_cutoff' && $activeCutoff) {
            $pdo->beginTransaction();
            try {
                $insComp = $pdo->prepare('
                    INSERT INTO allowance_cutoff_computations (
                        cutoff_id, sa_profile_id, semester_id, hourly_rate, scheduled_hours,
                        recorded_hours, break_deduction, credited_hours, overtime_hours, gross_allowance,
                        has_deduction_auth, school_balance_before, authorized_amount,
                        proposed_deduction, net_allowance, expected_balance_after,
                        attendance_status, computation_status, discrepancy_reasons
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        hourly_rate = VALUES(hourly_rate),
                        scheduled_hours = VALUES(scheduled_hours),
                        recorded_hours = VALUES(recorded_hours),
                        break_deduction = VALUES(break_deduction),
                        credited_hours = VALUES(credited_hours),
                        overtime_hours = VALUES(overtime_hours),
                        gross_allowance = VALUES(gross_allowance),
                        has_deduction_auth = VALUES(has_deduction_auth),
                        school_balance_before = VALUES(school_balance_before),
                        authorized_amount = VALUES(authorized_amount),
                        proposed_deduction = VALUES(proposed_deduction),
                        net_allowance = VALUES(net_allowance),
                        expected_balance_after = VALUES(expected_balance_after),
                        attendance_status = VALUES(attendance_status),
                        computation_status = VALUES(computation_status),
                        discrepancy_reasons = VALUES(discrepancy_reasons),
                        updated_at = NOW()
                ');

                foreach ($items as $it) {
                    $insComp->execute([
                        (int)$activeCutoff['id'],
                        (int)$it['id'],
                        $sem['id'],
                        $it['hourlyRate'],
                        $it['scheduledHours'],
                        $it['recordedHours'],
                        $it['breakDeduction'] ?? 0.00,
                        $it['creditedHours'],
                        $it['overtimeHours'],
                        $it['payableAllowance'],
                        $it['hasDeductionAuth'] ? 1 : 0,
                        $it['schoolBalanceBefore'],
                        $it['authorizedAmount'],
                        $it['proposedDeduction'],
                        $it['netAllowance'],
                        $it['expectedBalanceAfter'],
                        $it['attendanceStatus'],
                        $it['computationStatus'],
                        implode('; ', $it['discrepancies'])
                    ]);
                }

                // Update cutoff summary in allowance_cutoffs
                $updCut = $pdo->prepare('
                    UPDATE allowance_cutoffs
                       SET total_sas = ?,
                           total_scheduled_hours = ?,
                           total_credited_hours = ?,
                           total_gross_allowance = ?,
                           total_deductions = ?,
                           total_net_allowance = ?,
                           discrepancy_count = ?,
                           computation_status = "COMPUTED",
                           status = CASE WHEN status = "DRAFT" OR status = "OPEN_FOR_ATTENDANCE" THEN "COMPUTED" ELSE status END,
                           last_computed_at = NOW()
                     WHERE id = ?
                ');
                $updCut->execute([
                    count($items),
                    $totalScheduledWeeklyHours,
                    $totalCreditedHours,
                    $totalGrossPayableAllowance,
                    $totalProposedDeductions,
                    $totalNetAllowance,
                    $totalDiscrepancyCount,
                    (int)$activeCutoff['id']
                ]);

                $pdo->commit();
                audit('ALLOWANCE_CUTOFF_COMPUTED', "Computed allowance for {$activeCutoff['cutoff_name']}: Credited: {$totalCreditedHours}h, Gross: ₱{$totalGrossPayableAllowance}, Deductions: ₱{$totalProposedDeductions}, Net: ₱{$totalNetAllowance}", (int)$user['id']);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                fail('Computation error: ' . $e->getMessage(), 500);
            }
        }

        // Fetch official endorsement record if exists
        $endorseStmt = $pdo->prepare('
            SELECT * FROM allowance_endorsements 
             WHERE semester_id = ? AND cutoff_id = ? 
             ORDER BY id DESC LIMIT 1
        ');
        $endorseStmt->execute([$sem['id'], (int)($activeCutoff['id'] ?? 0)]);
        $endorsement = $endorseStmt->fetch(PDO::FETCH_ASSOC) ?: null;

        respond([
            'success' => true,
            'semester' => $sem,
            'semRate' => $semRate,
            'activeCutoff' => $activeCutoff,
            'cutoffs' => $eligibleCutoffs,
            'endorsement' => $endorsement,
            'stats' => [
                'activeCount' => count($profiles),
                'customRateCount' => $customRateCount,
                'standardRateCount' => count($profiles) - $customRateCount,
                'scheduledWeeklyLoad' => round($totalScheduledWeeklyHours, 1),
                'weeklyAllowanceEstimate' => round($totalScheduledWeeklyHours * $semRate, 2),
                'monthlyProjectedEstimate' => round($totalScheduledWeeklyHours * $semRate * 4, 2),
                'cutoffCreditedHours' => round($totalCreditedHours, 1),
                'cutoffPayableAllowance' => round($totalGrossPayableAllowance, 2),
                'cutoffProposedDeductions' => round($totalProposedDeductions, 2),
                'cutoffNetAllowance' => round($totalNetAllowance, 2),
                'awaitingAttendanceCount' => $awaitingAttendanceCount,
                'discrepancyCount' => $totalDiscrepancyCount,
                'readyForEndorsementCount' => $readyForEndorsementCount,
                'authorizedDeductionSasCount' => $authorizedDeductionSasCount
            ],
            'items' => $items,
        ]);

    case 'cutoff_save':
        $semId = (int)($in['semesterId'] ?? 0);
        $sem = target_semester($semId ?: null);

        $cutoffId = (int)($in['id'] ?? 0);
        $name = trim((string)($in['cutoffName'] ?? ''));
        $startDate = trim((string)($in['startDate'] ?? ''));
        $endDate = trim((string)($in['endDate'] ?? ''));
        $status = trim((string)($in['status'] ?? 'OPEN_FOR_ATTENDANCE'));

        if (!$name || mb_strlen($name) < 3) {
            fail('Cutoff name is required (at least 3 characters).', 422);
        }
        if (!$startDate || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDate)) {
            fail('A valid start date (YYYY-MM-DD) is required.', 422);
        }
        if (!$endDate || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate)) {
            fail('A valid end date (YYYY-MM-DD) is required.', 422);
        }
        if ($startDate > $endDate) {
            fail('Start date cannot be later than end date.', 422);
        }

        if ($cutoffId > 0) {
            $stmt = $pdo->prepare('
                UPDATE allowance_cutoffs
                   SET cutoff_name = ?, start_date = ?, end_date = ?, status = ?
                 WHERE id = ? AND semester_id = ?
            ');
            $stmt->execute([$name, $startDate, $endDate, $status, $cutoffId, $sem['id']]);
            audit('ALLOWANCE_CUTOFF_UPDATED', "Updated Cutoff #{$cutoffId} ({$name}): {$startDate} to {$endDate}", (int)$user['id']);
            respond(['success' => true, 'message' => "Cutoff '{$name}' updated successfully."]);
        } else {
            $code = 'CUST-' . date('Ymd', strtotime($startDate)) . '-' . date('Ymd', strtotime($endDate));
            $stmt = $pdo->prepare('
                INSERT INTO allowance_cutoffs (semester_id, cutoff_code, cutoff_name, start_date, end_date, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ');
            $stmt->execute([$sem['id'], $code, $name, $startDate, $endDate, $status, (int)$user['id']]);
            $newId = (int)$pdo->lastInsertId();
            audit('ALLOWANCE_CUTOFF_CREATED', "Created Cutoff #{$newId} ({$name}): {$startDate} to {$endDate}", (int)$user['id']);
            respond(['success' => true, 'message' => "Cutoff '{$name}' created successfully.", 'id' => $newId]);
        }

    case 'endorse_to_accounting':
        $semId = (int)($in['semesterId'] ?? 0);
        $sem = target_semester($semId ?: null);
        $cutoffId = (int)($in['cutoffId'] ?? 0);

        if ($cutoffId <= 0) {
            fail('Please select an allowance cutoff to endorse.', 422);
        }

        $cStmt = $pdo->prepare('SELECT * FROM allowance_cutoffs WHERE id = ? AND semester_id = ?');
        $cStmt->execute([$cutoffId, $sem['id']]);
        $cutoff = $cStmt->fetch(PDO::FETCH_ASSOC);
        if (!$cutoff) {
            fail('Specified cutoff period not found.', 404);
        }

        $today = date('Y-m-d');

        // Condition 1: Prevent future cutoff endorsement
        if ($cutoff['start_date'] > $today) {
            fail('Future cutoff periods cannot be endorsed to Accounting.', 422);
        }

        // Condition 2: Prevent early endorsement before cutoff period ends
        if ($today < $cutoff['end_date']) {
            fail("Cutoff '{$cutoff['cutoff_name']}' is still active (ends on {$cutoff['end_date']}). Accounting endorsement requires the period to close.", 422);
        }

        // Condition 3: Prevent duplicate endorsement
        if (in_array($cutoff['status'], ['ENDORSED_TO_ACCOUNTING', 'PROCESSING_CONFIRMED', 'SETTLED', 'CLOSED'])) {
            fail("This cutoff has already been endorsed to Accounting (Ref: " . ($cutoff['endorsement_ref'] ?? 'N/A') . ").", 422);
        }

        // Condition 4: Verify allowance computation exists
        $chkComp = $pdo->prepare('SELECT COUNT(*) FROM allowance_cutoff_computations WHERE cutoff_id = ?');
        $chkComp->execute([$cutoffId]);
        if ((int)$chkComp->fetchColumn() === 0) {
            fail('Allowance computation must be completed and finalized before endorsing to Accounting.', 422);
        }

        $remarks = trim((string)($in['remarks'] ?? ''));
        $refNo = 'END-' . date('Ym') . '-C' . str_pad((string)$cutoff['id'], 2, '0', STR_PAD_LEFT);
        $coordinatorName = $user['full_name'] ?? 'Ansherina A. Sudario';

        $totSas = isset($in['totalSas']) ? (int)$in['totalSas'] : (int)$cutoff['total_sas'];
        $totSched = isset($in['totalScheduledHours']) ? (float)$in['totalScheduledHours'] : (float)$cutoff['total_scheduled_hours'];
        $totCred = isset($in['totalCreditedHours']) ? (float)$in['totalCreditedHours'] : (float)$cutoff['total_credited_hours'];
        $totGross = isset($in['totalGrossAllowance']) ? (float)$in['totalGrossAllowance'] : (float)$cutoff['total_gross_allowance'];
        $totDed = isset($in['totalDeductions']) ? (float)$in['totalDeductions'] : (float)$cutoff['total_deductions'];
        $totNet = isset($in['totalNetAllowance']) ? (float)$in['totalNetAllowance'] : (float)$cutoff['total_net_allowance'];
        $discrepCount = isset($in['discrepancyCount']) ? (int)$in['discrepancyCount'] : (int)$cutoff['discrepancy_count'];

        // Recompute snapshots to make sure all figures are 100% synchronized
        $pdo->beginTransaction();
        try {
            // Update cutoff status and stats
            $updCut = $pdo->prepare('
                UPDATE allowance_cutoffs
                   SET status = "ENDORSED_TO_ACCOUNTING",
                       endorsement_status = "ENDORSED_TO_ACCOUNTING",
                       endorsement_ref = ?,
                       total_sas = ?,
                       total_scheduled_hours = ?,
                       total_credited_hours = ?,
                       total_gross_allowance = ?,
                       total_deductions = ?,
                       total_net_allowance = ?,
                       discrepancy_count = ?,
                       endorsed_at = NOW(),
                       endorsed_by = ?,
                       remarks = ?
                 WHERE id = ?
            ');
            $updCut->execute([$refNo, $totSas, $totSched, $totCred, $totGross, $totDed, $totNet, $discrepCount, (int)$user['id'], $remarks, $cutoffId]);

            // Insert / update allowance_endorsements
            $insEnd = $pdo->prepare('
                INSERT INTO allowance_endorsements (
                    semester_id, cutoff_id, endorsement_ref, period_type, period_label,
                    start_date, end_date, status, total_sas, total_scheduled_hours,
                    total_credited_hours, total_allowance, total_gross_allowance,
                    total_deductions, total_net_allowance, discrepancy_count,
                    remarks, coordinator_name, endorsed_by, endorsed_at, created_by
                ) VALUES (?, ?, ?, "CUTOFF", ?, ?, ?, "ENDORSED", ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
                ON DUPLICATE KEY UPDATE
                    endorsement_ref = VALUES(endorsement_ref),
                    status = "ENDORSED",
                    total_sas = VALUES(total_sas),
                    total_scheduled_hours = VALUES(total_scheduled_hours),
                    total_credited_hours = VALUES(total_credited_hours),
                    total_allowance = VALUES(total_allowance),
                    total_gross_allowance = VALUES(total_gross_allowance),
                    total_deductions = VALUES(total_deductions),
                    total_net_allowance = VALUES(total_net_allowance),
                    discrepancy_count = VALUES(discrepancy_count),
                    remarks = VALUES(remarks),
                    coordinator_name = VALUES(coordinator_name),
                    endorsed_by = VALUES(endorsed_by),
                    endorsed_at = NOW()
            ');
            $insEnd->execute([
                $sem['id'], $cutoffId, $refNo, $cutoff['cutoff_name'],
                $cutoff['start_date'], $cutoff['end_date'],
                $totSas, $totSched,
                $totCred, $totGross,
                $totGross, $totDed,
                $totNet, $discrepCount,
                $remarks, $coordinatorName, (int)$user['id'], (int)$user['id']
            ]);

            // Snapshot all eligible deduction candidates into allowance_deduction_endorsements
            // Eligible candidates: S.A.s with deduction_responses.choice === 'YES'
            $dedAuthStmt = $pdo->prepare('
                SELECT dr.id AS response_id, dr.campaign_id, dr.sa_profile_id, dr.choice,
                       dr.authorized_amount, dr.amount AS raw_amount, dr.replied_at,
                       p.student_id, CONCAT(p.first_name, " ", p.last_name) AS student_name,
                       COALESCE(sa_dept.department, p.department_type) AS dept, p.course,
                       comp.gross_allowance, comp.school_balance_before, comp.proposed_deduction,
                       comp.expected_balance_after
                  FROM deduction_responses dr
                  JOIN deduction_campaigns dc ON dc.id = dr.campaign_id
                  JOIN sa_profiles p ON p.id = dr.sa_profile_id
                  LEFT JOIN (
                      SELECT sa_profile_id, MAX(department) AS department
                        FROM schedule_assignments WHERE semester_id = ? GROUP BY sa_profile_id
                  ) sa_dept ON sa_dept.sa_profile_id = p.id
                  LEFT JOIN allowance_cutoff_computations comp ON comp.cutoff_id = ? AND comp.sa_profile_id = p.id
                 WHERE dc.semester_id = ? AND dr.choice = "YES"
            ');
            $dedAuthStmt->execute([$sem['id'], $cutoffId, $sem['id']]);
            $dedRows = $dedAuthStmt->fetchAll(PDO::FETCH_ASSOC);

            $insDedSnap = $pdo->prepare('
                INSERT INTO allowance_deduction_endorsements (
                    cutoff_id, sa_profile_id, semester_id, campaign_id, response_id,
                    student_id, student_name, department, course, gross_allowance,
                    school_balance_before, authorized_amount, proposed_deduction,
                    expected_balance_after, authorization_date, status, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    gross_allowance = VALUES(gross_allowance),
                    school_balance_before = VALUES(school_balance_before),
                    authorized_amount = VALUES(authorized_amount),
                    proposed_deduction = VALUES(proposed_deduction),
                    expected_balance_after = VALUES(expected_balance_after),
                    status = VALUES(status),
                    notes = VALUES(notes),
                    updated_at = NOW()
            ');

            foreach ($dedRows as $dr) {
                $gross = (float)($dr['gross_allowance'] ?? 0.0);
                $balBefore = (float)($dr['school_balance_before'] ?? 0.0);
                $proposed = (float)($dr['proposed_deduction'] ?? 0.0);
                $authAmt = (float)($dr['authorized_amount'] ?: $dr['raw_amount']);
                $expBal = (float)($dr['expected_balance_after'] ?? $balBefore);

                if ($gross <= 0) {
                    $snapStatus = 'EXCLUDED_NO_ALLOWANCE';
                    $notes = 'No payable allowance for this cutoff. Deduction withheld; balance unchanged.';
                    $proposed = 0.00;
                    $expBal = $balBefore;
                } else {
                    $snapStatus = 'ENDORSED_TO_ACCOUNTING';
                    $notes = 'Endorsed for accounting payroll deduction.';
                }

                $insDedSnap->execute([
                    $cutoffId, (int)$dr['sa_profile_id'], $sem['id'],
                    (int)$dr['campaign_id'], (int)$dr['response_id'],
                    $dr['student_id'], $dr['student_name'], $dr['dept'] ?: 'ITO', $dr['course'],
                    $gross, $balBefore, $authAmt, $proposed, $expBal,
                    $dr['replied_at'], $snapStatus, $notes
                ]);
            }

            $pdo->commit();
            audit('ALLOWANCE_ENDORSED_TO_ACCOUNTING', "Endorsed Cutoff #{$cutoffId} ({$cutoff['cutoff_name']}) with Ref #{$refNo} to Accounting Office. Gross: ₱{$cutoff['total_gross_allowance']}, Deductions: ₱{$cutoff['total_deductions']}, Net: ₱{$cutoff['total_net_allowance']}", (int)$user['id']);

            respond([
                'success' => true,
                'message' => "Cutoff '{$cutoff['cutoff_name']}' successfully endorsed to Accounting (Ref: {$refNo}).",
                'endorsementRef' => $refNo
            ]);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            fail('Endorsement failed: ' . $e->getMessage(), 500);
        }

    case 'settle_cutoff':
        $semId = (int)($in['semesterId'] ?? 0);
        $sem = target_semester($semId ?: null);
        $cutoffId = (int)($in['cutoffId'] ?? 0);

        if ($cutoffId <= 0) {
            fail('Please select an allowance cutoff to settle.', 422);
        }

        $cStmt = $pdo->prepare('SELECT * FROM allowance_cutoffs WHERE id = ? AND semester_id = ?');
        $cStmt->execute([$cutoffId, $sem['id']]);
        $cutoff = $cStmt->fetch(PDO::FETCH_ASSOC);
        if (!$cutoff) {
            fail('Specified cutoff period not found.', 404);
        }

        $today = date('Y-m-d');

        // Condition 1: Cutoff must have ended and be PREVIOUS CUT-OFF
        if ($today <= $cutoff['end_date']) {
            fail("Cutoff '{$cutoff['cutoff_name']}' cannot be settled while still in progress or active. Allowance settlement is strictly permitted only for closed periods (PREVIOUS CUT-OFF).", 422);
        }

        // Condition 2: Billing must have been endorsed to Accounting
        if (!in_array($cutoff['status'], ['ENDORSED_TO_ACCOUNTING', 'PROCESSING_CONFIRMED']) || empty($cutoff['endorsement_ref'])) {
            fail("Cutoff '{$cutoff['cutoff_name']}' has not been endorsed to Accounting. Billing endorsement must be completed before settling allowances.", 422);
        }

        // Condition 3: Prevent duplicate settlement
        if (in_array($cutoff['status'], ['SETTLED', 'CLOSED'])) {
            fail("Cutoff '{$cutoff['cutoff_name']}' has already been marked Allowance Settled (Settled on: {$cutoff['settled_at']}). Duplicate settlement is prohibited.", 422);
        }

        $settleNotes = trim((string)($in['notes'] ?? ''));

        $pdo->beginTransaction();
        try {
            $upd = $pdo->prepare('
                UPDATE allowance_cutoffs
                   SET status = "SETTLED",
                       settled_at = NOW(),
                       settled_by = ?,
                       settled_notes = ?
                 WHERE id = ?
            ');
            $upd->execute([(int)$user['id'], $settleNotes, $cutoffId]);

            $updDed = $pdo->prepare('
                UPDATE allowance_deduction_endorsements
                   SET status = "SETTLED",
                       updated_at = NOW()
                 WHERE cutoff_id = ? AND status = "ENDORSED_TO_ACCOUNTING"
            ');
            $updDed->execute([$cutoffId]);

            $pdo->commit();

            audit('ALLOWANCE_CUTOFF_SETTLED', "Settled Cutoff #{$cutoffId} ({$cutoff['cutoff_name']}). Net allowance disbursed: ₱{$cutoff['total_net_allowance']}. Settled by {$user['full_name']}.", (int)$user['id']);

            respond([
                'success' => true,
                'message' => "Cutoff '{$cutoff['cutoff_name']}' has been officially confirmed as Allowance Settled and permanently archived.",
                'cutoffId' => $cutoffId,
                'status' => 'SETTLED'
            ]);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            fail('Settlement error: ' . $e->getMessage(), 500);
        }

    case 'computation_breakdown':
        $semId = (int)($in['semesterId'] ?? 0);
        $sem = target_semester($semId ?: null);
        $cutoffId = (int)($in['cutoffId'] ?? 0);
        if ($cutoffId <= 0) fail('Please specify a cutoff ID.', 422);

        $cStmt = $pdo->prepare('SELECT * FROM allowance_cutoffs WHERE id = ? AND semester_id = ?');
        $cStmt->execute([$cutoffId, $sem['id']]);
        $cutoff = $cStmt->fetch(PDO::FETCH_ASSOC);
        if (!$cutoff) fail('Cutoff period not found.', 404);

        $today = date('Y-m-d');
        if ($cutoff['start_date'] > $today) {
            fail('Future cutoff periods cannot be accessed or processed before their start date (' . $cutoff['start_date'] . ').', 422);
        }

        $isReadOnly = in_array($cutoff['status'], ['ENDORSED_TO_ACCOUNTING', 'PROCESSING_CONFIRMED', 'SETTLED', 'CLOSED']);
        $startDate = $cutoff['start_date'];
        $endDate = $cutoff['end_date'];

        // Standard base rate
        $rateStmt = $pdo->prepare('SELECT hourly_rate FROM allowance_rates WHERE semester_id = ?');
        $rateStmt->execute([$sem['id']]);
        $semRate = (float)($rateStmt->fetchColumn() ?: DEFAULT_HOURLY_RATE);

        // Fetch attendance reconciliation records for this cutoff date range
        $attendStmt = $pdo->prepare('
            SELECT ar.*, p.student_id, p.first_name, p.last_name
              FROM sa_attendance_reconciliations ar
              JOIN sa_profiles p ON p.id = ar.sa_profile_id
             WHERE ar.semester_id = ? AND ar.duty_date BETWEEN ? AND ?
             ORDER BY ar.sa_profile_id, ar.duty_date ASC
        ');
        $attendStmt->execute([$sem['id'], $startDate, $endDate]);
        $dutyLogsBySa = [];
        $attendAggBySa = [];
        foreach ($attendStmt->fetchAll(PDO::FETCH_ASSOC) as $dRow) {
            $saId = (int)$dRow['sa_profile_id'];
            $dutyLogsBySa[$saId][] = $dRow;

            if (!isset($attendAggBySa[$saId])) {
                $attendAggBySa[$saId] = [
                    'dutyDays' => 0,
                    'recordedHours' => 0.0,
                    'breakDeduction' => 0.0,
                    'creditedHours' => 0.0,
                    'overtimeHours' => 0.0,
                    'lateMinutes' => 0,
                    'undertimeMinutes' => 0,
                    'unexcusedAbsences' => 0,
                    'incompleteLogs' => 0,
                    'pendingReconciliation' => 0,
                ];
            }
            $attendAggBySa[$saId]['dutyDays']++;
            $attendAggBySa[$saId]['recordedHours'] += (float)$dRow['recorded_hours'];
            $bDed = (float)($dRow['break_deduction'] ?? 0);
            if ($bDed <= 0 && (float)$dRow['recorded_hours'] > (float)$dRow['credited_hours']) {
                $bDed = round((float)$dRow['recorded_hours'] - (float)$dRow['credited_hours'], 2);
            }
            $attendAggBySa[$saId]['breakDeduction'] += $bDed;
            $attendAggBySa[$saId]['creditedHours'] += (float)$dRow['credited_hours'];
            $attendAggBySa[$saId]['overtimeHours'] += (float)$dRow['overtime_hours'];
            $attendAggBySa[$saId]['lateMinutes'] += (int)$dRow['late_minutes'];
            $attendAggBySa[$saId]['undertimeMinutes'] += (int)$dRow['undertime_minutes'];
            if (in_array($dRow['status'], ['ABSENT', 'UNEXCUSED'])) {
                $attendAggBySa[$saId]['unexcusedAbsences']++;
            }
            if ($dRow['status'] === 'INCOMPLETE' || (empty($dRow['actual_time_in']) && empty($dRow['actual_time_out']))) {
                $attendAggBySa[$saId]['incompleteLogs']++;
            }
            if (in_array($dRow['reconciliation_status'], ['DISPUTED', 'SYSTEM_GENERATED'])) {
                $attendAggBySa[$saId]['pendingReconciliation']++;
            }
        }

        // Fetch recent rate history for S.A.s to explain rate changes
        $rhStmt = $pdo->prepare('
            SELECT sa_profile_id, previous_rate, new_rate, effective_date, reason, source
              FROM sa_rate_history
             WHERE semester_id = ? AND effective_date <= ?
             ORDER BY id DESC
        ');
        $rhStmt->execute([$sem['id'], $endDate]);
        $rateHistMap = [];
        foreach ($rhStmt->fetchAll(PDO::FETCH_ASSOC) as $rh) {
            $saId = (int)$rh['sa_profile_id'];
            if ($saId > 0 && !isset($rateHistMap[$saId])) {
                $rateHistMap[$saId] = $rh;
            }
        }

        // Fetch S.A. profiles and any saved computation snapshots
        $compSnapStmt = $pdo->prepare('SELECT * FROM allowance_cutoff_computations WHERE cutoff_id = ?');
        $compSnapStmt->execute([$cutoffId]);
        $savedCompMap = [];
        foreach ($compSnapStmt->fetchAll(PDO::FETCH_ASSOC) as $sc) {
            $savedCompMap[(int)$sc['sa_profile_id']] = $sc;
        }

        // Deduction authorisations
        $dedAuthStmt = $pdo->prepare('
            SELECT dr.sa_profile_id, dr.choice, dr.authorized_amount, dr.amount AS raw_amount, dr.replied_at
              FROM deduction_responses dr
              JOIN deduction_campaigns dc ON dc.id = dr.campaign_id
             WHERE dc.semester_id = ? AND dc.status != "ARCHIVED"
             ORDER BY dr.id DESC
        ');
        $dedAuthStmt->execute([$sem['id']]);
        $dedAuthMap = [];
        foreach ($dedAuthStmt->fetchAll(PDO::FETCH_ASSOC) as $dar) {
            if (!isset($dedAuthMap[(int)$dar['sa_profile_id']])) {
                $dedAuthMap[(int)$dar['sa_profile_id']] = $dar;
            }
        }

        // All active profiles
        $profilesStmt = $pdo->query('
            SELECT p.id, p.student_id, p.first_name, p.last_name, p.course, p.year_level,
                   p.sa_category, p.department_type, p.hourly_rate AS sa_rate,
                   p.weekly_target_hours, o.name AS office_name, sup.full_name AS supervisor_name
              FROM sa_profiles p
              LEFT JOIN offices o ON o.id = p.office_id
              LEFT JOIN users sup ON sup.id = p.supervisor_id
             WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL
             ORDER BY p.last_name, p.first_name
        ');
        $profiles = $profilesStmt->fetchAll(PDO::FETCH_ASSOC);

        $breakdownItems = [];
        $totCredited = 0.0;
        $totGross = 0.0;
        $totDed = 0.0;
        $totNet = 0.0;
        $totDiscrepancies = 0;
        $totZeroAttendance = 0;

        foreach ($profiles as $p) {
            $saId = (int)$p['id'];
            $saved = $savedCompMap[$saId] ?? null;
            $agg = $attendAggBySa[$saId] ?? [
                'dutyDays' => 0,
                'recordedHours' => 0.0,
                'creditedHours' => 0.0,
                'overtimeHours' => 0.0,
                'lateMinutes' => 0,
                'undertimeMinutes' => 0,
                'unexcusedAbsences' => 0,
                'incompleteLogs' => 0,
                'pendingReconciliation' => 0,
            ];

            $rate = $saved ? (float)$saved['hourly_rate'] : ($p['sa_rate'] !== null ? (float)$p['sa_rate'] : $semRate);
            $credited = $saved ? (float)$saved['credited_hours'] : (float)$agg['creditedHours'];
            $recorded = $saved ? (float)$saved['recorded_hours'] : (float)$agg['recordedHours'];
            $overtime = $saved ? (float)$saved['overtime_hours'] : (float)$agg['overtimeHours'];
            $schedHours = $saved ? (float)$saved['scheduled_hours'] : (float)($p['weekly_target_hours'] ?: 35.0);
            $gross = $saved ? (float)$saved['gross_allowance'] : round(($credited + $overtime) * $rate, 2);
            $ded = $saved ? (float)$saved['proposed_deduction'] : 0.00;
            $net = $saved ? (float)$saved['net_allowance'] : max(0, $gross - $ded);
            $balBefore = $saved ? (float)$saved['school_balance_before'] : 0.00;
            $expBal = $saved ? (float)$saved['expected_balance_after'] : max(0, $balBefore - $ded);
            $attendStatus = $saved ? $saved['attendance_status'] : ($credited > 0 ? 'FINALIZED' : 'AWAITING_ATTENDANCE');
            $compStatus = $saved ? $saved['computation_status'] : ($credited > 0 ? 'READY_FOR_ENDORSEMENT' : 'AWAITING_ATTENDANCE');

            // Generate structured, human-readable explanations of why amounts changed
            $explanations = [];
            if ($credited <= 0 && $recorded <= 0) {
                $explanations[] = 'No attendance recorded for this cutoff (0.0h finalized = ₱0.00 payable allowance).';
                $totZeroAttendance++;
            } else {
                if ($agg['lateMinutes'] > 0) {
                    $explanations[] = "Late arrival: {$agg['lateMinutes']} minutes recorded.";
                }
                if ($agg['undertimeMinutes'] > 0) {
                    $explanations[] = "Undertime: {$agg['undertimeMinutes']} minutes recorded.";
                }
                if ($agg['unexcusedAbsences'] > 0) {
                    $explanations[] = "Absence: {$agg['unexcusedAbsences']} unexcused absence(s) on scheduled workdays.";
                }
                if ($agg['incompleteLogs'] > 0) {
                    $explanations[] = "Missing punch: {$agg['incompleteLogs']} incomplete duty log(s) requiring reconciliation.";
                }
                if ($agg['overtimeHours'] > 0) {
                    $explanations[] = "Approved overtime: {$agg['overtimeHours']} hours authorized.";
                }
                if ($agg['pendingReconciliation'] > 0) {
                    $explanations[] = "Reconciliation: {$agg['pendingReconciliation']} duty log(s) awaiting verification.";
                }
                $breakDed = $saved ? ((float)($saved['break_deduction'] ?? 0)) : (float)$agg['breakDeduction'];
                if ($breakDed > 0) {
                    $explanations[] = "Standard 1-hour unpaid lunch break automatically deducted: -{$breakDed}h total across qualifying duty days (12:00 NN–1:00 PM).";
                }
            }

            // Check rate change
            if (isset($rateHistMap[$saId])) {
                $rh = $rateHistMap[$saId];
                $prev = $rh['previous_rate'] !== null ? '₱' . number_format((float)$rh['previous_rate'], 2) : 'Standard';
                $cur = '₱' . number_format((float)$rh['new_rate'], 2);
                $explanations[] = "Rate change: {$prev} → {$cur}/hr effective {$rh['effective_date']} ({$rh['reason']}).";
            }

            if ($ded > 0) {
                $explanations[] = "Authorized deduction: ₱" . number_format($ded, 2) . " applied to school balance (Remaining due: ₱" . number_format($expBal, 2) . ").";
            }

            $hasIssues = ($agg['incompleteLogs'] > 0 || $agg['unexcusedAbsences'] > 0 || $agg['pendingReconciliation'] > 0 || ($credited <= 0 && $recorded > 0));
            if ($hasIssues) $totDiscrepancies++;

            $totCredited += $credited;
            $totGross += $gross;
            $totDed += $ded;
            $totNet += $net;

            $breakdownItems[] = [
                'id' => $saId,
                'studentId' => $p['student_id'],
                'name' => $p['first_name'] . ' ' . $p['last_name'],
                'course' => $p['course'],
                'yearLevel' => (int)$p['year_level'],
                'department' => $p['department_type'],
                'location' => $p['office_name'] ?: 'Assigned Post',
                'supervisor' => $p['supervisor_name'],
                'hourlyRate' => $rate,
                'scheduledHours' => round($schedHours, 1),
                'recordedHours' => round($recorded, 1),
                'breakDeduction' => round($breakDed ?? 0, 1),
                'creditedHours' => round($credited, 1),
                'overtimeHours' => round($overtime, 1),
                'dutyDaysCount' => $agg['dutyDays'],
                'lateMinutes' => $agg['lateMinutes'],
                'undertimeMinutes' => $agg['undertimeMinutes'],
                'unexcusedCount' => $agg['unexcusedAbsences'],
                'missingPunchCount' => $agg['incompleteLogs'],
                'pendingReconcileCount' => $agg['pendingReconciliation'],
                'grossAllowance' => $gross,
                'schoolBalanceBefore' => $balBefore,
                'authorizedDeduction' => $saved ? (float)$saved['authorized_amount'] : 0.00,
                'deductionFromAllowance' => $ded,
                'netAllowance' => $net,
                'expectedBalanceAfter' => $expBal,
                'attendanceStatus' => $attendStatus,
                'computationStatus' => $compStatus,
                'hasIssues' => $hasIssues,
                'zeroAttendance' => ($credited <= 0),
                'explanations' => $explanations,
                'dutyLogs' => $dutyLogsBySa[$saId] ?? [],
            ];
        }

        respond([
            'success' => true,
            'cutoff' => $cutoff,
            'semester' => $sem,
            'isReadOnly' => $isReadOnly,
            'totals' => [
                'totalSas' => count($profiles),
                'totalCreditedHours' => round($totCredited, 1),
                'totalGrossAllowance' => round($totGross, 2),
                'totalProposedDeductions' => round($totDed, 2),
                'totalNetAllowance' => round($totNet, 2),
                'discrepancyCount' => $totDiscrepancies,
                'zeroAttendanceCount' => $totZeroAttendance,
            ],
            'items' => $breakdownItems,
        ]);

    case 'deduction_endorsement_list':
        $semId = (int)($in['semesterId'] ?? 0);
        $sem = target_semester($semId ?: null);
        $cutoffId = (int)($in['cutoffId'] ?? $in['cutoff_id'] ?? 0);

        if ($cutoffId <= 0) {
            fail('Please specify a cutoff ID.', 422);
        }

        $cStmt = $pdo->prepare('SELECT * FROM allowance_cutoffs WHERE id = ? AND semester_id = ?');
        $cStmt->execute([$cutoffId, $sem['id']]);
        $cutoff = $cStmt->fetch(PDO::FETCH_ASSOC);
        if (!$cutoff) fail('Cutoff not found.', 404);

        $today = date('Y-m-d');
        if ($cutoff['start_date'] > $today) {
            fail('Future cutoff periods cannot be accessed or processed before their start date (' . $cutoff['start_date'] . ').', 422);
        }

        $isCutoffEndorsed = in_array($cutoff['status'], ['ENDORSED_TO_ACCOUNTING', 'PROCESSING_CONFIRMED', 'SETTLED', 'CLOSED']);

        // Fetch cumulative previously deducted amounts across prior cutoffs (to calculate total_amount_deducted)
        $prevDedStmt = $pdo->prepare('
            SELECT sa_profile_id, COALESCE(SUM(proposed_deduction), 0) AS total_deducted
              FROM allowance_deduction_endorsements
             WHERE semester_id = ? AND cutoff_id != ? AND status IN ("CONFIRMED_PROCESSED", "ENDORSED_TO_ACCOUNTING", "SETTLED")
             GROUP BY sa_profile_id
        ');
        $prevDedStmt->execute([$sem['id'], $cutoffId]);
        $prevDedMap = [];
        foreach ($prevDedStmt->fetchAll(PDO::FETCH_ASSOC) as $pr) {
            $prevDedMap[(int)$pr['sa_profile_id']] = (float)$pr['total_deducted'];
        }

        // Fetch deduction snapshot rows (or live preview if not yet endorsed)
        $snapStmt = $pdo->prepare('
            SELECT d.*, p.year_level
              FROM allowance_deduction_endorsements d
              JOIN sa_profiles p ON p.id = d.sa_profile_id
             WHERE d.cutoff_id = ? AND d.semester_id = ?
             ORDER BY d.student_name ASC
        ');
        $snapStmt->execute([$cutoffId, $sem['id']]);
        $rows = $snapStmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($rows)) {
            // Live preview before official endorsement: only include explicit YES choice!
            $previewStmt = $pdo->prepare('
                SELECT dr.id AS response_id, dr.campaign_id, dr.sa_profile_id, dr.choice,
                       dr.authorized_amount, dr.amount AS raw_amount, dr.replied_at AS authorization_date,
                       p.student_id, CONCAT(p.first_name, " ", p.last_name) AS student_name,
                       p.year_level, COALESCE(sa_dept.department, p.department_type) AS department, p.course,
                       COALESCE(comp.gross_allowance, 0.00) AS gross_allowance,
                       COALESCE(comp.school_balance_before, 0.00) AS school_balance_before,
                       COALESCE(comp.proposed_deduction, 0.00) AS proposed_deduction,
                       COALESCE(comp.expected_balance_after, 0.00) AS expected_balance_after,
                       CASE WHEN COALESCE(comp.gross_allowance, 0) <= 0 THEN "EXCLUDED_NO_ALLOWANCE" ELSE "PREVIEW_ELIGIBLE" END AS status,
                       "Preview prior to accounting endorsement" AS notes
                  FROM deduction_responses dr
                  JOIN deduction_campaigns dc ON dc.id = dr.campaign_id
                  JOIN sa_profiles p ON p.id = dr.sa_profile_id
                  LEFT JOIN (
                      SELECT sa_profile_id, MAX(department) AS department
                        FROM schedule_assignments WHERE semester_id = ? GROUP BY sa_profile_id
                  ) sa_dept ON sa_dept.sa_profile_id = p.id
                  LEFT JOIN allowance_cutoff_computations comp ON comp.cutoff_id = ? AND comp.sa_profile_id = p.id
                 WHERE dc.semester_id = ? AND dr.choice = "YES"
                 ORDER BY p.first_name ASC
            ');
            $previewStmt->execute([$sem['id'], $cutoffId, $sem['id']]);
            $rows = $previewStmt->fetchAll(PDO::FETCH_ASSOC);
        }

        $activeDeductions = [];
        $excludedNoAllowance = [];
        $totalAuthorized = 0.0;
        $totalStudentDueBefore = 0.0;
        $totalDeductionFromAllowance = 0.0;
        $totalCumulativeDeducted = 0.0;
        $totalRemainingBalance = 0.0;

        $no = 1;
        $noEx = 1;

        foreach ($rows as $r) {
            $saId = (int)$r['sa_profile_id'];
            $prop = (float)$r['proposed_deduction'];
            $balBefore = (float)$r['school_balance_before'];
            $gross = (float)$r['gross_allowance'];
            $auth = (float)($r['authorized_amount'] ?? $balBefore);
            if ($auth <= 0) $auth = $balBefore;
            $prevDeducted = $prevDedMap[$saId] ?? 0.00;
            $remaining = max(0, $balBefore - $prop);

            // Determine status label according to spec
            if ($isCutoffEndorsed) {
                $statusLabel = 'Endorsed to Accounting';
            } elseif ($r['status'] === 'CONFIRMED_PROCESSED') {
                $statusLabel = 'Confirmed Deducted';
            } elseif ($remaining <= 0) {
                $statusLabel = 'Cleared / Fully Paid';
            } elseif ($gross <= 0 || $prop <= 0) {
                $statusLabel = 'Withheld (₱0 Allowance)';
            } else {
                $statusLabel = 'Ready for Endorsement';
            }

            $item = [
                'no' => $no,
                'student_number' => $r['student_id'],
                'name' => $r['student_name'],
                'course' => $r['course'] ?? '',
                'department' => $r['department'] ?? '',
                'gross_allowance' => $gross,
                'authorized_deduction' => $auth,
                'student_due_before' => $balBefore,
                'deduction_from_allowance' => $prop,
                'total_amount_deducted' => $prevDeducted,
                'remaining_balance' => $remaining,
                'deduction_status' => $statusLabel,
                'raw_status' => $r['status']
            ];

            if ($r['status'] === 'EXCLUDED_NO_ALLOWANCE' || $gross <= 0 || $prop <= 0) {
                $item['no'] = $noEx++;
                $excludedNoAllowance[] = $item;
            } else {
                $item['no'] = $no++;
                $activeDeductions[] = $item;
                $totalAuthorized += $auth;
                $totalStudentDueBefore += $balBefore;
                $totalDeductionFromAllowance += $prop;
                $totalCumulativeDeducted += $prevDeducted;
                $totalRemainingBalance += $remaining;
            }
        }

        respond([
            'success' => true,
            'cutoff' => $cutoff,
            'semester' => $sem,
            'billingTitle' => 'S.A. BILLING — ' . $sem['label'],
            'isReadOnly' => $isCutoffEndorsed,
            'activeDeductions' => $activeDeductions,
            'excludedNoAllowance' => $excludedNoAllowance,
            'summary' => [
                'totalEligible' => count($activeDeductions),
                'totalExcluded' => count($excludedNoAllowance),
                'totalAuthorized' => round($totalAuthorized, 2),
                'totalStudentDueBefore' => round($totalStudentDueBefore, 2),
                'totalDeductionFromAllowance' => round($totalDeductionFromAllowance, 2),
                'totalCumulativeDeducted' => round($totalCumulativeDeducted, 2),
                'totalRemainingBalance' => round($totalRemainingBalance, 2),
            ]
        ]);

    case 'update_sa_rate':
    case 'update_rate':
        $saId = (int) ($in['saProfileId'] ?? 0);
        $semId = (int) ($in['semesterId'] ?? 0);
        $sem = target_semester($semId ?: null);

        $stmt = $pdo->prepare('SELECT id, student_id, first_name, last_name, hourly_rate FROM sa_profiles WHERE id = ?');
        $stmt->execute([$saId]);
        $sa = $stmt->fetch();
        if (!$sa) fail('Student Assistant profile not found.', 404);

        $reason = validate_rate_reason($in['reason'] ?? '', 'rate edit');
        $effectiveDate = trim((string) ($in['effectiveDate'] ?? ''));
        if (!$effectiveDate || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $effectiveDate)) {
            $effectiveDate = date('Y-m-d');
        }

        $useStd = !empty($in['useStandard']);
        $rawRateMode = strtoupper(trim((string) ($in['rateMode'] ?? '')));
        $rateMode = ($rawRateMode === 'STANDARD' || $useStd) ? 'STANDARD' : 'CUSTOM';
        $previousRate = $sa['hourly_rate'] !== null ? (float) $sa['hourly_rate'] : null;

        if ($rateMode === 'STANDARD') {
            $newRate = null;
            $auditNewRate = DEFAULT_HOURLY_RATE;
        } else {
            $newRate = validate_hourly_rate($in['hourlyRate'] ?? null, 'Hourly rate');
            $auditNewRate = $newRate;
        }

        $pdo->beginTransaction();
        try {
            $upd = $pdo->prepare('UPDATE sa_profiles SET hourly_rate = ? WHERE id = ?');
            $upd->execute([$newRate, $saId]);

            $fullName = trim($sa['first_name'] . ' ' . $sa['last_name']);
            $hist = $pdo->prepare(
                'INSERT INTO sa_rate_history (
                    sa_profile_id, sa_name, student_id, semester_id, previous_rate, new_rate,
                    effective_date, source, reason, changed_by, changed_by_name
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, "INDIVIDUAL_EDIT", ?, ?, ?)'
            );
            $hist->execute([
                $saId,
                $fullName,
                $sa['student_id'],
                $sem['id'],
                $previousRate,
                $auditNewRate,
                $effectiveDate,
                $reason,
                (int) $user['id'],
                $user['full_name'] ?? 'Coordinator',
            ]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            fail('Database error updating allowance rate: ' . $e->getMessage(), 500);
        }

        audit('SA_RATE_UPDATED', "Hourly rate for {$sa['first_name']} {$sa['last_name']} ({$sa['student_id']}) changed from " . ($previousRate !== null ? "₱{$previousRate}" : 'Standard') . " to " . ($newRate !== null ? "₱{$newRate}" : 'Standard') . " | Reason: {$reason}", (int) $user['id']);

        respond([
            'success' => true,
            'message' => "Hourly rate for {$sa['first_name']} {$sa['last_name']} updated to " . ($newRate !== null ? '₱' . number_format($newRate, 2) . '/hr.' : 'Standard Base Rate.'),
            'hourlyRate' => $newRate,
            'effectiveRate' => $newRate,
        ]);

    case 'bulk_update_rates':
        $semId = (int) ($in['semesterId'] ?? 0);
        $sem = target_semester($semId ?: null);

        $reason = validate_rate_reason($in['reason'] ?? '', 'bulk rate update');
        $effectiveDate = trim((string) ($in['effectiveDate'] ?? ''));
        if (!$effectiveDate || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $effectiveDate)) {
            $effectiveDate = date('Y-m-d');
        }

        $applyType = strtoupper(trim((string) ($in['applyType'] ?? 'UNIFORM')));
        $rateMode = strtoupper(trim((string) ($in['rateMode'] ?? 'CUSTOM')));

        $saIds = array_filter(array_map('intval', (array) ($in['saIds'] ?? [])));
        if (empty($saIds)) {
            fail('Please select at least one Student Assistant for bulk rate update.', 422);
        }

        $inClause = implode(',', array_fill(0, count($saIds), '?'));
        $stmt = $pdo->prepare("SELECT id, student_id, first_name, last_name, hourly_rate FROM sa_profiles WHERE id IN ({$inClause})");
        $stmt->execute($saIds);
        $targets = $stmt->fetchAll();

        if (empty($targets)) {
            fail('None of the selected Student Assistants could be found.', 404);
        }

        $uniformRate = null;
        if ($applyType === 'UNIFORM') {
            if ($rateMode === 'CUSTOM') {
                $uniformRate = validate_hourly_rate($in['hourlyRate'] ?? null, 'Uniform hourly rate');
            }
        }

        $ratesMap = (array) ($in['ratesMap'] ?? []);

        $pdo->beginTransaction();
        $updatedNames = [];
        $count = 0;

        try {
            $updStmt = $pdo->prepare('UPDATE sa_profiles SET hourly_rate = ? WHERE id = ?');
            $histStmt = $pdo->prepare(
                'INSERT INTO sa_rate_history (
                    sa_profile_id, sa_name, student_id, semester_id, previous_rate, new_rate,
                    effective_date, source, reason, changed_by, changed_by_name
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, "BULK_EDIT", ?, ?, ?)'
            );

            foreach ($targets as $t) {
                $tId = (int) $t['id'];
                $prevRate = $t['hourly_rate'] !== null ? (float) $t['hourly_rate'] : null;

                if ($applyType === 'UNIFORM') {
                    $newRate = ($rateMode === 'STANDARD') ? null : $uniformRate;
                } else {
                    $raw = $ratesMap[$tId] ?? null;
                    if ($raw === null || $raw === '' || $raw === 'STANDARD') {
                        $newRate = null;
                    } else {
                        $newRate = validate_hourly_rate($raw, "Rate for {$t['first_name']} {$t['last_name']}");
                    }
                }

                $auditRate = $newRate !== null ? $newRate : DEFAULT_HOURLY_RATE;
                $updStmt->execute([$newRate, $tId]);

                $fullName = trim($t['first_name'] . ' ' . $t['last_name']);
                $histStmt->execute([
                    $tId,
                    $fullName,
                    $t['student_id'],
                    $sem['id'],
                    $prevRate,
                    $auditRate,
                    $effectiveDate,
                    $reason,
                    (int) $user['id'],
                    $user['full_name'] ?? 'Coordinator',
                ]);

                $updatedNames[] = $fullName;
                $count++;
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            fail($e->getMessage(), 422);
        }

        $namesPreview = implode(', ', array_slice($updatedNames, 0, 6));
        if (count($updatedNames) > 6) {
            $namesPreview .= ' +' . (count($updatedNames) - 6) . ' more';
        }

        audit('SA_RATE_BULK_UPDATED', "Completed bulk rate update for {$count} S.A.(s) [{$namesPreview}] | Reason: {$reason}", (int) $user['id']);

        respond([
            'success' => true,
            'message' => "Successfully updated allowance rate for {$count} S.A.(s): {$namesPreview}.",
            'updatedCount' => $count,
        ]);

    case 'update_semester_rate':
        $semId = (int) ($in['semesterId'] ?? 0);
        $sem = target_semester($semId ?: null);

        $reason = validate_rate_reason($in['reason'] ?? '', 'standard base rate update');
        $effectiveDate = trim((string) ($in['effectiveDate'] ?? ''));
        if (!$effectiveDate || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $effectiveDate)) {
            $effectiveDate = date('Y-m-d');
        }

        $newRate = validate_hourly_rate($in['hourlyRate'] ?? null, 'Standard Base Rate');

        $prevStmt = $pdo->prepare('SELECT hourly_rate FROM allowance_rates WHERE semester_id = ?');
        $prevStmt->execute([$sem['id']]);
        $prevRate = (float) ($prevStmt->fetchColumn() ?: DEFAULT_HOURLY_RATE);

        $pdo->prepare(
            'INSERT INTO allowance_rates (semester_id, hourly_rate, created_by)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE hourly_rate = VALUES(hourly_rate), created_by = VALUES(created_by)'
        )->execute([$sem['id'], $newRate, $user['id']]);

        $pdo->prepare(
            'INSERT INTO sa_rate_history (
                sa_profile_id, sa_name, student_id, semester_id, previous_rate, new_rate,
                effective_date, source, reason, changed_by, changed_by_name
             ) VALUES (NULL, "Standard Base Rate", NULL, ?, ?, ?, ?, "STANDARD_RATE_UPDATE", ?, ?, ?)'
        )->execute([
            $sem['id'],
            $prevRate,
            $newRate,
            $effectiveDate,
            $reason,
            (int) $user['id'],
            $user['full_name'] ?? 'Coordinator',
        ]);

        audit('SEMESTER_RATE_UPDATED', "Standard hourly rate for {$sem['label']} updated from ₱" . number_format($prevRate, 2) . " to ₱" . number_format($newRate, 2) . "/hr | Reason: {$reason}", (int) $user['id']);

        respond([
            'success' => true,
            'message' => "Standard base rate for {$sem['label']} updated to ₱" . number_format($newRate, 2) . "/hr.",
            'hourlyRate' => $newRate,
            'effectiveRate' => $newRate,
        ]);

    case 'rate_history':
        $saId = isset($in['saProfileId']) ? (int) $in['saProfileId'] : null;
        $semId = isset($in['semesterId']) ? (int) $in['semesterId'] : null;

        $where = [];
        $params = [];

        if ($saId) {
            $where[] = 'sa_profile_id = ?';
            $params[] = $saId;
        } elseif ($semId) {
            $where[] = '(semester_id = ? OR semester_id IS NULL)';
            $params[] = $semId;
        }

        $sql = 'SELECT id, sa_profile_id, sa_name, student_id, semester_id,
                       previous_rate, new_rate, effective_date, source, reason,
                       changed_by, changed_by_name, created_at
                  FROM sa_rate_history';
        if (!empty($where)) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY id DESC LIMIT 100';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $logs = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $logs[] = [
                'id' => (int) $r['id'],
                'saProfileId' => $r['sa_profile_id'] ? (int) $r['sa_profile_id'] : null,
                'saName' => $r['sa_name'],
                'studentId' => $r['student_id'],
                'previousRate' => $r['previous_rate'] !== null ? (float) $r['previous_rate'] : null,
                'newRate' => (float) $r['new_rate'],
                'effectiveDate' => $r['effective_date'],
                'source' => $r['source'],
                'reason' => $r['reason'],
                'changedByName' => $r['changed_by_name'],
                'createdAt' => $r['created_at'],
            ];
        }

        respond([
            'success' => true,
            'logs' => $logs,
        ]);

    case 'return_allowance_correction':
        $semId = isset($in['semesterId']) ? (int) $in['semesterId'] : null;
        $sem = target_semester($semId);
        $cutoffId = (int)($in['cutoffId'] ?? 0);
        $reason = validate_rate_reason($in['reason'] ?? '', 'return for correction');

        $stmt = $pdo->prepare('
            UPDATE allowance_endorsements 
               SET status = "RETURNED_FOR_CORRECTION", return_reason = ?
             WHERE semester_id = ? AND (cutoff_id = ? OR cutoff_id IS NULL)
        ');
        $stmt->execute([$reason, $sem['id'], $cutoffId]);

        if ($cutoffId > 0) {
            $pdo->prepare('UPDATE allowance_cutoffs SET status = "FOR_REVIEW", endorsement_status = "RETURNED_FOR_CORRECTION" WHERE id = ?')
                ->execute([$cutoffId]);
        }

        audit('ALLOWANCE_RETURNED_FOR_CORRECTION', "Returned allowance computation for correction (Cutoff #{$cutoffId}) | Reason: {$reason}", (int) $user['id']);

        respond([
            'success' => true,
            'message' => 'Allowance computation has been returned for correction.',
        ]);

    default:
        fail('Unknown allowance action.', 404);
}
