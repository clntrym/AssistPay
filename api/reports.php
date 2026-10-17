<?php
// AssistPay — Reports & Analytics API Endpoint
// Provides comprehensive reporting data across Attendance, Allowance, School Balance,
// S.A. Summary, Schedule & Duty Coverage, and Exceptions & Audit.

require_once __DIR__ . '/_bootstrap.php';

$user = require_auth();
require_role($user, 'ADMIN', 'SUPERVISOR');

$in = input();
$action = trim((string)($in['action'] ?? 'overview'));

// Strict Role Guard: Supervisors can ONLY call supervisor_ report actions
if ($user['role'] === 'SUPERVISOR') {
    if (!str_starts_with($action, 'supervisor_')) {
        fail('Forbidden: Supervisors can only access operational attendance reports for their assigned team.', 403);
    }
}

if (!function_exists('ok')) {
    function ok(array $data): never {
        respond(['success' => true] + $data);
    }
}

if (!function_exists('get_supervisor_scope')) {
    function get_supervisor_scope(PDO $pdo, int $userId): ?array
    {
        $stmt = $pdo->prepare("
            SELECT u.id, u.username, u.full_name, u.first_name, u.last_name, u.supervisor_category, u.office_id, o.name AS primary_office_name
              FROM users u
         LEFT JOIN offices o ON o.id = u.office_id
             WHERE u.id = ? AND u.role = 'SUPERVISOR'
        ");
        $stmt->execute([$userId]);
        $sup = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$sup) return null;

        $officeIds = [];
        $officeNames = [];
        if ($sup['office_id']) {
            $officeIds[] = (int)$sup['office_id'];
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
        $soStmt->execute([$userId]);
        foreach ($soStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $oid = (int)$r['office_id'];
            $oname = $r['office_name'] === 'PRMD' ? 'PRD' : $r['office_name'];
            if (!in_array($oid, $officeIds, true)) $officeIds[] = $oid;
            if (!in_array($oname, $officeNames, true)) $officeNames[] = $oname;
        }

        $cat = strtoupper((string)($sup['supervisor_category'] ?? 'OFFICE'));
        if ($cat === 'ITO' && !in_array('ITO', $officeNames, true)) {
            $officeNames[] = 'ITO';
        } elseif ($cat === 'ACADS' && !in_array('ACADS', $officeNames, true)) {
            $officeNames[] = 'ACADS';
        }

        $primaryDept = !empty($officeNames) ? $officeNames[0] : ($cat ?: 'Office');
        $deptDisplayName = ($primaryDept === 'HR') ? 'HR Department' : ($primaryDept . (str_ends_with(strtoupper($primaryDept), 'DEPARTMENT') || str_ends_with(strtoupper($primaryDept), 'OFFICE') ? '' : ' Department'));

        return [
            'id' => (int)$sup['id'],
            'empId' => $sup['username'],
            'name' => $sup['full_name'],
            'category' => $cat,
            'officeIds' => $officeIds,
            'departments' => $officeNames,
            'primaryDept' => $primaryDept,
            'deptDisplayName' => $deptDisplayName,
            'scopeLabel' => implode(', ', $officeNames) ?: $cat,
        ];
    }
}

if (!function_exists('get_supervisor_assigned_sas')) {
    function get_supervisor_assigned_sas(PDO $pdo, array $scope): array
    {
        $supId = (int)$scope['id'];
        $cat = $scope['category'];
        $primaryOid = $scope['officeIds'][0] ?? 0;

        $stmt = $pdo->prepare("
            SELECT p.id as sa_profile_id, p.student_id, p.sa_number, p.first_name, p.last_name, p.suffix,
                   p.course, p.year_level, p.department_type, p.sa_category, p.hourly_rate,
                   p.office_id, p.supervisor_id, o.name AS office_name,
                   sup.full_name AS supervisor_name, b.photo_path AS biometric_photo
            FROM sa_profiles p
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN users sup ON sup.id = p.supervisor_id
            LEFT JOIN sa_biometrics b ON b.sa_profile_id = p.id
            WHERE p.sa_status = 'ACTIVE' AND p.archived_at IS NULL AND (
                p.supervisor_id = ?
                OR (? = 'ITO' AND (p.sa_category = 'ITO' OR p.department_type = 'ITO'))
                OR (? = 'ACADS' AND (p.sa_category = 'ACADS' OR p.department_type = 'ACADS'))
                OR (p.office_id IS NOT NULL AND p.office_id = ?)
                OR (p.office_id IN (SELECT office_id FROM supervisor_offices WHERE supervisor_id = ?))
            )
            ORDER BY p.last_name, p.first_name ASC
        ");
        $stmt->execute([$supId, $cat, $cat, $primaryOid, $supId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}

// Helper: Get Active Semester
function get_active_semester(PDO $pdo): ?array {
    $stmt = $pdo->query('SELECT * FROM semesters WHERE status = "ACTIVE" ORDER BY id DESC LIMIT 1');
    $sem = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($sem) {
        $sem['label'] = trim(($sem['term'] ? $sem['term'] . ' Semester ' : '') . 'AY ' . ($sem['academic_year'] ?? ''));
    }
    return $sem ?: null;
}

// Helper: Sanitize & Validate Date Range
function validate_date_range(?string $start, ?string $end): array {
    $s = !empty($start) ? trim($start) : null;
    $e = !empty($end) ? trim($end) : null;

    if ($s && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
        fail('Invalid start date format. Expected YYYY-MM-DD.', 422);
    }
    if ($e && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $e)) {
        fail('Invalid end date format. Expected YYYY-MM-DD.', 422);
    }
    if ($s && $e && $s > $e) {
        fail('Start date cannot be later than end date.', 422);
    }
    return [$s, $e];
}

switch ($action) {

    // =========================================================================
    // 1. OVERVIEW & LANDING PAGE DASHBOARD
    // =========================================================================
    case 'overview': {
        $activeSem = get_active_semester($pdo);
        $activeSemId = $activeSem ? (int)$activeSem['id'] : 0;

        // Semesters list for dropdown
        $allSemStmt = $pdo->query('SELECT id, academic_year, term, start_date, end_date, status FROM semesters ORDER BY start_date DESC');
        $allSemesters = [];
        foreach ($allSemStmt->fetchAll(PDO::FETCH_ASSOC) as $s) {
            $s['label'] = trim(($s['term'] ? $s['term'] . ' Semester ' : '') . 'AY ' . ($s['academic_year'] ?? ''));
            $allSemesters[] = $s;
        }

        // Active S.A. counts
        $saStmt = $pdo->query('
            SELECT 
                COUNT(*) as total_sas,
                SUM(CASE WHEN sa_status = "ACTIVE" THEN 1 ELSE 0 END) as active_sas,
                SUM(CASE WHEN sa_category = "ITO" THEN 1 ELSE 0 END) as ito_count,
                SUM(CASE WHEN sa_category = "ACADS" THEN 1 ELSE 0 END) as acads_count,
                SUM(CASE WHEN sa_category = "OFFICE" THEN 1 ELSE 0 END) as office_count,
                SUM(weekly_target_hours) as total_weekly_target_hours
            FROM sa_profiles 
            WHERE archived_at IS NULL
        ');
        $saMetrics = $saStmt->fetch(PDO::FETCH_ASSOC) ?: [];

        // Weekly scheduled hours from assignments
        $schedStmt = $pdo->prepare('
            SELECT 
                COUNT(*) as total_assignments,
                SUM(ROUND(TIME_TO_SEC(TIMEDIFF(end_time, start_time)) / 3600, 2)) as total_scheduled_hours
            FROM schedule_assignments
            WHERE semester_id = ?
        ');
        $schedStmt->execute([$activeSemId]);
        $schedMetrics = $schedStmt->fetch(PDO::FETCH_ASSOC) ?: [];

        // Credited hours from reconciliations
        $recStmt = $pdo->prepare('
            SELECT 
                COUNT(*) as total_reconciliations,
                SUM(credited_hours) as total_credited_hours,
                SUM(overtime_hours) as total_overtime_hours,
                SUM(CASE WHEN reconciliation_status IN ("PENDING_REVIEW", "FLAGGED") THEN 1 ELSE 0 END) as pending_reconciliations
            FROM sa_attendance_reconciliations
            WHERE semester_id = ?
        ');
        $recStmt->execute([$activeSemId]);
        $recMetrics = $recStmt->fetch(PDO::FETCH_ASSOC) ?: [];

        // Allowance calculations
        $allowStmt = $pdo->query('
            SELECT 
                SUM(p.weekly_target_hours * COALESCE(p.hourly_rate, 8.00) * 4) as projected_monthly_allowance,
                AVG(COALESCE(p.hourly_rate, 8.00)) as avg_hourly_rate
            FROM sa_profiles p
            WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL
        ');
        $allowMetrics = $allowStmt->fetch(PDO::FETCH_ASSOC) ?: [];

        // Finalized allowance from latest endorsements
        $endorsedStmt = $pdo->prepare('
            SELECT 
                SUM(total_allowance) as total_endorsed_allowance,
                COUNT(*) as total_endorsements
            FROM allowance_endorsements
            WHERE semester_id = ? AND status = "ENDORSED"
        ');
        $endorsedStmt->execute([$activeSemId]);
        $endorsedMetrics = $endorsedStmt->fetch(PDO::FETCH_ASSOC) ?: [];

        // School Balances & Deductions
        $balStmt = $pdo->query('
            SELECT 
                COUNT(b.id) as total_assessed_sas,
                SUM(b.tuition_fee + b.misc_fee) as total_cash_cor,
                SUM((b.tuition_fee * (b.tuition_coverage_pct / 100)) + (b.misc_fee * (b.misc_coverage_pct / 100))) as total_covered,
                SUM((b.tuition_fee * (1 - (b.tuition_coverage_pct / 100))) + (b.misc_fee * (1 - (b.misc_coverage_pct / 100)))) as total_balance
            FROM sa_benefits b
            JOIN sa_profiles p ON p.id = b.sa_profile_id AND p.archived_at IS NULL
        ');
        $balMetrics = $balStmt->fetch(PDO::FETCH_ASSOC) ?: [];

        // Deduction Responses
        $campStmt = $pdo->prepare('
            SELECT 
                SUM(CASE WHEN r.choice = "YES" THEN 1 ELSE 0 END) as yes_count,
                SUM(CASE WHEN r.choice = "NO" THEN 1 ELSE 0 END) as no_count,
                SUM(CASE WHEN r.choice IS NULL OR r.choice = "" THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN r.choice = "YES" THEN r.authorized_amount ELSE 0 END) as authorized_amount,
                SUM(CASE WHEN r.choice = "YES" THEN r.processed_amount ELSE 0 END) as processed_amount
            FROM deduction_responses r
            JOIN deduction_campaigns c ON c.id = r.campaign_id AND c.semester_id = ?
        ');
        $campStmt->execute([$activeSemId]);
        $respMetrics = $campStmt->fetch(PDO::FETCH_ASSOC) ?: [];

        // Schedule coverage gaps
        $gapStmt = $pdo->prepare('
            SELECT COUNT(*) as unassigned_slots
            FROM match_slots
            WHERE run_id = (SELECT id FROM matching_runs WHERE semester_id = ? ORDER BY id DESC LIMIT 1)
              AND (assigned_sa_profile_id IS NULL OR status = "UNASSIGNED")
        ');
        $gapStmt->execute([$activeSemId]);
        $gapMetrics = $gapStmt->fetch(PDO::FETCH_ASSOC) ?: ['unassigned_slots' => 0];

        // Exceptions / Requests pending
        $reqStmt = $pdo->prepare('
            SELECT COUNT(*) as pending_requests
            FROM sa_requests
            WHERE semester_id = ? AND status IN ("SUBMITTED", "PENDING_SUPERVISOR", "PENDING_COORDINATOR")
        ');
        $reqStmt->execute([$activeSemId]);
        $reqMetrics = $reqStmt->fetch(PDO::FETCH_ASSOC) ?: ['pending_requests' => 0];

        ok([
            'activeSemester' => $activeSem,
            'semesters' => $allSemesters,
            'metrics' => [
                'totalSas' => (int)($saMetrics['total_sas'] ?? 0),
                'activeSas' => (int)($saMetrics['active_sas'] ?? 0),
                'weeklyScheduledHours' => (float)($schedMetrics['total_scheduled_hours'] ?? 0),
                'totalCreditedHours' => (float)($recMetrics['total_credited_hours'] ?? 0),
                'projectedMonthlyAllowance' => (float)($allowMetrics['projected_monthly_allowance'] ?? 0),
                'endorsedAllowance' => (float)($endorsedMetrics['total_endorsed_allowance'] ?? 0),
                'totalSchoolBalance' => (float)($balMetrics['total_balance'] ?? 0),
                'totalConfirmedDeductions' => (float)($respMetrics['processed_amount'] ?? 0),
                'yesCount' => (int)($respMetrics['yes_count'] ?? 0),
                'noCount' => (int)($respMetrics['no_count'] ?? 0),
                'coverageGaps' => (int)($gapMetrics['unassigned_slots'] ?? 0),
                'pendingExceptions' => (int)($recMetrics['pending_reconciliations'] ?? 0) + (int)($reqMetrics['pending_requests'] ?? 0)
            ],
            'lastRefreshed' => date('Y-m-d H:i:s'),
            'coordinatorName' => $user['full_name'] ?? 'Ansherina A Sudario'
        ]);
        break;
    }

    // =========================================================================
    // 2. ATTENDANCE & DUTY HOURS REPORT
    // =========================================================================
    case 'attendance_report': {
        $activeSem = get_active_semester($pdo);
        $semId = (int)($in['semester_id'] ?? ($activeSem['id'] ?? 0));
        [$startDate, $endDate] = validate_date_range($in['start_date'] ?? null, $in['end_date'] ?? null);
        $deptFilter = trim((string)($in['department'] ?? 'ALL'));
        $statusFilter = trim((string)($in['status'] ?? 'ALL'));
        $reconFilter = trim((string)($in['reconciliation_status'] ?? 'ALL'));
        $search = trim((string)($in['search'] ?? ''));

        // Query Reconciliations joined with S.A. Profiles and assignments
        $where = ['p.archived_at IS NULL'];
        $params = [];

        if ($semId > 0) {
            $where[] = '(r.semester_id = ? OR r.semester_id IS NULL)';
            $params[] = $semId;
        }
        if ($startDate) {
            $where[] = 'r.duty_date >= ?';
            $params[] = $startDate;
        }
        if ($endDate) {
            $where[] = 'r.duty_date <= ?';
            $params[] = $endDate;
        }
        if ($deptFilter !== 'ALL' && $deptFilter !== '') {
            $where[] = '(p.sa_category = ? OR p.department_type = ? OR a.department = ?)';
            $params[] = $deptFilter;
            $params[] = $deptFilter;
            $params[] = $deptFilter;
        }
        if ($statusFilter !== 'ALL' && $statusFilter !== '') {
            $where[] = 'r.status = ?';
            $params[] = $statusFilter;
        }
        if ($reconFilter !== 'ALL' && $reconFilter !== '') {
            $where[] = 'r.reconciliation_status = ?';
            $params[] = $reconFilter;
        }
        if ($search !== '') {
            $where[] = '(CONCAT(p.first_name, " ", p.last_name) LIKE ? OR p.student_id LIKE ? OR p.sa_number LIKE ? OR p.course LIKE ?)';
            $like = '%' . $search . '%';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $sql = '
            SELECT 
                r.id as recon_id,
                r.duty_date,
                r.status as attendance_status,
                r.reconciliation_status,
                r.scheduled_start,
                r.scheduled_end,
                r.actual_time_in,
                r.actual_time_out,
                r.recorded_hours,
                r.credited_hours,
                r.late_minutes,
                r.overtime_hours,
                r.face_verified,
                r.gps_verified,
                r.verification_notes,
                p.id as sa_profile_id,
                p.student_id,
                p.sa_number,
                p.first_name,
                p.last_name,
                p.course,
                p.year_level,
                p.sa_category,
                p.department_type,
                COALESCE(o.name, a.department, p.department_type) as post_name,
                sup.full_name as supervisor_name
            FROM sa_attendance_reconciliations r
            JOIN sa_profiles p ON p.id = r.sa_profile_id
            LEFT JOIN schedule_assignments a ON a.id = r.assignment_id
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN users sup ON sup.id = p.supervisor_id
            WHERE ' . implode(' AND ', $where) . '
            ORDER BY r.duty_date DESC, p.last_name ASC, p.first_name ASC
            LIMIT 500
        ';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Fallback: If no records exist in sa_attendance_reconciliations, synthesize live monitoring view from sa_attendance_logs & schedule_assignments
        if (empty($rows)) {
            $logWhere = ['p.sa_status = "ACTIVE"', 'p.archived_at IS NULL'];
            $logParams = [];
            if ($deptFilter !== 'ALL' && $deptFilter !== '') {
                $logWhere[] = '(p.sa_category = ? OR p.department_type = ?)';
                $logParams[] = $deptFilter;
                $logParams[] = $deptFilter;
            }
            if ($search !== '') {
                $logWhere[] = '(CONCAT(p.first_name, " ", p.last_name) LIKE ? OR p.student_id LIKE ? OR p.sa_number LIKE ?)';
                $like = '%' . $search . '%';
                $logParams[] = $like;
                $logParams[] = $like;
                $logParams[] = $like;
            }

            $liveStmt = $pdo->prepare('
                SELECT 
                    p.id as sa_profile_id, p.student_id, p.sa_number, p.first_name, p.last_name, p.course, p.year_level,
                    p.sa_category, p.department_type, o.name as post_name, sup.full_name as supervisor_name
                FROM sa_profiles p
                LEFT JOIN offices o ON o.id = p.office_id
                LEFT JOIN users sup ON sup.id = p.supervisor_id
                WHERE ' . implode(' AND ', $logWhere) . '
                ORDER BY p.last_name, p.first_name
                LIMIT 100
            ');
            $liveStmt->execute($logParams);
            $activeSas = $liveStmt->fetchAll(PDO::FETCH_ASSOC);

            // Check if there are any logs for today or selected date
            $targetDate = $startDate ?: ($endDate ?: date('Y-m-d'));
            $logDateStmt = $pdo->prepare('SELECT * FROM sa_attendance_logs WHERE DATE(logged_at) = ?');
            $logDateStmt->execute([$targetDate]);
            $dayLogs = [];
            foreach ($logDateStmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
                $dayLogs[(int)$l['sa_profile_id']][] = $l;
            }

            foreach ($activeSas as $sa) {
                $sid = (int)$sa['sa_profile_id'];
                $userLogs = $dayLogs[$sid] ?? [];
                $cin = null;
                $cout = null;
                foreach ($userLogs as $l) {
                    if ($l['log_type'] === 'CHECK_IN' && !$cin) $cin = $l;
                    if ($l['log_type'] === 'CHECK_OUT') $cout = $l;
                }

                $status = 'SCHEDULED';
                $credited = 0.0;
                $recorded = 0.0;
                $ot = 0.0;
                $reconStatus = 'PENDING_LOG';

                if ($cin && $cout) {
                    $status = 'PRESENT';
                    $recorded = round((strtotime($cout['logged_at']) - strtotime($cin['logged_at'])) / 3600, 2);
                    $credited = min($recorded, 4.0); // max duty credited
                    $reconStatus = 'VERIFIED';
                } elseif ($cin) {
                    $status = 'INCOMPLETE';
                    $reconStatus = 'PENDING_REVIEW';
                }

                $rows[] = [
                    'recon_id' => 0,
                    'duty_date' => $targetDate,
                    'attendance_status' => $status,
                    'reconciliation_status' => $reconStatus,
                    'scheduled_start' => '08:00:00',
                    'scheduled_end' => '12:00:00',
                    'actual_time_in' => $cin ? date('H:i:s', strtotime($cin['logged_at'])) : null,
                    'actual_time_out' => $cout ? date('H:i:s', strtotime($cout['logged_at'])) : null,
                    'recorded_hours' => $recorded,
                    'credited_hours' => $credited,
                    'late_minutes' => 0,
                    'overtime_hours' => $ot,
                    'face_verified' => $cin ? (bool)($cin['verification_status'] === 'VERIFIED') : false,
                    'gps_verified' => $cin ? ((float)$cin['distance_meters'] <= 1000.0) : false,
                    'verification_notes' => $cin ? $cin['notes'] : '',
                    'sa_profile_id' => $sid,
                    'student_id' => $sa['student_id'],
                    'first_name' => $sa['first_name'],
                    'last_name' => $sa['last_name'],
                    'course' => $sa['course'],
                    'year_level' => $sa['year_level'],
                    'sa_category' => $sa['sa_category'],
                    'department_type' => $sa['department_type'],
                    'post_name' => $sa['post_name'] ?: 'Campus Duty',
                    'supervisor_name' => $sa['supervisor_name'] ?: 'Unassigned'
                ];
            }
        }

        // Aggregate Metrics
        $summary = [
            'totalRecords' => count($rows),
            'presentCount' => 0,
            'lateCount' => 0,
            'absentCount' => 0,
            'incompleteCount' => 0,
            'excusedCount' => 0,
            'totalScheduledHours' => 0.0,
            'totalRecordedHours' => 0.0,
            'totalCreditedHours' => 0.0,
            'totalOvertimeHours' => 0.0,
            'pendingCorrections' => 0
        ];

        $deptAgg = [];

        $formatted = [];
        foreach ($rows as $r) {
            $stat = strtoupper((string)$r['attendance_status']);
            if ($stat === 'PRESENT') $summary['presentCount']++;
            elseif ($stat === 'LATE') $summary['lateCount']++;
            elseif ($stat === 'ABSENT') $summary['absentCount']++;
            elseif ($stat === 'INCOMPLETE' || $stat === 'INCOMPLETE_TIME_RECORD') $summary['incompleteCount']++;
            elseif ($stat === 'EXCUSED') $summary['excusedCount']++;

            $schedHrs = 4.0; // default 4hr block
            if ($r['scheduled_start'] && $r['scheduled_end']) {
                $schedHrs = round((strtotime($r['scheduled_end']) - strtotime($r['scheduled_start'])) / 3600, 2);
            }
            $recHrs = (float)($r['recorded_hours'] ?: 0);
            $credHrs = (float)($r['credited_hours'] ?: 0);
            $otHrs = (float)($r['overtime_hours'] ?: 0);

            $summary['totalScheduledHours'] += $schedHrs;
            $summary['totalRecordedHours'] += $recHrs;
            $summary['totalCreditedHours'] += $credHrs;
            $summary['totalOvertimeHours'] += $otHrs;

            if ($r['reconciliation_status'] === 'PENDING_REVIEW' || $r['reconciliation_status'] === 'FLAGGED') {
                $summary['pendingCorrections']++;
            }

            $dept = $r['sa_category'] ?: ($r['department_type'] ?: 'OFFICE');
            if (!isset($deptAgg[$dept])) {
                $deptAgg[$dept] = ['department' => $dept, 'count' => 0, 'scheduled' => 0, 'credited' => 0, 'present' => 0, 'late' => 0, 'absent' => 0];
            }
            $deptAgg[$dept]['count']++;
            $deptAgg[$dept]['scheduled'] += $schedHrs;
            $deptAgg[$dept]['credited'] += $credHrs;
            if ($stat === 'PRESENT') $deptAgg[$dept]['present']++;
            elseif ($stat === 'LATE') $deptAgg[$dept]['late']++;
            elseif ($stat === 'ABSENT') $deptAgg[$dept]['absent']++;

            $formatted[] = [
                'reconId' => (int)$r['recon_id'],
                'saProfileId' => (int)$r['sa_profile_id'],
                'studentId' => $r['student_id'],
                'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                'course' => $r['course'] . ' ' . $r['year_level'],
                'department' => $dept,
                'post' => $r['post_name'] ?: 'Campus Duty',
                'supervisor' => $r['supervisor_name'],
                'dutyDate' => $r['duty_date'],
                'scheduledStart' => $r['scheduled_start'] ? date('h:i A', strtotime($r['scheduled_start'])) : '—',
                'scheduledEnd' => $r['scheduled_end'] ? date('h:i A', strtotime($r['scheduled_end'])) : '—',
                'actualTimeIn' => $r['actual_time_in'] ? date('h:i A', strtotime($r['actual_time_in'])) : '—',
                'actualTimeOut' => $r['actual_time_out'] ? date('h:i A', strtotime($r['actual_time_out'])) : '—',
                'scheduledHours' => $schedHrs,
                'recordedHours' => $recHrs,
                'creditedHours' => $credHrs,
                'overtimeHours' => $otHrs,
                'lateMinutes' => (int)$r['late_minutes'],
                'status' => $stat,
                'reconciliationStatus' => $r['reconciliation_status'] ?: 'UNRECONCILED',
                'faceVerified' => (bool)$r['face_verified'],
                'gpsVerified' => (bool)$r['gps_verified']
            ];
        }

        ok([
            'records' => $formatted,
            'summary' => $summary,
            'departmentSummary' => array_values($deptAgg),
            'appliedFilters' => [
                'semesterId' => $semId,
                'startDate' => $startDate,
                'endDate' => $endDate,
                'department' => $deptFilter,
                'status' => $statusFilter,
                'reconciliationStatus' => $reconFilter,
                'search' => $search
            ]
        ]);
        break;
    }

    // =========================================================================
    // 3. ALLOWANCE REPORT
    // =========================================================================
    case 'allowance_report': {
        $activeSem = get_active_semester($pdo);
        $semId = (int)($in['semester_id'] ?? ($activeSem['id'] ?? 0));
        $deptFilter = trim((string)($in['department'] ?? 'ALL'));
        $statusFilter = trim((string)($in['status'] ?? 'ALL'));
        $search = trim((string)($in['search'] ?? ''));

        // Standard base rate configured for this semester
        $rateStmt = $pdo->prepare('SELECT hourly_rate FROM allowance_rates WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
        $rateStmt->execute([$semId]);
        $baseRate = (float)($rateStmt->fetchColumn() ?: 8.00);

        // Active Endorsement for this semester
        $endStmt = $pdo->prepare('SELECT * FROM allowance_endorsements WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
        $endStmt->execute([$semId]);
        $activeEndorsement = $endStmt->fetch(PDO::FETCH_ASSOC) ?: null;

        // Fetch S.A. Profiles
        $where = ['p.sa_status = "ACTIVE"', 'p.archived_at IS NULL'];
        $params = [];
        if ($deptFilter !== 'ALL' && $deptFilter !== '') {
            $where[] = '(p.sa_category = ? OR p.department_type = ?)';
            $params[] = $deptFilter;
            $params[] = $deptFilter;
        }
        if ($search !== '') {
            $where[] = '(CONCAT(p.first_name, " ", p.last_name) LIKE ? OR p.student_id LIKE ? OR p.sa_number LIKE ?)';
            $like = '%' . $search . '%';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $saStmt = $pdo->prepare('
            SELECT 
                p.id as sa_profile_id, p.student_id, p.sa_number, p.first_name, p.last_name, p.course, p.year_level,
                p.sa_category, p.department_type, p.hourly_rate, p.weekly_target_hours,
                o.name as office_name, sup.full_name as supervisor_name
            FROM sa_profiles p
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN users sup ON sup.id = p.supervisor_id
            WHERE ' . implode(' AND ', $where) . '
            ORDER BY p.last_name, p.first_name
        ');
        $saStmt->execute($params);
        $sas = $saStmt->fetchAll(PDO::FETCH_ASSOC);

        // Fetch credited duty hours per S.A. for this semester
        $credStmt = $pdo->prepare('
            SELECT 
                sa_profile_id,
                SUM(credited_hours) as semester_credited_hours,
                SUM(overtime_hours) as semester_overtime_hours
            FROM sa_attendance_reconciliations
            WHERE semester_id = ?
            GROUP BY sa_profile_id
        ');
        $credStmt->execute([$semId]);
        $credMap = [];
        foreach ($credStmt->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $credMap[(int)$c['sa_profile_id']] = $c;
        }

        $records = [];
        $summary = [
            'totalSas' => count($sas),
            'totalEstimatedWeekly' => 0.0,
            'totalEstimatedMonthly' => 0.0,
            'totalFinalizedCreditedHours' => 0.0,
            'totalFinalizedAllowance' => 0.0,
            'totalEndorsedAllowance' => $activeEndorsement ? (float)$activeEndorsement['total_allowance'] : 0.0,
            'averageRate' => 0.0,
            'awaitingReviewCount' => 0,
            'returnedCount' => ($activeEndorsement && $activeEndorsement['status'] === 'RETURNED') ? 1 : 0
        ];

        $deptSummary = [];
        $rateSum = 0;

        foreach ($sas as $sa) {
            $sid = (int)$sa['sa_profile_id'];
            $rate = (float)($sa['hourly_rate'] ?: $baseRate);
            // Strict rate clamp 8 to 1000
            $rate = max(8.0, min(1000.0, round($rate)));
            $rateSum += $rate;

            $weeklyTarget = (float)($sa['weekly_target_hours'] ?: 20.0);
            $weeklyEstimated = $weeklyTarget * $rate;
            $monthlyEstimated = $weeklyEstimated * 4;

            $credData = $credMap[$sid] ?? null;
            $creditedHrs = $credData ? (float)$credData['semester_credited_hours'] : 0.0;
            $overtimeHrs = $credData ? (float)$credData['semester_overtime_hours'] : 0.0;
            $finalizedAllowance = ($creditedHrs + $overtimeHrs) * $rate;

            $computationStatus = 'ESTIMATED';
            if ($activeEndorsement && $activeEndorsement['status'] === 'ENDORSED') {
                $computationStatus = 'FINALIZED';
            } elseif ($activeEndorsement && $activeEndorsement['status'] === 'RETURNED') {
                $computationStatus = 'RETURNED';
            } elseif ($creditedHrs > 0) {
                $computationStatus = 'AWAITING_REVIEW';
                $summary['awaitingReviewCount']++;
            }

            if ($statusFilter !== 'ALL' && $statusFilter !== '' && $computationStatus !== $statusFilter) {
                continue;
            }

            $summary['totalEstimatedWeekly'] += $weeklyEstimated;
            $summary['totalEstimatedMonthly'] += $monthlyEstimated;
            $summary['totalFinalizedCreditedHours'] += $creditedHrs;
            $summary['totalFinalizedAllowance'] += $finalizedAllowance;

            $dept = $sa['sa_category'] ?: ($sa['department_type'] ?: 'OFFICE');
            if (!isset($deptSummary[$dept])) {
                $deptSummary[$dept] = ['department' => $dept, 'saCount' => 0, 'weeklyEstimated' => 0, 'monthlyEstimated' => 0, 'finalized' => 0];
            }
            $deptSummary[$dept]['saCount']++;
            $deptSummary[$dept]['weeklyEstimated'] += $weeklyEstimated;
            $deptSummary[$dept]['monthlyEstimated'] += $monthlyEstimated;
            $deptSummary[$dept]['finalized'] += $finalizedAllowance;

            $records[] = [
                'saProfileId' => $sid,
                'studentId' => $sa['student_id'],
                'saNumber' => $sa['sa_number'],
                'name' => trim($sa['first_name'] . ' ' . $sa['last_name']),
                'course' => $sa['course'] . ' ' . $sa['year_level'],
                'department' => $dept,
                'post' => $sa['office_name'] ?: 'Assigned Office',
                'hourlyRate' => $rate,
                'weeklyTargetHours' => $weeklyTarget,
                'weeklyEstimated' => $weeklyEstimated,
                'monthlyEstimated' => $monthlyEstimated,
                'finalizedCreditedHours' => $creditedHrs,
                'approvedOvertimeHours' => $overtimeHrs,
                'finalizedAllowance' => $finalizedAllowance,
                'computationStatus' => $computationStatus,
                'endorsementStatus' => $activeEndorsement ? $activeEndorsement['status'] : 'DRAFT',
                'lastUpdated' => date('Y-m-d')
            ];
        }

        $summary['averageRate'] = count($sas) ? round($rateSum / count($sas), 2) : 8.00;

        ok([
            'records' => $records,
            'summary' => $summary,
            'departmentSummary' => array_values($deptSummary),
            'activeEndorsement' => $activeEndorsement,
            'baseRate' => $baseRate
        ]);
        break;
    }

    // =========================================================================
    // 4. SCHOOL BALANCE & DEDUCTION REPORT
    // =========================================================================
    case 'school_balance_report': {
        $activeSem = get_active_semester($pdo);
        $semId = (int)($in['semester_id'] ?? ($activeSem['id'] ?? 0));
        $decisionFilter = trim((string)($in['decision'] ?? 'ALL')); // ALL, YES, NO, PENDING
        $deptFilter = trim((string)($in['department'] ?? 'ALL'));
        $procFilter = trim((string)($in['processing_status'] ?? 'ALL'));
        $search = trim((string)($in['search'] ?? ''));

        // Deduction Campaign for this semester
        $campStmt = $pdo->prepare('SELECT * FROM deduction_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
        $campStmt->execute([$semId]);
        $campaign = $campStmt->fetch(PDO::FETCH_ASSOC) ?: null;
        $campaignId = $campaign ? (int)$campaign['id'] : 0;

        // Responses map
        $respMap = [];
        if ($campaignId > 0) {
            $rStmt = $pdo->prepare('SELECT * FROM deduction_responses WHERE campaign_id = ?');
            $rStmt->execute([$campaignId]);
            foreach ($rStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $respMap[(int)$row['sa_profile_id']] = $row;
            }
        }

        // Transactions map
        $txMap = [];
        if ($campaignId > 0) {
            $txStmt = $pdo->prepare('SELECT * FROM deduction_transactions WHERE campaign_id = ?');
            $txStmt->execute([$campaignId]);
            foreach ($txStmt->fetchAll(PDO::FETCH_ASSOC) as $tx) {
                $txMap[(int)$tx['sa_profile_id']] = $tx;
            }
        }

        // Fetch S.A. Profiles and Benefits (Tuition 100% + Misc 70%)
        $where = ['p.archived_at IS NULL'];
        $params = [];
        if ($deptFilter !== 'ALL' && $deptFilter !== '') {
            $where[] = '(p.sa_category = ? OR p.department_type = ?)';
            $params[] = $deptFilter;
            $params[] = $deptFilter;
        }
        if ($search !== '') {
            $where[] = '(CONCAT(p.first_name, " ", p.last_name) LIKE ? OR p.student_id LIKE ? OR p.sa_number LIKE ?)';
            $like = '%' . $search . '%';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $stmt = $pdo->prepare('
            SELECT 
                p.id as sa_profile_id, p.student_id, p.sa_number, p.first_name, p.last_name, p.course, p.year_level,
                p.sa_category, p.department_type, o.name as office_name,
                b.tuition_fee, b.misc_fee, b.tuition_coverage_pct, b.misc_coverage_pct, b.updated_at as cor_synced_at
            FROM sa_profiles p
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN sa_benefits b ON b.sa_profile_id = p.id
            WHERE ' . implode(' AND ', $where) . '
            ORDER BY p.last_name, p.first_name
        ');
        $stmt->execute($params);
        $sas = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $records = [];
        $summary = [
            'totalCashCor' => 0.0,
            'totalBenefitCovered' => 0.0,
            'totalSchoolBalance' => 0.0,
            'yesCount' => 0,
            'noCount' => 0,
            'pendingCount' => 0,
            'authorizedAwaitingAmount' => 0.0,
            'totalConfirmedDeductions' => 0.0,
            'noBalanceTotal' => 0.0,
            'pendingBalanceTotal' => 0.0,
            'failedCount' => 0
        ];

        foreach ($sas as $sa) {
            $sid = (int)$sa['sa_profile_id'];
            $tuition = (float)($sa['tuition_fee'] ?: 0);
            $misc = (float)($sa['misc_fee'] ?: 0);
            $cashCor = $tuition + $misc;

            $tuitionCovered = $tuition * ((float)($sa['tuition_coverage_pct'] ?: 100.0) / 100);
            $miscCovered = $misc * ((float)($sa['misc_coverage_pct'] ?: 70.0) / 100);
            $covered = $tuitionCovered + $miscCovered;
            $balance = max(0.0, $cashCor - $covered);

            $resp = $respMap[$sid] ?? null;
            $tx = $txMap[$sid] ?? null;

            $decision = $resp ? strtoupper(trim((string)$resp['choice'])) : 'PENDING';
            if ($decision !== 'YES' && $decision !== 'NO') $decision = 'PENDING';

            $authAmount = $decision === 'YES' ? (float)($resp['authorized_amount'] ?: $balance) : 0.0;
            $deductedAmount = $tx ? (float)$tx['processed_amount'] : ($resp ? (float)$resp['processed_amount'] : 0.0);
            $netRemaining = max(0.0, $balance - $deductedAmount);

            $procStatus = $resp ? ($resp['processing_status'] ?: 'PENDING_PROCESSING') : 'NOT_SUBMITTED';
            if ($tx && $tx['status'] === 'CONFIRMED') $procStatus = 'CONFIRMED';
            elseif ($tx && $tx['status'] === 'FAILED') $procStatus = 'FAILED';

            // Filter by Decision
            if ($decisionFilter !== 'ALL' && $decisionFilter !== '' && $decision !== $decisionFilter) {
                continue;
            }
            // Filter by Processing Status
            if ($procFilter !== 'ALL' && $procFilter !== '' && $procStatus !== $procFilter) {
                continue;
            }

            // Summary Totals
            $summary['totalCashCor'] += $cashCor;
            $summary['totalBenefitCovered'] += $covered;
            $summary['totalSchoolBalance'] += $balance;

            if ($decision === 'YES') {
                $summary['yesCount']++;
                $summary['authorizedAwaitingAmount'] += max(0.0, $authAmount - $deductedAmount);
                $summary['totalConfirmedDeductions'] += $deductedAmount;
            } elseif ($decision === 'NO') {
                $summary['noCount']++;
                $summary['noBalanceTotal'] += $balance;
            } else {
                $summary['pendingCount']++;
                $summary['pendingBalanceTotal'] += $balance;
            }

            if ($procStatus === 'FAILED') $summary['failedCount']++;

            $dept = $sa['sa_category'] ?: ($sa['department_type'] ?: 'OFFICE');

            $records[] = [
                'saProfileId' => $sid,
                'studentId' => $sa['student_id'],
                'saNumber' => $sa['sa_number'],
                'name' => trim($sa['first_name'] . ' ' . $sa['last_name']),
                'course' => $sa['course'] . ' ' . $sa['year_level'],
                'department' => $dept,
                'semesterLabel' => $activeSem['label'] ?? 'Active Semester',
                'cashCor' => $cashCor,
                'benefitCovered' => $covered,
                'schoolBalance' => $balance,
                'decision' => $decision,
                'responseDate' => $resp && $resp['replied_at'] ? date('M d, Y h:i A', strtotime($resp['replied_at'])) : '—',
                'authorizedAmount' => $authAmount,
                'confirmedDeducted' => $deductedAmount,
                'remainingNetBalance' => $netRemaining,
                'processingStatus' => $procStatus,
                'corSyncedAt' => $sa['cor_synced_at'] ? date('M d, Y', strtotime($sa['cor_synced_at'])) : 'Official Assessment'
            ];
        }

        ok([
            'records' => $records,
            'summary' => $summary,
            'campaign' => $campaign
        ]);
        break;
    }

    // =========================================================================
    // 5. STUDENT ASSISTANT SUMMARY ROSTER
    // =========================================================================
    case 'sa_summary_report': {
        $deptFilter = trim((string)($in['department'] ?? 'ALL'));
        $statusFilter = trim((string)($in['status'] ?? 'ALL'));
        $search = trim((string)($in['search'] ?? ''));

        $where = ['p.archived_at IS NULL'];
        $params = [];
        if ($deptFilter !== 'ALL' && $deptFilter !== '') {
            $where[] = '(p.sa_category = ? OR p.department_type = ?)';
            $params[] = $deptFilter;
            $params[] = $deptFilter;
        }
        if ($statusFilter !== 'ALL' && $statusFilter !== '') {
            $where[] = 'p.sa_status = ?';
            $params[] = $statusFilter;
        }
        if ($search !== '') {
            $where[] = '(CONCAT(p.first_name, " ", p.last_name) LIKE ? OR p.student_id LIKE ? OR p.course LIKE ?)';
            $like = '%' . $search . '%';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $stmt = $pdo->prepare('
            SELECT 
                p.id as sa_profile_id, p.student_id, p.sa_number, p.first_name, p.middle_name, p.last_name, p.suffix,
                p.course, p.year_level, p.sa_category, p.department_type, p.sa_status, p.weekly_target_hours,
                p.hourly_rate, p.is_reliever, p.appointment_start, p.appointment_end,
                o.name as office_name,
                sup.full_name as supervisor_name,
                b.id as has_bio,
                ben.id as has_benefits
            FROM sa_profiles p
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN users sup ON sup.id = p.supervisor_id
            LEFT JOIN sa_biometrics b ON b.sa_profile_id = p.id
            LEFT JOIN sa_benefits ben ON ben.sa_profile_id = p.id
            WHERE ' . implode(' AND ', $where) . '
            ORDER BY p.sa_category, p.last_name, p.first_name
        ');
        $stmt->execute($params);
        $sas = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $summary = [
            'totalSas' => count($sas),
            'activeSas' => 0,
            'inactiveSas' => 0,
            'itoCount' => 0,
            'acadsCount' => 0,
            'officeCount' => 0,
            'totalWeeklyTargetHours' => 0.0,
            'fullyCompliantCount' => 0
        ];

        $records = [];
        foreach ($sas as $sa) {
            $isActive = $sa['sa_status'] === 'ACTIVE';
            if ($isActive) $summary['activeSas']++;
            else $summary['inactiveSas']++;

            $dept = $sa['sa_category'] ?: ($sa['department_type'] ?: 'OFFICE');
            if ($dept === 'ITO') $summary['itoCount']++;
            elseif ($dept === 'ACADS') $summary['acadsCount']++;
            else $summary['officeCount']++;

            $targetHours = (float)($sa['weekly_target_hours'] ?: 20.0);
            $summary['totalWeeklyTargetHours'] += $targetHours;

            $hasFace = !empty($sa['has_bio']);
            $hasCor = !empty($sa['has_benefits']);
            if ($hasFace && $hasCor) $summary['fullyCompliantCount']++;

            $records[] = [
                'saProfileId' => (int)$sa['sa_profile_id'],
                'studentId' => $sa['student_id'],
                'saNumber' => $sa['sa_number'],
                'name' => trim($sa['first_name'] . ' ' . $sa['last_name']),
                'course' => $sa['course'] . ' ' . $sa['year_level'],
                'department' => $dept,
                'post' => $sa['office_name'] ?: ($dept . ' Duty'),
                'supervisor' => $sa['supervisor_name'] ?: 'Unassigned',
                'status' => $sa['sa_status'],
                'weeklyTargetHours' => $targetHours,
                'hourlyRate' => (float)($sa['hourly_rate'] ?: 8.0),
                'isReliever' => (bool)$sa['is_reliever'],
                'faceEnrolled' => $hasFace,
                'corSynced' => $hasCor,
                'appointmentPeriod' => ($sa['appointment_start'] && $sa['appointment_end'])
                    ? date('M Y', strtotime($sa['appointment_start'])) . ' – ' . date('M Y', strtotime($sa['appointment_end']))
                    : 'Active Term'
            ];
        }

        ok([
            'records' => $records,
            'summary' => $summary
        ]);
        break;
    }

    // =========================================================================
    // 6. SCHEDULE & DUTY COVERAGE REPORT
    // =========================================================================
    case 'schedule_coverage_report': {
        $activeSem = get_active_semester($pdo);
        $semId = (int)($in['semester_id'] ?? ($activeSem['id'] ?? 0));
        $dowFilter = trim((string)($in['day_of_week'] ?? 'ALL'));
        $deptFilter = trim((string)($in['department'] ?? 'ALL'));
        $covFilter = trim((string)($in['coverage_status'] ?? 'ALL')); // ALL, FULFILLED, GAP

        // Fetch assignments
        $assignWhere = ['a.semester_id = ?'];
        $assignParams = [$semId];
        if ($dowFilter !== 'ALL' && $dowFilter !== '') {
            $assignWhere[] = 'a.day_of_week = ?';
            $assignParams[] = $dowFilter;
        }
        if ($deptFilter !== 'ALL' && $deptFilter !== '') {
            $assignWhere[] = '(a.department = ? OR p.sa_category = ?)';
            $assignParams[] = $deptFilter;
            $assignParams[] = $deptFilter;
        }

        $assignStmt = $pdo->prepare('
            SELECT 
                a.id as assignment_id, a.day_of_week, a.start_time, a.end_time, a.department, a.location,
                p.id as sa_profile_id, p.student_id, p.first_name, p.last_name, p.course, p.year_level, p.sa_category,
                sup.full_name as supervisor_name
            FROM schedule_assignments a
            JOIN sa_profiles p ON p.id = a.sa_profile_id AND p.archived_at IS NULL
            LEFT JOIN users sup ON sup.id = a.supervisor_id
            WHERE ' . implode(' AND ', $assignWhere) . '
            ORDER BY FIELD(a.day_of_week, "MON", "TUE", "WED", "THU", "FRI", "SAT"), a.start_time ASC
        ');
        $assignStmt->execute($assignParams);
        $assignments = $assignStmt->fetchAll(PDO::FETCH_ASSOC);

        // Fetch unassigned slots / coverage gaps from match_slots
        $gapWhere = ['s.status = "UNASSIGNED"'];
        $gapParams = [];
        if ($dowFilter !== 'ALL' && $dowFilter !== '') {
            $gapWhere[] = 's.day_of_week = ?';
            $gapParams[] = $dowFilter;
        }
        if ($deptFilter !== 'ALL' && $deptFilter !== '') {
            $gapWhere[] = 's.department = ?';
            $gapParams[] = $deptFilter;
        }

        $gapStmt = $pdo->prepare('
            SELECT 
                s.id as slot_id, s.slot_no, s.label, s.department, s.day_of_week, s.start_time, s.end_time,
                s.requirement_type, o.name as office_name, r.code as room_code
            FROM match_slots s
            LEFT JOIN office_requirements oreq ON oreq.id = s.office_requirement_id
            LEFT JOIN offices o ON o.id = oreq.office_id
            LEFT JOIN room_requirements rreq ON rreq.id = s.room_requirement_id
            LEFT JOIN rooms r ON r.id = rreq.room_id
            WHERE ' . implode(' AND ', $gapWhere) . '
            ORDER BY FIELD(s.day_of_week, "MON", "TUE", "WED", "THU", "FRI", "SAT"), s.start_time ASC
            LIMIT 100
        ');
        $gapStmt->execute($gapParams);
        $gaps = $gapStmt->fetchAll(PDO::FETCH_ASSOC);

        $records = [];
        $summary = [
            'totalDutySlots' => 0,
            'fulfilledSlots' => 0,
            'coverageGaps' => 0,
            'totalScheduledHours' => 0.0,
            'conflictCount' => 0,
            'coverageRate' => 100
        ];

        // Track SA concurrent slots for conflict detection
        $saSlotsByTime = [];

        foreach ($assignments as $a) {
            $hrs = round((strtotime($a['end_time']) - strtotime($a['start_time'])) / 3600, 2);
            $summary['totalDutySlots']++;
            $summary['fulfilledSlots']++;
            $summary['totalScheduledHours'] += $hrs;

            // Conflict check
            $sid = (int)$a['sa_profile_id'];
            $timeKey = $a['day_of_week'] . '_' . $a['start_time'];
            $hasConflict = false;
            if (isset($saSlotsByTime[$sid][$timeKey])) {
                $hasConflict = true;
                $summary['conflictCount']++;
            }
            $saSlotsByTime[$sid][$timeKey] = true;

            if ($covFilter === 'GAP') continue;

            $records[] = [
                'type' => 'ASSIGNED',
                'dayOfWeek' => $a['day_of_week'],
                'startTime' => date('h:i A', strtotime($a['start_time'])),
                'endTime' => date('h:i A', strtotime($a['end_time'])),
                'hours' => $hrs,
                'department' => $a['department'] ?: $a['sa_category'],
                'location' => $a['location'] ?: 'Campus Post',
                'assignedSa' => trim($a['first_name'] . ' ' . $a['last_name']),
                'studentId' => $a['student_id'],
                'supervisor' => $a['supervisor_name'] ?: 'Office Supervisor',
                'coverageStatus' => 'FULFILLED',
                'conflictStatus' => $hasConflict ? 'CONFLICT_DETECTED' : 'NO_CONFLICT'
            ];
        }

        foreach ($gaps as $g) {
            $hrs = round((strtotime($g['end_time']) - strtotime($g['start_time'])) / 3600, 2);
            $summary['totalDutySlots']++;
            $summary['coverageGaps']++;

            if ($covFilter === 'FULFILLED') continue;

            $records[] = [
                'type' => 'GAP',
                'dayOfWeek' => $g['day_of_week'],
                'startTime' => date('h:i A', strtotime($g['start_time'])),
                'endTime' => date('h:i A', strtotime($g['end_time'])),
                'hours' => $hrs,
                'department' => $g['department'] ?: 'CAMPUS',
                'location' => $g['office_name'] ?: ($g['room_code'] ? 'Room ' . $g['room_code'] : $g['label']),
                'assignedSa' => '⚠️ UNASSIGNED (Coverage Gap)',
                'studentId' => '—',
                'supervisor' => 'Action Required',
                'coverageStatus' => 'UNASSIGNED_GAP',
                'conflictStatus' => 'NO_CONFLICT'
            ];
        }

        if ($summary['totalDutySlots'] > 0) {
            $summary['coverageRate'] = round(($summary['fulfilledSlots'] / $summary['totalDutySlots']) * 100, 1);
        }

        ok([
            'records' => $records,
            'summary' => $summary
        ]);
        break;
    }

    // =========================================================================
    // 7. EXCEPTIONS & AUDIT REPORT
    // =========================================================================
    case 'exceptions_audit_report': {
        $moduleFilter = trim((string)($in['module'] ?? 'ALL')); // ALL, ATTENDANCE, ALLOWANCE, SCHOOL_BALANCE, SCHEDULING, SECURITY
        [$startDate, $endDate] = validate_date_range($in['start_date'] ?? null, $in['end_date'] ?? null);
        $search = trim((string)($in['search'] ?? ''));

        $records = [];
        $summary = [
            'totalEvents' => 0,
            'attendanceIssues' => 0,
            'allowanceRateChanges' => 0,
            'deductionChanges' => 0,
            'scheduleChanges' => 0,
            'securityEvents' => 0
        ];

        // 1. Audit Logs
        $where = ['1=1'];
        $params = [];
        if ($startDate) {
            $where[] = 'l.created_at >= ?';
            $params[] = $startDate . ' 00:00:00';
        }
        if ($endDate) {
            $where[] = 'l.created_at <= ?';
            $params[] = $endDate . ' 23:59:59';
        }
        if ($search !== '') {
            $where[] = '(l.action LIKE ? OR l.details LIKE ? OR u.full_name LIKE ?)';
            $like = '%' . $search . '%';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $auditStmt = $pdo->prepare('
            SELECT 
                l.id, l.action, l.details, l.ip_address, l.created_at,
                u.full_name as user_name, u.role as user_role
            FROM audit_logs l
            LEFT JOIN users u ON u.id = l.user_id
            WHERE ' . implode(' AND ', $where) . '
            ORDER BY l.created_at DESC
            LIMIT 150
        ');
        $auditStmt->execute($params);
        $logs = $auditStmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($logs as $l) {
            $act = strtoupper((string)$l['action']);
            $mod = 'SECURITY';
            if (strpos($act, 'ATTENDANCE') !== false) {
                $mod = 'ATTENDANCE';
                $summary['attendanceIssues']++;
            } elseif (strpos($act, 'RATE') !== false || strpos($act, 'ALLOWANCE') !== false) {
                $mod = 'ALLOWANCE';
                $summary['allowanceRateChanges']++;
            } elseif (strpos($act, 'DEDUCTION') !== false || strpos($act, 'BALANCE') !== false) {
                $mod = 'SCHOOL_BALANCE';
                $summary['deductionChanges']++;
            } elseif (strpos($act, 'SCHEDULE') !== false || strpos($act, 'MATCH') !== false) {
                $mod = 'SCHEDULING';
                $summary['scheduleChanges']++;
            } else {
                $summary['securityEvents']++;
            }

            $summary['totalEvents']++;

            if ($moduleFilter !== 'ALL' && $moduleFilter !== '' && $mod !== $moduleFilter) {
                continue;
            }

            $records[] = [
                'id' => (int)$l['id'],
                'timestamp' => $l['created_at'],
                'module' => $mod,
                'action' => $l['action'],
                'reference' => 'User: ' . ($l['user_name'] ?: 'System'),
                'details' => $l['details'] ?: 'System Audit Log',
                'responsibleUser' => $l['user_name'] ? ($l['user_name'] . ' (' . $l['user_role'] . ')') : 'System Automatic',
                'ipAddress' => $l['ip_address'],
                'status' => 'RECORDED'
            ];
        }

        // 2. Attendance Correction Requests from sa_requests
        if ($moduleFilter === 'ALL' || $moduleFilter === 'ATTENDANCE') {
            $reqStmt = $pdo->query('
                SELECT 
                    r.id, r.request_ref_no, r.request_type, r.request_date, r.explanation, r.status, r.created_at,
                    CONCAT(p.first_name, " ", p.last_name) as sa_name, p.student_id,
                    r.supervisor_decision, r.coordinator_decision
                FROM sa_requests r
                JOIN sa_profiles p ON p.id = r.sa_profile_id
                ORDER BY r.created_at DESC
                LIMIT 50
            ');
            foreach ($reqStmt->fetchAll(PDO::FETCH_ASSOC) as $req) {
                $summary['attendanceIssues']++;
                $summary['totalEvents']++;
                $records[] = [
                    'id' => 100000 + (int)$req['id'],
                    'timestamp' => $req['created_at'],
                    'module' => 'ATTENDANCE',
                    'action' => 'REQUEST_' . $req['request_type'],
                    'reference' => $req['sa_name'] . ' (' . $req['student_id'] . ') · Ref: ' . $req['request_ref_no'],
                    'details' => $req['explanation'] ?: ('Attendance request on ' . $req['request_date']),
                    'responsibleUser' => $req['sa_name'],
                    'ipAddress' => 'Client App',
                    'status' => $req['status']
                ];
            }
        }

        // 3. Hourly Rate Changes from sa_rate_history
        if ($moduleFilter === 'ALL' || $moduleFilter === 'ALLOWANCE') {
            $rateHistStmt = $pdo->query('
                SELECT * FROM sa_rate_history ORDER BY created_at DESC LIMIT 50
            ');
            foreach ($rateHistStmt->fetchAll(PDO::FETCH_ASSOC) as $rh) {
                $summary['allowanceRateChanges']++;
                $summary['totalEvents']++;
                $records[] = [
                    'id' => 200000 + (int)$rh['id'],
                    'timestamp' => $rh['created_at'],
                    'module' => 'ALLOWANCE',
                    'action' => 'HOURLY_RATE_CHANGE',
                    'reference' => ($rh['sa_name'] ?: 'S.A.') . ' (' . ($rh['student_id'] ?: 'ID') . ')',
                    'details' => 'Rate changed from ₱' . number_format($rh['previous_rate'], 2) . ' to ₱' . number_format($rh['new_rate'], 2) . '. Reason: ' . ($rh['reason'] ?: 'None specified'),
                    'responsibleUser' => $rh['changed_by_name'] ?: 'Coordinator',
                    'ipAddress' => 'Portal',
                    'status' => 'COMPLETED'
                ];
            }
        }

        // Sort all aggregated records descending by timestamp
        usort($records, function ($a, $b) {
            return strcmp($b['timestamp'], $a['timestamp']);
        });

        ok([
            'records' => array_slice($records, 0, 200),
            'summary' => $summary
        ]);
        break;
    }

    // =========================================================================
    // SUPERVISOR OPERATIONAL ATTENDANCE REPORTS (Strictly Scoped)
    // =========================================================================

    case 'supervisor_reports_dashboard': {
        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)($in['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) fail('Supervisor scope not found.', 404);

        $allAssignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $assignedSas = $allAssignedSas;
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        [$startDate, $endDate] = validate_date_range(
            $in['startDate'] ?? $in['start_date'] ?? '2026-10-01',
            $in['endDate'] ?? $in['end_date'] ?? '2026-10-15'
        );

        $saIdFilter = (int)($in['sa_profile_id'] ?? $in['saId'] ?? 0);
        if ($saIdFilter > 0 && in_array($saIdFilter, $scopedSaIds, true)) {
            $assignedSas = array_values(array_filter($assignedSas, fn($s) => (int)$s['sa_profile_id'] === $saIdFilter));
            $scopedSaIds = [$saIdFilter];
        }

        $sem = get_active_semester($pdo);
        $semId = $sem ? (int)$sem['id'] : 1;

        if (empty($scopedSaIds)) {
            ok([
                'supervisor' => $scope,
                'dateRange' => ['startDate' => $startDate, 'endDate' => $endDate],
                'summary' => [
                    'totalAssignedSas' => count($allAssignedSas),
                    'selectedAssignedSas' => 0,
                    'totalScheduledShifts' => 0,
                    'attendanceRecords' => 0,
                    'present' => 0,
                    'late' => 0,
                    'absent' => 0,
                    'onLeave' => 0,
                    'incomplete' => 0,
                    'unresolvedExceptions' => 0,
                    'pendingCorrections' => 0,
                    'requiresReview' => 0,
                    'attendanceRate' => 0.0,
                    'lateRate' => 0.0,
                    'absenceRate' => 0.0,
                    'totalScheduledHours' => 0.0,
                    'totalRecordedHours' => 0.0,
                    'totalCreditedHours' => 0.0,
                    'hasHoursDiscrepancy' => false,
                    'discrepancyNote' => ''
                ],
                'assignedSas' => []
            ]);
        }

        $inList = implode(',', $scopedSaIds);

        // Fetch logs in date range
        $logsStmt = $pdo->prepare("SELECT * FROM sa_attendance_logs WHERE sa_profile_id IN ($inList) AND DATE(logged_at) BETWEEN ? AND ? ORDER BY logged_at ASC");
        $logsStmt->execute([$startDate, $endDate]);
        $logs = [];
        foreach ($logsStmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
            $d = date('Y-m-d', strtotime($l['logged_at']));
            $logs[(int)$l['sa_profile_id']][$d][] = $l;
        }

        // Fetch reconciliations in date range
        $recStmt = $pdo->prepare("SELECT * FROM sa_attendance_reconciliations WHERE sa_profile_id IN ($inList) AND duty_date BETWEEN ? AND ?");
        $recStmt->execute([$startDate, $endDate]);
        $recs = [];
        foreach ($recStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $recs[(int)$r['sa_profile_id']][$r['duty_date']] = $r;
        }

        // Fetch excuse slips in date range
        $leaveStmt = $pdo->prepare("
            SELECT * FROM sa_requests
            WHERE sa_profile_id IN ($inList) AND request_type = 'EXCUSE'
              AND status IN ('RECORDED', 'PENDING_COORDINATOR_RECORDING')
              AND (request_date BETWEEN ? AND ? OR (request_end_date IS NOT NULL AND NOT (request_end_date < ? OR request_date > ?)))
        ");
        $leaveStmt->execute([$startDate, $endDate, $startDate, $endDate]);
        $leaves = [];
        foreach ($leaveStmt->fetchAll(PDO::FETCH_ASSOC) as $lv) {
            $leaves[(int)$lv['sa_profile_id']][] = $lv;
        }

        // Fetch weekly schedules
        $schedStmt = $pdo->prepare("SELECT * FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id IN ($inList) ORDER BY start_time ASC");
        $schedStmt->execute([$semId]);
        $scheds = [];
        foreach ($schedStmt->fetchAll(PDO::FETCH_ASSOC) as $sc) {
            $scheds[(int)$sc['sa_profile_id']][$sc['day_of_week']][] = $sc;
        }

        // Iterate dates in range to calculate summary metrics
        $curTs = strtotime($startDate);
        $endTs = strtotime($endDate);

        $totPresent = 0;
        $totLate = 0;
        $totAbsent = 0;
        $totLeave = 0;
        $totIncomplete = 0;
        $totUnresolvedExceptions = 0;
        $totEligibleScheduledShifts = 0;
        $totScheduledHours = 0.0;
        $totRecordedHours = 0.0;
        $totCreditedHours = 0.0;
        $totRecords = 0;

        while ($curTs <= $endTs) {
            $d = date('Y-m-d', $curTs);
            $dow = strtoupper(date('D', $curTs));
            $dayCode = match($dow) { 'MON' => 'MON', 'TUE' => 'TUE', 'WED' => 'WED', 'THU' => 'THU', 'FRI' => 'FRI', 'SAT' => 'SAT', default => 'SUN' };

            foreach ($assignedSas as $sa) {
                $sid = (int)$sa['sa_profile_id'];
                $saScheds = $scheds[$sid][$dayCode] ?? [];
                $saLogs = $logs[$sid][$d] ?? [];
                $saRec = $recs[$sid][$d] ?? null;

                // Check leave
                $isOnLeave = false;
                foreach ($leaves[$sid] ?? [] as $lv) {
                    if ($lv['request_date'] === $d || ($lv['request_end_date'] && $d >= $lv['request_date'] && $d <= $lv['request_end_date'])) {
                        $isOnLeave = true;
                        break;
                    }
                }

                $hasSched = !empty($saScheds);
                $hasLogs = !empty($saLogs);
                $hasRec = !empty($saRec);

                if (!$hasSched && !$hasLogs && !$hasRec && !$isOnLeave) {
                    continue; // S.A. not scheduled and no attendance activity on this day
                }

                $totRecords++;
                if ($hasSched && !$isOnLeave) {
                    $totEligibleScheduledShifts++;
                }

                // Scheduled hours
                $daySchedHours = 0.0;
                $schedStart = null;
                if ($hasSched) {
                    $schedStart = $saScheds[0]['start_time'];
                    foreach ($saScheds as $sc) {
                        $daySchedHours += round((strtotime($sc['end_time']) - strtotime($sc['start_time'])) / 3600, 2);
                    }
                }
                $totScheduledHours += $daySchedHours;

                // Punch analysis
                $checkIn = null;
                $checkOut = null;
                $breakOut = null;
                $breakIn = null;
                foreach ($saLogs as $l) {
                    if ($l['log_type'] === 'CHECK_IN' && !$checkIn) $checkIn = $l;
                    elseif ($l['log_type'] === 'BREAK_OUT' && !$breakOut) $breakOut = $l;
                    elseif ($l['log_type'] === 'BREAK_IN' && !$breakIn) $breakIn = $l;
                    elseif ($l['log_type'] === 'CHECK_OUT') $checkOut = $l;
                }

                $recHours = 0.0;
                $breakDed = 0.0;
                $credHours = 0.0;
                if ($checkIn && $checkOut) {
                    $hCalc = compute_daily_attendance_hours(
                        $checkIn['logged_at'],
                        $checkOut['logged_at'],
                        $daySchedHours
                    );
                    $recHours = $hCalc['elapsedHours'];
                    $breakDed = $hCalc['breakDeduction'];
                    $credHours = $hCalc['creditedHours'];
                }
                if ($saRec && $saRec['credited_hours'] !== null) {
                    $credHours = (float)$saRec['credited_hours'];
                    if (isset($saRec['break_deduction']) && $saRec['break_deduction'] !== null) {
                        $breakDed = (float)$saRec['break_deduction'];
                    }
                }
                $totRecordedHours += $recHours;
                $totCreditedHours += $credHours;

                // Attendance Status determination
                $status = 'PENDING_REVIEW';
                if ($saRec && !empty($saRec['status'])) {
                    $status = $saRec['status'];
                } elseif ($isOnLeave) {
                    $status = 'ON_LEAVE';
                } elseif ($checkIn && $checkOut) {
                    $status = 'PRESENT';
                    if ($schedStart) {
                        $actTime = date('H:i:s', strtotime($checkIn['logged_at']));
                        if (strtotime($actTime) > (strtotime($schedStart) + 15 * 60)) {
                            $status = 'LATE';
                        }
                    }
                } elseif ($checkIn && !$checkOut) {
                    $status = 'INCOMPLETE';
                } elseif ($d <= date('Y-m-d') && $hasSched) {
                    // Scheduled past shift with missing punches awaiting supervisor review
                    $status = 'UNRESOLVED_EXCEPTION';
                }

                if ($status === 'PRESENT') {
                    $totPresent++;
                } elseif ($status === 'LATE') {
                    $totLate++;
                } elseif ($status === 'ON_LEAVE' || $status === 'EXCUSED') {
                    $totLeave++;
                } elseif ($status === 'ABSENT') {
                    $totAbsent++;
                } elseif ($status === 'INCOMPLETE') {
                    $totIncomplete++;
                    $totUnresolvedExceptions++;
                } elseif ($status === 'UNRESOLVED_EXCEPTION' || $status === 'PENDING_REVIEW') {
                    $totUnresolvedExceptions++;
                }

                // If record has an unresolved dispute or unapproved status
                if ($saRec && in_array($saRec['review_status'] ?? '', ['NOT_YET_REVIEWED', 'UNDER_REVIEW', 'ESCALATED', 'REJECTED'], true)) {
                    if ($status !== 'UNRESOLVED_EXCEPTION' && $status !== 'INCOMPLETE') {
                        $totUnresolvedExceptions++;
                    }
                }
            }
            $curTs = strtotime('+1 day', $curTs);
        }

        // Open correction requests count
        $corrStmt = $pdo->prepare("
            SELECT COUNT(*) FROM sa_requests
            WHERE sa_profile_id IN ($inList) AND request_type = 'CORRECTION'
              AND status IN ('PENDING_SUPERVISOR_REVIEW', 'PENDING_COORDINATOR_RECORDING')
        ");
        $corrStmt->execute();
        $pendingCorrections = (int)$corrStmt->fetchColumn();

        $attRate = $totEligibleScheduledShifts > 0
            ? round((($totPresent + $totLate) / $totEligibleScheduledShifts) * 100, 1)
            : 0.0;
        $lateRate = $totEligibleScheduledShifts > 0
            ? round(($totLate / $totEligibleScheduledShifts) * 100, 1)
            : 0.0;
        $absenceRate = $totEligibleScheduledShifts > 0
            ? round(($totAbsent / $totEligibleScheduledShifts) * 100, 1)
            : 0.0;

        $hasDiscrepancy = (round($totRecordedHours, 2) == 0.0 && round($totCreditedHours, 2) > 0.0);
        $discrepancyNote = $hasDiscrepancy
            ? "Data Quality Audit Note: " . round($totCreditedHours, 2) . " credited duty hours were verified through supervisor duty reconciliations, while 0.0 biometric terminal punches were recorded for this period."
            : "";

        ok([
            'supervisor' => [
                'id' => (int)$scope['id'],
                'empId' => $scope['empId'],
                'name' => $scope['name'],
                'supervisor' => $scope['name'],
                'department' => $scope['deptDisplayName'],
                'deptDisplayName' => $scope['deptDisplayName'],
                'category' => $scope['category'],
                'assignedSasCount' => count($allAssignedSas),
                'departments' => $scope['departments'],
                'scopeLabel' => $scope['scopeLabel']
            ],
            'dateRange' => ['startDate' => $startDate, 'endDate' => $endDate],
            'summary' => [
                'totalAssignedSas' => count($allAssignedSas),
                'selectedAssignedSas' => count($assignedSas),
                'totalScheduledShifts' => $totEligibleScheduledShifts,
                'attendanceRecords' => $totRecords,
                'present' => $totPresent,
                'late' => $totLate,
                'absent' => $totAbsent,
                'onLeave' => $totLeave,
                'incomplete' => $totIncomplete,
                'unresolvedExceptions' => $totUnresolvedExceptions,
                'pendingCorrections' => $pendingCorrections,
                'requiresReview' => ($totUnresolvedExceptions + $pendingCorrections),
                'attendanceRate' => $attRate,
                'lateRate' => $lateRate,
                'absenceRate' => $absenceRate,
                'totalScheduledHours' => round($totScheduledHours, 2),
                'totalRecordedHours' => round($totRecordedHours, 2),
                'totalCreditedHours' => round($totCreditedHours, 2),
                'hasHoursDiscrepancy' => $hasDiscrepancy,
                'discrepancyNote' => $discrepancyNote
            ],
            'assignedSas' => array_map(fn($s) => [
                'id' => (int)$s['sa_profile_id'],
                'saProfileId' => (int)$s['sa_profile_id'],
                'studentId' => $s['student_id'],
                'studentNumber' => $s['student_id'],
                'saNumber' => $s['sa_number'],
                'name' => trim($s['first_name'] . ' ' . $s['last_name'] . ($s['suffix'] ? ' ' . $s['suffix'] : '')),
                'department' => $s['office_name'] ?: $scope['deptDisplayName']
            ], $allAssignedSas),
            'departments' => $scope['departments']
        ]);
        break;
    }

    case 'supervisor_daily_attendance_report': {
        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)($in['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) fail('Supervisor scope not found.', 404);

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        $date = trim((string)($in['date'] ?? date('Y-m-d')));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = date('Y-m-d');
        }

        $saIdFilter = (int)($in['sa_profile_id'] ?? $in['saId'] ?? 0);
        if ($saIdFilter > 0 && !in_array($saIdFilter, $scopedSaIds, true)) {
            fail('Access denied: You can only query reports for your assigned S.A.s.', 403);
        }

        $statusFilter = strtoupper(trim((string)($in['status'] ?? 'ALL')));
        $reviewFilter = strtoupper(trim((string)($in['review_status'] ?? $in['reviewStatus'] ?? 'ALL')));
        $deptFilter = trim((string)($in['department'] ?? 'ALL'));
        $search = strtolower(trim((string)($in['search'] ?? '')));

        if (empty($scopedSaIds)) {
            ok(['records' => [], 'summary' => ['totalRecords' => 0, 'presentCount' => 0, 'lateCount' => 0, 'absentCount' => 0, 'onLeaveCount' => 0, 'incompleteCount' => 0, 'totalCreditedHours' => 0], 'date' => $date]);
        }

        $inList = implode(',', $scopedSaIds);
        $dow = strtoupper(date('D', strtotime($date)));
        $dayCode = match($dow) { 'MON' => 'MON', 'TUE' => 'TUE', 'WED' => 'WED', 'THU' => 'THU', 'FRI' => 'FRI', 'SAT' => 'SAT', default => 'SUN' };

        $sem = get_active_semester($pdo);
        $semId = $sem ? (int)$sem['id'] : 1;

        // Schedules on this day
        $schedStmt = $pdo->prepare("SELECT * FROM schedule_assignments WHERE semester_id = ? AND day_of_week = ? AND sa_profile_id IN ($inList) ORDER BY start_time ASC");
        $schedStmt->execute([$semId, $dayCode]);
        $scheds = [];
        foreach ($schedStmt->fetchAll(PDO::FETCH_ASSOC) as $s) {
            $scheds[(int)$s['sa_profile_id']][] = $s;
        }

        // Logs on date
        $logsStmt = $pdo->prepare("SELECT * FROM sa_attendance_logs WHERE DATE(logged_at) = ? AND sa_profile_id IN ($inList) ORDER BY logged_at ASC");
        $logsStmt->execute([$date]);
        $logs = [];
        foreach ($logsStmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
            $logs[(int)$l['sa_profile_id']][] = $l;
        }

        // Reconciliations on date
        $recStmt = $pdo->prepare("SELECT * FROM sa_attendance_reconciliations WHERE duty_date = ? AND sa_profile_id IN ($inList)");
        $recStmt->execute([$date]);
        $recs = [];
        foreach ($recStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $recs[(int)$r['sa_profile_id']] = $r;
        }

        // Leaves on date
        $leaveStmt = $pdo->prepare("
            SELECT * FROM sa_requests
            WHERE sa_profile_id IN ($inList) AND request_type = 'EXCUSE'
              AND status IN ('RECORDED', 'PENDING_COORDINATOR_RECORDING')
              AND (? = request_date OR (request_end_date IS NOT NULL AND ? BETWEEN request_date AND request_end_date))
        ");
        $leaveStmt->execute([$date, $date]);
        $leaves = [];
        foreach ($leaveStmt->fetchAll(PDO::FETCH_ASSOC) as $lv) {
            $leaves[(int)$lv['sa_profile_id']] = $lv;
        }

        $records = [];
        $sum = ['totalRecords' => 0, 'presentCount' => 0, 'lateCount' => 0, 'absentCount' => 0, 'onLeaveCount' => 0, 'incompleteCount' => 0, 'totalCreditedHours' => 0];

        foreach ($assignedSas as $sa) {
            $sid = (int)$sa['sa_profile_id'];
            if ($saIdFilter > 0 && $sid !== $saIdFilter) continue;

            $fullName = trim($sa['first_name'] . ' ' . $sa['last_name'] . ($sa['suffix'] ? ' ' . $sa['suffix'] : ''));
            $area = $sa['office_name'] ?: $scope['deptDisplayName'];

            if ($search) {
                $str = strtolower($fullName . ' ' . $sa['student_id'] . ' ' . $sa['sa_number']);
                if (!str_contains($str, $search)) continue;
            }
            if ($deptFilter !== 'ALL' && !str_contains(strtolower($area), strtolower($deptFilter))) {
                continue;
            }

            $saScheds = $scheds[$sid] ?? [];
            $saLogs = $logs[$sid] ?? [];
            $saRec = $recs[$sid] ?? null;
            $isOnLeave = !empty($leaves[$sid]);

            $schedStart = null;
            $schedEnd = null;
            $schedHours = 0.0;
            $schedLabel = 'No Schedule Today';
            if (!empty($saScheds)) {
                $schedStart = $saScheds[0]['start_time'];
                $schedEnd = $saScheds[count($saScheds) - 1]['end_time'];
                $schedLabel = date('h:i A', strtotime($schedStart)) . ' – ' . date('h:i A', strtotime($schedEnd));
                foreach ($saScheds as $sc) {
                    $schedHours += round((strtotime($sc['end_time']) - strtotime($sc['start_time'])) / 3600, 2);
                }
            }

            $checkIn = null;
            $checkOut = null;
            foreach ($saLogs as $l) {
                if ($l['log_type'] === 'CHECK_IN' && !$checkIn) $checkIn = $l;
                elseif ($l['log_type'] === 'CHECK_OUT') $checkOut = $l;
            }

            $timeIn = $checkIn ? date('h:i A', strtotime($checkIn['logged_at'])) : '—';
            $timeOut = $checkOut ? date('h:i A', strtotime($checkOut['logged_at'])) : '—';
            $timeInOutLabel = ($checkIn && $checkOut) ? "{$timeIn} – {$timeOut}" : ($checkIn ? "{$timeIn} – Present" : "—");

            $recHours = 0.0;
            $breakDed = 0.0;
            $credHours = 0.0;
            if ($checkIn && $checkOut) {
                $hCalc = compute_daily_attendance_hours(
                    $checkIn['logged_at'],
                    $checkOut['logged_at'],
                    $schedHours
                );
                $recHours = $hCalc['elapsedHours'];
                $breakDed = $hCalc['breakDeduction'];
                $credHours = $hCalc['creditedHours'];
            }
            if ($saRec && $saRec['credited_hours'] !== null) {
                $credHours = (float)$saRec['credited_hours'];
                if (isset($saRec['break_deduction']) && $saRec['break_deduction'] !== null) {
                    $breakDed = (float)$saRec['break_deduction'];
                }
            }

            $status = 'ABSENT';
            if ($saRec && !empty($saRec['status'])) {
                $status = $saRec['status'];
            } elseif ($isOnLeave) {
                $status = 'ON_LEAVE';
            } elseif ($checkIn && $checkOut) {
                $status = 'PRESENT';
                if ($schedStart) {
                    $actTime = date('H:i:s', strtotime($checkIn['logged_at']));
                    if (strtotime($actTime) > (strtotime($schedStart) + 15 * 60)) {
                        $status = 'LATE';
                    }
                }
            } elseif ($checkIn && !$checkOut) {
                $status = 'INCOMPLETE';
            } elseif (empty($saScheds)) {
                $status = 'OFF';
            }

            $reviewStatus = $saRec['review_status'] ?? 'NOT_YET_REVIEWED';

            if ($statusFilter !== 'ALL') {
                if ($statusFilter === 'PRESENT' && !in_array($status, ['PRESENT', 'LATE'], true)) continue;
                if ($statusFilter === 'LATE' && $status !== 'LATE') continue;
                if ($statusFilter === 'ABSENT' && $status !== 'ABSENT') continue;
                if ($statusFilter === 'ON_LEAVE' && $status !== 'ON_LEAVE') continue;
                if ($statusFilter === 'INCOMPLETE' && $status !== 'INCOMPLETE') continue;
            }
            if ($reviewFilter !== 'ALL' && $reviewStatus !== $reviewFilter) {
                continue;
            }

            $sum['totalRecords']++;
            if ($status === 'PRESENT') $sum['presentCount']++;
            elseif ($status === 'LATE') { $sum['lateCount']++; $sum['presentCount']++; }
            elseif ($status === 'ON_LEAVE') $sum['onLeaveCount']++;
            elseif ($status === 'INCOMPLETE') $sum['incompleteCount']++;
            elseif ($status === 'ABSENT') $sum['absentCount']++;
            $sum['totalCreditedHours'] += $credHours;

            $records[] = [
                'saProfileId' => $sid,
                'studentNumber' => $sa['student_id'],
                'saNumber' => $sa['sa_number'],
                'name' => $fullName,
                'assignedDepartment' => $area,
                'scheduledShift' => $schedLabel,
                'scheduledHours' => $schedHours,
                'timeIn' => $timeIn,
                'timeOut' => $timeOut,
                'timeInOutLabel' => $timeInOutLabel,
                'recordedHours' => $recHours,
                'breakDeduction' => $breakDed,
                'creditedHours' => $credHours,
                'attendanceStatus' => $status,
                'reviewStatus' => $reviewStatus,
                'faceVerified' => $checkIn ? ($checkIn['verification_status'] === 'VERIFIED') : false,
                'gpsVerified' => $checkIn ? ((float)$checkIn['distance_meters'] <= 1000.0) : false,
                'locationName' => $checkIn ? ($checkIn['location_name'] ?: 'NCST Main Campus') : '—'
            ];
        }

        $sum['totalCreditedHours'] = round($sum['totalCreditedHours'], 2);

        ok([
            'records' => $records,
            'summary' => $sum,
            'date' => $date,
            'formattedDate' => date('D, M j, Y', strtotime($date))
        ]);
        break;
    }

    case 'supervisor_attendance_summary_report': {
        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)($in['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) fail('Supervisor scope not found.', 404);

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        [$startDate, $endDate] = validate_date_range(
            $in['startDate'] ?? $in['start_date'] ?? '2026-10-01',
            $in['endDate'] ?? $in['end_date'] ?? '2026-10-15'
        );

        $saIdFilter = (int)($in['sa_profile_id'] ?? $in['saId'] ?? 0);
        if ($saIdFilter > 0 && !in_array($saIdFilter, $scopedSaIds, true)) {
            fail('Access denied: Unauthorized S.A. query.', 403);
        }

        $deptFilter = trim((string)($in['department'] ?? 'ALL'));
        $search = strtolower(trim((string)($in['search'] ?? '')));

        if (empty($scopedSaIds)) {
            ok(['records' => [], 'summary' => ['totalScheduled' => 0, 'present' => 0, 'late' => 0, 'absent' => 0, 'onLeave' => 0, 'incomplete' => 0, 'totalCreditedHours' => 0]]);
        }

        $inList = implode(',', $scopedSaIds);
        $sem = get_active_semester($pdo);
        $semId = $sem ? (int)$sem['id'] : 1;

        // Fetch logs
        $logsStmt = $pdo->prepare("SELECT * FROM sa_attendance_logs WHERE sa_profile_id IN ($inList) AND DATE(logged_at) BETWEEN ? AND ? ORDER BY logged_at ASC");
        $logsStmt->execute([$startDate, $endDate]);
        $logs = [];
        foreach ($logsStmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
            $d = date('Y-m-d', strtotime($l['logged_at']));
            $logs[(int)$l['sa_profile_id']][$d][] = $l;
        }

        // Fetch reconciliations
        $recStmt = $pdo->prepare("SELECT * FROM sa_attendance_reconciliations WHERE sa_profile_id IN ($inList) AND duty_date BETWEEN ? AND ?");
        $recStmt->execute([$startDate, $endDate]);
        $recs = [];
        foreach ($recStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $recs[(int)$r['sa_profile_id']][$r['duty_date']] = $r;
        }

        // Fetch leaves
        $leaveStmt = $pdo->prepare("
            SELECT * FROM sa_requests
            WHERE sa_profile_id IN ($inList) AND request_type = 'EXCUSE'
              AND status IN ('RECORDED', 'PENDING_COORDINATOR_RECORDING')
              AND (request_date BETWEEN ? AND ? OR (request_end_date IS NOT NULL AND NOT (request_end_date < ? OR request_date > ?)))
        ");
        $leaveStmt->execute([$startDate, $endDate, $startDate, $endDate]);
        $leaves = [];
        foreach ($leaveStmt->fetchAll(PDO::FETCH_ASSOC) as $lv) {
            $leaves[(int)$lv['sa_profile_id']][] = $lv;
        }

        // Fetch schedules
        $schedStmt = $pdo->prepare("SELECT * FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id IN ($inList)");
        $schedStmt->execute([$semId]);
        $scheds = [];
        foreach ($schedStmt->fetchAll(PDO::FETCH_ASSOC) as $sc) {
            $scheds[(int)$sc['sa_profile_id']][$sc['day_of_week']][] = $sc;
        }

        $records = [];
        $grandSummary = [
            'totalScheduled' => 0, 'present' => 0, 'late' => 0, 'absent' => 0,
            'onLeave' => 0, 'incomplete' => 0, 'totalScheduledHours' => 0.0,
            'totalRecordedHours' => 0.0, 'totalCreditedHours' => 0.0
        ];

        foreach ($assignedSas as $sa) {
            $sid = (int)$sa['sa_profile_id'];
            if ($saIdFilter > 0 && $sid !== $saIdFilter) continue;

            $fullName = trim($sa['first_name'] . ' ' . $sa['last_name'] . ($sa['suffix'] ? ' ' . $sa['suffix'] : ''));
            $area = $sa['office_name'] ?: $scope['deptDisplayName'];

            if ($search) {
                $str = strtolower($fullName . ' ' . $sa['student_id'] . ' ' . $sa['sa_number']);
                if (!str_contains($str, $search)) continue;
            }
            if ($deptFilter !== 'ALL' && !str_contains(strtolower($area), strtolower($deptFilter))) {
                continue;
            }

            $saRow = [
                'saProfileId' => $sid,
                'studentNumber' => $sa['student_id'],
                'saNumber' => $sa['sa_number'],
                'name' => $fullName,
                'department' => $area,
                'totalScheduled' => 0,
                'present' => 0,
                'late' => 0,
                'absent' => 0,
                'onLeave' => 0,
                'incomplete' => 0,
                'scheduledHours' => 0.0,
                'recordedHours' => 0.0,
                'creditedHours' => 0.0,
                'attendanceRate' => 0
            ];

            $curTs = strtotime($startDate);
            $endTs = strtotime($endDate);
            while ($curTs <= $endTs) {
                $d = date('Y-m-d', $curTs);
                $dow = strtoupper(date('D', $curTs));
                $dayCode = match($dow) { 'MON' => 'MON', 'TUE' => 'TUE', 'WED' => 'WED', 'THU' => 'THU', 'FRI' => 'FRI', 'SAT' => 'SAT', default => 'SUN' };

                $dScheds = $scheds[$sid][$dayCode] ?? [];
                $dLogs = $logs[$sid][$d] ?? [];
                $dRec = $recs[$sid][$d] ?? null;

                $isOnLeave = false;
                foreach ($leaves[$sid] ?? [] as $lv) {
                    if ($lv['request_date'] === $d || ($lv['request_end_date'] && $d >= $lv['request_date'] && $d <= $lv['request_end_date'])) {
                        $isOnLeave = true;
                        break;
                    }
                }

                $hasSched = !empty($dScheds);
                $hasLogs = !empty($dLogs);
                $hasRec = !empty($dRec);

                if (!$hasSched && !$hasLogs && !$hasRec && !$isOnLeave) {
                    $curTs = strtotime('+1 day', $curTs);
                    continue;
                }

                $saRow['totalScheduled']++;

                $daySchedHours = 0.0;
                $schedStart = null;
                if ($hasSched) {
                    $schedStart = $dScheds[0]['start_time'];
                    foreach ($dScheds as $sc) {
                        $daySchedHours += round((strtotime($sc['end_time']) - strtotime($sc['start_time'])) / 3600, 2);
                    }
                }
                $saRow['scheduledHours'] += $daySchedHours;

                $checkIn = null;
                $checkOut = null;
                foreach ($dLogs as $l) {
                    if ($l['log_type'] === 'CHECK_IN' && !$checkIn) $checkIn = $l;
                    elseif ($l['log_type'] === 'CHECK_OUT') $checkOut = $l;
                }

                $recH = 0.0;
                $credH = 0.0;
                if ($checkIn && $checkOut) {
                    $diffSec = max(0, strtotime($checkOut['logged_at']) - strtotime($checkIn['logged_at']));
                    $recH = round($diffSec / 3600, 2);
                    $credH = $daySchedHours > 0 ? min($daySchedHours, $recH) : $recH;
                }
                if ($dRec && $dRec['credited_hours'] !== null) {
                    $credH = (float)$dRec['credited_hours'];
                }
                $saRow['recordedHours'] += $recH;
                $saRow['creditedHours'] += $credH;

                $status = 'ABSENT';
                if ($dRec && !empty($dRec['status'])) {
                    $status = $dRec['status'];
                } elseif ($isOnLeave) {
                    $status = 'ON_LEAVE';
                } elseif ($checkIn && $checkOut) {
                    $status = 'PRESENT';
                    if ($schedStart) {
                        $actTime = date('H:i:s', strtotime($checkIn['logged_at']));
                        if (strtotime($actTime) > (strtotime($schedStart) + 15 * 60)) {
                            $status = 'LATE';
                        }
                    }
                } elseif ($checkIn && !$checkOut) {
                    $status = 'INCOMPLETE';
                }

                if ($status === 'PRESENT') $saRow['present']++;
                elseif ($status === 'LATE') { $saRow['late']++; $saRow['present']++; }
                elseif ($status === 'ON_LEAVE') $saRow['onLeave']++;
                elseif ($status === 'INCOMPLETE') $saRow['incomplete']++;
                elseif ($status === 'ABSENT') $saRow['absent']++;

                $curTs = strtotime('+1 day', $curTs);
            }

            $saRow['scheduledHours'] = round($saRow['scheduledHours'], 2);
            $saRow['recordedHours'] = round($saRow['recordedHours'], 2);
            $saRow['creditedHours'] = round($saRow['creditedHours'], 2);
            $saRow['attendanceRate'] = $saRow['totalScheduled'] > 0
                ? round(($saRow['present'] / $saRow['totalScheduled']) * 100)
                : 0;

            $grandSummary['totalScheduled'] += $saRow['totalScheduled'];
            $grandSummary['present'] += $saRow['present'];
            $grandSummary['late'] += $saRow['late'];
            $grandSummary['absent'] += $saRow['absent'];
            $grandSummary['onLeave'] += $saRow['onLeave'];
            $grandSummary['incomplete'] += $saRow['incomplete'];
            $grandSummary['totalScheduledHours'] += $saRow['scheduledHours'];
            $grandSummary['totalRecordedHours'] += $saRow['recordedHours'];
            $grandSummary['totalCreditedHours'] += $saRow['creditedHours'];

            $records[] = $saRow;
        }

        $grandSummary['totalScheduledHours'] = round($grandSummary['totalScheduledHours'], 2);
        $grandSummary['totalRecordedHours'] = round($grandSummary['totalRecordedHours'], 2);
        $grandSummary['totalCreditedHours'] = round($grandSummary['totalCreditedHours'], 2);

        ok([
            'records' => $records,
            'summary' => $grandSummary,
            'dateRange' => ['startDate' => $startDate, 'endDate' => $endDate]
        ]);
        break;
    }

    case 'supervisor_attendance_exceptions_report': {
        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)($in['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) fail('Supervisor scope not found.', 404);

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        [$startDate, $endDate] = validate_date_range(
            $in['startDate'] ?? $in['start_date'] ?? '2026-10-01',
            $in['endDate'] ?? $in['end_date'] ?? '2026-10-15'
        );

        $saIdFilter = (int)($in['sa_profile_id'] ?? $in['saId'] ?? 0);
        if ($saIdFilter > 0 && !in_array($saIdFilter, $scopedSaIds, true)) {
            fail('Access denied: Unauthorized S.A. query.', 403);
        }

        $typeFilter = strtoupper(trim((string)($in['exceptionType'] ?? $in['type'] ?? 'ALL')));
        $search = strtolower(trim((string)($in['search'] ?? '')));

        if (empty($scopedSaIds)) {
            ok(['records' => [], 'summary' => ['totalExceptions' => 0, 'missingPunch' => 0, 'lateArrival' => 0, 'unresolvedDispute' => 0, 'geofenceWarning' => 0]]);
        }

        $inList = implode(',', $scopedSaIds);
        $sem = get_active_semester($pdo);
        $semId = $sem ? (int)$sem['id'] : 1;

        // Fetch logs
        $logsStmt = $pdo->prepare("SELECT * FROM sa_attendance_logs WHERE sa_profile_id IN ($inList) AND DATE(logged_at) BETWEEN ? AND ? ORDER BY logged_at ASC");
        $logsStmt->execute([$startDate, $endDate]);
        $logs = [];
        foreach ($logsStmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
            $d = date('Y-m-d', strtotime($l['logged_at']));
            $logs[(int)$l['sa_profile_id']][$d][] = $l;
        }

        // Fetch reconciliations
        $recStmt = $pdo->prepare("SELECT * FROM sa_attendance_reconciliations WHERE sa_profile_id IN ($inList) AND duty_date BETWEEN ? AND ?");
        $recStmt->execute([$startDate, $endDate]);
        $recs = [];
        foreach ($recStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $recs[(int)$r['sa_profile_id']][$r['duty_date']] = $r;
        }

        // Fetch leaves
        $leaveStmt = $pdo->prepare("
            SELECT * FROM sa_requests
            WHERE sa_profile_id IN ($inList) AND request_type = 'EXCUSE'
              AND status IN ('RECORDED', 'PENDING_COORDINATOR_RECORDING')
              AND (request_date BETWEEN ? AND ? OR (request_end_date IS NOT NULL AND NOT (request_end_date < ? OR request_date > ?)))
        ");
        $leaveStmt->execute([$startDate, $endDate, $startDate, $endDate]);
        $leaves = [];
        foreach ($leaveStmt->fetchAll(PDO::FETCH_ASSOC) as $lv) {
            $leaves[(int)$lv['sa_profile_id']][] = $lv;
        }

        // Fetch schedules
        $schedStmt = $pdo->prepare("SELECT * FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id IN ($inList)");
        $schedStmt->execute([$semId]);
        $scheds = [];
        foreach ($schedStmt->fetchAll(PDO::FETCH_ASSOC) as $sc) {
            $scheds[(int)$sc['sa_profile_id']][$sc['day_of_week']][] = $sc;
        }

        $exceptions = [];
        $sum = ['totalExceptions' => 0, 'missingPunch' => 0, 'lateArrival' => 0, 'unresolvedDispute' => 0, 'geofenceWarning' => 0];

        $curTs = strtotime($startDate);
        $endTs = strtotime($endDate);
        while ($curTs <= $endTs) {
            $d = date('Y-m-d', $curTs);
            $dow = strtoupper(date('D', $curTs));
            $dayCode = match($dow) { 'MON' => 'MON', 'TUE' => 'TUE', 'WED' => 'WED', 'THU' => 'THU', 'FRI' => 'FRI', 'SAT' => 'SAT', default => 'SUN' };

            foreach ($assignedSas as $sa) {
                $sid = (int)$sa['sa_profile_id'];
                if ($saIdFilter > 0 && $sid !== $saIdFilter) continue;

                $fullName = trim($sa['first_name'] . ' ' . $sa['last_name'] . ($sa['suffix'] ? ' ' . $sa['suffix'] : ''));
                $area = $sa['office_name'] ?: $scope['deptDisplayName'];

                if ($search) {
                    $str = strtolower($fullName . ' ' . $sa['student_id'] . ' ' . $sa['sa_number']);
                    if (!str_contains($str, $search)) continue;
                }

                $dScheds = $scheds[$sid][$dayCode] ?? [];
                $dLogs = $logs[$sid][$d] ?? [];
                $dRec = $recs[$sid][$d] ?? null;

                $isOnLeave = false;
                foreach ($leaves[$sid] ?? [] as $lv) {
                    if ($lv['request_date'] === $d || ($lv['request_end_date'] && $d >= $lv['request_date'] && $d <= $lv['request_end_date'])) {
                        $isOnLeave = true;
                        break;
                    }
                }

                $schedStart = !empty($dScheds) ? $dScheds[0]['start_time'] : null;
                $schedEnd = !empty($dScheds) ? $dScheds[count($dScheds) - 1]['end_time'] : null;
                $shiftLabel = ($schedStart && $schedEnd) ? (date('h:i A', strtotime($schedStart)) . ' – ' . date('h:i A', strtotime($schedEnd))) : 'No Schedule';

                $checkIn = null;
                $checkOut = null;
                foreach ($dLogs as $l) {
                    if ($l['log_type'] === 'CHECK_IN' && !$checkIn) $checkIn = $l;
                    elseif ($l['log_type'] === 'CHECK_OUT') $checkOut = $l;
                }

                $reviewStatus = $dRec['review_status'] ?? 'NOT_YET_REVIEWED';

                // Exception 0: Unpunched Scheduled Shift (Missing In/Out on past scheduled shift)
                if (empty($dLogs) && !empty($dScheds) && !$isOnLeave && $d <= date('Y-m-d')) {
                    $isReconciledAndApproved = ($dRec && in_array($dRec['review_status'] ?? '', ['APPROVED', 'VERIFIED'], true));
                    if (!$isReconciledAndApproved) {
                        $sum['missingPunch']++;
                        $sum['totalExceptions']++;
                        if ($typeFilter === 'ALL' || $typeFilter === 'MISSING_PUNCH') {
                            $exceptions[] = [
                                'id' => "exc-unp-{$sid}-{$d}",
                                'date' => $d,
                                'saProfileId' => $sid,
                                'studentId' => $sa['student_id'],
                                'studentNumber' => $sa['student_id'],
                                'saNumber' => $sa['sa_number'],
                                'name' => $fullName,
                                'department' => $area,
                                'exceptionType' => 'MISSING_PUNCH',
                                'title' => 'Unpunched Scheduled Shift',
                                'severity' => 'MEDIUM',
                                'description' => "Scheduled duty shift ({$shiftLabel}) with no biometric punches recorded. Awaiting supervisor review or reconciliation.",
                                'scheduledShift' => $shiftLabel,
                                'recordedPunch' => 'No Punches Recorded',
                                'reviewStatus' => $reviewStatus,
                                'attendanceStatus' => 'PENDING_REVIEW',
                                'actionUrl' => "/supervisor/attendance-review?saId={$sid}&date={$d}"
                            ];
                        }
                    }
                }

                // Exception 1: Missing Time Out (Checked in, but no check-out on a past day)
                if ($checkIn && !$checkOut && $d <= date('Y-m-d')) {
                    $sum['missingPunch']++;
                    $sum['totalExceptions']++;
                    if ($typeFilter === 'ALL' || $typeFilter === 'MISSING_PUNCH') {
                        $exceptions[] = [
                            'id' => "exc-mo-{$sid}-{$d}",
                            'date' => $d,
                            'saProfileId' => $sid,
                            'studentNumber' => $sa['student_id'],
                            'saNumber' => $sa['sa_number'],
                            'name' => $fullName,
                            'department' => $area,
                            'exceptionType' => 'MISSING_PUNCH',
                            'title' => 'Missing Time-Out',
                            'severity' => 'HIGH',
                            'description' => 'Student Assistant punched In at ' . date('h:i A', strtotime($checkIn['logged_at'])) . ' but did not record a Time-Out punch.',
                            'scheduledShift' => $shiftLabel,
                            'recordedPunch' => date('h:i A', strtotime($checkIn['logged_at'])) . ' – Missing',
                            'reviewStatus' => $reviewStatus,
                            'attendanceStatus' => 'INCOMPLETE',
                            'actionUrl' => "/supervisor/attendance-review?saId={$sid}&date={$d}"
                        ];
                    }
                }

                // Exception 2: Late Arrival (> 15 mins after schedule start)
                if ($checkIn && $schedStart) {
                    $cTime = strtotime(date('H:i:s', strtotime($checkIn['logged_at'])));
                    $sTime = strtotime($schedStart);
                    if ($cTime > ($sTime + 15 * 60)) {
                        $lateMins = round(($cTime - $sTime) / 60);
                        $sum['lateArrival']++;
                        $sum['totalExceptions']++;
                        if ($typeFilter === 'ALL' || $typeFilter === 'LATE_ARRIVAL') {
                            $exceptions[] = [
                                'id' => "exc-late-{$sid}-{$d}",
                                'date' => $d,
                                'saProfileId' => $sid,
                                'studentNumber' => $sa['student_id'],
                                'saNumber' => $sa['sa_number'],
                                'name' => $fullName,
                                'department' => $area,
                                'exceptionType' => 'LATE_ARRIVAL',
                                'title' => "Late Arrival ({$lateMins}m)",
                                'severity' => 'MEDIUM',
                                'description' => "Clocked in at " . date('h:i A', strtotime($checkIn['logged_at'])) . " for a shift scheduled at " . date('h:i A', strtotime($schedStart)) . " ({$lateMins} minutes late).",
                                'scheduledShift' => $shiftLabel,
                                'recordedPunch' => date('h:i A', strtotime($checkIn['logged_at'])),
                                'reviewStatus' => $reviewStatus,
                                'attendanceStatus' => 'LATE',
                                'actionUrl' => "/supervisor/attendance-review?saId={$sid}&date={$d}"
                            ];
                        }
                    }
                }

                // Exception 3: Geofence warning (>200m)
                if ($checkIn && (float)$checkIn['distance_meters'] > 200.0) {
                    $dist = round((float)$checkIn['distance_meters']);
                    $sum['geofenceWarning']++;
                    $sum['totalExceptions']++;
                    if ($typeFilter === 'ALL' || $typeFilter === 'GEOFENCE') {
                        $exceptions[] = [
                            'id' => "exc-geo-{$sid}-{$d}",
                            'date' => $d,
                            'saProfileId' => $sid,
                            'studentNumber' => $sa['student_id'],
                            'saNumber' => $sa['sa_number'],
                            'name' => $fullName,
                            'department' => $area,
                            'exceptionType' => 'GEOFENCE_WARNING',
                            'title' => 'Geofence Boundary Warning',
                            'severity' => 'LOW',
                            'description' => "Attendance captured {$dist}m from authorized campus boundary center.",
                            'scheduledShift' => $shiftLabel,
                            'recordedPunch' => "GPS Distance: {$dist}m",
                            'reviewStatus' => $reviewStatus,
                            'attendanceStatus' => 'VERIFIED',
                            'actionUrl' => "/supervisor/attendance-review?saId={$sid}&date={$d}"
                        ];
                    }
                }

                // Exception 4: Disputed / Rejected Record
                if ($dRec && in_array($dRec['review_status'], ['REJECTED', 'UNDER_REVIEW', 'ESCALATED'], true)) {
                    $sum['unresolvedDispute']++;
                    $sum['totalExceptions']++;
                    if ($typeFilter === 'ALL' || $typeFilter === 'UNRESOLVED') {
                        $exceptions[] = [
                            'id' => "exc-disp-{$sid}-{$d}",
                            'date' => $d,
                            'saProfileId' => $sid,
                            'studentNumber' => $sa['student_id'],
                            'saNumber' => $sa['sa_number'],
                            'name' => $fullName,
                            'department' => $area,
                            'exceptionType' => 'UNRESOLVED_DISPUTE',
                            'title' => 'Disputed / Under Review Record',
                            'severity' => 'HIGH',
                            'description' => $dRec['rejection_reason'] ?: ($dRec['escalation_reason'] ?: ($dRec['review_notes'] ?: 'Pending supervisor resolution.')),
                            'scheduledShift' => $shiftLabel,
                            'recordedPunch' => $dRec['status'],
                            'reviewStatus' => $dRec['review_status'],
                            'attendanceStatus' => $dRec['status'],
                            'actionUrl' => "/supervisor/attendance-review?saId={$sid}&date={$d}"
                        ];
                    }
                }
            }
            $curTs = strtotime('+1 day', $curTs);
        }

        ok([
            'records' => $exceptions,
            'summary' => $sum,
            'dateRange' => ['startDate' => $startDate, 'endDate' => $endDate]
        ]);
        break;
    }

    case 'supervisor_correction_requests_report': {
        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)($in['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) fail('Supervisor scope not found.', 404);

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        [$startDate, $endDate] = validate_date_range(
            $in['startDate'] ?? $in['start_date'] ?? '2026-10-01',
            $in['endDate'] ?? $in['end_date'] ?? '2026-10-15'
        );

        $saIdFilter = (int)($in['sa_profile_id'] ?? $in['saId'] ?? 0);
        if ($saIdFilter > 0 && !in_array($saIdFilter, $scopedSaIds, true)) {
            fail('Access denied: Unauthorized S.A. query.', 403);
        }

        $statusFilter = strtoupper(trim((string)($in['status'] ?? 'ALL')));
        $search = strtolower(trim((string)($in['search'] ?? '')));

        if (empty($scopedSaIds)) {
            ok(['records' => [], 'summary' => ['totalRequests' => 0, 'pending' => 0, 'approved' => 0, 'rejected' => 0]]);
        }

        $inList = implode(',', $scopedSaIds);

        $reqStmt = $pdo->prepare("
            SELECT r.*, p.first_name, p.last_name, p.suffix, p.student_id, p.sa_number, o.name as office_name
            FROM sa_requests r
            JOIN sa_profiles p ON p.id = r.sa_profile_id
            LEFT JOIN offices o ON o.id = p.office_id
            WHERE r.sa_profile_id IN ($inList) AND r.request_type = 'CORRECTION'
              AND r.request_date BETWEEN ? AND ?
            ORDER BY r.request_date DESC, r.id DESC
        ");
        $reqStmt->execute([$startDate, $endDate]);
        $raw = $reqStmt->fetchAll(PDO::FETCH_ASSOC);

        $records = [];
        $sum = ['totalRequests' => 0, 'pending' => 0, 'approved' => 0, 'rejected' => 0];

        foreach ($raw as $r) {
            $sid = (int)$r['sa_profile_id'];
            if ($saIdFilter > 0 && $sid !== $saIdFilter) continue;

            $fullName = trim($r['first_name'] . ' ' . $r['last_name'] . ($r['suffix'] ? ' ' . $r['suffix'] : ''));
            $area = $r['office_name'] ?: $scope['deptDisplayName'];

            if ($search) {
                $str = strtolower($fullName . ' ' . $r['student_id'] . ' ' . $r['sa_number'] . ' ' . $r['request_ref_no']);
                if (!str_contains($str, $search)) continue;
            }

            $st = $r['status'];
            $isPending = in_array($st, ['PENDING_SUPERVISOR_REVIEW', 'PENDING_COORDINATOR_RECORDING'], true);
            $isApproved = ($r['supervisor_decision'] === 'APPROVED' || $st === 'RECORDED');
            $isRejected = ($r['supervisor_decision'] === 'REJECTED' || $st === 'REJECTED_BY_SUPERVISOR');

            if ($statusFilter === 'PENDING' && !$isPending) continue;
            if ($statusFilter === 'APPROVED' && !$isApproved) continue;
            if ($statusFilter === 'REJECTED' && !$isRejected) continue;

            $sum['totalRequests']++;
            if ($isPending) $sum['pending']++;
            elseif ($isApproved) $sum['approved']++;
            elseif ($isRejected) $sum['rejected']++;

            $records[] = [
                'id' => (int)$r['id'],
                'refNo' => $r['request_ref_no'],
                'saProfileId' => $sid,
                'studentId' => $r['student_id'],
                'studentNumber' => $r['student_id'],
                'saNumber' => $r['sa_number'],
                'name' => $fullName,
                'department' => $area,
                'dutyDate' => $r['request_date'],
                'attendanceDate' => $r['request_date'],
                'formattedDate' => date('M j, Y', strtotime($r['request_date'])),
                'originalValue' => $r['actual_time'] ? date('h:i A', strtotime($r['actual_time'])) : 'Recorded Punches',
                'requestedPunch' => ($r['requested_start'] && $r['requested_end'])
                    ? (date('h:i A', strtotime($r['requested_start'])) . ' – ' . date('h:i A', strtotime($r['requested_end'])))
                    : ($r['requested_start'] ? date('h:i A', strtotime($r['requested_start'])) : 'Correction'),
                'requestedValue' => ($r['requested_start'] && $r['requested_end'])
                    ? (date('h:i A', strtotime($r['requested_start'])) . ' – ' . date('h:i A', strtotime($r['requested_end'])))
                    : ($r['requested_start'] ? date('h:i A', strtotime($r['requested_start'])) : 'Correction'),
                'reasonCategory' => $r['reason_category'] ?: 'Attendance Correction',
                'explanation' => $r['explanation'],
                'requestDate' => date('M j, Y h:i A', strtotime($r['submitted_at'] ?: $r['created_at'])),
                'currentStatus' => $st,
                'supervisorDecision' => $r['supervisor_decision'] ?: ($isPending ? 'Pending Decision' : $st),
                'supervisorRemarks' => $r['supervisor_remarks'] ?: '—',
                'supervisorActedAt' => $r['supervisor_acted_at'] ? date('M j, Y h:i A', strtotime($r['supervisor_acted_at'])) : null,
                'canApprove' => ($st === 'PENDING_SUPERVISOR_REVIEW'),
                'actionUrl' => "/supervisor/attendance-review?saId={$sid}&date={$r['request_date']}"
            ];
        }

        ok([
            'records' => $records,
            'summary' => $sum,
            'dateRange' => ['startDate' => $startDate, 'endDate' => $endDate]
        ]);
        break;
    }

    case 'supervisor_credited_hours_summary': {
        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)($in['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) fail('Supervisor scope not found.', 404);

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        [$startDate, $endDate] = validate_date_range(
            $in['startDate'] ?? $in['start_date'] ?? '2026-10-01',
            $in['endDate'] ?? $in['end_date'] ?? '2026-10-15'
        );

        $saIdFilter = (int)($in['sa_profile_id'] ?? $in['saId'] ?? 0);
        if ($saIdFilter > 0 && !in_array($saIdFilter, $scopedSaIds, true)) {
            fail('Access denied: Unauthorized S.A. query.', 403);
        }

        $deptFilter = trim((string)($in['department'] ?? 'ALL'));
        $search = strtolower(trim((string)($in['search'] ?? '')));

        if (empty($scopedSaIds)) {
            ok(['records' => [], 'summary' => ['totalScheduledHours' => 0, 'totalRecordedHours' => 0, 'totalCreditedHours' => 0, 'varianceHours' => 0, 'avgFulfillmentPct' => 0]]);
        }

        $inList = implode(',', $scopedSaIds);
        $sem = get_active_semester($pdo);
        $semId = $sem ? (int)$sem['id'] : 1;

        // Fetch logs
        $logsStmt = $pdo->prepare("SELECT * FROM sa_attendance_logs WHERE sa_profile_id IN ($inList) AND DATE(logged_at) BETWEEN ? AND ? ORDER BY logged_at ASC");
        $logsStmt->execute([$startDate, $endDate]);
        $logs = [];
        foreach ($logsStmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
            $d = date('Y-m-d', strtotime($l['logged_at']));
            $logs[(int)$l['sa_profile_id']][$d][] = $l;
        }

        // Fetch reconciliations
        $recStmt = $pdo->prepare("SELECT * FROM sa_attendance_reconciliations WHERE sa_profile_id IN ($inList) AND duty_date BETWEEN ? AND ?");
        $recStmt->execute([$startDate, $endDate]);
        $recs = [];
        foreach ($recStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $recs[(int)$r['sa_profile_id']][$r['duty_date']] = $r;
        }

        // Fetch schedules
        $schedStmt = $pdo->prepare("SELECT * FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id IN ($inList)");
        $schedStmt->execute([$semId]);
        $scheds = [];
        foreach ($schedStmt->fetchAll(PDO::FETCH_ASSOC) as $sc) {
            $scheds[(int)$sc['sa_profile_id']][$sc['day_of_week']][] = $sc;
        }

        $records = [];
        $totSched = 0.0;
        $totRec = 0.0;
        $totCred = 0.0;

        foreach ($assignedSas as $sa) {
            $sid = (int)$sa['sa_profile_id'];
            if ($saIdFilter > 0 && $sid !== $saIdFilter) continue;

            $fullName = trim($sa['first_name'] . ' ' . $sa['last_name'] . ($sa['suffix'] ? ' ' . $sa['suffix'] : ''));
            $area = $sa['office_name'] ?: $scope['deptDisplayName'];

            if ($search) {
                $str = strtolower($fullName . ' ' . $sa['student_id'] . ' ' . $sa['sa_number']);
                if (!str_contains($str, $search)) continue;
            }
            if ($deptFilter !== 'ALL' && !str_contains(strtolower($area), strtolower($deptFilter))) {
                continue;
            }

            $saSchedH = 0.0;
            $saRecH = 0.0;
            $saCredH = 0.0;
            $dutyDays = 0;

            $curTs = strtotime($startDate);
            $endTs = strtotime($endDate);
            while ($curTs <= $endTs) {
                $d = date('Y-m-d', $curTs);
                $dow = strtoupper(date('D', $curTs));
                $dayCode = match($dow) { 'MON' => 'MON', 'TUE' => 'TUE', 'WED' => 'WED', 'THU' => 'THU', 'FRI' => 'FRI', 'SAT' => 'SAT', default => 'SUN' };

                $dScheds = $scheds[$sid][$dayCode] ?? [];
                $dLogs = $logs[$sid][$d] ?? [];
                $dRec = $recs[$sid][$d] ?? null;

                $daySched = 0.0;
                if (!empty($dScheds)) {
                    foreach ($dScheds as $sc) {
                        $daySched += round((strtotime($sc['end_time']) - strtotime($sc['start_time'])) / 3600, 2);
                    }
                }
                $saSchedH += $daySched;

                $checkIn = null;
                $checkOut = null;
                foreach ($dLogs as $l) {
                    if ($l['log_type'] === 'CHECK_IN' && !$checkIn) $checkIn = $l;
                    elseif ($l['log_type'] === 'CHECK_OUT') $checkOut = $l;
                }

                $recH = 0.0;
                $credH = 0.0;
                if ($checkIn && $checkOut) {
                    $dutyDays++;
                    $diffSec = max(0, strtotime($checkOut['logged_at']) - strtotime($checkIn['logged_at']));
                    $recH = round($diffSec / 3600, 2);
                    $credH = $daySched > 0 ? min($daySched, $recH) : $recH;
                }
                if ($dRec && $dRec['credited_hours'] !== null) {
                    $credH = (float)$dRec['credited_hours'];
                }
                $saRecH += $recH;
                $saCredH += $credH;

                $curTs = strtotime('+1 day', $curTs);
            }

            $saSchedH = round($saSchedH, 2);
            $saRecH = round($saRecH, 2);
            $saCredH = round($saCredH, 2);
            $variance = round($saCredH - $saSchedH, 2);
            $fulfill = $saSchedH > 0 ? min(100, round(($saCredH / $saSchedH) * 100)) : ($saCredH > 0 ? 100 : 0);

            $totSched += $saSchedH;
            $totRec += $saRecH;
            $totCred += $saCredH;

            $records[] = [
                'saProfileId' => $sid,
                'studentNumber' => $sa['student_id'],
                'saNumber' => $sa['sa_number'],
                'name' => $fullName,
                'department' => $area,
                'dutyDays' => $dutyDays,
                'scheduledHours' => $saSchedH,
                'recordedHours' => $saRecH,
                'creditedHours' => $saCredH,
                'varianceHours' => $variance,
                'fulfillmentPct' => $fulfill
            ];
        }

        $totSched = round($totSched, 2);
        $totRec = round($totRec, 2);
        $totCred = round($totCred, 2);
        $totVar = round($totCred - $totSched, 2);
        $avgFulfill = $totSched > 0 ? min(100, round(($totCred / $totSched) * 100)) : 0;

        ok([
            'records' => $records,
            'summary' => [
                'totalScheduledHours' => $totSched,
                'totalRecordedHours' => $totRec,
                'totalCreditedHours' => $totCred,
                'varianceHours' => $totVar,
                'avgFulfillmentPct' => $avgFulfill
            ],
            'dateRange' => ['startDate' => $startDate, 'endDate' => $endDate],
            'disclaimer' => 'Operational attendance tracking and duty hour verification only. Allowance calculations, billing endorsements, and payroll approvals are reserved exclusively for S.A. Coordinator and Accounting.'
        ]);
        break;
    }

    default:
        fail("Unknown action '$action' for Reports module.", 400);
}
