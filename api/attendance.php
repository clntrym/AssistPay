<?php
// Attendance API for Student Assistants
// Handles Geofence calculation, facial descriptor verification, and attendance logging.

require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_sms.php';
require_once __DIR__ . '/_perfect_attendance.php';

// Allowed Attendance Geofence Locations
const ALLOWED_GEOFENCE_LOCATIONS = [
    [
        'id' => 'ncst_main',
        'name' => 'NCST Main Campus',
        'address' => 'Felix Amada building / NCST Building 2, Dasmariñas, Cavite',
        'lat' => 14.327472,  // 14°19'38.9"N
        'lng' => 120.940472, // 120°56'25.7"E
        'radius_meters' => 1000 // 1.0 km
    ],
    [
        'id' => 'user_testing_location',
        'name' => 'Testing Location (General Trias)',
        'address' => 'Bella Vista / General Trias, Cavite (Test Zone)',
        'lat' => 14.335944,  // 14°20'09.4"N
        'lng' => 120.915667, // 120°54'56.4"E
        'radius_meters' => 1000 // 1.0 km
    ]
];

const GEOFENCE_MAX_RADIUS_METERS = 1000.0;

function haversine_distance_meters(float $lat1, float $lon1, float $lat2, float $lon2): float
{
    $earthRadius = 6371000.0;
    $dLat = deg2rad($lat2 - $lat1);
    $dLon = deg2rad($lon2 - $lon1);
    $a = sin($dLat / 2) * sin($dLat / 2) +
         cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
         sin($dLon / 2) * sin($dLon / 2);
    $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
    return $earthRadius * $c;
}

function euclidean_distance(array $a, array $b): float
{
    if (count($a) !== count($b)) return 1.0;
    $sum = 0.0;
    for ($i = 0; $i < count($a); $i++) {
        $diff = (float)$a[$i] - (float)$b[$i];
        $sum += $diff * $diff;
    }
    return sqrt($sum);
}

