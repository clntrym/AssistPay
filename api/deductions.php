<?php
// Allowance Deductions & School Balance API
// Coordinator broadcasts deduction announcements/polls to S.A.s.
// S.A.s reply Yes/No (opt-in/opt-out with amount and reason).
// Coordinator tracks all responses, balances, Registrar COR sync, and deduction processing.
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_sa.php';
require_once __DIR__ . '/_scheduling.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
$in = input();
$action = $in['action'] ?? '';

// Schema migration & guard
function ensure_col(PDO $pdo, string $table, string $column, string $colDef): void {
    $columnEsc = str_replace("'", "\\'", $column);
    $tableEsc = str_replace("`", "``", $table);
    $cols = $pdo->query("SHOW COLUMNS FROM `{$tableEsc}` LIKE '{$columnEsc}'")->fetchAll();
    if (empty($cols)) {
        $pdo->exec("ALTER TABLE `{$tableEsc}` ADD COLUMN `{$column}` {$colDef}");
    }
}

if (!function_exists('schema_guard_ready') || !schema_guard_ready('deduction_tables_v2', 86400)) {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS deduction_campaigns (
            id INT AUTO_INCREMENT PRIMARY KEY,
            semester_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            deduction_type VARCHAR(100) NOT NULL DEFAULT 'TUITION',
            scope_category VARCHAR(50) NOT NULL DEFAULT 'ALL',
            description TEXT NULL,
            default_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            start_date DATE NULL,
            deadline DATE NULL,
            status ENUM('OPEN', 'CLOSED', 'ARCHIVED') NOT NULL DEFAULT 'OPEN',
            last_synced_at DATETIME NULL,
            created_by INT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_sem (semester_id),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

        CREATE TABLE IF NOT EXISTS deduction_responses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            campaign_id INT NOT NULL,
            sa_profile_id INT NOT NULL,
            choice ENUM('YES', 'NO') NOT NULL,
            amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            authorized_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            processed_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            notes TEXT NULL,
            status ENUM('OPTED_IN', 'DECLINED', 'APPROVED', 'APPLIED') NOT NULL DEFAULT 'OPTED_IN',
            processing_status ENUM('AWAITING_PROCESSING','PROCESSING','PARTIALLY_PROCESSED','PROCESSED','FAILED','RETURNED_FOR_CORRECTION','CANCELLED') NOT NULL DEFAULT 'AWAITING_PROCESSING',
            admin_override TINYINT(1) NOT NULL DEFAULT 0,
            last_override_reason VARCHAR(255) NULL,
            last_override_by INT NULL,
            replied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_campaign_sa (campaign_id, sa_profile_id),
            INDEX idx_camp (campaign_id),
            INDEX idx_sa (sa_profile_id),
            INDEX idx_choice (choice),
            INDEX idx_proc_status (processing_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

        CREATE TABLE IF NOT EXISTS deduction_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            campaign_id INT NOT NULL,
            response_id INT NOT NULL,
            sa_profile_id INT NOT NULL,
            semester_id INT NOT NULL,
            reference_no VARCHAR(50) NOT NULL UNIQUE,
            balance_before DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            authorized_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            processed_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            balance_after DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            status ENUM('AWAITING_PROCESSING','PROCESSING','PARTIALLY_PROCESSED','PROCESSED','FAILED','RETURNED_FOR_CORRECTION','CANCELLED') NOT NULL DEFAULT 'AWAITING_PROCESSING',
            remarks TEXT NULL,
            processed_by INT NULL,
            processed_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_camp (campaign_id),
            INDEX idx_sa (sa_profile_id),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

        CREATE TABLE IF NOT EXISTS deduction_response_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            campaign_id INT NOT NULL,
            sa_profile_id INT NOT NULL,
            previous_choice VARCHAR(20) NULL,
            new_choice VARCHAR(20) NOT NULL,
            previous_amount DECIMAL(10,2) NULL,
            new_amount DECIMAL(10,2) NOT NULL,
            previous_status VARCHAR(50) NULL,
            new_status VARCHAR(50) NOT NULL,
            reason VARCHAR(255) NOT NULL,
            changed_by INT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_camp_sa (campaign_id, sa_profile_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");

    ensure_col($pdo, 'deduction_campaigns', 'start_date', 'DATE NULL AFTER default_amount');
    ensure_col($pdo, 'deduction_campaigns', 'scope_category', 'VARCHAR(50) NOT NULL DEFAULT "ALL" AFTER deduction_type');
    ensure_col($pdo, 'deduction_campaigns', 'last_synced_at', 'DATETIME NULL AFTER status');

    ensure_col($pdo, 'deduction_responses', 'authorized_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER amount');
    ensure_col($pdo, 'deduction_responses', 'processed_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER authorized_amount');
    ensure_col($pdo, 'deduction_responses', 'processing_status', "ENUM('AWAITING_PROCESSING','PROCESSING','PARTIALLY_PROCESSED','PROCESSED','FAILED','RETURNED_FOR_CORRECTION','CANCELLED') NOT NULL DEFAULT 'AWAITING_PROCESSING' AFTER status");
    ensure_col($pdo, 'deduction_responses', 'admin_override', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER processing_status');
    ensure_col($pdo, 'deduction_responses', 'last_override_reason', 'VARCHAR(255) NULL AFTER admin_override');
    ensure_col($pdo, 'deduction_responses', 'last_override_by', 'INT NULL AFTER last_override_reason');

    // Sync any pre-existing amounts
    $pdo->exec("UPDATE deduction_responses SET authorized_amount = amount WHERE choice = 'YES' AND (authorized_amount = 0 OR authorized_amount IS NULL)");

    if (function_exists('schema_guard_mark_ready')) {
        schema_guard_mark_ready('deduction_tables_v2');
    }
}

switch ($action) {
    case 'list_campaigns':
        require_role($user, 'ADMIN', 'SA');
        $semId = isset($in['semesterId']) ? (int) $in['semesterId'] : null;
        $sem = target_semester($semId);

        // Total active SAs for this semester
        $totalSaStmt = $pdo->prepare('SELECT COUNT(*) FROM sa_profiles WHERE semester_id = ? AND sa_status = "ACTIVE" AND archived_at IS NULL');
        $totalSaStmt->execute([$sem['id']]);
        $totalSas = (int) $totalSaStmt->fetchColumn();

        // Get campaigns
        $cStmt = $pdo->prepare('
            SELECT c.*, u.full_name AS created_by_name
              FROM deduction_campaigns c
         LEFT JOIN users u ON u.id = c.created_by
             WHERE c.semester_id = ?
             ORDER BY c.id DESC
        ');
        $cStmt->execute([$sem['id']]);
        $campaigns = $cStmt->fetchAll();

        // If SA, get their profile ID
        $mySaProfileId = null;
        if ($user['role'] === 'SA') {
            $mySaStmt = $pdo->prepare('SELECT id FROM sa_profiles WHERE user_id = ? AND archived_at IS NULL LIMIT 1');
            $mySaStmt->execute([$user['id']]);
            $mySaProfileId = $mySaStmt->fetchColumn() ?: null;
        }

        $isAdmin = ($user['role'] === 'ADMIN');
        $statsByCampaign = [];
        $myRespByCampaign = [];
        if (!empty($campaigns)) {
            $cIds = implode(',', array_map(fn($c) => (int) $c['id'], $campaigns));
            if ($isAdmin) {
                $statsStmt = $pdo->query("
                    SELECT campaign_id,
                           COUNT(*) AS total_responses,
                           SUM(CASE WHEN choice = 'YES' THEN 1 ELSE 0 END) AS opted_in,
                           SUM(CASE WHEN choice = 'NO' THEN 1 ELSE 0 END) AS declined,
                           SUM(CASE WHEN choice = 'YES' THEN COALESCE(NULLIF(authorized_amount, 0), amount) ELSE 0 END) AS total_amount,
                           SUM(CASE WHEN choice = 'YES' THEN processed_amount ELSE 0 END) AS total_processed
                      FROM deduction_responses
                     WHERE campaign_id IN ({$cIds})
                     GROUP BY campaign_id
                ");
                foreach ($statsStmt as $sr) {
                    $statsByCampaign[(int) $sr['campaign_id']] = $sr;
                }
            }
            if ($mySaProfileId) {
                $myStmt = $pdo->prepare("SELECT campaign_id, choice, amount, authorized_amount, processed_amount, processing_status, notes, status, replied_at FROM deduction_responses WHERE campaign_id IN ({$cIds}) AND sa_profile_id = ?");
                $myStmt->execute([$mySaProfileId]);
                foreach ($myStmt as $mr) {
                    $myRespByCampaign[(int) $mr['campaign_id']] = $mr;
                }
            }
        }

        $formatted = [];
        foreach ($campaigns as $c) {
            $cid = (int) $c['id'];
            $stats = $statsByCampaign[$cid] ?? ['total_responses' => 0, 'opted_in' => 0, 'declined' => 0, 'total_amount' => 0, 'total_processed' => 0];
            $myResp = $myRespByCampaign[$cid] ?? null;

            $item = [
                'id' => $cid,
                'semesterId' => (int) $c['semester_id'],
                'title' => $c['title'],
                'deductionType' => $c['deduction_type'],
                'scopeCategory' => $c['scope_category'] ?? 'ALL',
                'description' => $c['description'],
                'defaultAmount' => (float) $c['default_amount'],
                'startDate' => $c['start_date'] ?? null,
                'deadline' => $c['deadline'],
                'status' => $c['status'],
                'lastSyncedAt' => $c['last_synced_at'] ?? null,
                'createdByName' => $c['created_by_name'],
                'createdAt' => $c['created_at'],
                'myResponse' => $myResp ? [
                    'choice' => $myResp['choice'],
                    'amount' => (float) ($myResp['authorized_amount'] ?: $myResp['amount']),
                    'processedAmount' => (float) $myResp['processed_amount'],
                    'processingStatus' => $myResp['processing_status'],
                    'notes' => $myResp['notes'],
                    'status' => $myResp['status'],
                    'repliedAt' => $myResp['replied_at'],
                ] : null,
            ];
            if ($isAdmin) {
                $item['totalSas'] = $totalSas;
                $item['respondedCount'] = (int) ($stats['total_responses'] ?? 0);
                $item['optedInCount'] = (int) ($stats['opted_in'] ?? 0);
                $item['declinedCount'] = (int) ($stats['declined'] ?? 0);
                $item['pendingCount'] = max(0, $totalSas - (int) ($stats['total_responses'] ?? 0));
                $item['totalDeductionAmount'] = (float) ($stats['total_amount'] ?? 0);
                $item['totalProcessedAmount'] = (float) ($stats['total_processed'] ?? 0);
            }
            $formatted[] = $item;
        }

        respond([
            'success' => true,
            'semester' => $sem,
            'campaigns' => $formatted,
            'totalActiveSas' => $isAdmin ? $totalSas : null,
        ]);

    case 'create_campaign':
        require_role($user, 'ADMIN');
        $semId = isset($in['semesterId']) ? (int) $in['semesterId'] : null;
        $sem = target_semester($semId);

        $title = trim($in['title'] ?? '');
        $deductionType = 'TUITION';
        $scopeCategory = trim($in['scopeCategory'] ?? 'ALL');
        if (!in_array($scopeCategory, ['ALL', 'ITO', 'ACADS', 'OFFICE'], true)) {
            $scopeCategory = 'ALL';
        }
        $description = trim($in['description'] ?? '');
        $defaultAmount = max(0, (float) ($in['defaultAmount'] ?? 0));
        $startDate = !empty($in['startDate']) ? $in['startDate'] : date('Y-m-d');
        $deadline = !empty($in['deadline']) ? $in['deadline'] : null;

        if (!$title) fail('Please provide an announcement title.', 422);

        if ($deadline && $deadline < $startDate) {
            fail('The deadline cannot be earlier than the start / announcement date.', 422);
        }

        // Optional duplicate check: warn if an OPEN campaign already exists for this semester
        $existingOpen = $pdo->prepare('SELECT id, title FROM deduction_campaigns WHERE semester_id = ? AND status = "OPEN" LIMIT 1');
        $existingOpen->execute([$sem['id']]);
        $opened = $existingOpen->fetch();
        if ($opened && empty($in['allowMultipleOpen'])) {
            // If already open, we allow creation but give clean notice if strictly requested
        }

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('
                INSERT INTO deduction_campaigns (semester_id, title, deduction_type, scope_category, description, default_amount, start_date, deadline, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, "OPEN", ?)
            ');
            $stmt->execute([$sem['id'], $title, $deductionType, $scopeCategory, $description, $defaultAmount, $startDate, $deadline, $user['id']]);
            $campaignId = (int) $pdo->lastInsertId();

            audit('DEDUCTION_CAMPAIGN_CREATED', "Coordinator posted deduction campaign '{$title}' (type: {$deductionType}, scope: {$scopeCategory}, default: ₱{$defaultAmount})", $user['id']);

            // Send notification to active S.A. users matching scope
            $queryScope = ($scopeCategory === 'ALL') ? '' : ' AND (p.department_type = ? OR p.sa_category = ?)';
            $sql = '
                SELECT DISTINCT u.id 
                  FROM users u 
                  JOIN sa_profiles p ON p.user_id = u.id 
                 WHERE p.semester_id = ? AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL AND u.status = "ACTIVE"' . $queryScope;
            
            $saUsersStmt = $pdo->prepare($sql);
            if ($scopeCategory === 'ALL') {
                $saUsersStmt->execute([$sem['id']]);
            } else {
                $saUsersStmt->execute([$sem['id'], $scopeCategory, $scopeCategory]);
            }
            $saUserIds = $saUsersStmt->fetchAll(PDO::FETCH_COLUMN);

            $notifTitle = "School Balance Deduction Poll: {$title}";
            $notifMsg = "The S.A. Coordinator posted an allowance deduction announcement for {$sem['label']}. Please open My School Balance and indicate YES or NO.";

            foreach ($saUserIds as $saUid) {
                create_notification(
                    (int) $saUid,
                    $notifTitle,
                    $notifMsg,
                    'DEDUCTION_ANNOUNCEMENT',
                    '#/sa/school-balance',
                    (int) $user['id']
                );
            }

            $pdo->commit();
            respond(['success' => true, 'campaignId' => $campaignId]);
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Failed to create deduction announcement: ' . $e->getMessage(), 500);
        }

    case 'campaign_details':
        require_role($user, 'ADMIN');
        $campaignId = (int) ($in['campaignId'] ?? 0);
        if (!$campaignId) fail('Campaign ID required.', 422);

        $cStmt = $pdo->prepare('
            SELECT c.*, u.full_name AS created_by_name
              FROM deduction_campaigns c
         LEFT JOIN users u ON u.id = c.created_by
             WHERE c.id = ?
        ');
        $cStmt->execute([$campaignId]);
        $campaign = $cStmt->fetch() ?: fail('Campaign not found.', 404);

        $semId = (int) $campaign['semester_id'];
        $sem = target_semester($semId);

        // Batch load official Fee Assessments from Registrar
        $feeAssessments = [];
        try {
            $faAll = $pdo->query('
                SELECT s.student_number, fa.*, e.enrollment_id, e.reference_no, e.status AS enrollment_status
                  FROM fee_assessments fa
                  JOIN enrollments e ON e.enrollment_id = fa.enrollment_id
                  JOIN students s ON s.student_id = e.student_id
            ');
            foreach ($faAll as $faRow) {
                $feeAssessments[$faRow['student_number']] = $faRow;
            }
        } catch (Throwable $e) {}

        // Batch load sa_benefits
        $benefitsMap = [];
        try {
            $bStmt = $pdo->prepare('SELECT * FROM sa_benefits WHERE semester_id = ?');
            $bStmt->execute([$semId]);
            foreach ($bStmt->fetchAll() as $bRow) {
                $benefitsMap[(int) $bRow['sa_profile_id']] = $bRow;
            }
        } catch (Throwable $e) {}

        // Get all active S.A.s for this semester with their response
        $saListStmt = $pdo->prepare('
            SELECT p.id AS sa_profile_id, p.student_id, p.first_name, p.last_name, p.middle_name, p.suffix,
                   p.course, p.year_level, p.sa_category, p.department_type, p.hourly_rate,
                   r.id AS response_id, r.choice, r.amount AS raw_amount, r.authorized_amount, r.processed_amount,
                   r.notes AS deduction_notes, r.status AS response_status, r.processing_status,
                   r.admin_override, r.last_override_reason, r.last_override_by, r.replied_at
              FROM sa_profiles p
         LEFT JOIN deduction_responses r ON r.campaign_id = ? AND r.sa_profile_id = p.id
             WHERE p.semester_id = ? AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL
             ORDER BY CASE WHEN r.choice = "YES" THEN 1 WHEN r.choice = "NO" THEN 2 ELSE 3 END, p.last_name, p.first_name
        ');
        $saListStmt->execute([$campaignId, $semId]);
        $sas = $saListStmt->fetchAll();

        $rows = [];
        $totalCashCor = 0.0;
        $totalCoveredBenefit = 0.0;
        $totalSchoolBalance = 0.0;

        $optedInCount = 0;
        $totalOptedInAmount = 0.0;

        $declinedCount = 0;
        $totalDeclinedBalance = 0.0;

        $pendingCount = 0;
        $totalPendingBalance = 0.0;

        $awaitingProcessingCount = 0;
        $awaitingProcessingAmount = 0.0;
        $totalProcessedAmount = 0.0;

        $today = date('Y-m-d');
        $deadline = $campaign['deadline'];

        foreach ($sas as $sa) {
            $pid = (int) $sa['sa_profile_id'];
            $sid = $sa['student_id'];
            $fa = $feeAssessments[$sid] ?? null;
            $ben = $benefitsMap[$pid] ?? null;

            // Tuition & Misc fee from Registrar or sa_benefits
            $tuition = $fa ? (float) $fa['tuition_fee'] : ($ben ? (float) $ben['tuition_fee'] : 0.0);
            $misc = $fa ? (float) $fa['misc_fee'] : ($ben ? (float) $ben['misc_fee'] : 0.0);
            $lab = $fa ? (float) $fa['lab_fee'] : 0.0;
            $lms = $fa ? (float) $fa['lms_fee'] : 0.0;
            $nstp = $fa ? (float) $fa['nstp_fee'] : 0.0;
            $omr = $fa ? (float) $fa['omr_fee'] : 0.0;
            $installmentCharge = $fa ? (float) $fa['installment_charge'] : 0.0;

            $cashTotal = $fa ? (float) $fa['cash_total'] : round($tuition + $misc + $lab + $lms + $nstp + $omr, 2);

            // S.A. Scholarship Coverage (100% Tuition + 70% Misc)
            $tPct = 100.0;
            $mPct = 70.0;
            $tuitionCovered = round($tuition * $tPct / 100, 2);
            $miscCovered = round($misc * $mPct / 100, 2);
            $totalCovered = round($tuitionCovered + $miscCovered, 2);

            // Net Remaining School Balance before deduction
            $balanceBefore = round(max(0, $cashTotal - $totalCovered), 2);

            $choice = $sa['choice']; // 'YES', 'NO', or null
            $authorizedAmount = 0.0;
            $processedAmount = (float) ($sa['processed_amount'] ?? 0.0);
            $procStatus = $sa['processing_status'] ?: 'AWAITING_PROCESSING';

            if ($choice === 'YES') {
                $rawAuth = (float) ($sa['authorized_amount'] ?: $sa['raw_amount']);
                $authorizedAmount = $rawAuth > 0 ? $rawAuth : ($balanceBefore > 0 ? $balanceBefore : (float) $campaign['default_amount']);
                $optedInCount++;
                $totalOptedInAmount += $authorizedAmount;

                if (in_array($procStatus, ['AWAITING_PROCESSING', 'PROCESSING', 'RETURNED_FOR_CORRECTION'], true)) {
                    $awaitingProcessingCount++;
                    $awaitingProcessingAmount += max(0, $authorizedAmount - $processedAmount);
                }
            } elseif ($choice === 'NO') {
                $declinedCount++;
                $totalDeclinedBalance += $balanceBefore;
                $procStatus = 'DECLINED';
            } else {
                $pendingCount++;
                $totalPendingBalance += $balanceBefore;
                $procStatus = 'PENDING_RESPONSE';
            }

            $totalProcessedAmount += $processedAmount;
            $balanceAfter = round(max(0, $balanceBefore - $processedAmount), 2);

            // Aggregate totals
            $totalCashCor += $cashTotal;
            $totalCoveredBenefit += $totalCovered;
            $totalSchoolBalance += $balanceBefore;

            // Deadline calculation
            $daysRemaining = null;
            $deadlineStatus = 'NONE';
            if ($deadline) {
                $diff = (int) floor((strtotime($deadline) - strtotime($today)) / 86400);
                $daysRemaining = $diff;
                if ($diff < 0) {
                    $deadlineStatus = 'OVERDUE';
                } elseif ($diff === 0) {
                    $deadlineStatus = 'DUE_TODAY';
                } elseif ($diff <= 3) {
                    $deadlineStatus = 'EXPIRING_SOON';
                } else {
                    $deadlineStatus = 'ON_TIME';
                }
            }

            $name = trim($sa['first_name'] . ' ' . ($sa['middle_name'] ? $sa['middle_name'] . ' ' : '') . $sa['last_name'] . ($sa['suffix'] ? ' ' . $sa['suffix'] : ''));

            $rows[] = [
                'saProfileId' => $pid,
                'responseId' => $sa['response_id'] ? (int) $sa['response_id'] : null,
                'studentId' => $sid,
                'name' => $name,
                'firstName' => $sa['first_name'],
                'lastName' => $sa['last_name'],
                'course' => $sa['course'],
                'yearLevel' => (int) $sa['year_level'],
                'category' => $sa['sa_category'],
                'department' => $sa['department_type'],
                'hourlyRate' => (float) ($sa['hourly_rate'] ?: DEFAULT_HOURLY_RATE),
                'cor' => [
                    'hasAssessment' => (bool) $fa,
                    'referenceNo' => $fa['reference_no'] ?? null,
                    'enrollmentStatus' => $fa['enrollment_status'] ?? 'Enrolled',
                    'tuitionFee' => $tuition,
                    'labFee' => $lab,
                    'miscFee' => $misc,
                    'lmsFee' => $lms,
                    'nstpFee' => $nstp,
                    'omrFee' => $omr,
                    'cashTotal' => $cashTotal,
                    'installmentCharge' => $installmentCharge,
                ],
                'benefit' => [
                    'tuitionCoveragePct' => $tPct,
                    'miscCoveragePct' => $mPct,
                    'tuitionCovered' => $tuitionCovered,
                    'miscCovered' => $miscCovered,
                    'totalCovered' => $totalCovered,
                ],
                'balanceBefore' => $balanceBefore,
                'choice' => $choice, // 'YES', 'NO', or null
                'authorizedAmount' => $authorizedAmount,
                'processedAmount' => $processedAmount,
                'balanceAfter' => $balanceAfter,
                'processingStatus' => $procStatus,
                'adminOverride' => (bool) $sa['admin_override'],
                'lastOverrideReason' => $sa['last_override_reason'] ?? '',
                'notes' => $sa['deduction_notes'] ?? '',
                'repliedAt' => $sa['replied_at'],
                'daysRemaining' => $daysRemaining,
                'deadlineStatus' => $deadlineStatus,
            ];
        }

        // Fetch recent deduction transactions for this campaign
        $txStmt = $pdo->prepare('
            SELECT t.*, u.full_name AS processed_by_name, p.student_id, p.first_name, p.last_name
              FROM deduction_transactions t
         LEFT JOIN users u ON u.id = t.processed_by
         LEFT JOIN sa_profiles p ON p.id = t.sa_profile_id
             WHERE t.campaign_id = ?
             ORDER BY t.id DESC
             LIMIT 50
        ');
        $txStmt->execute([$campaignId]);
        $transactions = $txStmt->fetchAll();

        respond([
            'success' => true,
            'campaign' => [
                'id' => (int) $campaign['id'],
                'semesterId' => $semId,
                'semesterLabel' => $sem['label'] ?? 'Active Semester',
                'title' => $campaign['title'],
                'deductionType' => $campaign['deduction_type'],
                'scopeCategory' => $campaign['scope_category'] ?? 'ALL',
                'description' => $campaign['description'],
                'defaultAmount' => (float) $campaign['default_amount'],
                'startDate' => $campaign['start_date'],
                'deadline' => $campaign['deadline'],
                'status' => $campaign['status'],
                'lastSyncedAt' => $campaign['last_synced_at'],
                'createdByName' => $campaign['created_by_name'],
                'createdAt' => $campaign['created_at'],
                'metrics' => [
                    'totalSas' => count($rows),
                    'totalCashCor' => $totalCashCor,
                    'totalCoveredBenefit' => $totalCoveredBenefit,
                    'totalSchoolBalance' => $totalSchoolBalance,
                    'optedInCount' => $optedInCount,
                    'totalOptedInAmount' => $totalOptedInAmount,
                    'declinedCount' => $declinedCount,
                    'totalDeclinedBalance' => $totalDeclinedBalance,
                    'pendingCount' => $pendingCount,
                    'totalPendingBalance' => $totalPendingBalance,
                    'awaitingProcessingCount' => $awaitingProcessingCount,
                    'awaitingProcessingAmount' => $awaitingProcessingAmount,
                    'totalProcessedAmount' => $totalProcessedAmount,
                ]
            ],
            'saResponses' => $rows,
            'transactions' => $transactions,
        ]);

    case 'update_campaign_status':
        require_role($user, 'ADMIN');
        $campaignId = (int) ($in['campaignId'] ?? 0);
        $status = strtoupper(trim($in['status'] ?? ''));
        if (!in_array($status, ['OPEN', 'CLOSED', 'ARCHIVED'], true)) fail('Invalid status.', 422);

        $pdo->prepare('UPDATE deduction_campaigns SET status = ? WHERE id = ?')->execute([$status, $campaignId]);
        audit('DEDUCTION_CAMPAIGN_STATUS', "Campaign #{$campaignId} status changed to {$status}", $user['id']);
        respond(['success' => true]);

    case 'admin_update_response':
        require_role($user, 'ADMIN');
        $campaignId = (int) ($in['campaignId'] ?? 0);
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        $choice = strtoupper(trim($in['choice'] ?? ''));
        $amount = max(0, (float) ($in['amount'] ?? 0));
        $reason = trim($in['reason'] ?? ($in['notes'] ?? ''));
        $processingStatus = strtoupper(trim($in['processingStatus'] ?? 'AWAITING_PROCESSING'));

        if (!$campaignId || !$saProfileId) fail('Announcement and Student Assistant profile required.', 422);
        if (!in_array($choice, ['YES', 'NO'], true)) fail('Choice must be YES or NO.', 422);

        // Strict Reason Validation: 3 to 200 chars
        if (mb_strlen($reason) < 3) {
            fail('Please enter a valid reason for updating this decision (minimum 3 characters).', 422);
        }
        if (mb_strlen($reason) > 200) {
            fail('The reason must be 200 characters or fewer.', 422);
        }

        $validStatuses = ['AWAITING_PROCESSING','PROCESSING','PARTIALLY_PROCESSED','PROCESSED','FAILED','RETURNED_FOR_CORRECTION','CANCELLED'];
        if (!in_array($processingStatus, $validStatuses, true)) {
            $processingStatus = 'AWAITING_PROCESSING';
        }

        // Fetch previous response if any
        $prevStmt = $pdo->prepare('SELECT * FROM deduction_responses WHERE campaign_id = ? AND sa_profile_id = ? LIMIT 1');
        $prevStmt->execute([$campaignId, $saProfileId]);
        $prev = $prevStmt->fetch();

        $prevChoice = $prev ? $prev['choice'] : null;
        $prevAmount = $prev ? (float) $prev['amount'] : 0.0;
        $prevStatus = $prev ? $prev['processing_status'] : 'NONE';

        $pdo->beginTransaction();
        try {
            $respStatus = ($choice === 'YES') ? 'OPTED_IN' : 'DECLINED';
            $authAmount = ($choice === 'YES') ? $amount : 0.0;

            $stmt = $pdo->prepare('
                INSERT INTO deduction_responses (
                    campaign_id, sa_profile_id, choice, amount, authorized_amount, notes, status,
                    processing_status, admin_override, last_override_reason, last_override_by, replied_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE 
                    choice = VALUES(choice),
                    amount = VALUES(amount),
                    authorized_amount = VALUES(authorized_amount),
                    notes = VALUES(notes),
                    status = VALUES(status),
                    processing_status = VALUES(processing_status),
                    admin_override = 1,
                    last_override_reason = VALUES(last_override_reason),
                    last_override_by = VALUES(last_override_by),
                    replied_at = NOW()
            ');
            $stmt->execute([
                $campaignId, $saProfileId, $choice, $authAmount, $authAmount, $reason,
                $respStatus, $processingStatus, $reason, $user['id']
            ]);

            // Record audit log entry in deduction_response_logs
            $logStmt = $pdo->prepare('
                INSERT INTO deduction_response_logs (
                    campaign_id, sa_profile_id, previous_choice, new_choice, previous_amount,
                    new_amount, previous_status, new_status, reason, changed_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ');
            $logStmt->execute([
                $campaignId, $saProfileId, $prevChoice, $choice, $prevAmount,
                $authAmount, $prevStatus, $processingStatus, $reason, $user['id']
            ]);

            audit(
                'ADMIN_UPDATED_DEDUCTION_RESPONSE',
                "Coordinator updated deduction for SA #{$saProfileId} in campaign #{$campaignId} to {$choice} (₱{$authAmount}). Reason: {$reason}",
                $user['id']
            );

            $pdo->commit();
            respond(['success' => true]);
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Failed to update deduction decision: ' . $e->getMessage(), 500);
        }

    case 'process_deduction':
        require_role($user, 'ADMIN');
        $campaignId = (int) ($in['campaignId'] ?? 0);
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        $processedAmount = (float) ($in['processedAmount'] ?? 0);
        $status = strtoupper(trim($in['status'] ?? 'PROCESSED'));
        $remarks = trim($in['remarks'] ?? '');

        if (!$campaignId || !$saProfileId) fail('Announcement and Student Assistant profile required.', 422);

        $validStatuses = ['AWAITING_PROCESSING','PROCESSING','PARTIALLY_PROCESSED','PROCESSED','FAILED','RETURNED_FOR_CORRECTION','CANCELLED'];
        if (!in_array($status, $validStatuses, true)) fail('Invalid processing status.', 422);

        // Fetch response & sa
        $rStmt = $pdo->prepare('
            SELECT r.*, p.student_id, p.first_name, p.last_name, p.user_id, c.semester_id, c.title AS campaign_title
              FROM deduction_responses r
              JOIN deduction_campaigns c ON c.id = r.campaign_id
              JOIN sa_profiles p ON p.id = r.sa_profile_id
             WHERE r.campaign_id = ? AND r.sa_profile_id = ?
             LIMIT 1
        ');
        $rStmt->execute([$campaignId, $saProfileId]);
        $row = $rStmt->fetch() ?: fail('No response record found for this Student Assistant.', 404);

        if ($row['choice'] !== 'YES') {
            fail('Cannot process allowance deduction for an S.A. who did not authorize or opted out.', 422);
        }

        $semId = (int) $row['semester_id'];
        $authorized = (float) ($row['authorized_amount'] ?: $row['amount']);

        // Check fee assessment
        $faStmt = $pdo->prepare('
            SELECT fa.cash_total, fa.tuition_fee, fa.misc_fee
              FROM fee_assessments fa
              JOIN enrollments e ON e.enrollment_id = fa.enrollment_id
              JOIN students s ON s.student_id = e.student_id
             WHERE s.student_number = ?
             LIMIT 1
        ');
        $faStmt->execute([$row['student_id']]);
        $fa = $faStmt->fetch();

        $tuition = $fa ? (float) $fa['tuition_fee'] : 0.0;
        $misc = $fa ? (float) $fa['misc_fee'] : 0.0;
        $covered = round(($tuition * 1.0) + ($misc * 0.70), 2);
        $cashTotal = $fa ? (float) $fa['cash_total'] : round($tuition + $misc, 2);
        $balanceBefore = round(max(0, $cashTotal - $covered), 2);

        if ($status === 'PROCESSED' && $processedAmount <= 0) {
            $processedAmount = $authorized > 0 ? $authorized : $balanceBefore;
        }

        $balanceAfter = round(max(0, $balanceBefore - $processedAmount), 2);

        // Generate unique reference number
        $refNo = 'DED-' . date('Y') . '-' . str_pad((string) mt_rand(1000, 99999), 5, '0', STR_PAD_LEFT);

        $pdo->beginTransaction();
        try {
            // Update deduction_responses
            $upd = $pdo->prepare('
                UPDATE deduction_responses 
                   SET processed_amount = ?,
                       processing_status = ?,
                       notes = CONCAT_WS(" | ", NULLIF(notes, ""), ?)
                 WHERE id = ?
            ');
            $upd->execute([$processedAmount, $status, "Processed ₱{$processedAmount} (Ref: {$refNo})", $row['id']]);

            // Insert into deduction_transactions
            $tx = $pdo->prepare('
                INSERT INTO deduction_transactions (
                    campaign_id, response_id, sa_profile_id, semester_id, reference_no,
                    balance_before, authorized_amount, processed_amount, balance_after,
                    status, remarks, processed_by, processed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ');
            $tx->execute([
                $campaignId, $row['id'], $saProfileId, $semId, $refNo,
                $balanceBefore, $authorized, $processedAmount, $balanceAfter,
                $status, $remarks, $user['id']
            ]);

            audit(
                'DEDUCTION_PROCESSED',
                "Processed deduction for {$row['student_id']} in '{$row['campaign_title']}': ₱{$processedAmount} ({$status}, Ref: {$refNo})",
                $user['id']
            );

            // Notify S.A.
            $statusLabel = str_replace('_', ' ', $status);
            create_notification(
                (int) $row['user_id'],
                "School Balance Allowance Deduction: {$statusLabel}",
                "Your authorized allowance deduction of ₱" . number_format($processedAmount, 2) . " has been recorded ({$statusLabel}, Ref: {$refNo}).",
                'DEDUCTION_PROCESSED',
                '#/sa/school-balance',
                (int) $user['id']
            );

            $pdo->commit();
            respond([
                'success' => true,
                'referenceNo' => $refNo,
                'processedAmount' => $processedAmount,
                'status' => $status
            ]);
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Failed to record deduction transaction: ' . $e->getMessage(), 500);
        }

    case 'sync_registrar_cor':
        require_role($user, 'ADMIN');
        $campaignId = (int) ($in['campaignId'] ?? 0);
        $semId = isset($in['semesterId']) ? (int) $in['semesterId'] : null;
        $sem = target_semester($semId);

        // Fetch all active S.A.s for target semester
        $saList = $pdo->prepare('
            SELECT id, student_id, first_name, last_name 
              FROM sa_profiles 
             WHERE semester_id = ? AND sa_status = "ACTIVE" AND archived_at IS NULL
        ');
        $saList->execute([$sem['id']]);
        $activeSas = $saList->fetchAll();

        // Fetch fee assessments from registrar
        $faMap = [];
        $faRows = $pdo->query('
            SELECT s.student_number, fa.*
              FROM fee_assessments fa
              JOIN enrollments e ON e.enrollment_id = fa.enrollment_id
              JOIN students s ON s.student_id = e.student_id
        ');
        foreach ($faRows as $f) {
            $faMap[$f['student_number']] = $f;
        }

        $syncedCount = 0;
        $updatedCount = 0;
        $unmatchedList = [];

        $pdo->beginTransaction();
        try {
            $benUpsert = $pdo->prepare('
                INSERT INTO sa_benefits (sa_profile_id, semester_id, tuition_fee, misc_fee, tuition_coverage_pct, misc_coverage_pct)
                VALUES (?, ?, ?, ?, 100.00, 70.00)
                ON DUPLICATE KEY UPDATE 
                    tuition_fee = VALUES(tuition_fee),
                    misc_fee = VALUES(misc_fee)
            ');

            foreach ($activeSas as $sa) {
                $sid = $sa['student_id'];
                if (isset($faMap[$sid])) {
                    $fa = $faMap[$sid];
                    $tFee = (float) $fa['tuition_fee'];
                    $mFee = (float) $fa['misc_fee'];
                    $benUpsert->execute([$sa['id'], $sem['id'], $tFee, $mFee]);
                    $syncedCount++;
                    $updatedCount++;
                } else {
                    $unmatchedList[] = [
                        'studentId' => $sid,
                        'name' => trim($sa['first_name'] . ' ' . $sa['last_name']),
                        'reason' => 'No Fee Assessment found in Registrar enrollments.'
                    ];
                }
            }

            if ($campaignId) {
                $pdo->prepare('UPDATE deduction_campaigns SET last_synced_at = NOW() WHERE id = ?')->execute([$campaignId]);
            }

            audit('REGISTRAR_COR_SYNCED', "Coordinator synced Registrar COR fee assessments for semester #{$sem['id']} ({$syncedCount} matched, " . count($unmatchedList) . " unmatched)", $user['id']);

            $pdo->commit();
            respond([
                'success' => true,
                'totalActiveSas' => count($activeSas),
                'syncedCount' => $syncedCount,
                'updatedCount' => $updatedCount,
                'unmatchedCount' => count($unmatchedList),
                'unmatchedList' => $unmatchedList,
                'timestamp' => date('Y-m-d H:i:s'),
            ]);
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Registrar COR Sync failed: ' . $e->getMessage(), 500);
        }

    case 'send_reminder':
        require_role($user, 'ADMIN');
        $campaignId = (int) ($in['campaignId'] ?? 0);
        $targetSaProfileId = !empty($in['saProfileId']) ? (int) $in['saProfileId'] : null;

        if (!$campaignId) fail('Campaign ID required.', 422);

        $cStmt = $pdo->prepare('SELECT * FROM deduction_campaigns WHERE id = ?');
        $cStmt->execute([$campaignId]);
        $campaign = $cStmt->fetch() ?: fail('Campaign not found.', 404);

        $semId = (int) $campaign['semester_id'];

        if ($targetSaProfileId) {
            $pStmt = $pdo->prepare('
                SELECT p.id, p.user_id, p.first_name, p.last_name, p.student_id 
                  FROM sa_profiles p 
                 WHERE p.id = ? AND p.semester_id = ? AND p.sa_status = "ACTIVE"
            ');
            $pStmt->execute([$targetSaProfileId, $semId]);
            $targets = $pStmt->fetchAll();
        } else {
            // All active SAs who have not responded to this campaign
            $pStmt = $pdo->prepare('
                SELECT p.id, p.user_id, p.first_name, p.last_name, p.student_id 
                  FROM sa_profiles p 
             LEFT JOIN deduction_responses r ON r.campaign_id = ? AND r.sa_profile_id = p.id
                 WHERE p.semester_id = ? AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL AND r.id IS NULL
            ');
            $pStmt->execute([$campaignId, $semId]);
            $targets = $pStmt->fetchAll();
        }

        if (empty($targets)) {
            respond(['success' => true, 'sentCount' => 0, 'message' => 'No pending Student Assistants found.']);
        }

        $sentCount = 0;
        $notifTitle = "Reminder: {$campaign['title']}";
        $deadlineText = $campaign['deadline'] ? " before the deadline on " . date('F j, Y', strtotime($campaign['deadline'])) : "";
        $notifMsg = "Please submit your School Balance Allowance Deduction decision (YES or NO){$deadlineText} under My School Balance.";

        foreach ($targets as $t) {
            create_notification(
                (int) $t['user_id'],
                $notifTitle,
                $notifMsg,
                'DEDUCTION_REMINDER',
                '#/sa/school-balance',
                (int) $user['id']
            );
            $sentCount++;
        }

        audit('DEDUCTION_REMINDERS_SENT', "Coordinator sent deduction reminders to {$sentCount} S.A.s for campaign #{$campaignId}", $user['id']);

        respond([
            'success' => true,
            'sentCount' => $sentCount
        ]);

    case 'sa_respond':
        require_role($user, 'SA');
        $campaignId = (int) ($in['campaignId'] ?? 0);
        $choice = strtoupper(trim($in['choice'] ?? ''));
        $amount = max(0, (float) ($in['amount'] ?? 0));
        $notes = trim($in['notes'] ?? '');

        if (!$campaignId) fail('Campaign ID required.', 422);
        if (!in_array($choice, ['YES', 'NO'], true)) fail('Choice must be YES or NO.', 422);

        // Verify campaign is OPEN
        $cStmt = $pdo->prepare('SELECT * FROM deduction_campaigns WHERE id = ?');
        $cStmt->execute([$campaignId]);
        $campaign = $cStmt->fetch() ?: fail('Campaign not found.', 404);
        if ($campaign['status'] !== 'OPEN') fail('This deduction announcement is already closed.', 400);

        // Find SA profile & actual school balance
        $saStmt = $pdo->prepare(SA_SELECT . ' WHERE p.user_id = ? AND p.archived_at IS NULL LIMIT 1');
        $saStmt->execute([$user['id']]);
        $sa = $saStmt->fetch() ?: fail('S.A. profile not found.', 404);

        // Enforce one-time response per S.A. per campaign
        $existingStmt = $pdo->prepare('SELECT id, choice FROM deduction_responses WHERE campaign_id = ? AND sa_profile_id = ? LIMIT 1');
        $existingStmt->execute([$campaignId, (int) $sa['id']]);
        if ($existingStmt->fetch()) {
            fail('You have already submitted your response for this announcement.', 400);
        }

        $formattedSa = format_sa($sa, true);
        $actualSchoolBalance = (float) ($formattedSa['benefits']['balance'] ?? 0);

        if ($choice === 'YES') {
            if ($amount <= 0) {
                $amount = $actualSchoolBalance > 0 ? $actualSchoolBalance : (float) $campaign['default_amount'];
            }
        } else {
            $amount = 0.0;
        }

        $respStatus = ($choice === 'YES') ? 'OPTED_IN' : 'DECLINED';
        $procStatus = ($choice === 'YES') ? 'AWAITING_PROCESSING' : 'AWAITING_PROCESSING';

        $pdo->prepare('
            INSERT INTO deduction_responses (campaign_id, sa_profile_id, choice, amount, authorized_amount, notes, status, processing_status, replied_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ')->execute([$campaignId, (int) $sa['id'], $choice, $amount, $amount, $notes, $respStatus, $procStatus]);

        audit('SA_DEDUCTION_REPLIED', "SA {$sa['student_id']} replied {$choice} to campaign #{$campaignId} (amount: {$amount})", $user['id']);

        // Send confirmation notification to the SA
        $choiceLabel = ($choice === 'YES') ? "YES — Deduct School Balance (₱" . number_format($amount, 2) . ")" : "NO — Do Not Deduct";
        create_notification(
            (int) $user['id'],
            "School Balance Deduction Response Recorded",
            "Your response for '{$campaign['title']}' has been submitted ({$choiceLabel}).",
            'DEDUCTION_RESPONSE',
            '#/sa/school-balance',
            (int) $user['id']
        );

        // Notify S.A. Coordinators (ADMIN)
        $coordStmt = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
        $saFullName = trim($sa['first_name'] . ' ' . $sa['last_name']);
        foreach ($coordStmt->fetchAll(PDO::FETCH_COLUMN) as $coordId) {
            create_notification(
                (int) $coordId,
                "School Balance Deduction Reply: {$saFullName}",
                "{$saFullName} ({$sa['student_id']}) answered {$choiceLabel} for '{$campaign['title']}'.",
                'DEDUCTION_RESPONSE',
                '#/admin/school-balance',
                (int) $user['id']
            );
        }

        respond(['success' => true]);

    default:
        fail('Unknown action.', 400);
}
