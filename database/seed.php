<?php
// Creates demo data for development (all names are fictional). Command line only:
//   C:\xampp\php\php.exe database\seed.php
// Run database\schema.sql first for a clean database.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../config/config.php';
require __DIR__ . '/../api/_passwords.php';
require __DIR__ . '/../api/_sa.php';

const DEMO_PASSWORD = 'AssistPay@2026';
$demoHash = password_hash(DEMO_PASSWORD, PASSWORD_DEFAULT);
$now = date('Y-m-d H:i:s');

$officeIds = [];
foreach ($pdo->query('SELECT id, code FROM offices') as $o) $officeIds[$o['code']] = (int) $o['id'];
$semesterId = (int) $pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" LIMIT 1')->fetchColumn();

$upsertUser = $pdo->prepare(
    'INSERT INTO users (username, password_hash, role, full_name, email, supervisor_category, office_id,
                        status, must_change_password, password_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), full_name = VALUES(full_name),
                             status = VALUES(status), must_change_password = VALUES(must_change_password),
                             password_changed_at = VALUES(password_changed_at), failed_attempts = 0, locked_until = NULL'
);
$userId = function (string $username) use ($pdo): int {
    $q = $pdo->prepare('SELECT id FROM users WHERE username = ?');
    $q->execute([$username]);
    return (int) $q->fetchColumn();
};

// ---------------- Staff accounts ----------------
// [username, full name, supervisor category, office code]
$staff = [
    ['coordinator', 'Liza Mendoza', null, null],
    ['ito.supervisor', 'Pedro Cruz', 'ITO', null],
    ['acads.supervisor', 'Maria Reyes', 'ACADS', null],
    ['ocm.supervisor', 'Ramon Aquino', 'OFFICE', 'OCM'],
    ['prmd.supervisor', 'Rafael Domingo', 'OFFICE', 'PRMD'],
    ['registrar.supervisor', 'Teresa Bautista', 'OFFICE', 'REGISTRAR'],
    ['hr.supervisor', 'Jose Mercado', 'OFFICE', 'HR'],
    ['psmo.supervisor', 'Lourdes Navarro', 'OFFICE', 'PSMO'],
    ['fmo.supervisor', 'Antonio Villareal', 'OFFICE', 'FMO'],
    ['osa.supervisor', 'Cristina Flores', 'OFFICE', 'OSA'],
    ['itjpo.supervisor', 'Eduardo Ramos', 'OFFICE', 'ITJPO'],
    ['clinic.supervisor', 'Carmela Santos', 'OFFICE', 'CLINIC'],
    ['faculty.supervisor', 'Victoria Castillo', 'OFFICE', 'FACULTY'],
    ['nstp.supervisor', 'Manuel Soriano', 'OFFICE', 'NSTP'],
    ['htmd.supervisor', 'Rosario Galang', 'OFFICE', 'HTMD'],
];
echo "Staff accounts (password: " . DEMO_PASSWORD . ")\n";
foreach ($staff as [$username, $name, $category, $office]) {
    $email = ($username === 'coordinator' ? 'coordinator' : strstr($username, '.', true)) . '@ncst.edu.ph';
    $upsertUser->execute([$username, $demoHash, $username === 'coordinator' ? 'ADMIN' : 'SUPERVISOR', $name, $email,
        $category, $office ? $officeIds[$office] : null, 'ACTIVE', 0, $now]);
    printf("  %-22s %s\n", $username, $name);
}

$supervisorFor = function (string $dept, ?string $office) use ($userId): int {
    return $userId($dept === 'OFFICE' ? strtolower($office) . '.supervisor' : strtolower($dept) . '.supervisor');
};