function ensure_attendance_schema(PDO $pdo): void
{
    static $ready = false;
    if ($ready) return;

    $pdo->exec('
        CREATE TABLE IF NOT EXISTS sa_attendance_logs (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            sa_profile_id INT UNSIGNED NOT NULL,
            user_id INT UNSIGNED NOT NULL,
            semester_id INT UNSIGNED DEFAULT NULL,
            log_type ENUM("CHECK_IN", "BREAK_OUT", "BREAK_IN", "CHECK_OUT") NOT NULL,
            logged_at DATETIME NOT NULL,
            latitude DECIMAL(10, 8) NULL,
            longitude DECIMAL(11, 8) NULL,
            distance_meters DECIMAL(10, 2) NULL,
            location_name VARCHAR(150) DEFAULT NULL,
            verification_status ENUM("VERIFIED", "FAILED") DEFAULT "VERIFIED",
            confidence_score DECIMAL(5, 2) DEFAULT NULL,
            photo_path VARCHAR(255) DEFAULT NULL,
            notes TEXT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sa_date (sa_profile_id, logged_at),
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ');

    $pdo->exec('
        CREATE TABLE IF NOT EXISTS sa_attendance_reconciliations (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            semester_id INT UNSIGNED NOT NULL,
            sa_profile_id INT UNSIGNED NOT NULL,
            assignment_id INT UNSIGNED DEFAULT NULL,
            duty_date DATE NOT NULL,
            status ENUM("PRESENT", "LATE", "ABSENT", "EXCUSED", "INCOMPLETE", "PENDING_VERIFICATION") NOT NULL,
            reconciliation_status ENUM("SYSTEM_GENERATED", "VERIFIED", "RECONCILED", "DISPUTED", "ADJUSTED") NOT NULL DEFAULT "SYSTEM_GENERATED",
            scheduled_start TIME DEFAULT NULL,
            scheduled_end TIME DEFAULT NULL,
            actual_time_in TIME DEFAULT NULL,
            actual_time_out TIME DEFAULT NULL,
            actual_break_out TIME DEFAULT NULL,
            actual_break_in TIME DEFAULT NULL,
            recorded_hours DECIMAL(5, 2) DEFAULT 0.00,
            credited_hours DECIMAL(5, 2) DEFAULT 0.00,
            late_minutes INT UNSIGNED DEFAULT 0,
            undertime_minutes INT UNSIGNED DEFAULT 0,
            overtime_hours DECIMAL(5, 2) DEFAULT 0.00,
            face_verified TINYINT(1) DEFAULT 0,
            gps_verified TINYINT(1) DEFAULT 0,
            verification_notes TEXT DEFAULT NULL,
            reconciled_by INT UNSIGNED DEFAULT NULL,
            reconciled_at DATETIME DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_sa_duty (sa_profile_id, duty_date, scheduled_start),
            INDEX idx_duty_date (duty_date),
            INDEX idx_status (status),
            INDEX idx_reconciliation (reconciliation_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ');

    // Add supervisor review workflow columns to sa_attendance_reconciliations if missing
    try {
        $cols = $pdo->query('SHOW COLUMNS FROM sa_attendance_reconciliations')->fetchAll(PDO::FETCH_COLUMN);
        if (!in_array('review_status', $cols, true)) {
            $pdo->exec("ALTER TABLE sa_attendance_reconciliations ADD COLUMN review_status VARCHAR(50) NOT NULL DEFAULT 'NOT_YET_REVIEWED'");
        }
        if (!in_array('reviewed_by', $cols, true)) {
            $pdo->exec("ALTER TABLE sa_attendance_reconciliations ADD COLUMN reviewed_by INT UNSIGNED DEFAULT NULL");
        }
        if (!in_array('reviewed_at', $cols, true)) {
            $pdo->exec("ALTER TABLE sa_attendance_reconciliations ADD COLUMN reviewed_at DATETIME DEFAULT NULL");
        }
        if (!in_array('review_notes', $cols, true)) {
            $pdo->exec("ALTER TABLE sa_attendance_reconciliations ADD COLUMN review_notes TEXT DEFAULT NULL");
        }
        if (!in_array('rejection_reason', $cols, true)) {
            $pdo->exec("ALTER TABLE sa_attendance_reconciliations ADD COLUMN rejection_reason TEXT DEFAULT NULL");
        }
        if (!in_array('escalation_reason', $cols, true)) {
            $pdo->exec("ALTER TABLE sa_attendance_reconciliations ADD COLUMN escalation_reason TEXT DEFAULT NULL");
        }
        if (!in_array('break_deduction', $cols, true)) {
            $pdo->exec("ALTER TABLE sa_attendance_reconciliations ADD COLUMN break_deduction DECIMAL(5, 2) NOT NULL DEFAULT 0.00 AFTER recorded_hours");
        }
    } catch (\Throwable $e) {}

    $ready = true;
}

/**
 * Resolve a Supervisor's authorized department and office scope.
 */
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

    $initials = '';
    $fn = trim((string)($sup['first_name'] ?? ''));
    $ln = trim((string)($sup['last_name'] ?? ''));
    if ($fn && $ln) {
        $initials = strtoupper(substr($fn, 0, 1) . substr($ln, 0, 1));
    } else {
        $parts = preg_split('/\s+/', trim((string)$sup['full_name']));
        if (count($parts) >= 2) {
            $initials = strtoupper(substr($parts[0], 0, 1) . substr($parts[count($parts) - 1], 0, 1));
        } else {
            $initials = strtoupper(substr($parts[0] ?? 'SU', 0, 2));
        }
    }

    return [
        'id' => (int)$sup['id'],
        'empId' => $sup['username'],
        'name' => $sup['full_name'],
        'initials' => $initials ?: 'JD',
        'category' => $cat,
        'officeIds' => $officeIds,
        'departments' => $officeNames,
        'primaryDept' => $primaryDept,
        'deptDisplayName' => $deptDisplayName,
        'scopeLabel' => implode(', ', $officeNames) ?: $cat,
    ];
}

/**
 * Get all active S.A.s strictly scoped to a supervisor's supervision.
 */
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

ensure_attendance_schema($pdo);
$user = require_auth();

$action = input()['action'] ?? $_GET['action'] ?? '';

// Coordinator and Admin Attendance Management Actions
$coordinatorActions = [
    'coordinator_dashboard',
    'coordinator_daily_records',
    'coordinator_record_detail',
    'coordinator_past_dates',
    'coordinator_exceptions',
    'coordinator_verify_record',
    'coordinator_reconcile_record',
    'coordinator_manual_entry',
    'coordinator_overtime_summary',
    'coordinator_export_report',
    'send_attendance_sms',
    'perfect_attendance_summary',
    'perfect_attendance_verify',
    'perfect_attendance_notification_details',
    'coordinator_streaks_overview',
    'save_mystery_token'
];

// Supervisor S.A. Attendance Review Actions (Strictly Scoped)
$supervisorActions = [
    'supervisor_attendance_dashboard',
    'supervisor_attendance_records',
    'supervisor_record_detail',
    'supervisor_review_attendance',
    'supervisor_process_correction',
    'send_attendance_sms'
];

if (in_array($action, $coordinatorActions, true)) {
    require_role($user, 'ADMIN', 'SUPERVISOR');
} else if (in_array($action, $supervisorActions, true)) {
    require_role($user, 'SUPERVISOR', 'ADMIN');
} else {
    // S.A. Face Biometrics & Attendance Capture Actions
    if ($user['role'] === 'SA') {
        $stmt = $pdo->prepare('
            SELECT p.*, o.name AS office_name, sup.full_name AS supervisor_name
            FROM sa_profiles p
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN users sup ON sup.id = p.supervisor_id
            WHERE p.user_id = ? LIMIT 1
        ');
        $stmt->execute([$user['id']]);
        $saProfile = $stmt->fetch();
        if (!$saProfile) {
            fail('No Student Assistant profile found for this account.', 404);
        }
        $saProfileId = (int)$saProfile['id'];
    } else if ($user['role'] === 'ADMIN') {
        // For admin testing/previewing
        $targetSaId = (int)(input()['saProfileId'] ?? 0);
        if ($targetSaId > 0) {
            $stmt = $pdo->prepare('
                SELECT p.*, o.name AS office_name, sup.full_name AS supervisor_name
                FROM sa_profiles p
                LEFT JOIN offices o ON o.id = p.office_id
                LEFT JOIN users sup ON sup.id = p.supervisor_id
                WHERE p.id = ? LIMIT 1
            ');
            $stmt->execute([$targetSaId]);
            $saProfile = $stmt->fetch();
            if ($saProfile) $saProfileId = (int)$saProfile['id'];
        }
        if (!$saProfileId) {
            $stmt = $pdo->query('
                SELECT p.*, o.name AS office_name, sup.full_name AS supervisor_name
                FROM sa_profiles p
                LEFT JOIN offices o ON o.id = p.office_id
                LEFT JOIN users sup ON sup.id = p.supervisor_id
                ORDER BY p.id DESC LIMIT 1
            ');
            $saProfile = $stmt->fetch();
            if ($saProfile) $saProfileId = (int)$saProfile['id'];
        }
    } else {
        fail('Only Student Assistants can access attendance capture.', 403);
    }
}

switch ($action) {
    case 'status':
        // Retrieve face biometrics
        $bioStmt = $pdo->prepare('SELECT id, face_descriptor, photo_path, status, updated_at, created_at FROM sa_biometrics WHERE sa_profile_id = ? LIMIT 1');
        $bioStmt->execute([$saProfileId]);
        $bio = $bioStmt->fetch();

        $hasBiometrics = false;
        $descriptor = null;
        if ($bio && !empty($bio['face_descriptor'])) {
            $descArr = json_decode($bio['face_descriptor'], true);
            if (is_array($descArr) && count($descArr) === 128) {
                $hasBiometrics = true;
                $descriptor = $descArr;
            }
        }

        // Active semester
        $semStmt = $pdo->query('SELECT id, academic_year, term, status FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSem = $semStmt->fetch();

        // Today's logs
        $today = date('Y-m-d');
        $logStmt = $pdo->prepare('
            SELECT id, log_type, logged_at, location_name, distance_meters, verification_status, confidence_score, photo_path
            FROM sa_attendance_logs
            WHERE sa_profile_id = ? AND DATE(logged_at) = ?
            ORDER BY logged_at ASC
        ');
        $logStmt->execute([$saProfileId, $today]);
        $todayLogs = $logStmt->fetchAll();

        // Format today's logs
        $formattedLogs = array_map(function($l) {
            return [
                'id' => (int)$l['id'],
                'logType' => $l['log_type'],
                'time' => date('h:i A', strtotime($l['logged_at'])),
                'timestamp' => $l['logged_at'],
                'locationName' => $l['location_name'],
                'distanceMeters' => (float)$l['distance_meters'],
                'confidenceScore' => (float)$l['confidence_score'],
                'photoUrl' => $l['photo_path']
            ];
        }, $todayLogs);

        // Determine current expected state
        $latest = !empty($formattedLogs) ? $formattedLogs[count($formattedLogs) - 1] : null;

        // Fetch official assigned duty schedules for this SA
        $semId = $activeSem ? (int)$activeSem['id'] : null;

        $dutyQuery = '
            SELECT a.id, a.day_of_week, a.start_time, a.end_time, a.location, a.department,
                   a.requirement_type, u.full_name AS supervisor_name
            FROM schedule_assignments a
            LEFT JOIN users u ON u.id = a.supervisor_id
            WHERE a.sa_profile_id = ?
        ';
        $params = [$saProfileId];
        if ($semId) {
            $dutyQuery .= ' AND a.semester_id = ? ';
            $params[] = $semId;
        }
        $dutyQuery .= ' ORDER BY FIELD(a.day_of_week, "MON","TUE","WED","THU","FRI","SAT","SUN"), a.start_time ASC ';
        $dutyStmt = $pdo->prepare($dutyQuery);
        $dutyStmt->execute($params);
        $rawDuty = $dutyStmt->fetchAll();

        // Fallback without semester if none found with semester constraint
        if (empty($rawDuty) && $semId) {
            $dutyStmt = $pdo->prepare('
                SELECT a.id, a.day_of_week, a.start_time, a.end_time, a.location, a.department,
                       a.requirement_type, u.full_name AS supervisor_name
                FROM schedule_assignments a
                LEFT JOIN users u ON u.id = a.supervisor_id
                WHERE a.sa_profile_id = ?
                ORDER BY FIELD(a.day_of_week, "MON","TUE","WED","THU","FRI","SAT","SUN"), a.start_time ASC
            ');
            $dutyStmt->execute([$saProfileId]);
            $rawDuty = $dutyStmt->fetchAll();
        }

        $todayDayCode = strtoupper(date('D')); // e.g. "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"
        $dayNames = [
            'MON' => 'Monday',
            'TUE' => 'Tuesday',
            'WED' => 'Wednesday',
            'THU' => 'Thursday',
            'FRI' => 'Friday',
            'SAT' => 'Saturday',
            'SUN' => 'Sunday'
        ];
        $todayDayName = $dayNames[$todayDayCode] ?? date('l');

        $weeklyDuty = [];
        $todayShifts = [];

        foreach ($rawDuty as $d) {
            $startMins = (int)date('H', strtotime($d['start_time'])) * 60 + (int)date('i', strtotime($d['start_time']));
            $endMins = (int)date('H', strtotime($d['end_time'])) * 60 + (int)date('i', strtotime($d['end_time']));
            $rawHours = round(max(0, $endMins - $startMins) / 60, 1);

            $shiftItem = [
                'id' => (int)$d['id'],
                'day' => $d['day_of_week'],
                'dayName' => $dayNames[$d['day_of_week']] ?? $d['day_of_week'],
                'startTime' => $d['start_time'],
                'endTime' => $d['end_time'],
                'startLabel' => date('g:i A', strtotime($d['start_time'])),
                'endLabel' => date('g:i A', strtotime($d['end_time'])),
                'location' => $d['location'] ?? ($saProfile['office_name'] ?? 'Assigned Station'),
                'department' => $d['department'] ?? 'Office',
                'requirementType' => $d['requirement_type'] ?? 'OFFICE',
                'supervisor' => $d['supervisor_name'] ?? ($saProfile['supervisor_name'] ?? null),
                'hours' => $rawHours
            ];

            $weeklyDuty[] = $shiftItem;

            if ($d['day_of_week'] === $todayDayCode) {
                $todayShifts[] = $shiftItem;
            }
        }

        // Fallback for Office SAs without individual custom schedule rows
        $isDefaultOfficeHours = false;
        if (empty($todayShifts) && !empty($saProfile['office_name']) && in_array($todayDayCode, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
            $isDefaultOfficeHours = true;
            $isSat = ($todayDayCode === 'SAT');
            $defStart = '08:00:00';
            $defEnd = $isSat ? '12:00:00' : '17:00:00';
            $todayShifts[] = [
                'id' => 0,
                'day' => $todayDayCode,
                'dayName' => $todayDayName,
                'startTime' => $defStart,
                'endTime' => $defEnd,
                'startLabel' => date('g:i A', strtotime($defStart)),
                'endLabel' => date('g:i A', strtotime($defEnd)),
                'location' => $saProfile['office_name'],
                'department' => 'OFFICE',
                'requirementType' => 'OFFICE',
                'supervisor' => $saProfile['supervisor_name'] ?? null,
                'hours' => $isSat ? 4.0 : 8.0,
                'isDefault' => true
            ];
        }

        $currentTimeMins = (int)date('H') * 60 + (int)date('i');
        $activeShift = null;
        if (!empty($todayShifts)) {
            foreach ($todayShifts as $s) {
                $sM = (int)date('H', strtotime($s['startTime'])) * 60 + (int)date('i', strtotime($s['startTime']));
                $eM = (int)date('H', strtotime($s['endTime'])) * 60 + (int)date('i', strtotime($s['endTime']));
                if ($currentTimeMins >= $sM - 60 && $currentTimeMins <= $eM + 60) {
                    $activeShift = $s;
                    break;
                }
            }
            if ($activeShift === null) {
                $activeShift = $todayShifts[0];
            }
        }

        $todayDuty = [
            'hasDutyToday' => !empty($todayShifts),
            'dayCode' => $todayDayCode,
            'dayName' => $todayDayName,
            'dateFormatted' => date('l, F j, Y'),
            'expectedCheckIn' => !empty($todayShifts) ? $todayShifts[0]['startLabel'] : null,
            'expectedCheckOut' => !empty($todayShifts) ? $todayShifts[count($todayShifts) - 1]['endLabel'] : null,
            'expectedStartTime' => !empty($todayShifts) ? $todayShifts[0]['startTime'] : null,
            'expectedEndTime' => !empty($todayShifts) ? $todayShifts[count($todayShifts) - 1]['endTime'] : null,
            'primaryLocation' => !empty($todayShifts) ? $todayShifts[0]['location'] : ($saProfile['office_name'] ?? 'Not Assigned'),
            'supervisor' => !empty($todayShifts) ? ($todayShifts[0]['supervisor'] ?? ($saProfile['supervisor_name'] ?? null)) : null,
            'shifts' => $todayShifts,
            'activeShift' => $activeShift,
            'isDefault' => $isDefaultOfficeHours,
            'totalHours' => array_sum(array_column($todayShifts, 'hours'))
        ];

        respond([
            'success' => true,
            'sa' => [
                'id' => $saProfileId,
                'name' => trim(($saProfile['first_name'] ?? '') . ' ' . ($saProfile['last_name'] ?? '')),
                'studentId' => $saProfile['student_id'] ?? '',
                'saNumber' => $saProfile['sa_number'] ?? '',
                'course' => $saProfile['course'] ?? '',
                'officeName' => $saProfile['office_name'] ?? '',
                'supervisorName' => $saProfile['supervisor_name'] ?? '',
                'hasBiometrics' => $hasBiometrics,
                'biometricPhoto' => $bio['photo_path'] ?? null,
                'descriptor' => $descriptor
            ],
            'todayDuty' => $todayDuty,
            'weeklyDuty' => $weeklyDuty,
            'todayLogs' => $formattedLogs,
            'latestLog' => $latest,
            'allowedLocations' => ALLOWED_GEOFENCE_LOCATIONS,
            'maxRadiusMeters' => GEOFENCE_MAX_RADIUS_METERS,
            'serverTime' => date('Y-m-d H:i:s')
        ]);

    case 'log':
        require_csrf();

        $logType = strtoupper(trim(input()['logType'] ?? ''));
        if (in_array($logType, ['BREAK_OUT', 'BREAK_IN'], true)) {
            fail('Manual break logging is discontinued. A standard 1-hour unpaid meal break (12:00 NN–1:00 PM) is automatically deducted from your attendance hours.', 422);
        }
        if (!in_array($logType, ['CHECK_IN', 'CHECK_OUT'], true)) {
            fail('Invalid attendance action. Must be CHECK_IN or CHECK_OUT.', 422);
        }

        // Validate Coordinates
        $lat = isset(input()['latitude']) ? (float)input()['latitude'] : null;
        $lng = isset(input()['longitude']) ? (float)input()['longitude'] : null;

        if ($lat === null || $lng === null || ($lat === 0.0 && $lng === 0.0)) {
            fail('Location coordinates are required. Please enable GPS / location permissions on your device.', 422);
        }

        // Calculate Geofence distance
        $targetLocationId = trim(input()['targetLocationId'] ?? '');
        $targetLocation = null;
        if (!empty($targetLocationId)) {
            foreach (ALLOWED_GEOFENCE_LOCATIONS as $loc) {
                if ($loc['id'] === $targetLocationId) {
                    $targetLocation = $loc;
                    break;
                }
            }
        }

        if ($targetLocation !== null) {
            $dist = haversine_distance_meters($lat, $lng, (float)$targetLocation['lat'], (float)$targetLocation['lng']);
            if ($dist > GEOFENCE_MAX_RADIUS_METERS) {
                $distKm = round($dist / 1000, 2);
                $distM = round($dist);
                fail(
                    "Outside Authorized Area! You are {$distM}m ({$distKm}km) away from {$targetLocation['name']}. You must be within 1,000 meters (1km) to record attendance.",
                    403,
                    [
                        'outOfRange' => true,
                        'distanceMeters' => $distM,
                        'targetLocation' => $targetLocation['name'],
                        'maxRadiusMeters' => GEOFENCE_MAX_RADIUS_METERS
                    ]
                );
            }
            $nearestLocation = $targetLocation;
            $minDistance = $dist;
        } else {
            $nearestLocation = null;
            $minDistance = INF;

            foreach (ALLOWED_GEOFENCE_LOCATIONS as $loc) {
                $dist = haversine_distance_meters($lat, $lng, (float)$loc['lat'], (float)$loc['lng']);
                if ($dist < $minDistance) {
                    $minDistance = $dist;
                    $nearestLocation = $loc;
                }
            }

            // 1km (1,000 meters) range limit check
            if ($minDistance > GEOFENCE_MAX_RADIUS_METERS) {
                $distKm = round($minDistance / 1000, 2);
                $distM = round($minDistance);
                fail(
                    "Outside Authorized Area! You are {$distM}m ({$distKm}km) away from {$nearestLocation['name']}. You must be within 1,000 meters (1km) of an authorized campus location to record attendance.",
                    403,
                    [
                        'outOfRange' => true,
                        'distanceMeters' => round($minDistance),
                        'nearestLocation' => $nearestLocation['name'],
                        'maxRadiusMeters' => GEOFENCE_MAX_RADIUS_METERS
                    ]
                );
            }
        }

        // Validate Face Biometrics
        $bioStmt = $pdo->prepare('SELECT face_descriptor FROM sa_biometrics WHERE sa_profile_id = ? LIMIT 1');
        $bioStmt->execute([$saProfileId]);
        $bio = $bioStmt->fetch();

        if (!$bio || empty($bio['face_descriptor'])) {
            fail('Facial biometric profile is not registered. Please contact the S.A. Coordinator to enroll your face biometrics.', 403);
        }

        $regDescriptor = json_decode($bio['face_descriptor'], true);
        if (!is_array($regDescriptor) || count($regDescriptor) !== 128) {
            fail('Registered face profile is invalid. Please re-register your face with the Coordinator.', 400);
        }

        // Validate Live Face Biometrics (SariSmart standard: FaceMatcher threshold <= 0.50)
        $liveDescriptor = input()['descriptor'] ?? null;
        if (empty($liveDescriptor)) {
            fail('Live facial biometric descriptor is required. Please capture your face using the camera.', 422);
        }

        $liveArr = is_string($liveDescriptor) ? json_decode($liveDescriptor, true) : $liveDescriptor;
        if (!is_array($liveArr) || count($liveArr) !== 128) {
            fail('Invalid biometric descriptor received from camera.', 422);
        }

        $matchDistance = euclidean_distance($regDescriptor, $liveArr);

        // Strict Euclidean threshold (SariSmart standard <= 0.50; rejection for non-matching persons)
        if ($matchDistance > 0.50) {
            fail('Access Denied: Face does not match the registered Student Assistant profile (Difference: ' . round($matchDistance, 3) . ').', 403, [
                'faceMismatch' => true,
                'distance' => round($matchDistance, 3)
            ]);
        }

        $confidenceScore = isset(input()['confidence']) ? (float)input()['confidence'] : null;
        if ($confidenceScore === null) {
            $confidenceScore = max(0, min(100, round((1.0 - $matchDistance) * 100, 1)));
        }

        // Save Photo Snapshot
        $photoBase64 = input()['photo'] ?? input()['snapshot'] ?? null;
        $photoPath = null;
        if (!empty($photoBase64) && str_starts_with($photoBase64, 'data:image/')) {
            $uploadDir = __DIR__ . '/../uploads/attendance';
            if (!is_dir($uploadDir)) @mkdir($uploadDir, 0777, true);

            if (preg_match('/^data:image\/(\w+);base64,/', $photoBase64, $m)) {
                $ext = strtolower($m[1]) === 'png' ? 'png' : 'jpg';
                $data = substr($photoBase64, strpos($photoBase64, ',') + 1);
                $decoded = base64_decode($data);
                if ($decoded !== false) {
                    $filename = 'attend_' . $saProfileId . '_' . strtolower($logType) . '_' . time() . '.' . $ext;
                    $targetFile = $uploadDir . '/' . $filename;
                    if (file_put_contents($targetFile, $decoded)) {
                        $photoPath = 'uploads/attendance/' . $filename;
                    }
                }
            }
        }

        // Active semester
        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = $semStmt->fetchColumn() ?: null;

        $now = date('Y-m-d H:i:s');
        $locationName = $nearestLocation['name'];

        $insStmt = $pdo->prepare('
            INSERT INTO sa_attendance_logs (
                sa_profile_id, user_id, semester_id, log_type, logged_at,
                latitude, longitude, distance_meters, location_name,
                verification_status, confidence_score, photo_path, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "VERIFIED", ?, ?, NOW())
        ');
        $insStmt->execute([
            $saProfileId,
            $user['id'],
            $activeSemId,
            $logType,
            $now,
            $lat,
            $lng,
            round($minDistance, 2),
            $locationName,
            $confidenceScore ?: 95.0,
            $photoPath
        ]);

        $logId = (int)$pdo->lastInsertId();

        $actionLabels = [
            'CHECK_IN' => 'Checked In (Shift Start)',
            'BREAK_OUT' => 'Break Out (Break Start)',
            'BREAK_IN' => 'Break In (Break End)',
            'CHECK_OUT' => 'Checked Out (Shift End)'
        ];
        $label = $actionLabels[$logType] ?? $logType;

        audit('SA_ATTENDANCE_' . $logType, "Logged {$label} at {$locationName} (" . round($minDistance) . "m away)");

        // Determine attendance status for SMS Notification via Semaphore
        $todayDay = strtoupper(date('D', strtotime($now)));
        $schedStart = null;
        $schedEnd = null;
        $schedHours = 0.0;

        $semStmt = $pdo->query('SELECT * FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSem = $semStmt->fetch() ?: null;
        $activeSemId = $activeSem ? (int)$activeSem['id'] : 0;

        $schedQuery = '
            SELECT start_time, end_time, location, department FROM schedule_assignments
            WHERE sa_profile_id = ? AND day_of_week = ?
        ';
        $schedParams = [$saProfileId, $todayDay];
        if ($activeSemId) {
            $schedQuery .= ' AND (semester_id = ? OR semester_id IS NULL) ';
            $schedParams[] = $activeSemId;
        }
        $schedQuery .= ' ORDER BY start_time ASC ';
        $schedStmt = $pdo->prepare($schedQuery);
        $schedStmt->execute($schedParams);
        $shiftsToday = $schedStmt->fetchAll();

        if (!empty($shiftsToday)) {
            $schedStart = $shiftsToday[0]['start_time'];
            $schedEnd = $shiftsToday[count($shiftsToday) - 1]['end_time'];
            foreach ($shiftsToday as $sh) {
                $schedHours += max(0, (strtotime($sh['end_time']) - strtotime($sh['start_time'])) / 3600);
            }
        } elseif (!empty($saProfile['office_name']) && in_array($todayDay, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
            $schedStart = '08:00:00';
            $schedEnd = ($todayDay === 'SAT') ? '12:00:00' : '17:00:00';
            $schedHours = ($todayDay === 'SAT') ? 4.0 : 8.0;
        }

        $logTime = date('g:i A', strtotime($now));
        $smsStatusType = 'PRESENT';
        $smsCtx = [
            'time' => $logTime,
            'date' => date('M d, Y', strtotime($now)),
            'location' => $locationName,
            'schedStart' => $schedStart ? date('g:i A', strtotime($schedStart)) : null,
            'schedEnd' => $schedEnd ? date('g:i A', strtotime($schedEnd)) : null
        ];

        if ($logType === 'CHECK_IN') {
            if ($schedStart) {
                $nowTime = strtotime(date('H:i:s', strtotime($now)));
                $sTime = strtotime($schedStart);
                if ($nowTime > ($sTime + 15 * 60)) {
                    $smsStatusType = 'LATE';
                    $smsCtx['lateMinutes'] = round(($nowTime - $sTime) / 60);
                } else {
                    $smsStatusType = 'PRESENT';
                }
            } else {
                $smsStatusType = 'PRESENT';
            }
        } elseif ($logType === 'CHECK_OUT') {
            $firstInStmt = $pdo->prepare('
                SELECT logged_at FROM sa_attendance_logs
                WHERE sa_profile_id = ? AND DATE(logged_at) = ? AND log_type = "CHECK_IN"
                ORDER BY logged_at ASC LIMIT 1
            ');
            $firstInStmt->execute([$saProfileId, date('Y-m-d', strtotime($now))]);
            $firstInTime = $firstInStmt->fetchColumn();

            $elapsedHours = 0.0;
            $creditedHours = 0.0;
            $hCalc = null;
            if ($firstInTime) {
                $hCalc = compute_daily_attendance_hours($firstInTime, $now, $schedHours);
                $elapsedHours = $hCalc['elapsedHours'];
                $creditedHours = $hCalc['creditedHours'];
            }
            $smsCtx['hours'] = $creditedHours ?: $elapsedHours;

            if ($schedEnd) {
                $nowTime = strtotime(date('H:i:s', strtotime($now)));
                $eTime = strtotime($schedEnd);
                if ($nowTime < ($eTime - 15 * 60)) {
                    $smsStatusType = 'UNDERTIME';
                    $smsCtx['undertimeMinutes'] = round(($eTime - $nowTime) / 60);
                } elseif ($nowTime > ($eTime + 30 * 60) || ($schedHours > 0 && $creditedHours > $schedHours)) {
                    $smsStatusType = 'OVERTIME';
                    $smsCtx['overtimeHours'] = max(0, round(($nowTime - $eTime) / 3600, 1));
                } else {
                    $smsStatusType = 'COMPLETED';
                }
            } else {
                $smsStatusType = 'COMPLETED';
            }

            // Record reconciliation entry into sa_attendance_reconciliations
            if ($firstInTime) {
                try {
                    $dutyDate = date('Y-m-d', strtotime($now));
                    $actIn = date('H:i:s', strtotime($firstInTime));
                    $actOut = date('H:i:s', strtotime($now));
                    $finalStatus = $smsStatusType === 'COMPLETED' ? 'PRESENT' : $smsStatusType;
                    if (!in_array($finalStatus, ['PRESENT', 'LATE', 'UNDERTIME', 'OVERTIME', 'ABSENT', 'EXCUSED', 'INCOMPLETE', 'PENDING_VERIFICATION', 'FOR_REVIEW'], true)) {
                        $finalStatus = 'PRESENT';
                    }
                    $lMins = (int)($smsCtx['lateMinutes'] ?? 0);
                    if ($lMins === 0 && $schedStart) {
                        $inMins = strtotime($actIn);
                        $sMins = strtotime($schedStart);
                        if ($inMins > ($sMins + 15 * 60)) {
                            $lMins = round(($inMins - $sMins) / 60);
                        }
                    }
                    $uMins = (int)($smsCtx['undertimeMinutes'] ?? 0);
                    $oHrs = (float)($smsCtx['overtimeHours'] ?? 0.0);
                    $brkDed = (float)($hCalc['breakDeduction'] ?? 0.0);

                    $upsertRec = $pdo->prepare('
                        INSERT INTO sa_attendance_reconciliations (
                            semester_id, sa_profile_id, duty_date, status, reconciliation_status,
                            scheduled_start, scheduled_end, actual_time_in, actual_time_out,
                            recorded_hours, break_deduction, credited_hours,
                            late_minutes, undertime_minutes, overtime_hours,
                            face_verified, gps_verified
                        ) VALUES (
                            ?, ?, ?, ?, "SYSTEM_GENERATED",
                            ?, ?, ?, ?,
                            ?, ?, ?,
                            ?, ?, ?,
                            1, 1
                        ) ON DUPLICATE KEY UPDATE
                            status = VALUES(status),
                            actual_time_in = VALUES(actual_time_in),
                            actual_time_out = VALUES(actual_time_out),
                            recorded_hours = VALUES(recorded_hours),
                            break_deduction = VALUES(break_deduction),
                            credited_hours = VALUES(credited_hours),
                            late_minutes = VALUES(late_minutes),
                            undertime_minutes = VALUES(undertime_minutes),
                            overtime_hours = VALUES(overtime_hours),
                            scheduled_start = COALESCE(VALUES(scheduled_start), scheduled_start),
                            scheduled_end = COALESCE(VALUES(scheduled_end), scheduled_end)
                    ');
                    $upsertRec->execute([
                        $activeSemId ?: 1,
                        $saProfileId,
                        $dutyDate,
                        $finalStatus,
                        $schedStart,
                        $schedEnd,
                        $actIn,
                        $actOut,
                        $elapsedHours,
                        $brkDed,
                        $creditedHours,
                        $lMins,
                        $uMins,
                        $oHrs
                    ]);
                } catch (Throwable $_) {}
            }
        }

        // Send SMS via Semaphore
        $smsResult = send_attendance_status_sms($saProfileId, $smsStatusType, $smsCtx);

        respond([
            'success' => true,
            'message' => "Successfully {$label} at {$locationName}!",
            'statusType' => $smsStatusType,
            'smsNotification' => [
                'sent' => $smsResult['success'] ?? false,
                'status' => $smsStatusType,
                'phone' => $smsResult['phone'] ?? null
            ],
            'log' => [
                'id' => $logId,
                'logType' => $logType,
                'label' => $label,
                'time' => date('h:i A', strtotime($now)),
                'timestamp' => $now,
                'locationName' => $locationName,
                'distanceMeters' => round($minDistance),
                'confidenceScore' => $confidenceScore ?: 95.0,
                'photoUrl' => $photoPath
            ]
        ]);

    case 'history':
        $limit = min(50, max(5, (int)(input()['limit'] ?? 20)));
        $stmt = $pdo->prepare('
            SELECT id, log_type, logged_at, location_name, distance_meters, verification_status, confidence_score, photo_path
            FROM sa_attendance_logs
            WHERE sa_profile_id = ?
            ORDER BY logged_at DESC
            LIMIT ?
        ');
        $stmt->bindValue(1, $saProfileId, PDO::PARAM_INT);
        $stmt->bindValue(2, $limit, PDO::PARAM_INT);
        $stmt->execute();

        $rows = array_map(function($r) {
            return [
                'id' => (int)$r['id'],
                'logType' => $r['log_type'],
                'date' => date('M d, Y', strtotime($r['logged_at'])),
                'time' => date('h:i A', strtotime($r['logged_at'])),
                'timestamp' => $r['logged_at'],
                'locationName' => $r['location_name'],
                'distanceMeters' => (float)$r['distance_meters'],
                'confidenceScore' => (float)$r['confidence_score'],
                'photoUrl' => $r['photo_path']
            ];
        }, $stmt->fetchAll());

        respond([
            'success' => true,
            'logs' => $rows
        ]);

    // =========================================================================
    // S.A. COORDINATOR ATTENDANCE MODULE ACTIONS
    // =========================================================================

    case 'coordinator_dashboard':
        // High-level summary cards, recent attendance stream, and quick filters
        $date = trim(input()['date'] ?? $_GET['date'] ?? date('Y-m-d'));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = date('Y-m-d');
        }

        $dow = strtoupper(date('D', strtotime($date)));
        $dayCode = match($dow) {
            'MON' => 'MON',
            'TUE' => 'TUE',
            'WED' => 'WED',
            'THU' => 'THU',
            'FRI' => 'FRI',
            'SAT' => 'SAT',
            default => 'SUN'
        };

        // Active semester
        $semStmt = $pdo->query('SELECT * FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSem = $semStmt->fetch() ?: null;
        $activeSemId = $activeSem ? (int)$activeSem['id'] : 0;

        // Total scheduled S.A.s for this day of week
        $totScheduledStmt = $pdo->prepare('
            SELECT COUNT(DISTINCT sa_profile_id)
            FROM schedule_assignments
            WHERE semester_id = ? AND day_of_week = ?
        ');
        $totScheduledStmt->execute([$activeSemId, $dayCode]);
        $totalScheduled = (int)$totScheduledStmt->fetchColumn();

        // Total active SAs enrolled
        $totActiveSas = (int)$pdo->query('SELECT COUNT(*) FROM sa_profiles WHERE sa_status = "ACTIVE" AND archived_at IS NULL')->fetchColumn();

        // Fetch logs for this date
        $logsStmt = $pdo->prepare('
            SELECT l.*, p.student_id, p.first_name, p.last_name, p.course, p.year_level, p.department_type, o.name AS office_name
            FROM sa_attendance_logs l
            JOIN sa_profiles p ON p.id = l.sa_profile_id
            LEFT JOIN offices o ON o.id = p.office_id
            WHERE DATE(l.logged_at) = ?
            ORDER BY l.logged_at DESC
        ');
        $logsStmt->execute([$date]);
        $dayLogs = $logsStmt->fetchAll();

        // Distinct SAs with CHECK_IN / CHECK_OUT on the selected $date
        $checkInsBySa = [];
        $checkOutsBySa = [];
        foreach ($dayLogs as $l) {
            $saId = (int)$l['sa_profile_id'];
            if ($l['log_type'] === 'CHECK_IN' && !isset($checkInsBySa[$saId])) {
                $checkInsBySa[$saId] = $l;
            }
            if ($l['log_type'] === 'CHECK_OUT' && !isset($checkOutsBySa[$saId])) {
                $checkOutsBySa[$saId] = $l;
            }
        }

        // Live recent attendance activity stream (based on current actual S.A. activity)
        $liveLogsStmt = $pdo->query('
            SELECT l.*, p.student_id, p.first_name, p.last_name, p.course, p.year_level, p.department_type, o.name AS office_name
            FROM sa_attendance_logs l
            JOIN sa_profiles p ON p.id = l.sa_profile_id
            LEFT JOIN offices o ON o.id = p.office_id
            ORDER BY l.logged_at DESC, l.id DESC
            LIMIT 20
        ');
        $liveLogs = $liveLogsStmt ? $liveLogsStmt->fetchAll() : [];

        $typeLabels = [
            'CHECK_IN' => 'Checked In',
            'BREAK_OUT' => 'Break Out',
            'BREAK_IN' => 'Break In',
            'CHECK_OUT' => 'Checked Out'
        ];
        $recentActivity = [];
        $todayStr = date('Y-m-d');

        foreach ($liveLogs as $l) {
            $saId = (int)$l['sa_profile_id'];
            $logDate = date('Y-m-d', strtotime($l['logged_at']));
            $isToday = ($logDate === $todayStr);
            $dateLabel = $isToday ? 'Today' : date('M j', strtotime($l['logged_at']));
            $timeFormatted = date('h:i A', strtotime($l['logged_at']));

            $recentActivity[] = [
                'id' => (int)$l['id'],
                'date' => $logDate,
                'isToday' => $isToday,
                'dateLabel' => $dateLabel,
                'time' => $timeFormatted,
                'displayTime' => $isToday ? $timeFormatted : ($dateLabel . ', ' . $timeFormatted),
                'timestamp' => $l['logged_at'],
                'saId' => $saId,
                'name' => trim($l['first_name'] . ' ' . $l['last_name']),
                'studentId' => $l['student_id'],
                'department' => $l['office_name'] ?: ($l['department_type'] ?: 'Campus'),
                'logType' => $l['log_type'],
                'label' => $typeLabels[$l['log_type']] ?? $l['log_type'],
                'locationName' => $l['location_name'] ?: 'NCST Main Campus',
                'status' => $l['verification_status'] ?: 'VERIFIED',
                'confidence' => (float)$l['confidence_score'],
                'photoUrl' => $l['photo_path']
            ];
        }

        // Compute Present, Late, Undertime, Overtime, Absent, For Review
        $presentCount = count($checkInsBySa);
        $lateCount = 0;
        $undertimeCount = 0;
        $overtimeCount = 0;
        $forReviewCount = 0;

        // Check assigned schedules to determine tardiness against schedule
        $assignmentsStmt = $pdo->prepare('
            SELECT a.sa_profile_id, MIN(a.start_time) as min_start, MAX(a.end_time) as max_end
            FROM schedule_assignments a
            WHERE a.semester_id = ? AND a.day_of_week = ?
            GROUP BY a.sa_profile_id
        ');
        $assignmentsStmt->execute([$activeSemId, $dayCode]);
        $scheduledDutyMap = [];
        foreach ($assignmentsStmt->fetchAll() as $row) {
            $scheduledDutyMap[(int)$row['sa_profile_id']] = $row;
        }

        foreach ($checkInsBySa as $saId => $cin) {
            $sched = $scheduledDutyMap[$saId] ?? null;
            if ($sched && !empty($sched['min_start'])) {
                $actualTime = date('H:i:s', strtotime($cin['logged_at']));
                // Grace period: 15 minutes
                $expectedMins = strtotime($sched['min_start']);
                $actualMins = strtotime($actualTime);
                if ($actualMins > ($expectedMins + 15 * 60)) {
                    $lateCount++;
                }
            }
            $cout = $checkOutsBySa[$saId] ?? null;
            if ($cout && $sched && !empty($sched['max_end'])) {
                $actualOutTime = date('H:i:s', strtotime($cout['logged_at']));
                $expectedEndMins = strtotime($sched['max_end']);
                $actualOutMins = strtotime($actualOutTime);
                if ($actualOutMins < ($expectedEndMins - 15 * 60)) {
                    $undertimeCount++;
                } elseif ($actualOutMins > ($expectedEndMins + 30 * 60)) {
                    $overtimeCount++;
                }
            }
            if ($cin['verification_status'] === 'FAILED' || (float)$cin['confidence_score'] < 60) {
                $forReviewCount++;
            }
        }

        $absentCount = max(0, $totalScheduled - $presentCount);

        // Pending corrections from sa_requests
        $pendingCorrectionsStmt = $pdo->query('
            SELECT COUNT(*) FROM sa_requests
            WHERE status IN ("PENDING_COORDINATOR_RECORDING", "PENDING_SUPERVISOR_REVIEW")
        ');
        $pendingCorrections = (int)$pendingCorrectionsStmt->fetchColumn();

        // Pending reconciliation
        $pendingReconcileStmt = $pdo->prepare('
            SELECT COUNT(*) FROM sa_attendance_reconciliations
            WHERE duty_date = ? AND reconciliation_status = "SYSTEM_GENERATED"
        ');
        $pendingReconcileStmt->execute([$date]);
        $pendingReconcile = (int)$pendingReconcileStmt->fetchColumn();

        respond([
            'success' => true,
            'date' => $date,
            'dayCode' => $dayCode,
            'dayLabel' => date('l, M j, Y', strtotime($date)),
            'currentTime' => date('h:i:s A'),
            'summaryCards' => [
                'totalScheduled' => $totalScheduled,
                'totalActiveSas' => $totActiveSas,
                'presentToday' => $presentCount,
                'lateToday' => $lateCount,
                'undertimeToday' => $undertimeCount,
                'overtimeToday' => $overtimeCount,
                'absentToday' => $absentCount,
                'forReviewCount' => $forReviewCount,
                'pendingCorrections' => $pendingCorrections,
                'pendingReconciliation' => $pendingReconcile,
                'presentPct' => $totalScheduled > 0 ? round(($presentCount / $totalScheduled) * 100) : 0,
                'latePct' => $totalScheduled > 0 ? round(($lateCount / $totalScheduled) * 100) : 0,
                'undertimePct' => $totalScheduled > 0 ? round(($undertimeCount / $totalScheduled) * 100) : 0,
                'absentPct' => $totalScheduled > 0 ? round(($absentCount / $totalScheduled) * 100) : 0,
                'reviewPct' => $totalScheduled > 0 ? round(($forReviewCount / $totalScheduled) * 100) : 0,
            ],
            'recentActivity' => $recentActivity,
            'allowedLocations' => ALLOWED_GEOFENCE_LOCATIONS
        ]);

    case 'coordinator_daily_records':
        $date = trim(input()['date'] ?? $_GET['date'] ?? date('Y-m-d'));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = date('Y-m-d');
        }

        $dow = strtoupper(date('D', strtotime($date)));
        $dayCode = match($dow) {
            'MON' => 'MON',
            'TUE' => 'TUE',
            'WED' => 'WED',
            'THU' => 'THU',
            'FRI' => 'FRI',
            'SAT' => 'SAT',
            default => 'SUN'
        };

        // Active semester
        $semStmt = $pdo->query('SELECT * FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSem = $semStmt->fetch() ?: null;
        $activeSemId = $activeSem ? (int)$activeSem['id'] : 0;

        // Fetch all active SAs who have scheduled duty on this day OR have logged attendance
        $query = '
            SELECT p.id as sa_profile_id, p.student_id, p.sa_number, p.first_name, p.last_name, p.course, p.year_level,
                   p.department_type, p.sa_category, p.hourly_rate, o.name AS office_name,
                   sup.full_name AS supervisor_name,
                   a.id AS assignment_id, a.department AS sched_dept, a.location AS sched_location,
                   a.start_time AS sched_start, a.end_time AS sched_end, a.day_of_week
            FROM sa_profiles p
            LEFT JOIN schedule_assignments a ON a.sa_profile_id = p.id AND a.semester_id = :semId AND a.day_of_week = :dow
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN users sup ON sup.id = p.supervisor_id
            WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL
            ORDER BY p.last_name, p.first_name, a.start_time ASC
        ';
        $stmt = $pdo->prepare($query);
        $stmt->execute(['semId' => $activeSemId, 'dow' => $dayCode]);
        $saRaw = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Fetch all logs for this date
        $logStmt = $pdo->prepare('
            SELECT * FROM sa_attendance_logs
            WHERE DATE(logged_at) = ?
            ORDER BY logged_at ASC
        ');
        $logStmt->execute([$date]);
        $dayLogs = $logStmt->fetchAll(PDO::FETCH_ASSOC);

        $logsBySa = [];
        foreach ($dayLogs as $l) {
            $logsBySa[(int)$l['sa_profile_id']][] = $l;
        }

        // Fetch reconciliations for this date if existing
        $recStmt = $pdo->prepare('
            SELECT * FROM sa_attendance_reconciliations
            WHERE duty_date = ?
        ');
        $recStmt->execute([$date]);
        $recBySa = [];
        foreach ($recStmt->fetchAll(PDO::FETCH_ASSOC) as $rc) {
            $recBySa[(int)$rc['sa_profile_id']] = $rc;
        }

        // Group rows per S.A.
        $grouped = [];
        foreach ($saRaw as $r) {
            $sid = (int)$r['sa_profile_id'];
            if (!isset($grouped[$sid])) {
                $grouped[$sid] = [
                    'saProfileId' => $sid,
                    'studentId' => $r['student_id'],
                    'saNumber' => $r['sa_number'],
                    'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                    'firstName' => $r['first_name'],
                    'lastName' => $r['last_name'],
                    'course' => $r['course'],
                    'yearLevel' => $r['year_level'],
                    'department' => $r['office_name'] ?: ($r['sched_dept'] ?: $r['department_type']),
                    'location' => $r['sched_location'] ?: ($r['office_name'] ?: 'Campus'),
                    'supervisorName' => $r['supervisor_name'] ?: 'Unassigned',
                    'hourlyRate' => (float)($r['hourly_rate'] ?: 8.00),
                    'assignments' => []
                ];
            }
            if ($r['assignment_id']) {
                $grouped[$sid]['assignments'][] = [
                    'id' => (int)$r['assignment_id'],
                    'location' => $r['sched_location'],
                    'startTime' => $r['sched_start'],
                    'endTime' => $r['sched_end'],
                    'startFormatted' => date('h:i A', strtotime($r['sched_start'])),
                    'endFormatted' => date('h:i A', strtotime($r['sched_end'])),
                    'hours' => round((strtotime($r['sched_end']) - strtotime($r['sched_start'])) / 3600, 2)
                ];
            }
        }

        // Construct final records
        $records = [];
        foreach ($grouped as $sid => $g) {
            $saLogs = $logsBySa[$sid] ?? [];
            $hasLogs = !empty($saLogs);

            // Compute first check in, break out, break in, check out
            $checkIn = null;
            $checkOut = null;
            $breakOut = null;
            $breakIn = null;
            $confidence = null;
            $faceVerified = false;
            $gpsVerified = false;
            $photoUrl = null;
            $notes = '';

            foreach ($saLogs as $l) {
                if ($l['log_type'] === 'CHECK_IN' && !$checkIn) {
                    $checkIn = $l;
                    $confidence = (float)$l['confidence_score'];
                    $photoUrl = $l['photo_path'];
                    $faceVerified = $l['verification_status'] === 'VERIFIED';
                    $gpsVerified = (float)$l['distance_meters'] <= 1000.0;
                } elseif ($l['log_type'] === 'BREAK_OUT' && !$breakOut) {
                    $breakOut = $l;
                } elseif ($l['log_type'] === 'BREAK_IN' && !$breakIn) {
                    $breakIn = $l;
                } elseif ($l['log_type'] === 'CHECK_OUT') {
                    $checkOut = $l;
                }
            }

            // Determine scheduled shift times
            $schedStart = null;
            $schedEnd = null;
            $schedHours = 0.0;
            $schedLabel = 'No Schedule Today';

            if (!empty($g['assignments'])) {
                $firstAss = $g['assignments'][0];
                $lastAss = $g['assignments'][count($g['assignments']) - 1];
                $schedStart = $firstAss['startTime'];
                $schedEnd = $lastAss['endTime'];
                foreach ($g['assignments'] as $a) {
                    $schedHours += $a['hours'];
                }
                $schedLabel = $firstAss['startFormatted'] . ' - ' . $lastAss['endFormatted'];
            }

            // Recorded duration and credited calculation with Automatic 1-Hour Meal Break Deduction
            $recordedHours = 0.0;
            $breakDeduction = 0.0;
            $creditedHours = 0.0;
            $lateMinutes = 0;
            $undertimeMinutes = 0;
            $overtimeHours = 0.0;
            $status = 'ABSENT';
            $reconciliationStatus = 'SYSTEM_GENERATED';

            if ($checkIn && $checkOut) {
                $hCalc = compute_daily_attendance_hours(
                    $checkIn['logged_at'],
                    $checkOut['logged_at'],
                    $schedHours
                );
                $recordedHours = $hCalc['elapsedHours'];
                $breakDeduction = $hCalc['breakDeduction'];
                $creditedHours = $hCalc['creditedHours'];
                $status = 'PRESENT';
            } elseif ($checkIn && !$checkOut) {
                $status = 'INCOMPLETE';
                $reconciliationStatus = 'SYSTEM_GENERATED';
                $recordedHours = 0.0;
                $breakDeduction = 0.0;
                $creditedHours = 0.0;
            } elseif (!$checkIn && empty($g['assignments'])) {
                $status = 'OFF';
            }

            // Check if late against finalized schedule start
            if ($checkIn && $schedStart) {
                $cTime = strtotime(date('H:i:s', strtotime($checkIn['logged_at'])));
                $sTime = strtotime($schedStart);
                if ($cTime > ($sTime + 15 * 60)) {
                    $lateMinutes = round(($cTime - $sTime) / 60);
                    if ($status === 'PRESENT') {
                        $status = 'LATE';
                    }
                }
            }

            // Check if undertime or overtime against finalized schedule end
            if ($checkOut && $schedEnd) {
                $oTime = strtotime(date('H:i:s', strtotime($checkOut['logged_at'])));
                $eTime = strtotime($schedEnd);
                if ($oTime < ($eTime - 15 * 60)) {
                    $undertimeMinutes = round(($eTime - $oTime) / 60);
                    if ($status === 'PRESENT') {
                        $status = 'UNDERTIME';
                    }
                } elseif ($oTime > ($eTime + 30 * 60) || ($schedHours > 0 && $creditedHours > $schedHours)) {
                    $overtimeHours = max(0, round(($oTime - $eTime) / 3600, 1));
                    if ($status === 'PRESENT') {
                        $status = 'OVERTIME';
                    }
                }
            }

            // Check if For Review / Exception
            if ($checkIn && (!$faceVerified || (float)$confidence < 60 || (float)$checkIn['distance_meters'] > 1000.0)) {
                $status = 'FOR_REVIEW';
            }

            // Check manual reconciliation override
            if (isset($recBySa[$sid])) {
                $rRec = $recBySa[$sid];
                $status = $rRec['status'];
                $reconciliationStatus = $rRec['reconciliation_status'];
                if ($rRec['credited_hours'] > 0) $creditedHours = (float)$rRec['credited_hours'];
                if ($rRec['recorded_hours'] > 0) $recordedHours = (float)$rRec['recorded_hours'];
                if (isset($rRec['late_minutes'])) $lateMinutes = (int)$rRec['late_minutes'];
                if (isset($rRec['undertime_minutes'])) $undertimeMinutes = (int)$rRec['undertime_minutes'];
                if (isset($rRec['overtime_hours'])) $overtimeHours = (float)$rRec['overtime_hours'];
                if (isset($rRec['break_deduction']) && $rRec['break_deduction'] !== null) {
                    $breakDeduction = (float)$rRec['break_deduction'];
                }
            }

            $records[] = [
                'saProfileId' => $sid,
                'studentId' => $g['studentId'] ?? ($g['student_id'] ?? ''),
                'saNumber' => $g['saNumber'],
                'name' => $g['name'],
                'firstName' => $g['firstName'],
                'lastName' => $g['lastName'],
                'course' => $g['course'],
                'department' => $g['department'],
                'location' => $g['location'],
                'supervisor' => $g['supervisorName'],
                'schedule' => $schedLabel,
                'scheduledStart' => $schedStart ? date('h:i A', strtotime($schedStart)) : '—',
                'scheduledEnd' => $schedEnd ? date('h:i A', strtotime($schedEnd)) : '—',
                'schedHours' => $schedHours,
                'timeIn' => $checkIn ? date('h:i A', strtotime($checkIn['logged_at'])) : '—',
                'timeInRaw' => $checkIn ? $checkIn['logged_at'] : null,
                'timeOut' => $checkOut ? date('h:i A', strtotime($checkOut['logged_at'])) : '—',
                'timeOutRaw' => $checkOut ? $checkOut['logged_at'] : null,
                'breakOut' => $breakOut ? date('h:i A', strtotime($breakOut['logged_at'])) : '—',
                'breakIn' => $breakIn ? date('h:i A', strtotime($breakIn['logged_at'])) : '—',
                'recordedHours' => $recordedHours,
                'breakDeduction' => $breakDeduction,
                'creditedHours' => $creditedHours,
                'lateMinutes' => $lateMinutes,
                'undertimeMinutes' => $undertimeMinutes,
                'overtimeHours' => $overtimeHours,
                'status' => $status,
                'reconciliationStatus' => $reconciliationStatus,
                'faceVerified' => $faceVerified,
                'gpsVerified' => $gpsVerified,
                'confidenceScore' => $confidence,
                'distanceMeters' => $checkIn ? (float)$checkIn['distance_meters'] : 0,
                'locationName' => $checkIn ? $checkIn['location_name'] : '—',
                'photoUrl' => $photoUrl,
                'logsCount' => count($saLogs),
                'logs' => array_map(function($l) {
                    return [
                        'id' => (int)$l['id'],
                        'logType' => $l['log_type'],
                        'time' => date('h:i A', strtotime($l['logged_at'])),
                        'timestamp' => $l['logged_at'],
                        'location' => $l['location_name'],
                        'distance' => (float)$l['distance_meters'],
                        'confidence' => (float)$l['confidence_score'],
                        'status' => $l['verification_status'],
                        'photo' => $l['photo_path']
                    ];
                }, $saLogs)
            ];
        }

        respond([
            'success' => true,
            'date' => $date,
            'total' => count($records),
            'records' => $records
        ]);

    case 'coordinator_record_detail':
        $saId = (int)(input()['saProfileId'] ?? 0);
        $date = trim(input()['date'] ?? date('Y-m-d'));

        if ($saId <= 0) fail('Student Assistant profile ID is required.', 422);

        // S.A. Profile
        $saStmt = $pdo->prepare('
            SELECT p.*, o.name AS office_name, sup.full_name AS supervisor_name, b.photo_path AS biometric_photo
            FROM sa_profiles p
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN users sup ON sup.id = p.supervisor_id
            LEFT JOIN sa_biometrics b ON b.sa_profile_id = p.id
            WHERE p.id = ? LIMIT 1
        ');
        $saStmt->execute([$saId]);
        $sa = $saStmt->fetch(PDO::FETCH_ASSOC);
        if (!$sa) fail('S.A. profile not found.', 404);

        // Scheduled duty on this date's day of week
        $dow = strtoupper(date('D', strtotime($date)));
        $dayCode = match($dow) { 'MON' => 'MON', 'TUE' => 'TUE', 'WED' => 'WED', 'THU' => 'THU', 'FRI' => 'FRI', 'SAT' => 'SAT', default => 'SUN' };

        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int)$semStmt->fetchColumn();

        $dutyStmt = $pdo->prepare('
            SELECT * FROM schedule_assignments
            WHERE semester_id = ? AND sa_profile_id = ? AND day_of_week = ?
            ORDER BY start_time ASC
        ');
        $dutyStmt->execute([$activeSemId, $saId, $dayCode]);
        $duties = $dutyStmt->fetchAll(PDO::FETCH_ASSOC);

        // Day logs
        $logsStmt = $pdo->prepare('
            SELECT * FROM sa_attendance_logs
            WHERE sa_profile_id = ? AND DATE(logged_at) = ?
            ORDER BY logged_at ASC
        ');
        $logsStmt->execute([$saId, $date]);
        $logs = $logsStmt->fetchAll(PDO::FETCH_ASSOC);

        // Related Requests filed for this date
        $reqStmt = $pdo->prepare('
            SELECT * FROM sa_requests
            WHERE sa_profile_id = ? AND request_date = ?
            ORDER BY id DESC
        ');
        $reqStmt->execute([$saId, $date]);
        $requests = $reqStmt->fetchAll(PDO::FETCH_ASSOC);

        // Related Incidents/Violations
        $incStmt = $pdo->prepare('
            SELECT * FROM sa_attendance_incidents
            WHERE sa_profile_id = ? AND incident_date = ?
        ');
        $incStmt->execute([$saId, $date]);
        $incidents = $incStmt->fetchAll(PDO::FETCH_ASSOC);

        // Reconciliation record
        $recStmt = $pdo->prepare('
            SELECT r.*, u.full_name AS reconciled_by_name
            FROM sa_attendance_reconciliations r
            LEFT JOIN users u ON u.id = r.reconciled_by
            WHERE r.sa_profile_id = ? AND r.duty_date = ?
            LIMIT 1
        ');
        $recStmt->execute([$saId, $date]);
        $reconciliation = $recStmt->fetch(PDO::FETCH_ASSOC);

        respond([
            'success' => true,
            'date' => $date,
            'sa' => [
                'id' => (int)$sa['id'],
                'studentId' => $sa['student_id'],
                'saNumber' => $sa['sa_number'],
                'name' => trim($sa['first_name'] . ' ' . $sa['last_name']),
                'course' => $sa['course'],
                'yearLevel' => $sa['year_level'],
                'department' => $sa['office_name'] ?: $sa['department_type'],
                'supervisor' => $sa['supervisor_name'] ?: 'Unassigned',
                'biometricPhoto' => $sa['biometric_photo'],
                'hourlyRate' => (float)$sa['hourly_rate']
            ],
            'duties' => array_map(function($d) {
                return [
                    'id' => (int)$d['id'],
                    'department' => $d['department'],
                    'location' => $d['location'],
                    'startTime' => $d['start_time'],
                    'endTime' => $d['end_time'],
                    'startFormatted' => date('h:i A', strtotime($d['start_time'])),
                    'endFormatted' => date('h:i A', strtotime($d['end_time'])),
                    'hours' => round((strtotime($d['end_time']) - strtotime($d['start_time'])) / 3600, 2)
                ];
            }, $duties),
            'logs' => array_map(function($l) {
                return [
                    'id' => (int)$l['id'],
                    'logType' => $l['log_type'],
                    'loggedAt' => $l['logged_at'],
                    'time' => date('h:i A', strtotime($l['logged_at'])),
                    'latitude' => (float)$l['latitude'],
                    'longitude' => (float)$l['longitude'],
                    'distanceMeters' => (float)$l['distance_meters'],
                    'locationName' => $l['location_name'],
                    'verificationStatus' => $l['verification_status'],
                    'confidenceScore' => (float)$l['confidence_score'],
                    'photoUrl' => $l['photo_path'],
                    'notes' => $l['notes']
                ];
            }, $logs),
            'pastHistory' => (function() use ($pdo, $saId, $date) {
                $pastStmt = $pdo->prepare('
                    SELECT DATE(logged_at) AS log_date,
                           MIN(CASE WHEN log_type = "CHECK_IN" THEN logged_at END) as first_in,
                           MAX(CASE WHEN log_type = "CHECK_OUT" THEN logged_at END) as last_out,
                           COUNT(*) as log_count
                    FROM sa_attendance_logs
                    WHERE sa_profile_id = ? AND DATE(logged_at) != ?
                    GROUP BY DATE(logged_at)
                    ORDER BY log_date DESC
                    LIMIT 10
                ');
                $pastStmt->execute([$saId, $date]);
                $pRows = $pastStmt->fetchAll(PDO::FETCH_ASSOC);
                return array_map(function($p) {
                    return [
                        'date' => $p['log_date'],
                        'dateFormatted' => date('M j, Y (D)', strtotime($p['log_date'])),
                        'timeIn' => $p['first_in'] ? date('h:i A', strtotime($p['first_in'])) : '—',
                        'timeOut' => $p['last_out'] ? date('h:i A', strtotime($p['last_out'])) : '—',
                        'logCount' => (int)$p['log_count']
                    ];
                }, $pRows);
            })(),
            'requests' => $requests,
            'incidents' => $incidents,
            'reconciliation' => $reconciliation
        ]);

    case 'coordinator_past_dates':
        // Distinct dates with recorded logs or reconciliations
        $datesStmt = $pdo->query('
            SELECT DISTINCT duty_date FROM (
                SELECT DATE(logged_at) AS duty_date FROM sa_attendance_logs
                UNION
                SELECT duty_date FROM sa_attendance_reconciliations
            ) combined
            WHERE duty_date IS NOT NULL
            ORDER BY duty_date DESC
            LIMIT 60
        ');
        $rawDates = $datesStmt ? $datesStmt->fetchAll(PDO::FETCH_COLUMN) : [];

        $dateSummaries = [];
        foreach ($rawDates as $d) {
            if (!$d) continue;

            $lCountStmt = $pdo->prepare('SELECT COUNT(*) FROM sa_attendance_logs WHERE DATE(logged_at) = ?');
            $lCountStmt->execute([$d]);
            $logCount = (int)$lCountStmt->fetchColumn();

            $saCountStmt = $pdo->prepare('SELECT COUNT(DISTINCT sa_profile_id) FROM sa_attendance_logs WHERE DATE(logged_at) = ?');
            $saCountStmt->execute([$d]);
            $distinctSas = (int)$saCountStmt->fetchColumn();

            $recCountStmt = $pdo->prepare('SELECT COUNT(*) FROM sa_attendance_reconciliations WHERE duty_date = ?');
            $recCountStmt->execute([$d]);
            $reconciledCount = (int)$recCountStmt->fetchColumn();

            $dateSummaries[] = [
                'date' => $d,
                'label' => date('l, M j, Y', strtotime($d)),
                'shortLabel' => date('M j, Y (D)', strtotime($d)),
                'isToday' => ($d === date('Y-m-d')),
                'logCount' => $logCount,
                'saCount' => $distinctSas,
                'reconciledCount' => $reconciledCount
            ];
        }

        respond([
            'success' => true,
            'dates' => $dateSummaries
        ]);

    case 'coordinator_verify_record':
        require_csrf();
        require_role($user, 'ADMIN');

        $saId = (int)(input()['saProfileId'] ?? 0);
        $date = trim(input()['date'] ?? date('Y-m-d'));
        $logId = (int)(input()['logId'] ?? 0);
        $status = strtoupper(trim(input()['status'] ?? 'VERIFIED'));
        $notes = trim(input()['notes'] ?? '');

        if ($saId <= 0 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            fail('Valid S.A. profile ID and date are required.', 422);
        }

        if ($logId > 0) {
            $stmt = $pdo->prepare('
                UPDATE sa_attendance_logs
                SET verification_status = ?, notes = CONCAT(COALESCE(notes, ""), "\n[Verified by Coordinator: ", ?, "]")
                WHERE id = ? AND sa_profile_id = ?
            ');
            $stmt->execute([$status, $notes ?: 'Manually verified', $logId, $saId]);
        }

        audit('COORDINATOR_ATTENDANCE_VERIFIED', "Verified S.A. #{$saId} attendance for {$date} (status: {$status})");

        respond([
            'success' => true,
            'message' => "Attendance log #{$logId} verification updated successfully."
        ]);

    case 'coordinator_reconcile_record':
        require_csrf();
        require_role($user, 'ADMIN');

        $saId = (int)(input()['saProfileId'] ?? 0);
        $date = trim(input()['date'] ?? date('Y-m-d'));
        $status = strtoupper(trim(input()['status'] ?? 'PRESENT'));
        $creditedHours = (float)(input()['creditedHours'] ?? 0.0);
        $overtimeHours = (float)(input()['overtimeHours'] ?? 0.0);
        $remarks = trim(input()['remarks'] ?? '');

        if ($saId <= 0 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            fail('Valid S.A. Profile ID and duty date are required.', 422);
        }

        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int)$semStmt->fetchColumn();

        // Upsert reconciliation row
        $stmt = $pdo->prepare('
            INSERT INTO sa_attendance_reconciliations (
                semester_id, sa_profile_id, duty_date, status, reconciliation_status,
                credited_hours, overtime_hours, verification_notes, reconciled_by, reconciled_at
            ) VALUES (?, ?, ?, ?, "RECONCILED", ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                status = VALUES(status),
                reconciliation_status = "RECONCILED",
                credited_hours = VALUES(credited_hours),
                overtime_hours = VALUES(overtime_hours),
                verification_notes = VALUES(verification_notes),
                reconciled_by = VALUES(reconciled_by),
                reconciled_at = NOW()
        ');
        $stmt->execute([
            $activeSemId, $saId, $date, $status, $creditedHours, $overtimeHours, $remarks, (int)$user['id']
        ]);

        audit('COORDINATOR_ATTENDANCE_RECONCILED', "Reconciled S.A. #{$saId} for {$date}: {$status}, Credited: {$creditedHours}h, OT: {$overtimeHours}h. Remarks: {$remarks}");

        // Dispatch SMS Alert via Semaphore (ABSENT, PRESENT, UNDERTIME, OVERTIME)
        $smsResult = send_attendance_status_sms($saId, $status, [
            'date' => date('M d, Y', strtotime($date)),
            'reason' => $remarks ?: ($status === 'ABSENT' ? 'Absence recorded by Coordinator' : ''),
            'hours' => $creditedHours,
            'overtimeHours' => $overtimeHours
        ]);

        respond([
            'success' => true,
            'message' => "Attendance for {$date} successfully reconciled and saved.",
            'smsSent' => $smsResult['success'] ?? false,
            'smsError' => $smsResult['error'] ?? null
        ]);

    case 'coordinator_manual_entry':
        require_csrf();
        require_role($user, 'ADMIN');

        $saId = (int)(input()['saProfileId'] ?? 0);
        $date = trim(input()['date'] ?? date('Y-m-d'));
        $timeIn = trim(input()['timeIn'] ?? '');
        $timeOut = trim(input()['timeOut'] ?? '');
        $reason = trim(input()['reason'] ?? '');

        if ($saId <= 0 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || empty($timeIn)) {
            fail('S.A. Profile, date, and Time In are required.', 422);
        }

        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int)$semStmt->fetchColumn();

        $saStmt = $pdo->prepare('SELECT user_id FROM sa_profiles WHERE id = ? LIMIT 1');
        $saStmt->execute([$saId]);
        $saUserId = (int)$saStmt->fetchColumn();

        // Insert CHECK_IN log
        $insCin = $pdo->prepare('
            INSERT INTO sa_attendance_logs (
                sa_profile_id, user_id, semester_id, log_type, logged_at,
                location_name, verification_status, confidence_score, notes
            ) VALUES (?, ?, ?, "CHECK_IN", ?, "Coordinator Manual Entry", "VERIFIED", 100.0, ?)
        ');
        $cinDateTime = $date . ' ' . (strlen($timeIn) === 5 ? $timeIn . ':00' : $timeIn);
        $insCin->execute([$saId, $saUserId, $activeSemId, $cinDateTime, "Manual Entry: $reason"]);

        // Insert CHECK_OUT log if provided
        if (!empty($timeOut)) {
            $insCout = $pdo->prepare('
                INSERT INTO sa_attendance_logs (
                    sa_profile_id, user_id, semester_id, log_type, logged_at,
                    location_name, verification_status, confidence_score, notes
                ) VALUES (?, ?, ?, "CHECK_OUT", ?, "Coordinator Manual Entry", "VERIFIED", 100.0, ?)
            ');
            $coutDateTime = $date . ' ' . (strlen($timeOut) === 5 ? $timeOut . ':00' : $timeOut);
            $insCout->execute([$saId, $saUserId, $activeSemId, $coutDateTime, "Manual Entry: $reason"]);
        }

        audit('COORDINATOR_ATTENDANCE_MANUAL_ENTRY', "Manual attendance added for S.A. #{$saId} on {$date} ({$timeIn} - {$timeOut}). Reason: {$reason}");

        // Dispatch SMS notification for manual entry
        $smsStatus = !empty($timeOut) ? 'COMPLETED' : 'PRESENT';
        $smsResult = send_attendance_status_sms($saId, $smsStatus, [
            'date' => date('M d, Y', strtotime($date)),
            'time' => !empty($timeOut) ? date('g:i A', strtotime($coutDateTime)) : date('g:i A', strtotime($cinDateTime)),
            'location' => 'Coordinator Manual Entry',
            'reason' => $reason
        ]);

        respond([
            'success' => true,
            'message' => 'Attendance successfully recorded.',
            'smsSent' => $smsResult['success'] ?? false,
            'smsError' => $smsResult['error'] ?? null
        ]);

    case 'coordinator_overtime_summary':
        // Overtime monitoring & reporting endpoint
        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int)$semStmt->fetchColumn();

        $otStmt = $pdo->prepare('
            SELECT r.*, p.student_id, p.first_name, p.last_name, p.course, o.name AS office_name,
                   sup.full_name AS approver_name
            FROM sa_requests r
            JOIN sa_profiles p ON p.id = r.sa_profile_id
            LEFT JOIN offices o ON o.id = p.office_id
            LEFT JOIN users sup ON sup.id = r.supervisor_acted_by_id
            WHERE r.request_type = "OVERTIME" AND r.semester_id = ?
            ORDER BY r.request_date DESC, r.id DESC
        ');
        $otStmt->execute([$activeSemId]);
        $rows = $otStmt->fetchAll(PDO::FETCH_ASSOC);

        respond([
            'success' => true,
            'overtimeRequests' => array_map(function($r) {
                return [
                    'id' => (int)$r['id'],
                    'refNo' => $r['request_ref_no'],
                    'studentId' => $r['student_id'],
                    'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                    'department' => $r['office_name'] ?: $r['department'],
                    'location' => $r['location'],
                    'requestDate' => $r['request_date'],
                    'hours' => (float)$r['hours_affected'],
                    'status' => $r['status'],
                    'approver' => $r['approver_name'] ?: ($r['supervisor_name'] ?: 'Pending Review'),
                    'actedAt' => $r['supervisor_acted_at']
                ];
            }, $rows)
        ]);

    // =========================================================================
    // SUPERVISOR ATTENDANCE REVIEW MODULE ACTIONS (Strictly Scoped)
    // =========================================================================

    case 'supervisor_attendance_dashboard': {
        $date = trim(input()['date'] ?? $_GET['date'] ?? date('Y-m-d'));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = date('Y-m-d');
        }

        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)(input()['supervisorId'] ?? $_GET['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) {
            fail('Supervisor scope not found.', 404);
        }

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $totalAssigned = count($assignedSas);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        $semStmt = $pdo->query('SELECT id, academic_year, term FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSem = $semStmt->fetch(PDO::FETCH_ASSOC);
        $activeSemId = $activeSem ? (int)$activeSem['id'] : 1;

        $calcMetricsForDate = function(string $d) use ($pdo, $activeSemId, $scopedSaIds, $assignedSas) {
            $dow = strtoupper(date('D', strtotime($d)));
            $dayCode = match($dow) { 'MON' => 'MON', 'TUE' => 'TUE', 'WED' => 'WED', 'THU' => 'THU', 'FRI' => 'FRI', 'SAT' => 'SAT', default => 'SUN' };

            $counts = ['present' => 0, 'late' => 0, 'undertime' => 0, 'absent' => 0, 'onLeave' => 0, 'incomplete' => 0, 'pendingReview' => 0];
            if (empty($scopedSaIds)) return $counts;

            $inList = implode(',', $scopedSaIds);

            // Schedules
            $schedStmt = $pdo->prepare("SELECT sa_profile_id, start_time, end_time FROM schedule_assignments WHERE semester_id = ? AND day_of_week = ? AND sa_profile_id IN ($inList)");
            $schedStmt->execute([$activeSemId, $dayCode]);
            $scheds = [];
            foreach ($schedStmt->fetchAll(PDO::FETCH_ASSOC) as $s) {
                $scheds[(int)$s['sa_profile_id']][] = $s;
            }

            // Logs
            $logsStmt = $pdo->prepare("SELECT * FROM sa_attendance_logs WHERE DATE(logged_at) = ? AND sa_profile_id IN ($inList) ORDER BY logged_at ASC");
            $logsStmt->execute([$d]);
            $logs = [];
            foreach ($logsStmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
                $logs[(int)$l['sa_profile_id']][] = $l;
            }

            // Reconciliations
            $recStmt = $pdo->prepare("SELECT * FROM sa_attendance_reconciliations WHERE duty_date = ? AND sa_profile_id IN ($inList)");
            $recStmt->execute([$d]);
            $recs = [];
            foreach ($recStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $recs[(int)$r['sa_profile_id']] = $r;
            }

            // Leave / excuse
            $leaveStmt = $pdo->prepare("
                SELECT sa_profile_id FROM sa_requests
                WHERE sa_profile_id IN ($inList) AND request_type = 'EXCUSE'
                  AND status IN ('RECORDED', 'PENDING_COORDINATOR_RECORDING')
                  AND (? = request_date OR (request_end_date IS NOT NULL AND ? BETWEEN request_date AND request_end_date))
            ");
            $leaveStmt->execute([$d, $d]);
            $leaves = $leaveStmt->fetchAll(PDO::FETCH_COLUMN);

            foreach ($assignedSas as $sa) {
                $sid = (int)$sa['sa_profile_id'];
                $sLogs = $logs[$sid] ?? [];
                $sRec = $recs[$sid] ?? null;
                $hasSched = !empty($scheds[$sid]);
                $onLeave = in_array($sid, $leaves, true);

                $checkIn = null;
                $checkOut = null;
                foreach ($sLogs as $l) {
                    if ($l['log_type'] === 'CHECK_IN' && !$checkIn) $checkIn = $l;
                    if ($l['log_type'] === 'CHECK_OUT') $checkOut = $l;
                }

                $status = 'ABSENT';
                if ($sRec && !empty($sRec['status'])) {
                    $status = $sRec['status'];
                } elseif ($onLeave) {
                    $status = 'ON_LEAVE';
                } elseif ($checkIn) {
                    $status = 'PRESENT';
                    if (!empty($scheds[$sid])) {
                        $minStart = $scheds[$sid][0]['start_time'];
                        $actTime = date('H:i:s', strtotime($checkIn['logged_at']));
                        if (strtotime($actTime) > (strtotime($minStart) + 15 * 60)) {
                            $status = 'LATE';
                        }
                        if ($checkOut) {
                            $maxEnd = $scheds[$sid][count($scheds[$sid]) - 1]['end_time'];
                            $actOut = date('H:i:s', strtotime($checkOut['logged_at']));
                            if (strtotime($actOut) < (strtotime($maxEnd) - 15 * 60) && $status === 'PRESENT') {
                                $status = 'UNDERTIME';
                            }
                        }
                    }
                } elseif (!$hasSched) {
                    $status = 'OFF';
                }

                if ($status === 'PRESENT') {
                    $counts['present']++;
                } elseif ($status === 'LATE') {
                    $counts['late']++;
                    $counts['present']++;
                } elseif ($status === 'UNDERTIME') {
                    $counts['undertime']++;
                    $counts['present']++;
                } elseif ($status === 'ON_LEAVE') {
                    $counts['onLeave']++;
                } elseif ($status === 'ABSENT') {
                    $counts['absent']++;
                } elseif ($status === 'INCOMPLETE') {
                    $counts['incomplete']++;
                    $counts['present']++;
                }

                $rev = $sRec['review_status'] ?? 'NOT_YET_REVIEWED';
                if ($rev === 'NOT_YET_REVIEWED' || $rev === 'UNDER_REVIEW') {
                    $counts['pendingReview']++;
                }
            }
            return $counts;
        };

        $todayCounts = $calcMetricsForDate($date);
        $yesterdayDate = date('Y-m-d', strtotime($date . ' -1 day'));
        $yesterdayCounts = $calcMetricsForDate($yesterdayDate);

        // Pending corrections from sa_requests
        $pendingCorrections = 0;
        if (!empty($scopedSaIds)) {
            $inList = implode(',', $scopedSaIds);
            $corrStmt = $pdo->prepare("
                SELECT COUNT(*) FROM sa_requests
                WHERE sa_profile_id IN ($inList)
                  AND request_type = 'CORRECTION'
                  AND status IN ('PENDING_SUPERVISOR_REVIEW', 'PENDING_COORDINATOR_RECORDING')
            ");
            $corrStmt->execute();
            $pendingCorrections = (int)$corrStmt->fetchColumn();
        }

        // Subtext for Assigned SAs
        $assignedSubtext = $totalAssigned === 2
            ? "Both assigned to {$scope['primaryDept']}"
            : "All {$totalAssigned} assigned to {$scope['primaryDept']}";

        // Recent activity for assigned SAs
        $recentActivity = [];
        if (!empty($scopedSaIds)) {
            $inList = implode(',', $scopedSaIds);
            $actStmt = $pdo->prepare("
                SELECT l.id, l.sa_profile_id, l.log_type, l.logged_at, l.location_name,
                       p.first_name, p.last_name, p.sa_number, p.student_id
                FROM sa_attendance_logs l
                JOIN sa_profiles p ON p.id = l.sa_profile_id
                WHERE l.sa_profile_id IN ($inList) AND DATE(l.logged_at) = ?
                ORDER BY l.logged_at DESC
                LIMIT 15
            ");
            $actStmt->execute([$date]);
            foreach ($actStmt->fetchAll(PDO::FETCH_ASSOC) as $act) {
                $logLabels = [
                    'CHECK_IN' => 'Checked In',
                    'BREAK_OUT' => 'Break-Out',
                    'BREAK_IN' => 'Break-In',
                    'CHECK_OUT' => 'Checked Out'
                ];
                $typeLabel = $logLabels[$act['log_type']] ?? $act['log_type'];
                $saLabel = trim($act['first_name'] . ' ' . $act['last_name']) . " (" . ($act['sa_number'] ?: $act['student_id']) . ")";
                $recentActivity[] = [
                    'id' => (int)$act['id'],
                    'time' => date('h:i A', strtotime($act['logged_at'])),
                    'timestamp' => $act['logged_at'],
                    'saId' => (int)$act['sa_profile_id'],
                    'saLabel' => $saLabel,
                    'action' => $typeLabel,
                    'logType' => $act['log_type'],
                    'location' => $act['location_name'] ?: 'NCST Main Campus'
                ];
            }
        }

        // Percentage calculations
        $presentPct = $totalAssigned > 0 ? round(($todayCounts['present'] / $totalAssigned) * 100) : 0;
        $latePct = $totalAssigned > 0 ? round(($todayCounts['late'] / $totalAssigned) * 100) : 0;
        $absentPct = $totalAssigned > 0 ? round(($todayCounts['absent'] / $totalAssigned) * 100) : 0;
        $onLeavePct = $totalAssigned > 0 ? round(($todayCounts['onLeave'] / $totalAssigned) * 100) : 0;

        $calcDiff = function(int $today, int $yesterday) {
            $diff = $today - $yesterday;
            if ($diff > 0) return ['label' => "+{$diff} vs. yesterday", 'trend' => 'up'];
            if ($diff < 0) return ['label' => "{$diff} vs. yesterday", 'trend' => 'down'];
            return ['label' => '0% vs. yesterday', 'trend' => 'same'];
        };

        respond([
            'success' => true,
            'supervisor' => [
                'id' => $scope['id'],
                'empId' => $scope['empId'],
                'name' => $scope['name'],
                'initials' => $scope['initials'],
                'category' => $scope['category'],
                'department' => $scope['deptDisplayName'],
                'primaryDept' => $scope['primaryDept'],
                'departments' => $scope['departments'],
                'scopeLabel' => $scope['scopeLabel']
            ],
            'date' => $date,
            'dayLabel' => date('D, M j, Y', strtotime($date)),
            'currentTime' => date('h:i:s A'),
            'summary' => [
                'assignedSas' => $totalAssigned,
                'assignedSubtext' => $assignedSubtext,
                'present' => $todayCounts['present'],
                'presentPct' => $presentPct,
                'presentDiff' => $calcDiff($todayCounts['present'], $yesterdayCounts['present'])['label'],
                'presentTrend' => $calcDiff($todayCounts['present'], $yesterdayCounts['present'])['trend'],
                'late' => $todayCounts['late'],
                'latePct' => $latePct,
                'lateDiff' => $calcDiff($todayCounts['late'], $yesterdayCounts['late'])['label'],
                'lateTrend' => $calcDiff($todayCounts['late'], $yesterdayCounts['late'])['trend'],
                'absent' => $todayCounts['absent'],
                'absentDiff' => $calcDiff($todayCounts['absent'], $yesterdayCounts['absent'])['label'],
                'absentTrend' => $calcDiff($todayCounts['absent'], $yesterdayCounts['absent'])['trend'],
                'onLeave' => $todayCounts['onLeave'],
                'onLeavePct' => $onLeavePct,
                'onLeaveDiff' => $calcDiff($todayCounts['onLeave'], $yesterdayCounts['onLeave'])['label'],
                'onLeaveTrend' => $calcDiff($todayCounts['onLeave'], $yesterdayCounts['onLeave'])['trend'],
                'pendingReview' => $todayCounts['pendingReview'],
                'pendingCorrections' => $pendingCorrections
            ],
            'recentActivity' => $recentActivity
        ]);
        break;
    }

    case 'supervisor_attendance_records': {
        $date = trim(input()['date'] ?? $_GET['date'] ?? date('Y-m-d'));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = date('Y-m-d');
        }

        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)(input()['supervisorId'] ?? $_GET['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) {
            fail('Supervisor scope not found.', 404);
        }

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        if (empty($scopedSaIds)) {
            respond(['success' => true, 'records' => [], 'total' => 0, 'date' => $date]);
        }

        $dow = strtoupper(date('D', strtotime($date)));
        $dayCode = match($dow) { 'MON' => 'MON', 'TUE' => 'TUE', 'WED' => 'WED', 'THU' => 'THU', 'FRI' => 'FRI', 'SAT' => 'SAT', default => 'SUN' };

        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int)$semStmt->fetchColumn() ?: 1;

        $inList = implode(',', $scopedSaIds);

        // Fetch duty assignments
        $schedStmt = $pdo->prepare("
            SELECT a.*, o.name as office_name
            FROM schedule_assignments a
            LEFT JOIN offices o ON o.id = a.office_requirement_id
            WHERE a.semester_id = ? AND a.day_of_week = ? AND a.sa_profile_id IN ($inList)
            ORDER BY a.start_time ASC
        ");
        $schedStmt->execute([$activeSemId, $dayCode]);
        $scheds = [];
        foreach ($schedStmt->fetchAll(PDO::FETCH_ASSOC) as $s) {
            $scheds[(int)$s['sa_profile_id']][] = $s;
        }

        // Fetch punch logs
        $logsStmt = $pdo->prepare("
            SELECT * FROM sa_attendance_logs
            WHERE DATE(logged_at) = ? AND sa_profile_id IN ($inList)
            ORDER BY logged_at ASC
        ");
        $logsStmt->execute([$date]);
        $logs = [];
        foreach ($logsStmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
            $logs[(int)$l['sa_profile_id']][] = $l;
        }

        // Fetch reconciliations
        $recStmt = $pdo->prepare("
            SELECT r.*, u.full_name AS reviewed_by_name
            FROM sa_attendance_reconciliations r
            LEFT JOIN users u ON u.id = r.reviewed_by
            WHERE r.duty_date = ? AND r.sa_profile_id IN ($inList)
        ");
        $recStmt->execute([$date]);
        $recs = [];
        foreach ($recStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $recs[(int)$r['sa_profile_id']] = $r;
        }

        // Fetch requests (corrections & leave)
        $reqStmt = $pdo->prepare("
            SELECT * FROM sa_requests
            WHERE sa_profile_id IN ($inList)
              AND (? = request_date OR (request_end_date IS NOT NULL AND ? BETWEEN request_date AND request_end_date))
            ORDER BY id DESC
        ");
        $reqStmt->execute([$date, $date]);
        $requests = [];
        foreach ($reqStmt->fetchAll(PDO::FETCH_ASSOC) as $rq) {
            $requests[(int)$rq['sa_profile_id']][] = $rq;
        }

        // Optional filters
        $search = strtolower(trim((string)(input()['search'] ?? $_GET['search'] ?? '')));
        $statusFilter = strtoupper(trim((string)(input()['attendance_status'] ?? $_GET['attendance_status'] ?? 'ALL')));
        $reviewFilter = strtoupper(trim((string)(input()['review_status'] ?? $_GET['review_status'] ?? 'ALL')));
        $deptFilter = trim((string)(input()['department'] ?? $_GET['department'] ?? 'ALL'));

        $records = [];
        foreach ($assignedSas as $sa) {
            $sid = (int)$sa['sa_profile_id'];
            $sLogs = $logs[$sid] ?? [];
            $sRec = $recs[$sid] ?? null;
            $sScheds = $scheds[$sid] ?? [];
            $sReqs = $requests[$sid] ?? [];

            $fullName = trim($sa['first_name'] . ' ' . $sa['last_name'] . ($sa['suffix'] ? ' ' . $sa['suffix'] : ''));
            $initials = strtoupper(substr($sa['first_name'], 0, 1) . substr($sa['last_name'], 0, 1));
            $area = $sa['office_name'] ?: $scope['deptDisplayName'];

            // Determine Schedule Label & Hours
            $schedStart = null;
            $schedEnd = null;
            $schedHours = 0.0;
            $schedLabel = 'No Schedule Today';
            if (!empty($sScheds)) {
                $first = $sScheds[0];
                $last = $sScheds[count($sScheds) - 1];
                $schedStart = $first['start_time'];
                $schedEnd = $last['end_time'];
                $schedLabel = date('h:i A', strtotime($schedStart)) . ' – ' . date('h:i A', strtotime($schedEnd));
                foreach ($sScheds as $sc) {
                    $schedHours += round((strtotime($sc['end_time']) - strtotime($sc['start_time'])) / 3600, 2);
                }
            }

            // Punch analysis
            $checkIn = null;
            $checkOut = null;
            $breakOut = null;
            $breakIn = null;
            foreach ($sLogs as $l) {
                if ($l['log_type'] === 'CHECK_IN' && !$checkIn) $checkIn = $l;
                elseif ($l['log_type'] === 'BREAK_OUT' && !$breakOut) $breakOut = $l;
                elseif ($l['log_type'] === 'BREAK_IN' && !$breakIn) $breakIn = $l;
                elseif ($l['log_type'] === 'CHECK_OUT') $checkOut = $l;
            }

            $timeInFormatted = $checkIn ? date('h:i A', strtotime($checkIn['logged_at'])) : null;
            $timeOutFormatted = $checkOut ? date('h:i A', strtotime($checkOut['logged_at'])) : null;
            $breakOutFormatted = $breakOut ? date('h:i A', strtotime($breakOut['logged_at'])) : null;
            $breakInFormatted = $breakIn ? date('h:i A', strtotime($breakIn['logged_at'])) : null;

            $timeInOutLabel = '—';
            if ($timeInFormatted && $timeOutFormatted) {
                $timeInOutLabel = "{$timeInFormatted} – {$timeOutFormatted}";
            } elseif ($timeInFormatted && !$timeOutFormatted) {
                $timeInOutLabel = "{$timeInFormatted} – Present";
            }

            // Recorded & Credited Hours with Automatic 1-Hour Meal Break Deduction
            $hourlyRate = ($sa['hourly_rate'] !== null && (float)$sa['hourly_rate'] > 0)
                ? (float)$sa['hourly_rate']
                : 0.0;
            if ($hourlyRate <= 0) {
                $saSemId = (int)($sa['semester_id'] ?? 0);
                if ($saSemId > 0) {
                    $rStmt = $pdo->prepare('SELECT hourly_rate FROM allowance_rates WHERE semester_id = ?');
                    $rStmt->execute([$saSemId]);
                    $hourlyRate = (float)($rStmt->fetchColumn() ?: DEFAULT_HOURLY_RATE);
                } else {
                    $hourlyRate = (float)DEFAULT_HOURLY_RATE;
                }
            }
            $recordedHours = 0.0;
            $breakDeduction = 0.0;
            $creditedHours = 0.0;
            $computedAllowance = 0.0;

            if ($checkIn && $checkOut) {
                $hCalc = compute_daily_attendance_hours(
                    $checkIn['logged_at'],
                    $checkOut['logged_at'],
                    $schedHours,
                    $hourlyRate
                );
                $recordedHours = $hCalc['elapsedHours'];
                $breakDeduction = $hCalc['breakDeduction'];
                $creditedHours = $hCalc['creditedHours'];
                $computedAllowance = $hCalc['computedAllowance'];
            } elseif ($checkIn) {
                $recordedHours = 0.0;
                $breakDeduction = 0.0;
                $creditedHours = 0.0;
            }

            // Leave check
            $leaveReq = null;
            $corrReq = null;
            foreach ($sReqs as $rq) {
                if ($rq['request_type'] === 'EXCUSE' && in_array($rq['status'], ['RECORDED', 'PENDING_COORDINATOR_RECORDING'], true)) {
                    $leaveReq = $rq;
                }
                if ($rq['request_type'] === 'CORRECTION' && in_array($rq['status'], ['PENDING_SUPERVISOR_REVIEW', 'PENDING_COORDINATOR_RECORDING'], true)) {
                    $corrReq = $rq;
                }
            }

            // Dynamic attendance status
            $attendanceStatus = 'ABSENT';
            if ($leaveReq) {
                $attendanceStatus = 'ON_LEAVE';
            } elseif ($checkIn && $checkOut) {
                $attendanceStatus = 'PRESENT';
                if ($schedStart) {
                    $actTime = date('H:i:s', strtotime($checkIn['logged_at']));
                    if (strtotime($actTime) > (strtotime($schedStart) + 15 * 60)) {
                        $attendanceStatus = 'LATE';
                    }
                }
            } elseif ($checkIn && !$checkOut) {
                $attendanceStatus = 'INCOMPLETE';
            } elseif (empty($sScheds)) {
                $attendanceStatus = 'OFF';
            }

            // Verification details
            $faceVerified = $checkIn ? ($checkIn['verification_status'] === 'VERIFIED') : false;
            $distance = $checkIn ? (float)$checkIn['distance_meters'] : 0.0;
            $gpsVerified = $checkIn ? ($distance <= 1000.0) : false;
            $confidence = $checkIn ? (float)$checkIn['confidence_score'] : 0.0;
            $locName = $checkIn ? ($checkIn['location_name'] ?: 'NCST Main Campus') : 'NCST Campus';

            // Review status
            $reviewStatus = 'NOT_YET_REVIEWED';
            if ($corrReq) {
                $reviewStatus = 'PENDING_CORRECTION';
            } elseif ($sRec && !empty($sRec['review_status'])) {
                $reviewStatus = $sRec['review_status'];
                if ($sRec['credited_hours'] !== null) {
                    $creditedHours = (float)$sRec['credited_hours'];
                }
                if (isset($sRec['break_deduction']) && $sRec['break_deduction'] !== null) {
                    $breakDeduction = (float)$sRec['break_deduction'];
                }
                $computedAllowance = round($creditedHours * $hourlyRate, 2);
                if (!empty($sRec['status'])) {
                    $attendanceStatus = $sRec['status'];
                }
            } elseif ($attendanceStatus === 'INCOMPLETE' || ($checkIn && (!$faceVerified || !$gpsVerified))) {
                $reviewStatus = 'UNDER_REVIEW';
            }

            // Filtering
            if ($search) {
                $matchStr = strtolower($fullName . ' ' . $sa['student_id'] . ' ' . $sa['sa_number']);
                if (!str_contains($matchStr, $search)) continue;
            }
            if ($statusFilter !== 'ALL' && $statusFilter !== '') {
                if ($statusFilter === 'PRESENT' && !in_array($attendanceStatus, ['PRESENT', 'LATE'], true)) continue;
                if ($statusFilter === 'LATE' && $attendanceStatus !== 'LATE') continue;
                if ($statusFilter === 'ABSENT' && $attendanceStatus !== 'ABSENT') continue;
                if ($statusFilter === 'ON_LEAVE' && $attendanceStatus !== 'ON_LEAVE') continue;
                if ($statusFilter === 'INCOMPLETE' && $attendanceStatus !== 'INCOMPLETE') continue;
            }
            if ($reviewFilter !== 'ALL' && $reviewFilter !== '') {
                if ($reviewStatus !== $reviewFilter) continue;
            }
            if ($deptFilter !== 'ALL' && $deptFilter !== '') {
                if (!str_contains(strtolower($area), strtolower($deptFilter))) continue;
            }

            $records[] = [
                'saProfileId' => $sid,
                'studentId' => $sa['student_id'],
                'saNumber' => $sa['sa_number'] ?: ('SA-' . $sa['student_id']),
                'name' => $fullName,
                'firstName' => $sa['first_name'],
                'lastName' => $sa['last_name'],
                'initials' => $initials,
                'photoUrl' => $sa['biometric_photo'] ?: null,
                'course' => $sa['course'],
                'yearLevel' => $sa['year_level'],
                'assignedArea' => $area,
                'schedule' => $schedLabel,
                'scheduledStart' => $schedStart,
                'scheduledEnd' => $schedEnd,
                'scheduledHours' => $schedHours,
                'timeIn' => $timeInFormatted,
                'timeOut' => $timeOutFormatted,
                'breakOut' => $breakOutFormatted,
                'breakIn' => $breakInFormatted,
                'timeInOutLabel' => $timeInOutLabel,
                'recordedHours' => $recordedHours,
                'breakDeduction' => $breakDeduction,
                'creditedHours' => $creditedHours,
                'hourlyRate' => $hourlyRate,
                'computedAllowance' => $computedAllowance,
                'attendanceStatus' => $attendanceStatus,
                'reviewStatus' => $reviewStatus,
                'latitude' => $checkIn ? (float)$checkIn['latitude'] : 14.327472,
                'longitude' => $checkIn ? (float)$checkIn['longitude'] : 120.940472,
                'distanceMeters' => $distance,
                'locationName' => $locName,
                'gpsVerified' => $gpsVerified,
                'verification' => [
                    'faceVerified' => $faceVerified,
                    'gpsVerified' => $gpsVerified,
                    'confidence' => $confidence,
                    'distanceMeters' => $distance,
                    'locationName' => $locName,
                    'withinGeofence' => ($distance <= 1000.0 || $gpsVerified),
                    'latitude' => $checkIn ? (float)$checkIn['latitude'] : 14.327472,
                    'longitude' => $checkIn ? (float)$checkIn['longitude'] : 120.940472
                ],
                'reviewedBy' => $sRec['reviewed_by_name'] ?? null,
                'reviewedAt' => $sRec['reviewed_at'] ?? null,
                'reviewNotes' => $sRec['review_notes'] ?? null,
                'rejectionReason' => $sRec['rejection_reason'] ?? null,
                'escalationReason' => $sRec['escalation_reason'] ?? null,
                'pendingCorrection' => $corrReq ? [
                    'id' => (int)$corrReq['id'],
                    'refNo' => $corrReq['request_ref_no'],
                    'actualTime' => $corrReq['actual_time'],
                    'requestedStart' => $corrReq['requested_start'],
                    'explanation' => $corrReq['explanation'],
                    'status' => $corrReq['status']
                ] : null,
                'logsCount' => count($sLogs)
            ];
        }

        respond([
            'success' => true,
            'date' => $date,
            'total' => count($records),
            'records' => $records
        ]);
        break;
    }

    case 'supervisor_record_detail': {
        $saId = (int)(input()['saProfileId'] ?? $_GET['saProfileId'] ?? 0);
        $date = trim(input()['date'] ?? $_GET['date'] ?? date('Y-m-d'));
        if ($saId <= 0 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            fail('Valid S.A. profile ID and date are required.', 422);
        }

        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)(input()['supervisorId'] ?? $_GET['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) fail('Supervisor scope not found.', 404);

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        // Security check: must belong to this supervisor's assigned SAs
        if (!in_array($saId, $scopedSaIds, true)) {
            fail('Access denied. This S.A. is not assigned under your supervision.', 403);
        }

        // Fetch S.A. details
        $sa = null;
        foreach ($assignedSas as $s) {
            if ((int)$s['sa_profile_id'] === $saId) {
                $sa = $s;
                break;
            }
        }
        if (!$sa) fail('S.A. not found.', 404);

        $dow = strtoupper(date('D', strtotime($date)));
        $dayCode = match($dow) { 'MON' => 'MON', 'TUE' => 'TUE', 'WED' => 'WED', 'THU' => 'THU', 'FRI' => 'FRI', 'SAT' => 'SAT', default => 'SUN' };

        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int)$semStmt->fetchColumn() ?: 1;

        // Schedule
        $schedStmt = $pdo->prepare("SELECT * FROM schedule_assignments WHERE semester_id = ? AND day_of_week = ? AND sa_profile_id = ? ORDER BY start_time ASC");
        $schedStmt->execute([$activeSemId, $dayCode, $saId]);
        $duties = $schedStmt->fetchAll(PDO::FETCH_ASSOC);

        $schedLabel = 'No Schedule Today';
        $schedHours = 0.0;
        if (!empty($duties)) {
            $schedLabel = date('h:i A', strtotime($duties[0]['start_time'])) . ' – ' . date('h:i A', strtotime($duties[count($duties) - 1]['end_time']));
            foreach ($duties as $d) {
                $schedHours += round((strtotime($d['end_time']) - strtotime($d['start_time'])) / 3600, 2);
            }
        }

        // Logs
        $logsStmt = $pdo->prepare("SELECT * FROM sa_attendance_logs WHERE sa_profile_id = ? AND DATE(logged_at) = ? ORDER BY logged_at ASC");
        $logsStmt->execute([$saId, $date]);
        $logs = $logsStmt->fetchAll(PDO::FETCH_ASSOC);

        // Reconciliation
        $recStmt = $pdo->prepare("SELECT r.*, u.full_name as reviewed_by_name FROM sa_attendance_reconciliations r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.sa_profile_id = ? AND r.duty_date = ? LIMIT 1");
        $recStmt->execute([$saId, $date]);
        $rec = $recStmt->fetch(PDO::FETCH_ASSOC) ?: null;

        // Requests / corrections
        $reqStmt = $pdo->prepare("SELECT * FROM sa_requests WHERE sa_profile_id = ? AND (? = request_date OR (request_end_date IS NOT NULL AND ? BETWEEN request_date AND request_end_date)) ORDER BY id DESC");
        $reqStmt->execute([$saId, $date, $date]);
        $requests = $reqStmt->fetchAll(PDO::FETCH_ASSOC);

        $checkIn = null;
        $checkOut = null;
        $breakOut = null;
        $breakIn = null;
        foreach ($logs as $l) {
            if ($l['log_type'] === 'CHECK_IN' && !$checkIn) $checkIn = $l;
            elseif ($l['log_type'] === 'BREAK_OUT' && !$breakOut) $breakOut = $l;
            elseif ($l['log_type'] === 'BREAK_IN' && !$breakIn) $breakIn = $l;
            elseif ($l['log_type'] === 'CHECK_OUT') $checkOut = $l;
        }

        $hourlyRate = ($sa['hourly_rate'] !== null && (float)$sa['hourly_rate'] > 0)
            ? (float)$sa['hourly_rate']
            : 0.0;
        if ($hourlyRate <= 0) {
            $saSemId = (int)($sa['semester_id'] ?? 0);
            if ($saSemId > 0) {
                $rStmt = $pdo->prepare('SELECT hourly_rate FROM allowance_rates WHERE semester_id = ?');
                $rStmt->execute([$saSemId]);
                $hourlyRate = (float)($rStmt->fetchColumn() ?: DEFAULT_HOURLY_RATE);
            } else {
                $hourlyRate = (float)DEFAULT_HOURLY_RATE;
            }
        }
        $recordedHours = 0.0;
        $breakDeduction = 0.0;
        $creditedHours = 0.0;
        $computedAllowance = 0.0;

        if ($checkIn && $checkOut) {
            $hCalc = compute_daily_attendance_hours(
                $checkIn['logged_at'],
                $checkOut['logged_at'],
                $schedHours,
                $hourlyRate
            );
            $recordedHours = $hCalc['elapsedHours'];
            $breakDeduction = $hCalc['breakDeduction'];
            $creditedHours = $hCalc['creditedHours'];
            $computedAllowance = $hCalc['computedAllowance'];
        } elseif ($checkIn) {
            $recordedHours = 0.0;
            $breakDeduction = 0.0;
            $creditedHours = 0.0;
        }

        $attendanceStatus = 'ABSENT';
        if ($checkIn && $checkOut) {
            $attendanceStatus = 'PRESENT';
            if (!empty($duties)) {
                $minStart = $duties[0]['start_time'];
                $actTime = date('H:i:s', strtotime($checkIn['logged_at']));
                if (strtotime($actTime) > (strtotime($minStart) + 15 * 60)) {
                    $attendanceStatus = 'LATE';
                }
            }
        } elseif ($checkIn) {
            $attendanceStatus = 'INCOMPLETE';
        } elseif (empty($duties)) {
            $attendanceStatus = 'OFF';
        }

        if ($rec && !empty($rec['status'])) {
            $attendanceStatus = $rec['status'];
            if ($rec['credited_hours'] !== null) $creditedHours = (float)$rec['credited_hours'];
            if (isset($rec['break_deduction']) && $rec['break_deduction'] !== null) {
                $breakDeduction = (float)$rec['break_deduction'];
            }
            $computedAllowance = round($creditedHours * $hourlyRate, 2);
        }

        // Timeline items (Clean Check-In, Automatic Meal Break, Check-Out)
        $timeline = [
            [
                'key' => 'in',
                'label' => 'Time In',
                'time' => $checkIn ? date('h:i A', strtotime($checkIn['logged_at'])) : '—',
                'faceVerified' => $checkIn ? ($checkIn['verification_status'] === 'VERIFIED') : false,
                'gpsVerified' => $checkIn ? ((float)$checkIn['distance_meters'] <= 1000.0) : false,
                'status' => $checkIn ? 'completed' : 'pending'
            ],
            [
                'key' => 'meal_break',
                'label' => 'Standard Meal Break (12:00 NN–1:00 PM)',
                'time' => $breakDeduction > 0 ? '−1.00 hr' : '0.00 hr',
                'faceVerified' => true,
                'gpsVerified' => true,
                'isAutomatic' => true,
                'status' => $breakDeduction > 0 ? 'deducted' : 'none',
                'note' => $breakDeduction > 0 ? 'Standard 1-hour unpaid lunch break automatically deducted' : 'Meal break deduction not applicable'
            ],
            [
                'key' => 'out',
                'label' => 'Time Out',
                'time' => $checkOut ? date('h:i A', strtotime($checkOut['logged_at'])) : '—',
                'faceVerified' => $checkOut ? ($checkOut['verification_status'] === 'VERIFIED') : false,
                'gpsVerified' => $checkOut ? ((float)$checkOut['distance_meters'] <= 1000.0) : false,
                'status' => $checkOut ? 'completed' : 'pending'
            ]
        ];

        // Exceptions
        $exceptions = [];
        if ($checkIn && !empty($duties)) {
            $minStart = $duties[0]['start_time'];
            $actTime = date('H:i:s', strtotime($checkIn['logged_at']));
            if (strtotime($actTime) > (strtotime($minStart) + 15 * 60)) {
                $lateMins = round((strtotime($actTime) - strtotime($minStart)) / 60);
                $exceptions[] = [
                    'type' => 'LATE',
                    'title' => 'Late Arrival',
                    'detail' => "Clocked in at " . date('h:i A', strtotime($actTime)) . " ({$lateMins} minutes after scheduled start)."
                ];
            }
        }
        if ($checkIn && !$checkOut && $date < date('Y-m-d')) {
            $exceptions[] = [
                'type' => 'INCOMPLETE',
                'title' => 'Missing Time Out',
                'detail' => 'Student Assistant did not punch out for the shift.'
            ];
        }
        if ($checkIn && (float)$checkIn['distance_meters'] > 200.0) {
            $exceptions[] = [
                'type' => 'GPS_WARNING',
                'title' => 'Geofence Boundary',
                'detail' => "Punched at " . round($checkIn['distance_meters']) . "m from campus geofence center."
            ];
        }

        // Current location info
        $firstLog = $checkIn ?: ($logs[0] ?? null);
        $curDist = $firstLog ? (float)$firstLog['distance_meters'] : 45.0;
        $isWithin = $firstLog ? ($curDist <= 1000.0) : true;
        $curLoc = [
            'name' => $firstLog ? ($firstLog['location_name'] ?: 'NCST Main Campus') : 'NCST Main Campus',
            'authorizedArea' => 'NCST Main Campus',
            'radiusMeters' => 1000,
            'radiusLabel' => 'Geo Fencing Range / Radius: 1,000 meters (approx.)',
            'statusLabel' => $isWithin ? 'Within Authorized Area' : 'Outside Authorized Area',
            'withinArea' => $isWithin,
            'lat' => $firstLog ? (float)$firstLog['latitude'] : 14.327472,
            'lng' => $firstLog ? (float)$firstLog['longitude'] : 120.940472,
            'distanceMeters' => $curDist,
            'saName' => trim($sa['first_name'] . ' ' . $sa['last_name'] . ($sa['suffix'] ? ' ' . $sa['suffix'] : ''))
        ];

        // Recent activity for this S.A.
        $recentActivity = array_map(function($l) use ($sa) {
            $labels = ['CHECK_IN' => 'Checked In', 'BREAK_OUT' => 'Break-Out', 'BREAK_IN' => 'Break-In', 'CHECK_OUT' => 'Checked Out'];
            return [
                'id' => (int)$l['id'],
                'time' => date('h:i A', strtotime($l['logged_at'])),
                'timestamp' => $l['logged_at'],
                'logType' => $l['log_type'],
                'action' => $labels[$l['log_type']] ?? $l['log_type'],
                'saLabel' => trim($sa['first_name'] . ' ' . $sa['last_name']) . ' (' . ($sa['sa_number'] ?: $sa['student_id']) . ')',
                'location' => $l['location_name'] ?: 'NCST Main Campus'
            ];
        }, $logs);

        respond([
            'success' => true,
            'sa' => [
                'id' => $saId,
                'studentId' => $sa['student_id'],
                'saNumber' => $sa['sa_number'] ?: ('SA-' . $sa['student_id']),
                'name' => trim($sa['first_name'] . ' ' . $sa['last_name'] . ($sa['suffix'] ? ' ' . $sa['suffix'] : '')),
                'course' => $sa['course'],
                'yearLevel' => $sa['year_level'],
                'department' => $sa['office_name'] ?: $scope['deptDisplayName'],
                'supervisor' => $scope['name'],
                'photoUrl' => $sa['biometric_photo'] ?: null
            ],
            'date' => $date,
            'schedule' => $schedLabel,
            'scheduledHours' => $schedHours,
            'timeInOutLabel' => ($checkIn && $checkOut) ? (date('h:i A', strtotime($checkIn['logged_at'])) . ' – ' . date('h:i A', strtotime($checkOut['logged_at']))) : '—',
            'recordedHours' => $recordedHours,
            'breakDeduction' => $breakDeduction,
            'creditedHours' => $creditedHours,
            'hourlyRate' => $hourlyRate,
            'computedAllowance' => $computedAllowance,
            'breakDeductionNote' => 'Standard 1-hour unpaid lunch break (12:00 NN–1:00 PM) automatically deducted.',
            'attendanceStatus' => $attendanceStatus,
            'reviewStatus' => $rec['review_status'] ?? 'NOT_YET_REVIEWED',
            'reviewedBy' => $rec['reviewed_by_name'] ?? null,
            'reviewedAt' => $rec['reviewed_at'] ?? null,
            'reviewNotes' => $rec['review_notes'] ?? null,
            'rejectionReason' => $rec['rejection_reason'] ?? null,
            'escalationReason' => $rec['escalation_reason'] ?? null,
            'currentLocation' => $curLoc,
            'timeline' => $timeline,
            'exceptions' => $exceptions,
            'recentActivity' => $recentActivity,
            'requests' => $requests
        ]);
        break;
    }

    case 'supervisor_review_attendance': {
        require_csrf();
        $saId = (int)(input()['saProfileId'] ?? 0);
        $date = trim(input()['dutyDate'] ?? input()['date'] ?? date('Y-m-d'));
        $decision = strtoupper(trim(input()['decision'] ?? 'APPROVE')); // APPROVE | REJECT | ESCALATE
        $creditedHours = (float)(input()['creditedHours'] ?? 0.0);
        $remarks = trim(input()['remarks'] ?? '');
        $reason = trim(input()['reason'] ?? '');

        if ($saId <= 0 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            fail('Valid S.A. profile ID and duty date are required.', 422);
        }

        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)(input()['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) fail('Supervisor scope not found.', 404);

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        // Security check
        if (!in_array($saId, $scopedSaIds, true)) {
            fail('Access denied. This S.A. is not assigned under your supervision.', 403);
        }

        if (in_array($decision, ['REJECT', 'ESCALATE'], true) && empty($reason) && empty($remarks)) {
            fail("A reason is mandatory when {$decision}ing an attendance record.", 422);
        }

        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int)$semStmt->fetchColumn() ?: 1;

        $reviewStatus = match($decision) {
            'APPROVE' => 'APPROVED',
            'REJECT' => 'REJECTED',
            'ESCALATE' => 'ESCALATED',
            default => 'UNDER_REVIEW'
        };

        $reconcileStatus = match($decision) {
            'APPROVE' => 'RECONCILED',
            'REJECT' => 'DISPUTED',
            'ESCALATE' => 'ADJUSTED',
            default => 'SYSTEM_GENERATED'
        };

        $rejReason = ($decision === 'REJECT') ? ($reason ?: $remarks) : null;
        $escReason = ($decision === 'ESCALATE') ? ($reason ?: $remarks) : null;
        $finalCredited = ($decision === 'REJECT') ? 0.00 : $creditedHours;
        $recordedHours = isset(input()['recordedHours']) ? (float)input()['recordedHours'] : 0.00;
        $breakDeduction = isset(input()['breakDeduction']) ? (float)input()['breakDeduction'] : 0.00;
        if ($finalCredited > 0 && $breakDeduction <= 0 && $recordedHours >= 5.0) {
            $breakDeduction = min(1.00, $recordedHours);
        }

        $upsert = $pdo->prepare("
            INSERT INTO sa_attendance_reconciliations (
                semester_id, sa_profile_id, duty_date, status, reconciliation_status,
                review_status, reviewed_by, reviewed_at, review_notes, rejection_reason, escalation_reason,
                recorded_hours, break_deduction, credited_hours, reconciled_by, reconciled_at
            ) VALUES (
                ?, ?, ?, 'PRESENT', ?,
                ?, ?, NOW(), ?, ?, ?,
                ?, ?, ?, ?, NOW()
            )
            ON DUPLICATE KEY UPDATE
                review_status = VALUES(review_status),
                reconciliation_status = VALUES(reconciliation_status),
                reviewed_by = VALUES(reviewed_by),
                reviewed_at = NOW(),
                review_notes = VALUES(review_notes),
                rejection_reason = VALUES(rejection_reason),
                escalation_reason = VALUES(escalation_reason),
                recorded_hours = IF(VALUES(recorded_hours) > 0, VALUES(recorded_hours), recorded_hours),
                break_deduction = IF(VALUES(break_deduction) > 0, VALUES(break_deduction), break_deduction),
                credited_hours = IF(VALUES(review_status) = 'REJECTED', 0.00, IF(VALUES(credited_hours) > 0, VALUES(credited_hours), credited_hours)),
                reconciled_by = VALUES(reconciled_by),
                reconciled_at = NOW()
        ");
        $upsert->execute([
            $activeSemId, $saId, $date, $reconcileStatus,
            $reviewStatus, $user['id'], $remarks, $rejReason, $escReason,
            $recordedHours, $breakDeduction, $finalCredited, $user['id']
        ]);

        audit('SUPERVISOR_ATTENDANCE_REVIEW', "Supervisor #{$user['id']} ({$user['full_name']}) {$decision} attendance for S.A. #{$saId} on {$date} | Notes: {$remarks} | Reason: {$reason}", (int)$user['id']);

        $actionWord = match($decision) {
            'APPROVE' => 'approved',
            'REJECT' => 'rejected',
            'ESCALATE' => 'escalated to coordinator',
            default => 'reviewed'
        };

        // If rejected by supervisor, send ABSENT SMS alert to S.A.
        $smsResult = null;
        if ($decision === 'REJECT') {
            $smsResult = send_attendance_status_sms($saId, 'ABSENT', [
                'date' => date('M d, Y', strtotime($date)),
                'reason' => $rejReason ?: 'Shift unverified or rejected by supervisor'
            ]);
        }

        respond([
            'success' => true,
            'message' => "Attendance record successfully {$actionWord}.",
            'reviewStatus' => $reviewStatus,
            'reconciliationStatus' => $reconcileStatus,
            'recordedHours' => $recordedHours,
            'breakDeduction' => $breakDeduction,
            'creditedHours' => $finalCredited,
            'smsSent' => $smsResult['success'] ?? false,
            'smsError' => $smsResult['error'] ?? null
        ]);
        break;
    }

    case 'supervisor_process_correction': {
        require_csrf();
        $requestId = (int)(input()['requestId'] ?? 0);
        $decision = strtoupper(trim(input()['decision'] ?? 'APPROVED')); // APPROVED | REJECTED
        $remarks = trim(input()['remarks'] ?? '');
        $reason = trim(input()['reason'] ?? '');

        if ($requestId <= 0) {
            fail('Valid request ID is required.', 422);
        }

        $supId = ($user['role'] === 'SUPERVISOR')
            ? (int)$user['id']
            : (int)(input()['supervisorId'] ?? 19);

        $scope = get_supervisor_scope($pdo, $supId);
        if (!$scope) fail('Supervisor scope not found.', 404);

        $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
        $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);

        // Fetch request
        $reqStmt = $pdo->prepare("SELECT * FROM sa_requests WHERE id = ? LIMIT 1");
        $reqStmt->execute([$requestId]);
        $req = $reqStmt->fetch(PDO::FETCH_ASSOC);
        if (!$req) fail('Correction request not found.', 404);

        if (!in_array((int)$req['sa_profile_id'], $scopedSaIds, true)) {
            fail('Access denied. You can only review requests for your assigned S.A.s.', 403);
        }

        if ($decision === 'REJECTED' && empty($reason) && empty($remarks)) {
            fail('Rejection remarks/reason is required.', 422);
        }

        $newStatus = ($decision === 'APPROVED') ? 'PENDING_COORDINATOR_RECORDING' : 'REJECTED_BY_SUPERVISOR';
        $finalRemarks = ($decision === 'APPROVED') ? $remarks : ($reason ?: $remarks);

        $upd = $pdo->prepare("
            UPDATE sa_requests
            SET status = ?,
                supervisor_decision = ?,
                supervisor_acted_by_id = ?,
                supervisor_name = ?,
                supervisor_remarks = ?,
                supervisor_acted_at = NOW()
            WHERE id = ?
        ");
        $upd->execute([
            $newStatus, $decision, $user['id'], $user['full_name'], $finalRemarks, $requestId
        ]);

        // If approved, update reconciliation record
        if ($decision === 'APPROVED') {
            $pdo->prepare("
                UPDATE sa_attendance_reconciliations
                SET review_status = 'APPROVED',
                    reviewed_by = ?,
                    reviewed_at = NOW(),
                    review_notes = CONCAT(COALESCE(review_notes, ''), '\n[Correction Approved by Supervisor: ', ?, ']')
                WHERE sa_profile_id = ? AND duty_date = ?
            ")->execute([$user['id'], $finalRemarks, $req['sa_profile_id'], $req['request_date']]);
        }

        audit('SUPERVISOR_REQUEST_DECISION', "Supervisor #{$user['id']} decided {$decision} on correction request #{$requestId} for S.A. #{$req['sa_profile_id']}", (int)$user['id']);

        respond([
            'success' => true,
            'message' => "Correction request successfully " . strtolower($decision) . ".",
            'status' => $newStatus
        ]);
        break;
    }

    case 'send_attendance_sms': {
        require_csrf();
        require_role($user, 'ADMIN', 'SUPERVISOR');

        $saId = (int)(input()['saProfileId'] ?? 0);
        $statusType = strtoupper(trim(input()['statusType'] ?? 'ABSENT'));
        $customMessage = trim(input()['message'] ?? '');
        $date = trim(input()['date'] ?? date('Y-m-d'));
        $reason = trim(input()['reason'] ?? '');

        if ($saId <= 0) {
            fail('Valid S.A. Profile ID is required.', 422);
        }

        // Check scope if supervisor
        if ($user['role'] === 'SUPERVISOR') {
            $scope = get_supervisor_scope($pdo, (int)$user['id']);
            if (!$scope) fail('Supervisor scope not found.', 404);
            $assignedSas = get_supervisor_assigned_sas($pdo, $scope);
            $scopedSaIds = array_map(fn($s) => (int)$s['sa_profile_id'], $assignedSas);
            if (!in_array($saId, $scopedSaIds, true)) {
                fail('Access denied. You can only send alerts to your assigned S.A.s.', 403);
            }
        }

        if (!empty($customMessage)) {
            // Fetch SA phone
            $stmt = $pdo->prepare('
                SELECT p.id, p.contact_number, u.phone AS user_phone
                FROM sa_profiles p
                LEFT JOIN users u ON u.id = p.user_id
                WHERE p.id = ? LIMIT 1
            ');
            $stmt->execute([$saId]);
            $sa = $stmt->fetch();
            $phone = !empty($sa['contact_number']) ? $sa['contact_number'] : ($sa['user_phone'] ?? null);
            if (empty($phone)) {
                fail('No contact number available for this Student Assistant.', 422);
            }
            $smsResult = send_semaphore_sms($phone, $customMessage, $saId, $statusType);
        } else {
            $smsResult = send_attendance_status_sms($saId, $statusType, [
                'date' => date('M d, Y', strtotime($date)),
                'reason' => $reason
            ]);
        }

        audit('ATTENDANCE_SMS_SENT', "User #{$user['id']} sent {$statusType} SMS to S.A. #{$saId}. Result: " . (($smsResult['success'] ?? false) ? 'OK' : 'Pending/Logged'));

        respond([
            'success' => true,
            'message' => "SMS alert for {$statusType} dispatched.",
            'smsResult' => $smsResult
        ]);
        break;
    }

    case 'perfect_attendance_summary': {
        require_role($user, 'ADMIN');
        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int) ($semStmt->fetchColumn() ?: 0);
        $selectedSemId = (int) (input()['semesterId'] ?? $_GET['semesterId'] ?? $activeSemId);
        $month = isset(input()['month']) ? (int) input()['month'] : (isset($_GET['month']) ? (int) $_GET['month'] : 0);
        $year = isset(input()['year']) ? (int) input()['year'] : (isset($_GET['year']) ? (int) $_GET['year'] : 0);

        $availableMonths = get_perfect_attendance_available_months($pdo, $selectedSemId ?: null);
        if ($month <= 0 || $year <= 0) {
            if (!empty($availableMonths)) {
                $month = (int) $availableMonths[0]['month'];
                $year = (int) $availableMonths[0]['year'];
            } else {
                $month = (int) date('n');
                $year = (int) date('Y');
            }
        }

        $summary = get_monthly_perfect_attendance_summary($pdo, $selectedSemId, $year, $month);
        $summary['availableMonths'] = $availableMonths;
        respond($summary);
        break;
    }

    case 'perfect_attendance_verify': {
        require_csrf();
        require_role($user, 'ADMIN');
        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int) ($semStmt->fetchColumn() ?: 0);
        $selectedSemId = (int) (input()['semesterId'] ?? $activeSemId);
        $month = (int) (input()['month'] ?? date('n'));
        $year = (int) (input()['year'] ?? date('Y'));
        $force = (bool) (input()['force'] ?? false);

        $result = verify_monthly_perfect_attendance($pdo, $selectedSemId, $year, $month, (int) $user['id'], $force);
        $result['availableMonths'] = get_perfect_attendance_available_months($pdo, $selectedSemId ?: null);
        audit('PERFECT_ATTENDANCE_VERIFIED', "Verified Perfect Attendance for {$result['period']['label']}: {$result['verification']['qualifiedCount']} qualified S.A.(s)", (int) $user['id']);
        respond($result);
        break;
    }

    case 'perfect_attendance_notification_details': {
        require_role($user, 'ADMIN');
        $month = (int) (input()['month'] ?? $_GET['month'] ?? 0);
        $year = (int) (input()['year'] ?? $_GET['year'] ?? 0);
        $notificationId = (int) (input()['notificationId'] ?? $_GET['notificationId'] ?? 0);

        if ($notificationId > 0) {
            $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')->execute([$notificationId, $user['id']]);
        }

        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int) ($semStmt->fetchColumn() ?: 0);

        if ($month <= 0 || $year <= 0) {
            $verifStmt = $pdo->query('SELECT month, year FROM perfect_attendance_verifications ORDER BY year DESC, month DESC LIMIT 1');
            $v = $verifStmt->fetch();
            if ($v) {
                $month = (int) $v['month'];
                $year = (int) $v['year'];
            } else {
                $month = (int) date('n');
                $year = (int) date('Y');
            }
        }

        $summary = get_monthly_perfect_attendance_summary($pdo, $activeSemId, $year, $month);
        respond($summary);
        break;
    }

    case 'coordinator_streaks_overview': {
        require_role($user, 'ADMIN', 'SUPERVISOR');
        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int) ($semStmt->fetchColumn() ?: 0);
        $selectedSemId = (int) (input()['semesterId'] ?? $_GET['semesterId'] ?? $activeSemId);
        $month = isset(input()['month']) ? (int) input()['month'] : (isset($_GET['month']) ? (int) $_GET['month'] : (int) date('n'));
        $year = isset(input()['year']) ? (int) input()['year'] : (isset($_GET['year']) ? (int) $_GET['year'] : (int) date('Y'));

        $overview = get_coordinator_streaks_overview($pdo, $selectedSemId, $year, $month);
        $overview['availableMonths'] = get_perfect_attendance_available_months($pdo, $selectedSemId ?: null);
        respond($overview);
        break;
    }

    case 'save_mystery_token': {
        require_csrf();
        require_role($user, 'ADMIN');
        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int) ($semStmt->fetchColumn() ?: 1);
        $semesterId = (int)(input()['semesterId'] ?? $activeSemId);
        $targetMonth = (int)(input()['targetMonth'] ?? 11);
        $targetYear = (int)(input()['targetYear'] ?? 2026);
        $title = trim((string)(input()['title'] ?? 'Mystery Token of Appreciation'));
        $clue = trim((string)(input()['clue'] ?? 'A little something to brighten your S.A. journey.'));
        $imageUrl = input()['imageUrl'] ? trim((string)input()['imageUrl']) : null;
        $visibility = (input()['visibility'] === 'HIDDEN') ? 'HIDDEN' : 'VISIBLE';

        $res = save_mystery_token($pdo, $semesterId, $targetYear, $targetMonth, $title, $clue, $imageUrl, $visibility, (int)$user['id']);
        audit('MYSTERY_TOKEN_UPDATED', "Updated mystery appreciation token for {$res['mysteryToken']['targetMonthLabel']}", (int)$user['id']);
        respond($res);
        break;
    }

    case 'sa_streak_calendar': {
        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int) ($semStmt->fetchColumn() ?: 1);
        $selectedSemId = (int) (input()['semesterId'] ?? $_GET['semesterId'] ?? $activeSemId);
        $month = isset(input()['month']) ? (int) input()['month'] : (isset($_GET['month']) ? (int) $_GET['month'] : (int) date('n'));
        $year = isset(input()['year']) ? (int) input()['year'] : (isset($_GET['year']) ? (int) $_GET['year'] : (int) date('Y'));

        $targetSaId = $saProfileId;
        if ($user['role'] === 'ADMIN' && !empty(input()['saProfileId'])) {
            $targetSaId = (int)input()['saProfileId'];
        }

        $res = get_sa_attendance_streak_summary($pdo, $targetSaId, $selectedSemId, $year, $month);
        $res['availableMonths'] = get_perfect_attendance_available_months($pdo, $selectedSemId ?: null);
        respond($res);
        break;
    }

    case 'sa_attendance_history_table': {
        $semStmt = $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1');
        $activeSemId = (int) ($semStmt->fetchColumn() ?: 1);
        $selectedSemId = (int) (input()['semesterId'] ?? $_GET['semesterId'] ?? $activeSemId);
        $month = isset(input()['month']) ? (int) input()['month'] : (isset($_GET['month']) ? (int) $_GET['month'] : null);
        $year = isset(input()['year']) ? (int) input()['year'] : (isset($_GET['year']) ? (int) $_GET['year'] : null);

        $targetSaId = $saProfileId;
        if ($user['role'] === 'ADMIN' && !empty(input()['saProfileId'])) {
            $targetSaId = (int)input()['saProfileId'];
        }

        $res = get_sa_attendance_monitoring_history($pdo, $targetSaId, $selectedSemId, $year, $month);
        respond($res);
        break;
    }

    default:
        fail('Unknown attendance action.', 400);
}

