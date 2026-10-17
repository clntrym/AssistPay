<?php
// Role-Based Dashboard API (POST + CSRF + Strict Role & Scope Enforcement).
//   summary              ADMIN       S.A. Coordinator Dashboard
//   supervisor_summary   SUPERVISOR  Supervisor Dashboard (strictly scoped to assigned dept/offices)
//   sa_summary           SA          Student Assistant Dashboard (strictly scoped to signed-in S.A.)

require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_sa.php';
require_once __DIR__ . '/_scheduling.php';
require_once __DIR__ . '/_matching.php';
require_once __DIR__ . '/_violations.php';
require_once __DIR__ . '/_evaluation_workflow.php';
require_once __DIR__ . '/_perfect_attendance.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
$in = input();
$action = $in['action'] ?? 'summary';

ensure_violation_schema($pdo);
ensure_matching_board_tables();
ensure_evaluation_tables($pdo);

/**
 * Helper to resolve a Supervisor's authorized department and office scope.
 */
function dashboard_supervisor_scope(PDO $pdo, int $supId): ?array
{
    $stmt = $pdo->prepare("
        SELECT u.id, u.username, u.full_name, u.supervisor_category, u.office_id, o.name AS primary_office_name
          FROM users u
     LEFT JOIN offices o ON o.id = u.office_id
         WHERE u.id = ? AND u.role = 'SUPERVISOR'
    ");
    $stmt->execute([$supId]);
    $sup = $stmt->fetch();
    if (!$sup) return null;

    $officeIds = [];
    $officeNames = [];
    if ($sup['office_id']) {
        $officeIds[] = (int) $sup['office_id'];
        if ($sup['primary_office_name']) {
            $officeNames[] = $sup['primary_office_name'] === 'PRMD' ? 'PRD' : $sup['primary_office_name'];
        }
    }
    $soStmt = $pdo->prepare("
        SELECT so.office_id, o.name AS office_name
          FROM supervisor_offices so
          JOIN offices o ON o.id = so.office_id
         WHERE so.supervisor_id = ?
         ORDER BY so.id ASC
    ");
    $soStmt->execute([$supId]);
    foreach ($soStmt as $r) {
        $oid = (int) $r['office_id'];
        $oname = $r['office_name'] === 'PRMD' ? 'PRD' : $r['office_name'];
        if (!in_array($oid, $officeIds, true)) $officeIds[] = $oid;
        if (!in_array($oname, $officeNames, true)) $officeNames[] = $oname;
    }

    $cat = strtoupper((string) ($sup['supervisor_category'] ?? 'OFFICE'));
    if ($cat === 'ITO' && !in_array('ITO', $officeNames, true)) {
        $officeNames[] = 'ITO';
    } elseif ($cat === 'ACADS' && !in_array('ACADS', $officeNames, true)) {
        $officeNames[] = 'ACADS';
    }

    return [
        'id' => (int) $sup['id'],
        'empId' => $sup['username'],
        'name' => $sup['full_name'],
        'category' => $cat,
        'officeIds' => $officeIds,
        'departments' => $officeNames,
        'scopeLabel' => implode(', ', $officeNames) ?: $cat,
    ];
}

/**
 * Helper to format relative time for notifications.
 */
function dashboard_time_ago(string $dt): string
{
    $ts = strtotime($dt);
    if (!$ts) return '';
    $diff = max(0, time() - $ts);
    if ($diff < 60) return 'Just now';
    if ($diff < 3600) return floor($diff / 60) . 'm ago';
    if ($diff < 86400) return floor($diff / 3600) . 'h ago';
    if ($diff < 86400 * 7) return floor($diff / 86400) . 'd ago';
    return date('M j, Y', $ts);
}

switch ($action) {

// ============================================================================
// 1. S.A. COORDINATOR DASHBOARD (ADMIN ONLY)
// ============================================================================
case 'summary':
    require_role($user, 'ADMIN');

    $sem = $pdo->query('SELECT * FROM semesters WHERE status = "ACTIVE" ORDER BY id DESC LIMIT 1')->fetch();
    if (!$sem) {
        respond([
            'success' => true,
            'semester' => null,
            'attention' => [[
                'group' => 'Scheduling',
                'title' => 'No semester is running',
                'detail' => 'Create the active semester first in Semester Setup.',
                'action' => ['label' => 'Open Semester Setup', 'to' => '/admin/scheduling/semester-setup'],
                'tone' => 'danger',
            ]],
            'roster' => null,
            'scheduling' => null,
            'programOverview' => null,
            'pendingDecisions' => [],
            'exceptionsAndAlerts' => [],
            'evaluationProgress' => null,
            'allowancePayroll' => null,
            'steps' => [],
            'publication' => null,
            'activity' => [],
        ]);
    }
    $semesterId = (int) $sem['id'];

    // ---------------------------------------------------------- Roster Metrics
    $roster = $pdo->query(
        'SELECT COUNT(*) AS total,
                SUM(sa_status = "ACTIVE" AND archived_at IS NULL) AS active,
                SUM(sa_status = "ACTIVE" AND archived_at IS NULL AND marked_for_reassignment = 1) AS marked_reassignment,
                SUM(sa_status = "ACTIVE" AND archived_at IS NULL AND disciplinary_status = "UNDER_AGREEMENT") AS under_agreement
           FROM sa_profiles'
    )->fetch();

    $archived = (int) $pdo->query('SELECT COUNT(*) FROM sa_profiles WHERE archived_at IS NOT NULL OR sa_status = "INACTIVE"')->fetchColumn();
    $activeSa = (int) ($roster['active'] ?? 0);

    // Compute assigned S.A. count directly from active assignments for this semester
    $assignedSaStmt = $pdo->prepare('
        SELECT COUNT(DISTINCT a.sa_profile_id)
          FROM schedule_assignments a
          JOIN sa_profiles p ON p.id = a.sa_profile_id
         WHERE a.semester_id = ?
           AND p.sa_status = "ACTIVE"
           AND p.archived_at IS NULL
    ');
    $assignedSaStmt->execute([$semesterId]);
    $assignedSa = (int) $assignedSaStmt->fetchColumn();
    $unassignedSa = max(0, $activeSa - $assignedSa);
    $markedReassignmentCount = (int) ($roster['marked_reassignment'] ?? 0);
    $underAgreementCount = (int) ($roster['under_agreement'] ?? 0);
    $requiredSa = (int) ($sem['required_sa'] ?? 0);

    // Attendance & Disciplinary counts
    $pendingWarningsCount = (int) $pdo->query("SELECT COUNT(*) FROM sa_disciplinary_warnings WHERE evaluation_status = 'PENDING_REVIEW'")->fetchColumn();
    $pendingAgreementsCount = (int) $pdo->query("SELECT COUNT(*) FROM sa_under_agreements WHERE status IN ('PENDING_APPROVAL', 'PENDING_SIGNATURE')")->fetchColumn();
    $unverifiedIncidentsStmt = $pdo->prepare("SELECT COUNT(*) FROM sa_attendance_incidents WHERE semester_id = ? AND status IN ('RECORDED', 'PENDING', 'DISPUTED')");
    $unverifiedIncidentsStmt->execute([$semesterId]);
    $unverifiedIncidentsCount = (int) $unverifiedIncidentsStmt->fetchColumn();
    $totalIncidentsStmt = $pdo->prepare("SELECT COUNT(*) FROM sa_attendance_incidents WHERE semester_id = ?");
    $totalIncidentsStmt->execute([$semesterId]);
    $totalIncidentsCount = (int) $totalIncidentsStmt->fetchColumn();

    // Class Schedules on file
    $withClassesStmt = $pdo->prepare('
        SELECT COUNT(DISTINCT c.sa_profile_id)
          FROM class_schedules c
          JOIN sa_profiles p ON p.id = c.sa_profile_id
         WHERE c.semester_id = ?
           AND c.archived_at IS NULL
           AND p.sa_status = "ACTIVE"
           AND p.archived_at IS NULL
    ');
    $withClassesStmt->execute([$semesterId]);
    $withClasses = (int) $withClassesStmt->fetchColumn();
    $missingClassSchedule = max(0, $activeSa - $withClasses);

    // --------------------------------------------------- Scheduling & Coverage
    $roomsStmt = $pdo->prepare('SELECT COUNT(*) AS periods, COUNT(DISTINCT CONCAT(department_type, room)) AS posts FROM room_requirements WHERE semester_id = ?');
    $roomsStmt->execute([$semesterId]);
    $rooms = $roomsStmt->fetch();

    $officesStmt = $pdo->prepare('SELECT COUNT(*) FROM office_requirements WHERE semester_id = ?');
    $officesStmt->execute([$semesterId]);
    $officesCount = (int) $officesStmt->fetchColumn();

    $runStmt = $pdo->prepare('SELECT id, batch_status, approved_by, approved_at, created_at FROM matching_runs WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
    $runStmt->execute([$semesterId]);
    $run = $runStmt->fetch();

    $slots = ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0];
    if ($run) {
        $stmt = $pdo->prepare('SELECT decision, status, COUNT(*) AS n FROM match_slots WHERE run_id = ? GROUP BY decision, status');
        $stmt->execute([$run['id']]);
        foreach ($stmt as $r) {
            $slots['total'] += (int) $r['n'];
            if ($r['decision'] === 'PENDING') $slots['pending'] += (int) $r['n'];
            else $slots['decided'] += (int) $r['n'];
            if ($r['status'] === 'COVERAGE_GAP' && $r['decision'] === 'PENDING') $slots['gaps'] += (int) $r['n'];
        }
    }

    // Room Assignment Board summary (Primary vs Reliever & Coverage by Department)
    $grid = room_grid($semesterId);
    $boardSummary = $grid['boardSummary'] ?? [
        'totalAssignments' => 0,
        'awaitingApproval' => 0,
        'approvedAssignments' => 0,
        'uncoveredRooms' => (int) $slots['gaps'],
        'relieverNeededRooms' => 0,
        'primaryAssignedCount' => $assignedSa,
        'relieverAssignedCount' => 0,
    ];
    $lockInfo = get_matching_batch_lock_info($semesterId);

    $coverageByDept = [
        'ITO' => ['dept' => 'ITO', 'label' => 'ITO Laboratories', 'totalPosts' => 0, 'coveredPosts' => 0, 'uncoveredPosts' => 0, 'primaryCount' => 0, 'relieverCount' => 0],
        'ACADS' => ['dept' => 'ACADS', 'label' => 'ACADS Lecture Rooms', 'totalPosts' => 0, 'coveredPosts' => 0, 'uncoveredPosts' => 0, 'primaryCount' => 0, 'relieverCount' => 0],
        'OFFICE' => ['dept' => 'OFFICE', 'label' => 'Campus Offices', 'totalPosts' => 0, 'coveredPosts' => 0, 'uncoveredPosts' => 0, 'primaryCount' => 0, 'relieverCount' => 0],
    ];
    foreach ($grid['posts'] ?? [] as $gp) {
        $dKey = in_array($gp['department'], ['ITO', 'ACADS', 'OFFICE'], true) ? $gp['department'] : 'OFFICE';
        $coverageByDept[$dKey]['totalPosts']++;
        if (in_array($gp['coverageStatus'] ?? '', ['UNCOVERED', 'RELIEVER_NEEDED'], true)) {
            $coverageByDept[$dKey]['uncoveredPosts']++;
        } else {
            $coverageByDept[$dKey]['coveredPosts']++;
        }
        $coverageByDept[$dKey]['primaryCount'] += count($gp['primarySas'] ?? []);
        $coverageByDept[$dKey]['relieverCount'] += count($gp['relieverSas'] ?? []);
    }

    $activeReliefStmt = $pdo->prepare("SELECT COUNT(*) FROM room_relief_coverages WHERE semester_id = ? AND status = 'ACTIVE'");
    $activeReliefStmt->execute([$semesterId]);
    $activeReliefCount = (int) $activeReliefStmt->fetchColumn();

    $assignmentsStmt = $pdo->prepare('SELECT COUNT(*) FROM schedule_assignments WHERE semester_id = ?');
    $assignmentsStmt->execute([$semesterId]);
    $assignments = (int) $assignmentsStmt->fetchColumn();

    $pub = publication($semesterId);
    $clashes = duty_class_clashes($semesterId);
    $view = $assignments ? schedule_view($semesterId) : null;
    $short = $view ? (int) $view['summary']['belowMinimum'] : 0;

    // --------------------------------------------------- Evaluation Progress
    $evalCampStmt = $pdo->prepare('SELECT * FROM evaluation_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
    $evalCampStmt->execute([$semesterId]);
    $evalCampaign = $evalCampStmt->fetch() ?: null;

    $evalStats = [
        'hasCampaign' => (bool) $evalCampaign,
        'campaignTitle' => $evalCampaign['title'] ?? null,
        'campaignStatus' => $evalCampaign['status'] ?? null,
        'deadline' => $evalCampaign['deadline'] ?? null,
        'total' => 0,
        'awaitingSupervisor' => 0,
        'awaitingSaAck' => 0,
        'awaitingCoordinator' => 0,
        'finalized' => 0,
        'pendingFinalDecision' => 0,
        'pendingExtensions' => 0,
        'disputes' => 0,
    ];
    $evalRowsStmt = $pdo->prepare('
        SELECT status, extension_status, sa_has_dispute
          FROM sa_evaluations
         WHERE semester_id = ?
    ');
    $evalRowsStmt->execute([$semesterId]);
    foreach ($evalRowsStmt->fetchAll() as $er) {
        $evalStats['total']++;
        $st = strtoupper((string) $er['status']);
        if (in_array($st, ['PENDING_SUPERVISOR', 'RETURNED_FOR_REVISION'], true)) {
            $evalStats['awaitingSupervisor']++;
        } elseif ($st === 'FOR_SA_REVIEW') {
            $evalStats['awaitingSaAck']++;
        } elseif (in_array($st, ['FOR_COORDINATOR_REVIEW', 'FOR_FINAL_DECISION'], true)) {
            $evalStats['awaitingCoordinator']++;
        } elseif ($st === 'FINALIZED') {
            $evalStats['finalized']++;
        }
        if (($er['extension_status'] ?? '') === 'PENDING') {
            $evalStats['pendingExtensions']++;
        }
        if (!empty($er['sa_has_dispute']) && $st !== 'FINALIZED') {
            $evalStats['disputes']++;
        }
    }
    $evalStats['pendingFinalDecision'] = max(0, $evalStats['total'] - $evalStats['finalized']);

    // --------------------------------------------------- Allowance & Payroll
    $rateStmt = $pdo->prepare('SELECT hourly_rate FROM allowance_rates WHERE semester_id = ?');
    $rateStmt->execute([$semesterId]);
    $semRate = (float) ($rateStmt->fetchColumn() ?: DEFAULT_HOURLY_RATE);

    $assignedHrsStmt = $pdo->prepare('
        SELECT sa_profile_id, COALESCE(SUM(TIMESTAMPDIFF(MINUTE, start_time, end_time)/60), 0) AS hrs
          FROM schedule_assignments
         WHERE semester_id = ?
         GROUP BY sa_profile_id
    ');
    $assignedHrsStmt->execute([$semesterId]);
    $assignedHrsBySa = [];
    foreach ($assignedHrsStmt->fetchAll() as $ar) {
        $assignedHrsBySa[(int) $ar['sa_profile_id']] = (float) $ar['hrs'];
    }

    $saPayStmt = $pdo->query('SELECT id, hourly_rate, weekly_target_hours FROM sa_profiles WHERE sa_status = "ACTIVE" AND archived_at IS NULL');
    $totalWeeklyHours = 0.0;
    $totalWeeklyAllowance = 0.0;
    $customRateCount = 0;
    foreach ($saPayStmt->fetchAll() as $sp) {
        $sid = (int) $sp['id'];
        $hrs = isset($assignedHrsBySa[$sid]) && $assignedHrsBySa[$sid] > 0
            ? $assignedHrsBySa[$sid]
            : (float) ($sp['weekly_target_hours'] ?: 35.0);
        $rate = $sp['hourly_rate'] !== null ? (float) $sp['hourly_rate'] : $semRate;
        if ($sp['hourly_rate'] !== null && abs((float) $sp['hourly_rate'] - $semRate) > 0.001) {
            $customRateCount++;
        }
        $totalWeeklyHours += $hrs;
        $totalWeeklyAllowance += round($hrs * $rate, 2);
    }
    $totalMonthlyAllowance = round($totalWeeklyAllowance * 4, 2);

    // School Balance Deduction Campaign status
    $dedCampStmt = $pdo->prepare('SELECT * FROM deduction_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
    $dedCampStmt->execute([$semesterId]);
    $dedCampaign = $dedCampStmt->fetch() ?: null;
    $dedPendingResponses = 0;
    $dedOptedInCount = 0;
    if ($dedCampaign) {
        $dedRespStmt = $pdo->prepare('
            SELECT COUNT(*) AS total_resp, SUM(choice = "YES") AS opted_in
              FROM deduction_responses
             WHERE campaign_id = ?
        ');
        $dedRespStmt->execute([(int) $dedCampaign['id']]);
        $dr = $dedRespStmt->fetch();
        $dedResponded = (int) ($dr['total_resp'] ?? 0);
        $dedOptedInCount = (int) ($dr['opted_in'] ?? 0);
        $dedPendingResponses = max(0, $activeSa - $dedResponded);
    }

    $allowancePayroll = [
        'standardRate' => $semRate,
        'customRateCount' => $customRateCount,
        'totalWeeklyHours' => round($totalWeeklyHours, 1),
        'estimatedWeeklyPayroll' => round($totalWeeklyAllowance, 2),
        'estimatedMonthlyPayroll' => $totalMonthlyAllowance,
        'statusLabel' => $pub['status'] === 'PUBLISHED' ? 'Active Schedule Rates' : 'Projected (Pre-Publish)',
        'deductionCampaign' => $dedCampaign ? [
            'id' => (int) $dedCampaign['id'],
            'title' => $dedCampaign['title'],
            'status' => $dedCampaign['status'],
            'optedInCount' => $dedOptedInCount,
            'pendingResponses' => $dedPendingResponses,
        ] : null,
    ];

    // --------------------------------------------------- Section B: Pending Decisions
    $pendingDecisions = [];
    $scheduleBatchPendingCount = !$lockInfo['isLocked'] ? (int) ($boardSummary['awaitingApproval'] ?? 0) : 0;
    if ($run && !$lockInfo['isLocked']) {
        $pendingDecisions[] = [
            'key' => 'BATCH_APPROVAL',
            'category' => 'Schedule & Matching',
            'title' => 'Matching Batch Awaiting Coordinator Approval & Lock',
            'count' => 1,
            'badge' => ($boardSummary['totalAssignments'] ?? 0) . ' assigned · Batch Unlocked',
            'detail' => 'Review Primary and Reliever S.A. assignments on the Room Assignment Board and lock the semester batch.',
            'to' => '/admin/scheduling/matching',
            'actionLabel' => 'Review & Lock Batch',
            'tone' => 'warning',
        ];
    }
    if ($assignments > 0 && $pub['status'] !== 'PUBLISHED') {
        $pendingDecisions[] = [
            'key' => 'PUBLISH_SCHEDULE',
            'category' => 'Schedule Publication',
            'title' => 'Official Semester Schedule Ready for Publication',
            'count' => 1,
            'badge' => $pub['status'],
            'detail' => $assignments . ' duty period(s) are finalized. Publish the schedule so S.A.s and Supervisors can view their official assignments.',
            'to' => '/admin/scheduling/finalized',
            'actionLabel' => 'Finalize & Publish',
            'tone' => 'info',
        ];
    }

    // S.A. Requests awaiting Coordinator Verification & Recording
    $pendingReqStmt = $pdo->prepare("SELECT COUNT(*) FROM sa_requests WHERE semester_id = ? AND status = 'PENDING_COORDINATOR_RECORDING'");
    $pendingReqStmt->execute([$semesterId]);
    $pendingRequestsCount = (int) $pendingReqStmt->fetchColumn();
    if ($pendingRequestsCount > 0) {
        $pendingDecisions[] = [
            'key' => 'REQUESTS_RECORDING',
            'category' => 'Review Requests',
            'title' => 'Supervisor-Approved Requests Awaiting Coordinator Recording',
            'count' => $pendingRequestsCount,
            'badge' => $pendingRequestsCount . ' request(s)',
            'detail' => 'Verify and officially record supervisor-approved excuse slips, overtime, undertime, or attendance corrections.',
            'to' => '/admin/requests?status=PENDING_COORDINATOR_RECORDING',
            'actionLabel' => 'Verify & Record',
            'tone' => 'warning',
        ];
    }

    // Allowance Cutoffs awaiting computation review / endorsement
    $cutoffPendingStmt = $pdo->prepare("
        SELECT COUNT(*) FROM allowance_cutoffs
         WHERE semester_id = ? AND status IN ('COMPUTED', 'FOR_REVIEW')
    ");
    $cutoffPendingStmt->execute([$semesterId]);
    $cutoffPendingCount = (int) $cutoffPendingStmt->fetchColumn();
    if ($cutoffPendingCount > 0) {
        $pendingDecisions[] = [
            'key' => 'CUTOFF_ENDORSEMENT',
            'category' => 'Allowance & Payroll',
            'title' => 'Allowance Cutoff Computations Awaiting Review & Endorsement',
            'count' => $cutoffPendingCount,
            'badge' => $cutoffPendingCount . ' cutoff(s)',
            'detail' => 'Review computed S.A. allowance hours and endorse cutoff payroll to Accounting.',
            'to' => '/admin/allowance',
            'actionLabel' => 'Review Cutoff',
            'tone' => 'warning',
        ];
    }

    if ($pendingWarningsCount > 0 || $pendingAgreementsCount > 0) {
        $pendingDecisions[] = [
            'key' => 'ATTENDANCE_DISCIPLINARY',
            'category' => 'Attendance & Disciplinary',
            'title' => 'Attendance Warning Memos & Probationary Agreements',
            'count' => $pendingWarningsCount + $pendingAgreementsCount,
            'badge' => $pendingWarningsCount . ' warning(s) · ' . $pendingAgreementsCount . ' agreement(s)',
            'detail' => 'Review generated attendance violation memos or Under Agreement probationary contracts awaiting Coordinator approval.',
            'to' => '/admin/sa-management?status=UNDER_AGREEMENT',
            'actionLabel' => 'Review Attendance Cases',
            'tone' => 'danger',
        ];
    }
    if ($evalStats['awaitingCoordinator'] > 0 || $evalStats['pendingExtensions'] > 0) {
        $pendingDecisions[] = [
            'key' => 'EVALUATION_DECISIONS',
            'category' => 'Performance Evaluation',
            'title' => 'Evaluations & Extension Requests Awaiting Coordinator Decision',
            'count' => $evalStats['awaitingCoordinator'] + $evalStats['pendingExtensions'],
            'badge' => $evalStats['awaitingCoordinator'] . ' review(s) · ' . $evalStats['pendingExtensions'] . ' extension(s)',
            'detail' => 'Record official retention/reassignment decisions or decide on S.A. acknowledgment deadline extension requests.',
            'to' => '/admin/evaluations',
            'actionLabel' => 'Open Evaluations',
            'tone' => 'warning',
        ];
    }
    if ($dedCampaign && $dedCampaign['status'] === 'OPEN') {
        $pendingDecisions[] = [
            'key' => 'DEDUCTION_CAMPAIGN',
            'category' => 'Allowance & School Balance',
            'title' => 'School Balance Deduction Poll In Progress',
            'count' => 1,
            'badge' => $dedOptedInCount . ' S.A.(s) opted in · ' . $dedPendingResponses . ' pending',
            'detail' => $dedOptedInCount . ' of ' . $activeSa . ' active S.A.s opted in so far for "' . $dedCampaign['title'] . '". Poll is actively open for student submissions.',
            'to' => '/admin/school-balance',
            'actionLabel' => 'Monitor Poll',
            'tone' => 'info',
        ];
    }

    $totalPendingApprovals = array_sum(array_column($pendingDecisions, 'count'));

    // --------------------------------------------------- Section C: Exceptions & Alerts
    $exceptionsAndAlerts = [];
    if (count($clashes) > 0) {
        $exceptionsAndAlerts[] = [
            'key' => 'CLASS_CLASHES',
            'category' => 'Class Conflict',
            'title' => count($clashes) . ' Duty Period(s) Conflict with Registrar Class Schedules',
            'detail' => 'A class schedule was updated after duty assignment. Resolve the overlapping period immediately.',
            'to' => '/admin/scheduling/finalized',
            'actionLabel' => 'Resolve Clashes',
            'tone' => 'danger',
        ];
    }
    $coverageGapsCount = max((int) ($boardSummary['uncoveredRooms'] ?? 0), (int) $slots['gaps']);
    if ($coverageGapsCount > 0) {
        $exceptionsAndAlerts[] = [
            'key' => 'UNCOVERED_ROOMS',
            'category' => 'Coverage Gap',
            'title' => $coverageGapsCount . ' Uncovered Room(s) / Period(s) Needing Reliever',
            'detail' => 'One or more required duty windows lack a qualified Primary or Reliever S.A.',
            'to' => '/admin/scheduling/matching',
            'actionLabel' => 'Assign Reliever / Staff',
            'tone' => 'danger',
        ];
    }
    if ($missingClassSchedule > 0) {
        $exceptionsAndAlerts[] = [
            'key' => 'MISSING_CLASSES',
            'category' => 'Missing Schedule Data',
            'title' => $missingClassSchedule . ' Active S.A.(s) Without Imported Class Schedule',
            'detail' => 'Import their Registrar COR / class schedule so conflict detection can verify their duty hours.',
            'to' => '/admin/scheduling/class-schedules',
            'actionLabel' => 'Import Class Schedules',
            'tone' => 'warning',
        ];
    }
    if ($short > 0) {
        $exceptionsAndAlerts[] = [
            'key' => 'BELOW_MIN_HOURS',
            'category' => 'Staffing Shortage',
            'title' => $short . ' Assigned S.A.(s) Below ' . min_weekly_hours() . '-Hour Weekly Minimum',
            'detail' => 'Assigned S.A.s must meet the minimum weekly credited duty requirement (' . min_weekly_hours() . '–' . hard_weekly_cap() . ' hrs/wk).',
            'to' => '/admin/scheduling/recommendations',
            'actionLabel' => 'Adjust Duty Hours',
            'tone' => 'warning',
        ];
    }
    if ($underAgreementCount > 0 || $unverifiedIncidentsCount > 0) {
        $exceptionsAndAlerts[] = [
            'key' => 'ATTENDANCE_EXCEPTIONS',
            'category' => 'Attendance Exception',
            'title' => $underAgreementCount . ' S.A.(s) Under Agreement · ' . $unverifiedIncidentsCount . ' Unverified Incident(s)',
            'detail' => 'Monitor probationary attendance compliance and verify recorded late, undertime, or absence logs.',
            'to' => '/admin/sa-management?status=UNDER_AGREEMENT',
            'actionLabel' => 'Inspect Attendance',
            'tone' => 'danger',
        ];
    }
    if ($evalStats['disputes'] > 0) {
        $exceptionsAndAlerts[] = [
            'key' => 'EVAL_DISPUTES',
            'category' => 'Evaluation Concern',
            'title' => $evalStats['disputes'] . ' Evaluation(s) Flagged with S.A. Concern / Dispute',
            'detail' => 'An S.A. submitted a concern during acknowledgment. Coordinator review is required before final decision.',
            'to' => '/admin/evaluations',
            'actionLabel' => 'Review Concerns',
            'tone' => 'warning',
        ];
    }
    if ($customRateCount > 0) {
        $exceptionsAndAlerts[] = [
            'key' => 'CUSTOM_RATES',
            'category' => 'Payroll Rate Override',
            'title' => $customRateCount . ' S.A.(s) Configured with Custom Hourly Rate Override',
            'detail' => 'Verify custom hourly rate exceptions against the standard ₱' . number_format($semRate, 2) . '/hr semester rate.',
            'to' => '/admin/allowance',
            'actionLabel' => 'Verify Allowance Rates',
            'tone' => 'info',
        ];
    }

    // Legacy attention & steps for compatibility
    $steps = [
        ['key' => 'SEMESTER', 'label' => 'Semester Setup', 'to' => '/admin/scheduling/semester-setup',
         'done' => true, 'detail' => semester_label($sem) . ' is active'],
        ['key' => 'ROOMS', 'label' => 'Room/Lab Schedules', 'to' => '/admin/scheduling/room-lab',
         'done' => (int) $rooms['posts'] > 0,
         'detail' => $rooms['posts'] ? $rooms['posts'] . ' duty post(s), ' . $rooms['periods'] . ' period(s)/wk' : 'No room set up yet'],
        ['key' => 'CLASSES', 'label' => 'Class Schedules', 'to' => '/admin/scheduling/class-schedules',
         'done' => $withClasses >= $activeSa && $activeSa > 0,
         'detail' => $withClasses . ' of ' . $activeSa . ' active S.A.s on file'],
        ['key' => 'OFFICES', 'label' => 'Office Staffing', 'to' => '/admin/scheduling/office-staffing',
         'done' => $officesCount > 0,
         'detail' => $officesCount ? $officesCount . ' office requirement(s)' : 'No office staffing set yet'],
        ['key' => 'MATCHING', 'label' => 'Room Assignment Board', 'to' => '/admin/scheduling/matching',
         'done' => (bool) $run,
         'detail' => $run ? ($lockInfo['isLocked'] ? 'Batch Approved & Locked' : 'Matched on ' . date('M j, Y', strtotime($run['created_at']))) : 'Not run yet'],
        ['key' => 'DECISIONS', 'label' => 'Recommendations & Duty Grid', 'to' => '/admin/scheduling/recommendations',
         'done' => $run && ($lockInfo['isLocked'] || $slots['pending'] === 0),
         'detail' => $run ? $slots['decided'] . ' of ' . $slots['total'] . ' slot(s) decided' : 'Waiting for matching run'],
        ['key' => 'FINALIZED', 'label' => 'Finalize Schedule', 'to' => '/admin/scheduling/finalized',
         'done' => $assignments > 0 && $pub['status'] === 'PUBLISHED',
         'detail' => $pub['status'] === 'PUBLISHED'
             ? 'Published ' . date('M j, Y', strtotime($pub['published_at']))
             : ($assignments ? $assignments . ' duty period(s) staged' : 'Not finalized yet')],
    ];

    // Fetch S.A.s currently Under Agreement or with Pending Warnings
    $uaSasStmt = $pdo->query("
        SELECT p.id, p.student_id, p.sa_number, p.first_name, p.last_name, p.suffix,
               p.course, p.year_level, p.assignment_status, p.disciplinary_status, p.under_agreement_at,
               o.name AS office_name, p.department_type
        FROM sa_profiles p
        LEFT JOIN offices o ON o.id = p.office_id
        WHERE p.archived_at IS NULL
          AND (p.disciplinary_status != 'GOOD_STANDING'
               OR EXISTS (SELECT 1 FROM sa_disciplinary_warnings w WHERE w.sa_profile_id = p.id AND w.evaluation_status = 'PENDING_REVIEW'))
        ORDER BY FIELD(p.disciplinary_status, 'UNDER_AGREEMENT', 'SECOND_WARNING', 'FIRST_WARNING', 'GOOD_STANDING'), p.last_name ASC
        LIMIT 8
    ");
    $disciplinarySas = array_map(fn($r) => [
        'id' => (int) $r['id'],
        'name' => sa_full_name($r),
        'studentId' => $r['student_id'],
        'saNumber' => $r['sa_number'],
        'course' => $r['course'],
        'yearLevel' => (int) $r['year_level'],
        'office' => $r['office_name'] ?: $r['department_type'],
        'assignmentStatus' => $r['assignment_status'],
        'disciplinaryStatus' => $r['disciplinary_status'],
        'underAgreementAt' => $r['under_agreement_at'],
    ], $uaSasStmt->fetchAll());

    $activityStmt = $pdo->prepare(
        'SELECT a.action, a.details, a.created_at, u.full_name
           FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
          WHERE a.action NOT IN ("LOGIN_SUCCESS","LOGIN_FAILED","LOGOUT")
          ORDER BY a.id DESC LIMIT 10'
    );
    $activityStmt->execute();

    // Attendance records needing Coordinator intervention (escalated or rejected in supervisor review)
    $escalatedAttStmt = $pdo->prepare("
        SELECT COUNT(*) FROM sa_attendance_reconciliations
         WHERE semester_id = ? AND review_status IN ('ESCALATED', 'REJECTED')
    ");
    $escalatedAttStmt->execute([$semesterId]);
    $escalatedAttCount = (int) $escalatedAttStmt->fetchColumn();

    $attendanceExceptionsTotal = $pendingWarningsCount + $pendingAgreementsCount + $underAgreementCount + $unverifiedIncidentsCount + $escalatedAttCount;

    respond([
        'success' => true,
        'semester' => format_semester($sem),
        'roster' => [
            'total' => (int) $roster['total'],
            'active' => $activeSa,
            'assigned' => $assignedSa,
            'unassigned' => $unassignedSa,
            'markedForReassignment' => $markedReassignmentCount,
            'underAgreement' => $underAgreementCount,
            'pendingWarnings' => $pendingWarningsCount,
            'pendingAgreements' => $pendingAgreementsCount,
            'unverifiedIncidents' => $unverifiedIncidentsCount,
            'totalIncidents' => $totalIncidentsCount,
            'archived' => $archived,
            'requiredSa' => $requiredSa,
            'withClassSchedule' => $withClasses,
            'missingClassSchedule' => $missingClassSchedule,
        ],
        'scheduling' => [
            'posts' => (int) $rooms['posts'],
            'periods' => (int) $rooms['periods'],
            'offices' => $officesCount,
            'run' => $run ? ['id' => (int) $run['id'], 'ranAt' => $run['created_at'], 'batchStatus' => $run['batch_status']] : null,
            'lockInfo' => $lockInfo,
            'boardSummary' => $boardSummary,
            'coverageGaps' => $coverageGapsCount,
            'activeReliefCount' => $activeReliefCount,
            'slots' => $slots,
            'assignments' => $assignments,
            'clashes' => count($clashes),
            'belowMinimum' => $short,
            'minWeekly' => min_weekly_hours(),
            'maxWeekly' => hard_weekly_cap(),
        ],
        'programOverview' => [
            'coverageByDept' => array_values($coverageByDept),
            'primaryAssignedCount' => (int) ($boardSummary['primaryAssignedCount'] ?? $assignedSa),
            'relieverAssignedCount' => (int) ($boardSummary['relieverAssignedCount'] ?? 0),
            'activeTemporaryReliefs' => $activeReliefCount,
            'vacantPosts' => $coverageGapsCount,
            'belowMinimumSas' => $short,
            'missingClassSchedules' => $missingClassSchedule,
        ],
        'pendingApprovalsTotal' => $totalPendingApprovals,
        'attendanceExceptionsTotal' => $attendanceExceptionsTotal,
        'pendingDecisions' => $pendingDecisions,
        'exceptionsAndAlerts' => $exceptionsAndAlerts,
        'evaluationProgress' => $evalStats,
        'allowancePayroll' => $allowancePayroll,
        'disciplinarySas' => $disciplinarySas,
        'steps' => $steps,
        'publication' => [
            'status' => $pub['status'],
            'finalizedAt' => $pub['finalized_at'],
            'publishedAt' => $pub['published_at'],
            'finalizedBy' => $pub['finalized_by_name'],
            'publishedBy' => $pub['published_by_name'],
        ],
        'activity' => array_map(fn($a) => [
            'action' => $a['action'],
            'details' => $a['details'],
            'by' => $a['full_name'],
            'at' => $a['created_at'],
        ], $activityStmt->fetchAll()),
        'perfectAttendance' => get_latest_perfect_attendance_recognition($pdo, $semesterId),
    ]);

// ============================================================================
// 2. SUPERVISOR DASHBOARD (SUPERVISOR ONLY — STRICTLY SCOPED)
// ============================================================================
case 'supervisor_summary':
    require_role($user, 'SUPERVISOR');

    $supId = (int) $user['id'];
    $scope = dashboard_supervisor_scope($pdo, $supId);
    if (!$scope) fail('Supervisor profile not found.', 404);

    $sem = target_semester(null);
    $semesterId = (int) $sem['id'];
    ensure_assigned_office_schedules($semesterId);
    sync_approved_to_assignments($semesterId);
    $pub = publication($semesterId);
    $isPublished = (($pub['status'] ?? 'DRAFT') === 'PUBLISHED');

    // Resolve all active S.A.s within this Supervisor's authorized scope
    $saMetaMap = [];
    $scopedSaIds = [];
    $pStmt = $pdo->query("
        SELECT p.id, p.student_id, p.first_name, p.last_name, p.course, p.year_level,
               p.sa_category, p.department_type, p.office_id, p.supervisor_id, p.disciplinary_status,
               o.name AS office_name
          FROM sa_profiles p
     LEFT JOIN offices o ON o.id = p.office_id
         WHERE p.sa_status = 'ACTIVE' AND p.archived_at IS NULL
    ");
    foreach ($pStmt as $pr) {
        $sid = (int) $pr['id'];
        $cat = strtoupper((string) $pr['sa_category']);
        $deptType = strtoupper((string) $pr['department_type']);
        $oid = $pr['office_id'] ? (int) $pr['office_id'] : null;
        $expSupId = $pr['supervisor_id'] ? (int) $pr['supervisor_id'] : null;

        $inScope = ($expSupId === $scope['id'])
            || ($scope['category'] === 'ITO' && ($cat === 'ITO' || $deptType === 'ITO'))
            || ($scope['category'] === 'ACADS' && ($cat === 'ACADS' || $deptType === 'ACADS'))
            || ($oid && in_array($oid, $scope['officeIds'], true));

        $saMetaMap[$sid] = [
            'id' => $sid,
            'studentId' => $pr['student_id'],
            'name' => trim($pr['first_name'] . ' ' . $pr['last_name']),
            'course' => $pr['course'],
            'yearLevel' => (int) $pr['year_level'],
            'category' => $cat,
            'officeId' => $oid,
            'officeName' => $pr['office_name'] === 'PRMD' ? 'PRD' : $pr['office_name'],
            'supervisorId' => $expSupId,
            'disciplinaryStatus' => $pr['disciplinary_status'] ?: 'GOOD_STANDING',
            'inScope' => $inScope,
        ];
        if ($inScope) {
            $scopedSaIds[$sid] = $sid;
        }
    }

    // Filter published schedule staff to Supervisor's scope
    $scopedStaff = [];
    if ($isPublished) {
        $sched = schedule_view($semesterId);
        foreach ($sched['staff'] ?? [] as $st) {
            $sid = (int) ($st['saId'] ?? 0);
            $dept = strtoupper((string) ($st['department'] ?? ''));
            $meta = $saMetaMap[$sid] ?? null;
            $inScope = ($meta && $meta['inScope'])
                || ($scope['category'] === 'ITO' && $dept === 'ITO')
                || ($scope['category'] === 'ACADS' && $dept === 'ACADS');
            if ($inScope) {
                $scopedStaff[] = $st;
                $scopedSaIds[$sid] = $sid;
            }
        }
    }

    // Determine today's day code (MON..SUN)
    $dayMap = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    $dayNames = [
        'SUN' => 'Sunday', 'MON' => 'Monday', 'TUE' => 'Tuesday', 'WED' => 'Wednesday',
        'THU' => 'Thursday', 'FRI' => 'Friday', 'SAT' => 'Saturday',
    ];
    $todayCode = $dayMap[(int) date('w')] ?? 'MON';
    $todayDate = date('Y-m-d');
    $nowMins = ((int) date('G')) * 60 + ((int) date('i'));

    // Check today's attendance incidents for deployment status
    $todayIncidentsBySa = [];
    if (!empty($scopedSaIds)) {
        $idList = implode(',', array_map('intval', array_values($scopedSaIds)));
        $tIncStmt = $pdo->prepare("
            SELECT sa_profile_id, category, status, actual_time_in, actual_time_out, minutes_affected
              FROM sa_attendance_incidents
             WHERE semester_id = ? AND incident_date = ? AND sa_profile_id IN ($idList)
        ");
        $tIncStmt->execute([$semesterId, $todayDate]);
        foreach ($tIncStmt->fetchAll() as $ti) {
            $todayIncidentsBySa[(int) $ti['sa_profile_id']] = $ti;
        }
    }

    // Check active temporary relief coverages in scope for today
    $todayReliefs = [];
    $relStmt = $pdo->prepare("
        SELECT rc.*,
               CONCAT(ps.first_name, ' ', ps.last_name) AS primary_sa_name,
               CONCAT(rs.first_name, ' ', rs.last_name) AS reliever_sa_name,
               rs.student_id AS reliever_student_id
          FROM room_relief_coverages rc
     LEFT JOIN sa_profiles ps ON ps.id = rc.primary_sa_id
     LEFT JOIN sa_profiles rs ON rs.id = rc.reliever_sa_id
         WHERE rc.semester_id = ? AND rc.coverage_date = ? AND rc.status = 'ACTIVE'
    ");
    $relStmt->execute([$semesterId, $todayDate]);
    foreach ($relStmt->fetchAll() as $rc) {
        $rcDept = strtoupper((string) $rc['department']);
        $inRelScope = ($scope['category'] === 'ITO' && $rcDept === 'ITO')
            || ($scope['category'] === 'ACADS' && $rcDept === 'ACADS')
            || in_array($rc['room'], $scope['departments'], true)
            || ($rc['primary_sa_id'] && isset($scopedSaIds[(int) $rc['primary_sa_id']]))
            || ($rc['reliever_sa_id'] && isset($scopedSaIds[(int) $rc['reliever_sa_id']]));
        if ($inRelScope) {
            $todayReliefs[] = [
                'id' => (int) $rc['id'],
                'room' => $rc['room'],
                'department' => $rc['department'],
                'primarySaName' => $rc['primary_sa_name'],
                'relieverSaName' => $rc['reliever_sa_name'],
                'relieverStudentId' => $rc['reliever_student_id'],
                'startLabel' => format_time($rc['start_time']),
                'endLabel' => format_time($rc['end_time']),
                'reason' => $rc['reason'],
            ];
        }
    }

    // Build Section A: Today's Assigned Deployments & Assigned Locations Summary
    $todayDeployments = [];
    $locationsSummary = [];
    foreach ($scopedStaff as $st) {
        $sid = (int) $st['saId'];
        $blocks = $st['blocks'] ?? [];
        foreach ($blocks as $b) {
            $loc = (string) ($b['location'] ?? '');
            $cleanLoc = trim(preg_replace('/\s*\(ITO Reliever\)/i', '', $loc));
            $isReliever = stripos($loc, 'Reliever') !== false;
            if ($cleanLoc !== '') {
                if (!isset($locationsSummary[$cleanLoc])) {
                    $locationsSummary[$cleanLoc] = [
                        'location' => $cleanLoc,
                        'department' => $st['department'] ?: $st['category'],
                        'primarySas' => [],
                        'relieverSas' => [],
                        'todayBlocksCount' => 0,
                    ];
                }
                if ($isReliever) {
                    $locationsSummary[$cleanLoc]['relieverSas'][$sid] = $st['name'];
                } else {
                    $locationsSummary[$cleanLoc]['primarySas'][$sid] = $st['name'];
                }
            }

            if (($b['day'] ?? '') === $todayCode) {
                if ($cleanLoc !== '' && isset($locationsSummary[$cleanLoc])) {
                    $locationsSummary[$cleanLoc]['todayBlocksCount']++;
                }
                $inc = $todayIncidentsBySa[$sid] ?? null;
                $bStart = (int) ($b['start'] ?? 0);
                $bEnd = (int) ($b['end'] ?? 0);

                if ($inc) {
                    $verifyStatus = 'INCIDENT_LOGGED';
                    $verifyLabel = 'Exception: ' . $inc['category'];
                } elseif ($nowMins >= $bEnd) {
                    $verifyStatus = 'COMPLETED';
                    $verifyLabel = 'Period Completed';
                } elseif ($nowMins >= $bStart && $nowMins < $bEnd) {
                    $verifyStatus = 'ON_DUTY_NOW';
                    $verifyLabel = 'On Duty Now';
                } else {
                    $verifyStatus = 'SCHEDULED_TODAY';
                    $verifyLabel = 'Scheduled Today';
                }

                $todayDeployments[] = [
                    'saId' => $sid,
                    'saName' => $st['name'],
                    'studentId' => $st['studentId'],
                    'saNumber' => $st['saNumber'] ?? null,
                    'course' => $st['course'],
                    'yearLevel' => $st['yearLevel'],
                    'location' => $cleanLoc ?: $st['location'],
                    'department' => $st['department'] ?: $st['category'],
                    'roleBadge' => $isReliever ? 'RELIEVER' : 'PRIMARY',
                    'start' => $bStart,
                    'end' => $bEnd,
                    'startLabel' => $b['startLabel'],
                    'endLabel' => $b['endLabel'],
                    'creditedHours' => $b['credited'],
                    'hasBreak' => !empty($b['hasBreak']),
                    'verificationStatus' => $verifyStatus,
                    'verificationLabel' => $verifyLabel,
                ];
            }
        }
    }
    usort($todayDeployments, fn($a, $b) => ($a['start'] <=> $b['start']) ?: strnatcasecmp($a['location'], $b['location']));

    $assignedLocations = array_values(array_map(function ($loc) {
        return [
            'location' => $loc['location'],
            'department' => $loc['department'],
            'primarySas' => array_values($loc['primarySas']),
            'relieverSas' => array_values($loc['relieverSas']),
            'todayBlocksCount' => $loc['todayBlocksCount'],
        ];
    }, $locationsSummary));
    usort($assignedLocations, fn($a, $b) => strnatcasecmp($a['location'], $b['location']));

    // Section B: Attendance Verification (Scoped exclusively to Supervisor's S.A.s)
    $attendanceRecords = [];
    $pendingVerificationCount = 0;
    if (!empty($scopedSaIds)) {
        $idList = implode(',', array_map('intval', array_values($scopedSaIds)));
        $incStmt = $pdo->prepare("
            SELECT i.id, i.sa_profile_id, i.category, i.incident_date, i.scheduled_start, i.scheduled_end,
                   i.actual_time_in, i.actual_time_out, i.minutes_affected, i.evidence_notes, i.status,
                   p.first_name, p.last_name, p.student_id, p.disciplinary_status, o.name AS office_name, p.sa_category
              FROM sa_attendance_incidents i
              JOIN sa_profiles p ON p.id = i.sa_profile_id
         LEFT JOIN offices o ON o.id = p.office_id
             WHERE i.semester_id = ? AND i.sa_profile_id IN ($idList)
             ORDER BY i.incident_date DESC, i.id DESC
             LIMIT 15
        ");
        $incStmt->execute([$semesterId]);
        foreach ($incStmt->fetchAll() as $ir) {
            $st = strtoupper((string) ($ir['status'] ?: 'RECORDED'));
            $needsReview = in_array($st, ['RECORDED', 'PENDING', 'DISPUTED'], true)
                || (empty($ir['actual_time_in']) && $ir['category'] !== 'ABSENT')
                || (empty($ir['actual_time_out']) && $ir['category'] !== 'ABSENT');
            if ($needsReview) $pendingVerificationCount++;

            $attendanceRecords[] = [
                'id' => (int) $ir['id'],
                'saId' => (int) $ir['sa_profile_id'],
                'saName' => trim($ir['first_name'] . ' ' . $ir['last_name']),
                'studentId' => $ir['student_id'],
                'location' => ($ir['office_name'] === 'PRMD' ? 'PRD' : $ir['office_name']) ?: $ir['sa_category'],
                'category' => $ir['category'],
                'incidentDate' => $ir['incident_date'],
                'scheduledPeriod' => ($ir['scheduled_start'] && $ir['scheduled_end'])
                    ? format_time($ir['scheduled_start']) . ' – ' . format_time($ir['scheduled_end'])
                    : 'Scheduled Shift',
                'timeIn' => $ir['actual_time_in'] ? format_time($ir['actual_time_in']) : 'Missing',
                'timeOut' => $ir['actual_time_out'] ? format_time($ir['actual_time_out']) : 'Missing',
                'minutesAffected' => (int) ($ir['minutes_affected'] ?? 0),
                'notes' => $ir['evidence_notes'],
                'status' => $st,
                'disciplinaryStatus' => $ir['disciplinary_status'] ?: 'GOOD_STANDING',
                'needsVerification' => $needsReview,
            ];
        }
    }

    // Section C: Evaluation Tasks (Scoped to this Supervisor)
    $evalCampStmt = $pdo->prepare('SELECT * FROM evaluation_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
    $evalCampStmt->execute([$semesterId]);
    $evalCamp = $evalCampStmt->fetch() ?: null;

    $evalTasks = [
        'hasCampaign' => (bool) $evalCamp,
        'campaignTitle' => $evalCamp['title'] ?? null,
        'deadline' => $evalCamp['deadline'] ?? null,
        'assignedTotal' => 0,
        'pendingSubmission' => 0,
        'returnedForRevision' => 0,
        'awaitingSaAck' => 0,
        'awaitingCoordinator' => 0,
        'finalized' => 0,
        'items' => [],
    ];
    if ($evalCamp) {
        $evStmt = $pdo->prepare('
            SELECT e.id, e.sa_profile_id, e.student_name, e.department, e.position_title,
                   e.status, e.acknowledgment_status, e.total_score, e.average_score, e.rating_label,
                   e.recommendation, e.last_return_reason, e.submitted_at, e.ack_due_date,
                   e.coordinator_decision, e.finalized_at,
                   p.student_id, p.course, p.year_level
              FROM sa_evaluations e
              JOIN sa_profiles p ON p.id = e.sa_profile_id
             WHERE e.campaign_id = ?
               AND (e.supervisor_id = ?' . (!empty($scopedSaIds) ? ' OR e.sa_profile_id IN (' . implode(',', array_map('intval', array_values($scopedSaIds))) . ')' : '') . ')
             ORDER BY FIELD(e.status, "RETURNED_FOR_REVISION", "PENDING_SUPERVISOR", "FOR_SA_REVIEW", "FOR_COORDINATOR_REVIEW", "FINALIZED"), e.student_name ASC
        ');
        $evStmt->execute([(int) $evalCamp['id'], $supId]);
        foreach ($evStmt->fetchAll() as $ev) {
            $evalTasks['assignedTotal']++;
            $st = strtoupper((string) $ev['status']);
            if ($st === 'PENDING_SUPERVISOR') $evalTasks['pendingSubmission']++;
            elseif ($st === 'RETURNED_FOR_REVISION') $evalTasks['returnedForRevision']++;
            elseif ($st === 'FOR_SA_REVIEW') $evalTasks['awaitingSaAck']++;
            elseif ($st === 'FOR_COORDINATOR_REVIEW') $evalTasks['awaitingCoordinator']++;
            elseif ($st === 'FINALIZED') $evalTasks['finalized']++;

            $evalTasks['items'][] = [
                'id' => (int) $ev['id'],
                'saId' => (int) $ev['sa_profile_id'],
                'studentName' => $ev['student_name'],
                'studentId' => $ev['student_id'],
                'course' => $ev['course'],
                'yearLevel' => (int) $ev['year_level'],
                'department' => $ev['department'],
                'status' => $st,
                'acknowledgmentStatus' => $ev['acknowledgment_status'],
                'totalScore' => $ev['total_score'] !== null ? (int) $ev['total_score'] : null,
                'averageScore' => $ev['average_score'] !== null ? (float) $ev['average_score'] : null,
                'ratingLabel' => $ev['rating_label'],
                'recommendation' => $ev['recommendation'],
                'returnReason' => $ev['last_return_reason'],
                'submittedAt' => $ev['submitted_at'],
                'ackDueDate' => $ev['ack_due_date'],
                'coordinatorDecision' => $ev['coordinator_decision'],
            ];
        }
    }

    // Section D: Relevant Notifications (Strictly for this Supervisor)
    $notifStmt = $pdo->prepare('
        SELECT n.id, n.type, n.title, n.message, n.link, n.is_read, n.created_at,
               u.full_name AS sender_name
          FROM notifications n
     LEFT JOIN users u ON u.id = n.sender_id
         WHERE n.user_id = ?
         ORDER BY n.id DESC
         LIMIT 12
    ');
    $notifStmt->execute([$supId]);
    $supNotifications = array_map(fn($r) => [
        'id' => (int) $r['id'],
        'type' => $r['type'],
        'title' => $r['title'],
        'message' => $r['message'],
        'link' => $r['link'],
        'isRead' => (bool) $r['is_read'],
        'createdAt' => $r['created_at'],
        'timeAgo' => dashboard_time_ago($r['created_at']),
        'senderName' => $r['sender_name'] ?: 'S.A. Coordinator',
    ], $notifStmt->fetchAll());

    respond([
        'success' => true,
        'supervisor' => $scope,
        'semester' => $sem,
        'publication' => [
            'status' => $pub['status'] ?? 'DRAFT',
            'publishedAt' => $pub['published_at'] ?? null,
            'publishedBy' => $pub['published_by_name'] ?? null,
        ],
        'summaryCards' => [
            'assignedSasCount' => $isPublished ? count($scopedStaff) : 0,
            'assignedLocationsCount' => count($assignedLocations),
            'todayDeploymentsCount' => count($todayDeployments),
            'attendanceVerificationCount' => $pendingVerificationCount,
            'pendingEvaluationsCount' => $evalTasks['pendingSubmission'] + $evalTasks['returnedForRevision'],
        ],
        'todayDeployments' => [
            'dayCode' => $todayCode,
            'dayLabel' => $dayNames[$todayCode] ?? 'Today',
            'date' => $todayDate,
            'items' => $todayDeployments,
            'activeReliefs' => $todayReliefs,
            'assignedLocations' => $assignedLocations,
        ],
        'attendanceVerification' => [
            'pendingCount' => $pendingVerificationCount,
            'records' => $attendanceRecords,
        ],
        'evaluationTasks' => $evalTasks,
        'notifications' => $supNotifications,
    ]);

// ============================================================================
// 3. STUDENT ASSISTANT DASHBOARD (SA ONLY — STRICTLY PERSONAL RECORDS)
// ============================================================================
case 'sa_summary':
    require_role($user, 'SA');

    // Resolve S.A. profile strictly from session user ID (never from request parameters)
    $saStmt = $pdo->prepare(SA_SELECT . ' WHERE p.user_id = ? AND p.archived_at IS NULL LIMIT 1');
    $saStmt->execute([(int) $user['id']]);
    $saRow = $saStmt->fetch();
    if (!$saRow) fail('Your Student Assistant profile was not found. Please contact the S.A. Coordinator.', 404);

    $saId = (int) $saRow['id'];
    sync_sa_from_registrar($saId);
    $saStmt->execute([(int) $user['id']]);
    $saRow = $saStmt->fetch();
    $formattedSa = format_sa($saRow, true);

    $sem = target_semester(null);
    $semesterId = (int) $sem['id'];
    ensure_assigned_office_schedules($semesterId);
    sync_approved_to_assignments($semesterId);
    $pub = publication($semesterId);
    $isPublished = (($pub['status'] ?? 'DRAFT') === 'PUBLISHED');

    // --------------------------------------------------- Section A: My Schedule
    $classesStmt = $pdo->prepare('
        SELECT id, day_of_week, start_time, end_time, subject, section
          FROM class_schedules
         WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NULL
         ORDER BY FIELD(day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), start_time
    ');
    $classesStmt->execute([$semesterId, $saId]);
    $classRows = array_map(fn($c) => [
        'id' => (int) $c['id'],
        'day' => $c['day_of_week'],
        'start' => mins($c['start_time']),
        'end' => mins($c['end_time']),
        'startLabel' => format_time($c['start_time']),
        'endLabel' => format_time($c['end_time']),
        'subject' => $c['subject'],
        'section' => $c['section'],
        'hours' => round((mins($c['end_time']) - mins($c['start_time'])) / 60, 1),
    ], $classesStmt->fetchAll());

    $isOffice = ($saRow['sa_category'] === 'OFFICE' || $saRow['department_type'] === 'OFFICE' || !empty($saRow['office_name']));
    $dutyRows = [];
    $blocks = [];
    $assignedLocation = 'Not assigned yet';
    $assignedSupervisor = 'Pending assignment';

    if ($isPublished) {
        $assignedLocation = $saRow['office_name'] ? ($saRow['office_name'] === 'PRMD' ? 'PRD' : $saRow['office_name']) : 'Not assigned yet';
        $assignedSupervisor = $saRow['supervisor_name'] ?: 'S.A. Coordinator';
        $dutyStmt = $pdo->prepare('
            SELECT a.id, a.day_of_week, a.start_time, a.end_time, a.location, a.department,
                   a.requirement_type, u.full_name AS supervisor_name
              FROM schedule_assignments a
         LEFT JOIN users u ON u.id = a.supervisor_id
             WHERE a.semester_id = ? AND a.sa_profile_id = ?
             ORDER BY FIELD(a.day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), a.start_time
        ');
        $dutyStmt->execute([$semesterId, $saId]);
        $locs = [];
        foreach ($dutyStmt as $d) {
            $s = mins($d['start_time']);
            $e = mins($d['end_time']);
            $hours = round(($e - $s) / 60, 1);
            $credited = credited_hours($hours, $d['day_of_week'], $isOffice, $s, $e);
            $loc = $d['location'];
            $locs[$loc] = $loc;
            if (!empty($d['supervisor_name']) && $assignedSupervisor === 'S.A. Coordinator') {
                $assignedSupervisor = $d['supervisor_name'];
            }
            $dutyRows[] = [
                'id' => (int) $d['id'],
                'day' => $d['day_of_week'],
                'start' => $s,
                'end' => $e,
                'startLabel' => format_time($d['start_time']),
                'endLabel' => format_time($d['end_time']),
                'location' => $loc,
                'department' => $d['department'],
                'hours' => $hours,
                'credited' => $credited,
                'hasBreak' => $credited < $hours,
            ];
        }
        $dutyRows = credit_once_per_day($dutyRows, $isOffice);
        $byDay = [];
        foreach ($dutyRows as $d) $byDay[$d['day'] . '|' . $d['location']][] = [$d['start'], $d['end']];
        foreach ($byDay as $key => $spans) {
            [$day, $where] = explode('|', $key, 2);
            foreach (merge_spans($spans) as $sp) {
                $blk = duty_block($day, $sp[0], $sp[1], $isOffice);
                $blk['location'] = $where;
                $blk['roleBadge'] = stripos($where, 'Reliever') !== false ? 'RELIEVER' : 'PRIMARY';
                $blocks[] = $blk;
            }
        }
        $blocks = credit_once_per_day($blocks, $isOffice);

        if ($locs) {
            $locList = array_values($locs);
            usort($locList, function ($a, $b) {
                $aRel = stripos($a, 'Reliever') !== false ? 1 : 0;
                $bRel = stripos($b, 'Reliever') !== false ? 1 : 0;
                return ($aRel !== $bRel) ? ($aRel <=> $bRel) : strnatcasecmp($a, $b);
            });
            $assignedLocation = implode(' + ', $locList);
        }
    }

    $rawDutyHours = round(array_sum(array_column($blocks, 'hours')), 1);
    $creditedDutyHours = round(array_sum(array_column($blocks, 'credited')), 1);
    $classHours = round(array_sum(array_column($classRows, 'hours')), 1);

    // Compute Next Scheduled Duty & Today's Schedule
    $dayMap = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    $dayNames = [
        'SUN' => 'Sunday', 'MON' => 'Monday', 'TUE' => 'Tuesday', 'WED' => 'Wednesday',
        'THU' => 'Thursday', 'FRI' => 'Friday', 'SAT' => 'Saturday',
    ];
    $todayIdx = (int) date('w');
    $todayCode = $dayMap[$todayIdx] ?? 'MON';
    $nowMins = ((int) date('G')) * 60 + ((int) date('i'));

    $todayDuty = array_values(array_filter($blocks, fn($b) => $b['day'] === $todayCode));
    $todayClasses = array_values(array_filter($classRows, fn($c) => $c['day'] === $todayCode));

    $nextDuty = null;
    if (!empty($blocks)) {
        // Check remaining/current blocks today first, then scan next 7 days
        for ($offset = 0; $offset < 7; $offset++) {
            $dIdx = ($todayIdx + $offset) % 7;
            $dCode = $dayMap[$dIdx];
            $dayBlocks = array_values(array_filter($blocks, fn($b) => $b['day'] === $dCode));
            usort($dayBlocks, fn($a, $b) => $a['start'] <=> $b['start']);
            foreach ($dayBlocks as $db) {
                if ($offset === 0 && $db['end'] <= $nowMins) continue;
                $isOngoing = ($offset === 0 && $db['start'] <= $nowMins && $db['end'] > $nowMins);
                $nextDuty = [
                    'dayCode' => $dCode,
                    'dayLabel' => $offset === 0 ? 'Today (' . $dayNames[$dCode] . ')' : ($offset === 1 ? 'Tomorrow (' . $dayNames[$dCode] . ')' : $dayNames[$dCode]),
                    'location' => $db['location'],
                    'roleBadge' => stripos((string) $db['location'], 'Reliever') !== false ? 'RELIEVER' : 'PRIMARY',
                    'startLabel' => $db['startLabel'],
                    'endLabel' => $db['endLabel'],
                    'creditedHours' => $db['credited'],
                    'statusLabel' => $isOngoing ? 'ON DUTY NOW' : ($offset === 0 ? 'UPCOMING TODAY' : 'NEXT SCHEDULED DUTY'),
                ];
                break 2;
            }
        }
    }

    // Recent official schedule changes for this S.A.
    $chgStmt = $pdo->prepare('
        SELECT id, change_type, previous_value, new_value, effective_date, reason, created_at
          FROM schedule_changes
         WHERE semester_id = ? AND sa_profile_id = ?
         ORDER BY id DESC LIMIT 5
    ');
    $chgStmt->execute([$semesterId, $saId]);
    $recentScheduleChanges = array_map(fn($ch) => [
        'id' => (int) $ch['id'],
        'changeType' => $ch['change_type'],
        'newValue' => $ch['new_value'],
        'effectiveDate' => $ch['effective_date'],
        'reason' => $ch['reason'],
        'createdAt' => $ch['created_at'],
    ], $chgStmt->fetchAll());

    // --------------------------------------------------- Section B: My Attendance
    $incStmt = $pdo->prepare('
        SELECT id, category, incident_date, scheduled_start, scheduled_end,
               actual_time_in, actual_time_out, minutes_affected, evidence_notes, correction_notes, status, created_at
          FROM sa_attendance_incidents
         WHERE semester_id = ? AND sa_profile_id = ?
         ORDER BY incident_date DESC, id DESC
         LIMIT 10
    ');
    $incStmt->execute([$semesterId, $saId]);
    $myIncidents = array_map(fn($ir) => [
        'id' => (int) $ir['id'],
        'category' => $ir['category'],
        'incidentDate' => $ir['incident_date'],
        'scheduledPeriod' => ($ir['scheduled_start'] && $ir['scheduled_end'])
            ? format_time($ir['scheduled_start']) . ' – ' . format_time($ir['scheduled_end'])
            : 'Scheduled Duty',
        'timeIn' => $ir['actual_time_in'] ? format_time($ir['actual_time_in']) : '—',
        'timeOut' => $ir['actual_time_out'] ? format_time($ir['actual_time_out']) : '—',
        'minutesAffected' => (int) ($ir['minutes_affected'] ?? 0),
        'notes' => $ir['evidence_notes'],
        'correctionNotes' => $ir['correction_notes'],
        'status' => strtoupper((string) ($ir['status'] ?: 'RECORDED')),
    ], $incStmt->fetchAll());

    $memosStmt = $pdo->prepare('
        SELECT id, memo_ref_no, warning_level, violation_category, issued_date, status, acknowledged_at
          FROM sa_warning_memos
         WHERE sa_profile_id = ?
         ORDER BY id DESC LIMIT 5
    ');
    $memosStmt->execute([$saId]);
    $myWarningMemos = array_map(fn($m) => [
        'id' => (int) $m['id'],
        'refNo' => $m['memo_ref_no'],
        'warningLevel' => $m['warning_level'],
        'category' => $m['violation_category'],
        'issuedDate' => $m['issued_date'],
        'status' => $m['status'],
        'acknowledgedAt' => $m['acknowledged_at'],
    ], $memosStmt->fetchAll());

    $discStatus = $saRow['disciplinary_status'] ?: 'GOOD_STANDING';

    // --------------------------------------------------- Section C: My Allowance
    $effectiveRate = (float) ($formattedSa['benefits']['effectiveHourlyRate'] ?? DEFAULT_HOURLY_RATE);
    $approvedHoursForCalc = $creditedDutyHours > 0 ? $creditedDutyHours : (float) ($saRow['weekly_target_hours'] ?: 35.0);
    $estWeekly = round($approvedHoursForCalc * $effectiveRate, 2);
    $estBiweekly = round($estWeekly * 2, 2);
    $estMonthly = round($estWeekly * 4, 2);

    // Check active deduction campaign & S.A.'s own response
    $dedCampStmt = $pdo->prepare('SELECT * FROM deduction_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
    $dedCampStmt->execute([$semesterId]);
    $dedCamp = $dedCampStmt->fetch() ?: null;
    $myDedResponse = null;
    if ($dedCamp) {
        $drStmt = $pdo->prepare('SELECT choice, amount, notes, status, replied_at FROM deduction_responses WHERE campaign_id = ? AND sa_profile_id = ? LIMIT 1');
        $drStmt->execute([(int) $dedCamp['id'], $saId]);
        $myDedResponse = $drStmt->fetch() ?: null;
    }

    $myAllowance = [
        'hourlyRate' => $effectiveRate,
        'isCustomRate' => $saRow['hourly_rate'] !== null,
        'approvedCreditedHours' => $creditedDutyHours,
        'targetWeeklyHours' => (float) ($saRow['weekly_target_hours'] ?: 35.0),
        'hoursBasisLabel' => $creditedDutyHours > 0 ? 'Approved Published Duty Hours' : 'Target Weekly Hours (Schedule Pending)',
        'estimatedWeekly' => $estWeekly,
        'estimatedBiweekly' => $estBiweekly,
        'estimatedMonthly' => $estMonthly,
        'allowanceStatus' => 'ESTIMATED',
        'allowanceNotice' => 'Estimated amounts are based on scheduled credited duty hours. Final released allowance requires verified attendance reconciliation and Coordinator payroll approval.',
        'benefits' => $formattedSa['benefits'],
        'deductionCampaign' => $dedCamp ? [
            'id' => (int) $dedCamp['id'],
            'title' => $dedCamp['title'],
            'status' => $dedCamp['status'],
            'deadline' => $dedCamp['deadline'],
            'myResponse' => $myDedResponse ? [
                'choice' => $myDedResponse['choice'],
                'amount' => (float) $myDedResponse['amount'],
                'notes' => $myDedResponse['notes'],
                'status' => $myDedResponse['status'],
                'repliedAt' => $myDedResponse['replied_at'],
            ] : null,
        ] : null,
    ];

    // --------------------------------------------------- Section D: My Pending Actions
    $myPendingActions = [];

    // 1. Check Performance Evaluation for this S.A.
    $evStmt = $pdo->prepare('
        SELECT e.id, e.status, e.acknowledgment_status, e.total_score, e.average_score, e.rating_label,
               e.recommendation, e.supervisor_name, e.submitted_at, e.ack_due_date, e.extension_status,
               e.coordinator_decision, e.finalized_at, c.title AS campaign_title
          FROM sa_evaluations e
          JOIN evaluation_campaigns c ON c.id = e.campaign_id
         WHERE e.sa_profile_id = ? AND e.semester_id = ?
         ORDER BY e.id DESC LIMIT 1
    ');
    $evStmt->execute([$saId, $semesterId]);
    $myEval = $evStmt->fetch() ?: null;

    if ($myEval) {
        if ($myEval['status'] === 'FOR_SA_REVIEW') {
            $myPendingActions[] = [
                'key' => 'EVAL_ACKNOWLEDGMENT',
                'type' => 'EVALUATION',
                'priority' => 'HIGH',
                'title' => 'Acknowledge Your Semester Performance Evaluation',
                'badge' => $myEval['ack_due_date'] ? 'Due ' . date('M j, Y', strtotime($myEval['ack_due_date'])) : 'Action Required',
                'detail' => 'Supervisor ' . $myEval['supervisor_name'] . ' submitted your evaluation (' . ($myEval['rating_label'] ?: 'Rated') . '). Review ratings, optionally add comments/concerns, and sign to acknowledge receipt.',
                'to' => '/sa/evaluations',
                'actionLabel' => 'Review & Sign Evaluation',
            ];
        } elseif ($myEval['status'] === 'FOR_COORDINATOR_REVIEW') {
            $myPendingActions[] = [
                'key' => 'EVAL_AWAITING_COORD',
                'type' => 'EVALUATION_INFO',
                'priority' => 'INFO',
                'title' => 'Evaluation Acknowledged — Awaiting Coordinator Final Decision',
                'badge' => 'Step 3–4 In Progress',
                'detail' => 'You have signed and acknowledged your evaluation. The S.A. Coordinator is reviewing it for the official final decision.',
                'to' => '/sa/evaluations',
                'actionLabel' => 'View Evaluation Status',
            ];
        } elseif ($myEval['status'] === 'FINALIZED') {
            $myPendingActions[] = [
                'key' => 'EVAL_FINALIZED',
                'type' => 'EVALUATION_DONE',
                'priority' => 'SUCCESS',
                'title' => 'Finalized Performance Evaluation Result Available',
                'badge' => str_replace('_', ' ', (string) ($myEval['coordinator_decision'] ?: 'FINALIZED')),
                'detail' => 'The S.A. Coordinator has recorded the official final decision on your semester performance evaluation.',
                'to' => '/sa/evaluations',
                'actionLabel' => 'View Final Result',
            ];
        }
    }

    // 2. Check open School Balance Deduction Campaign awaiting S.A. response
    if ($dedCamp && $dedCamp['status'] === 'OPEN' && !$myDedResponse) {
        $balAmt = (float) ($formattedSa['benefits']['balance'] ?? 0);
        $myPendingActions[] = [
            'key' => 'SCHOOL_BALANCE_POLL',
            'type' => 'DEDUCTION',
            'priority' => 'HIGH',
            'title' => 'Respond to School Balance Allowance Deduction Announcement',
            'badge' => $dedCamp['deadline'] ? 'Deadline ' . date('M j, Y', strtotime($dedCamp['deadline'])) : 'YES / NO Required',
            'detail' => 'Indicate whether you want your remaining school balance (₱' . number_format($balAmt, 2) . ') deducted from your S.A. allowance for "' . $dedCamp['title'] . '".',
            'to' => '/sa/school-balance',
            'actionLabel' => 'Answer YES or NO',
        ];
    }

    // 3. Check unacknowledged Warning Memos
    foreach ($myWarningMemos as $wm) {
        if ($wm['status'] === 'ISSUED' && empty($wm['acknowledgedAt'])) {
            $myPendingActions[] = [
                'key' => 'WARNING_MEMO_' . $wm['id'],
                'type' => 'ATTENDANCE_MEMO',
                'priority' => 'HIGH',
                'title' => 'Review Issued Attendance Warning Memo (' . str_replace('_', ' ', $wm['warningLevel']) . ')',
                'badge' => $wm['refNo'],
                'detail' => 'Issued on ' . $wm['issuedDate'] . ' regarding ' . $wm['category'] . '. Review the memo details in your profile.',
                'to' => '/sa/profile',
                'actionLabel' => 'View Warning Memo',
            ];
        }
    }

    // --------------------------------------------------- Section E: My Notifications
    $notifStmt = $pdo->prepare('
        SELECT n.id, n.type, n.title, n.message, n.link, n.is_read, n.created_at,
               u.full_name AS sender_name
          FROM notifications n
     LEFT JOIN users u ON u.id = n.sender_id
         WHERE n.user_id = ?
         ORDER BY n.id DESC
         LIMIT 12
    ');
    $notifStmt->execute([(int) $user['id']]);
    $myNotifications = array_map(fn($r) => [
        'id' => (int) $r['id'],
        'type' => $r['type'],
        'title' => $r['title'],
        'message' => $r['message'],
        'link' => $r['link'],
        'isRead' => (bool) $r['is_read'],
        'createdAt' => $r['created_at'],
        'timeAgo' => dashboard_time_ago($r['created_at']),
        'senderName' => $r['sender_name'] ?: 'S.A. Coordinator',
    ], $notifStmt->fetchAll());

    $actionRequiredCount = count(array_filter($myPendingActions, fn($a) => $a['priority'] === 'HIGH'));

    respond([
        'success' => true,
        'semester' => $sem,
        'publication' => [
            'status' => $pub['status'] ?? 'DRAFT',
            'publishedAt' => $pub['published_at'] ?? null,
            'publishedBy' => $pub['published_by_name'] ?? null,
        ],
        'profile' => [
            'id' => $saId,
            'studentId' => $saRow['student_id'],
            'saNumber' => $saRow['sa_number'],
            'name' => sa_full_name($saRow),
            'course' => $saRow['course'],
            'yearLevel' => (int) $saRow['year_level'],
            'category' => $saRow['sa_category'],
            'department' => $saRow['department_type'],
            'officeName' => $assignedLocation,
            'supervisorName' => $assignedSupervisor,
            'assignmentStatus' => $saRow['assignment_status'],
            'disciplinaryStatus' => $discStatus,
        ],
        'mySchedule' => [
            'isPublished' => $isPublished,
            'nextDuty' => $nextDuty,
            'todayCode' => $todayCode,
            'todayLabel' => $dayNames[$todayCode] ?? 'Today',
            'todayDuty' => $todayDuty,
            'todayClasses' => $todayClasses,
            'assignedLocation' => $assignedLocation,
            'supervisorName' => $assignedSupervisor,
            'assignmentStatus' => $saRow['assignment_status'],
            'creditedHours' => $creditedDutyHours,
            'rawHours' => $rawDutyHours,
            'classHours' => $classHours,
            'blocksCount' => count($blocks),
            'classesCount' => count($classRows),
            'recentChanges' => $recentScheduleChanges,
        ],
        'myAttendance' => [
            'disciplinaryStatus' => $discStatus,
            'underAgreementAt' => $saRow['under_agreement_at'],
            'incidentsCount' => count($myIncidents),
            'incidents' => $myIncidents,
            'warningMemos' => $myWarningMemos,
        ],
        'myAllowance' => $myAllowance,
        'myPendingActions' => $myPendingActions,
        'actionRequiredCount' => $actionRequiredCount,
        'myNotifications' => $myNotifications,
    ]);

default:
    fail('Unknown dashboard action.', 400);
}