// ---------------- Student Assistants ----------------
// First three match the PDF examples. [student ID, first, last, sex, course, year, category, office, assignment]
$sas = [
    ['2026-00123', 'Juan', 'Dela Cruz', 'MALE', 'BSIT', 3, 'ACADS', null, 'ASSIGNED'],
    ['2026-00145', 'Maria', 'Santos', 'FEMALE', 'BSCS', 4, 'ITO', null, 'ASSIGNED'],
    ['2026-00201', 'Carlo', 'Reyes', 'MALE', 'BSIT', 3, 'OFFICE', 'REGISTRAR', 'UNASSIGNED'],
];
$people = [
    ['Ana', 'Garcia', 'FEMALE'], ['Mark', 'Villanueva', 'MALE'], ['Pedro', 'Reyes', 'MALE'], ['Ana', 'Cruz', 'FEMALE'],
    ['Lea', 'Garcia', 'FEMALE'], ['Sofia', 'Ramos', 'FEMALE'], ['Daniel', 'Cruz', 'MALE'], ['Ella', 'Fernandez', 'FEMALE'],
    ['Miguel', 'Torres', 'MALE'], ['Andrea', 'Lopez', 'FEMALE'], ['Joshua', 'Mendoza', 'MALE'], ['Kristine', 'Aquino', 'FEMALE'],
    ['Paolo', 'Bautista', 'MALE'], ['Camille', 'Navarro', 'FEMALE'], ['Rafael', 'Castillo', 'MALE'], ['Jasmine', 'Morales', 'FEMALE'],
    ['Gabriel', 'Santiago', 'MALE'], ['Nicole', 'Del Rosario', 'FEMALE'], ['Adrian', 'Pascual', 'MALE'], ['Bea', 'Salazar', 'FEMALE'],
    ['Christian', 'Dizon', 'MALE'], ['Patricia', 'Manalo', 'FEMALE'], ['Kevin', 'Gonzales', 'MALE'], ['Angela', 'Rivera', 'FEMALE'],
    ['Nathaniel', 'Samson', 'MALE'], ['Trisha', 'Valdez', 'FEMALE'], ['Jerome', 'Ocampo', 'MALE'], ['Denise', 'Sison', 'FEMALE'],
    ['Ryan', 'Enriquez', 'MALE'], ['Clarisse', 'Medina', 'FEMALE'], ['Vincent', 'Tolentino', 'MALE'], ['Hannah', 'Lim', 'FEMALE'],
    ['Emmanuel', 'Robles', 'MALE'], ['Katrina', 'Padilla', 'FEMALE'], ['Lorenzo', 'Estrada', 'MALE'], ['Isabel', 'Marquez', 'FEMALE'],
    ['Francis', 'Cabrera', 'MALE'],
];
$categories = ['ACADS', 'ITO', 'OFFICE', 'OFFICE', 'ACADS', 'ITO', 'OFFICE', 'ACADS', 'OFFICE', 'ITO'];
$offices = array_keys($officeIds);
$courses = ['BSIT', 'BSCS', 'BSCpE', 'BSBA', 'BSA', 'BSHM', 'BSTM', 'BSPsy', 'BSIT', 'BSCS'];
foreach ($people as $i => [$first, $last, $sex]) {
    $category = $i === 18 || $i === 29 ? 'RELIEVER' : $categories[$i % count($categories)];
    $assignment = match (true) {
        in_array($i, [5, 21, 33], true) => 'UNASSIGNED',
        in_array($i, [9, 26], true) => 'FOR_REASSIGNMENT',
        $i === 14 => 'INACTIVE',
        default => 'ASSIGNED',
    };
    $sas[] = [sprintf('%d-%05d', $i < 20 ? 2025 : 2026, 210 + $i * 7), $first, $last, $sex, $courses[$i % count($courses)],
        1 + ($i % 4), $category, $category === 'OFFICE' ? $offices[$i % count($offices)] : null, $assignment];
}

$insertProfile = $pdo->prepare(
    'INSERT INTO sa_profiles (user_id, student_id, first_name, last_name, birth_date, sex, contact_number, course, year_level,
        semester_id, academic_status, enrollment_status, expected_graduation, sa_category, department_type, office_id,
        sa_status, appointment_start, assignment_status, weekly_target_hours, is_reliever, supervisor_id,
        emergency_name, emergency_number, emergency_relationship, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE sa_category = VALUES(sa_category), assignment_status = VALUES(assignment_status),
        supervisor_id = VALUES(supervisor_id), office_id = VALUES(office_id), department_type = VALUES(department_type)'
);
$coordinatorId = $userId('coordinator');
$pendingAccounts = ['2026-00145', '2026-00201'];   // must change password on first sign-in

echo "\nStudent Assistants\n";
foreach ($sas as $n => [$studentId, $first, $last, $sex, $course, $year, $category, $office, $assignment]) {
    $dept = $category === 'RELIEVER' ? 'ACADS' : $category;
    $pending = in_array($studentId, $pendingAccounts, true);
    $inactive = $assignment === 'INACTIVE';
    $temp = $pending ? generate_temp_password() : null;
    $email = strtolower(str_replace(' ', '', "$first.$last")) . ($n > 2 ? $n : '') . '@ncst.edu.ph';
    if ($studentId === '2026-00123') $email = 'juan.delacruz@ncst.edu.ph';
    if ($studentId === '2026-00145') $email = 'maria.santos@ncst.edu.ph';
    if ($studentId === '2026-00201') $email = 'carlo.reyes@ncst.edu.ph';

    $upsertUser->execute([$studentId, $pending ? password_hash($temp, PASSWORD_DEFAULT) : $demoHash, 'SA', "$first $last", $email,
        null, null, $inactive ? 'INACTIVE' : ($pending ? 'PENDING_ACTIVATION' : 'ACTIVE'), $pending ? 1 : 0, $pending ? null : $now]);

    $isNew = $assignment === 'UNASSIGNED';
    $insertProfile->execute([
        $userId($studentId), $studentId, $first, $last,
        sprintf('%d-%02d-%02d', 2003 + $n % 4, 1 + $n % 12, 1 + ($n * 3) % 28), $sex,
        sprintf('09%02d%07d', 17 + $n % 10, 1000000 + $n * 7919), $course, $year, $semesterId,
        $n % 6 === 5 ? 'IRREGULAR' : 'REGULAR', 'ENROLLED', sprintf('%d-%02d-01', 2027 + (4 - $year), $n % 2 ? 6 : 12),
        $category, $dept, $dept === 'OFFICE' ? $officeIds[$office] : null,
        $inactive ? 'INACTIVE' : 'ACTIVE', $isNew ? '2026-08-17' : '2025-08-18', $assignment, 35.0,
        $category === 'RELIEVER' ? 1 : 0,
        $isNew ? null : $supervisorFor($dept, $office),
        $n % 3 === 0 ? null : "Parent of $first", $n % 3 === 0 ? null : sprintf('0918%07d', 2000000 + $n * 4513),
        $n % 3 === 0 ? null : ($n % 2 ? 'Mother' : 'Father'), $coordinatorId,
    ]);
    $profileId = (int) $pdo->query('SELECT id FROM sa_profiles WHERE student_id = ' . $pdo->quote($studentId))->fetchColumn();
    save_benefits($profileId, ['semester_id' => $semesterId, 'tuition_fee' => 32000 + ($n % 5) * 2500, 'misc_fee' => 8500 + ($n % 4) * 750]);

    printf("  %-11s %-22s %-9s %-17s%s\n", $studentId, "$first $last", $category, $assignment,
        $temp ? "  temporary password: $temp" : ($inactive ? '  (account inactive)' : ''));
}
echo "\nOther S.A. accounts use the password " . DEMO_PASSWORD . "\n";

// ---------------- Scheduling inputs (Step 5) ----------------
$profiles = $pdo->query('SELECT id, student_id, course, year_level FROM sa_profiles ORDER BY id')->fetchAll();

// Class schedules: 3 blocks per week, leaving weekday gaps for duty hours
$classPatterns = [
    [['MON', '08:00:00', '10:00:00'], ['WED', '13:00:00', '15:00:00'], ['FRI', '10:00:00', '12:00:00']],
    [['TUE', '07:30:00', '09:30:00'], ['THU', '13:00:00', '16:00:00'], ['FRI', '07:30:00', '09:30:00']],
    [['MON', '15:00:00', '17:00:00'], ['TUE', '10:00:00', '12:00:00'], ['THU', '08:00:00', '10:00:00']],
    [['WED', '08:00:00', '11:00:00'], ['FRI', '13:00:00', '15:00:00'], ['SAT', '08:00:00', '11:00:00']],
    [['MON', '10:00:00', '12:00:00'], ['WED', '15:00:00', '17:00:00'], ['THU', '10:00:00', '12:00:00']],
];
$subjects = [
    'BSIT' => ['IT101', 'IT202', 'IT303'], 'BSCS' => ['CS101', 'CS210', 'CS311'],
    'BSCpE' => ['CPE110', 'CPE220', 'CPE330'], 'BSBA' => ['BA101', 'BA205', 'BA310'],
    'BSA' => ['ACC101', 'ACC210', 'ACC315'], 'BSHM' => ['HM101', 'HM220', 'HM330'],
    'BSTM' => ['TM101', 'TM215', 'TM320'], 'BSPsy' => ['PSY101', 'PSY210', 'PSY320'],
];
$insertClass = $pdo->prepare(
    'INSERT IGNORE INTO class_schedules (semester_id, sa_profile_id, student_id, day_of_week, start_time, end_time, subject, section, imported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
$classCount = 0;
foreach ($profiles as $i => $p) {
    $pattern = $classPatterns[$i % count($classPatterns)];
    $codes = $subjects[$p['course']] ?? ['GE101', 'GE102', 'GE103'];
    $section = $p['course'] . '-' . $p['year_level'] . chr(65 + $i % 3);
    foreach ($pattern as $k => [$day, $start, $end]) {
        $insertClass->execute([$semesterId, $p['id'], $p['student_id'], $day, $start, $end, $codes[$k], $section, $coordinatorId]);
        $classCount += $insertClass->rowCount();
    }
}

// Room / lab requirements: period-specific coverage for ACADS and ITO
$insertRoom = $pdo->prepare(
    'INSERT IGNORE INTO room_requirements (semester_id, department_type, room, day_of_week, start_time, end_time, required_sa, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
$weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
$periods = [['08:00:00', '10:00:00'], ['10:00:00', '12:00:00'], ['13:00:00', '15:00:00']];
$rooms = [['ACADS', 'LAB 1'], ['ACADS', 'LAB 2'], ['ACADS', 'LAB 3'], ['ITO', 'LAB 3'], ['ITO', 'LAB 5']];
$roomCount = 0;
foreach ($rooms as $r => [$dept, $room]) {
    foreach ($weekdays as $d => $day) {
        foreach ($periods as $q => [$start, $end]) {
            if (($r + $d + $q) % 3 === 2) continue;              // not every lab needs every period
            $required = ($r === 3 && $day === 'TUE') ? 2 : 1;    // ITO LAB 3 Tuesday needs 2
            $insertRoom->execute([$semesterId, $dept, $room, $day, $start, $end, $required, $coordinatorId]);
            $roomCount += $insertRoom->rowCount();
        }
    }
}

// Office staffing requirements: entered by the Coordinator, never assumed
$officeNeeds = ['REGISTRAR' => 3, 'OCM' => 2, 'HR' => 2, 'OSA' => 2, 'CLINIC' => 1, 'FMO' => 1,
                'PSMO' => 1, 'PRMD' => 1, 'ITJPO' => 1, 'FACULTY' => 2];
$insertOffice = $pdo->prepare(
    'INSERT INTO office_requirements (semester_id, office_id, required_sa, operating_start, operating_end, weekly_target_hours, created_by)
     VALUES (?, ?, ?, "08:00:00", "17:00:00", 35.0, ?)
     ON DUPLICATE KEY UPDATE required_sa = VALUES(required_sa)'
);
foreach ($officeNeeds as $code => $need) {
    $insertOffice->execute([$semesterId, $officeIds[$code], $need, $coordinatorId]);
}

printf("\nScheduling inputs: %d class rows, %d room/lab periods, %d office requirements (NSTP and HTMD left blank on purpose)\n",
    $classCount, $roomCount, count($officeNeeds));
