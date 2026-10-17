<?php
// Shared S.A. Management logic: dropdown options, validation and output format.

const COURSES = [
    'BSIT'      => 'BS Information Technology',
    'BSCS'      => 'BS Computer Science',
    'BSCPE'     => 'BS Computer Engineering',
    'BSCpE'     => 'BS Computer Engineering',
    'BSECE'     => 'BS Electronics Engineering',
    'BSIE'      => 'BS Industrial Engineering',
    'BSBA'      => 'BS Business Administration',
    'BSBA-MM'   => 'BSBA - Major in Marketing Management',
    'BSBA-OM'   => 'BSBA - Major in Operations Management',
    'BSBA-FM'   => 'BSBA - Major in Financial Management',
    'BSA'       => 'BS Accountancy',
    'BSHM'      => 'BS Hospitality Management',
    'BSTM'      => 'BS Tourism Management',
    'BSPSY'     => 'BS Psychology',
    'BSPsy'     => 'BS Psychology',
    'BSCRIM'    => 'BS Criminology',
    'BSCrim'    => 'BS Criminology',
    'BSARCH'    => 'BS Architecture',
    'BSARCHI'   => 'BS Architecture',
    'ABCOM'     => 'Bachelor of Arts in Communication',
    'BSE'       => 'BS Entrepreneurship',
    'BSENTREP'  => 'BS Entrepreneurship',
    'BSCA'      => 'BS Customs Administration',
    'BSREM'     => 'BS Real Estate Management',
    'BSPA'      => 'BS Public Administration',
    'BSEd'      => 'Bachelor of Secondary Education',
    'BSEd-ENG'  => 'BSEd - Major in English',
    'BSEd-MATH' => 'BSEd - Major in Mathematics',
    'BSEd-FIL'  => 'BSEd - Major in Filipino',
    'BSEd-SS'   => 'BSEd - Major in Social Science',
    'BEEd'      => 'Bachelor of Elementary Education',
    'BSECE'     => 'BS Electronics Engineering',
    'BSEE'      => 'BS Electronics Engineering',
];

// Benefit policy (PDF: 100% free tuition, 70% free miscellaneous)
const TUITION_COVERAGE_PCT = 100.0;
const MISC_COVERAGE_PCT = 70.0;

// What an S.A. earns per duty hour, and the least they may earn. Whole pesos
// only: an S.A. can be paid more than the standard 8, never less and never in
// centavos.
const DEFAULT_HOURLY_RATE = 8;
const MIN_HOURLY_RATE = 8;
const MAX_HOURLY_RATE = 1000;

const STUDENT_ID_PATTERN = '/^\d{4}-\d{5}$/';            // 2026-00123
const PH_MOBILE_PATTERN = '/^(09|\+639)\d{9}$/';         // 09171234567 or +639171234567
// Names: a letter first, then letters (Ñ and accents included), spaces,
// hyphens, apostrophes and periods. No digits, no other special characters.
const NAME_PATTERN = "/^\p{L}[\p{L}\p{M}'. -]*$/u";
const NAME_MESSAGE = 'Letters, spaces, hyphens and apostrophes only.';
const EMERGENCY_TEXT_PATTERN = "/^[\p{L}\p{M}\d'.\s\-\/\(\),&#]+$/u";
const EMERGENCY_TEXT_MESSAGE = 'Letters, spaces, hyphens, slashes and common punctuation only.';

function semester_label(array $s): string
{
    $terms = ['1ST' => '1st Semester', '2ND' => '2nd Semester', 'SUMMER' => 'Summer'];
    return $terms[$s['term']] . ' AY ' . str_replace('-', '–', $s['academic_year']);
}

function active_semester(): ?array
{
    global $pdo;
    static $cached = false;
    if ($cached !== false && PHP_SAPI !== 'cli') {
        return $cached;
    }
    $row = $pdo->query(
        'SELECT s.*, r.hourly_rate FROM semesters s
         LEFT JOIN allowance_rates r ON r.semester_id = s.id
         WHERE s.status = "ACTIVE" ORDER BY s.start_date DESC LIMIT 1'
    )->fetch();
    $cached = $row ? format_semester($row) : null;
    return $cached;
}

function format_semester(array $s): array
{
    $endDate = $s['end_date'] ?? null;
    $status = $s['status'] ?? 'ACTIVE';
    $today = date('Y-m-d');
    $isEnded = ($status === 'CLOSED') || ($endDate && $today >= $endDate);

    return [
        'id' => (int) $s['id'],
        'label' => semester_label($s),
        'academicYear' => $s['academic_year'],
        'term' => $s['term'],
        'startDate' => $s['start_date'],
        'endDate' => $endDate,
        'status' => $status,
        'requiredSa' => isset($s['required_sa']) ? (int) $s['required_sa'] : null,
        'hourlyRate' => isset($s['hourly_rate']) ? (float) $s['hourly_rate'] : null,
        'dutyScheduleMode' => $s['duty_schedule_mode'] ?? 'SEMESTER',
        'isEnded' => (bool) $isEnded,
    ];
}

/**
 * Auto-generates a standardized S.A. Number, e.g. "SA-2026-0001".
 * Format: SA-[YEAR]-[4-DIGIT SEQUENCE]
 */
function generate_sa_number(?string $department = null): string
{
    global $pdo;
    $year = date('Y');
    $prefix = "SA-{$year}-";
    $prefixLen = strlen($prefix) + 1;

    // Find highest sequence for standard 4-digit sequence format SA-YYYY-XXXX (1 to 9999)
    $stmt = $pdo->prepare("
        SELECT MAX(CAST(SUBSTRING(sa_number, ?) AS UNSIGNED)) 
          FROM sa_profiles 
         WHERE sa_number LIKE ? 
           AND sa_number REGEXP ?
    ");
    $stmt->execute([$prefixLen, $prefix . '%', '^SA-[0-9]{4}-[0-9]{4}$']);
    $maxSeq = (int) $stmt->fetchColumn();

    if ($maxSeq === 0) {
        $stmt2 = $pdo->prepare("SELECT MAX(CAST(SUBSTRING(sa_number, ?) AS UNSIGNED)) FROM sa_profiles WHERE sa_number LIKE ?");
        $stmt2->execute([$prefixLen, $prefix . '%']);
        $maxSeq = (int) $stmt2->fetchColumn();
    }

    $seq = $maxSeq + 1;

    // Concurrency collision-resistance check
    $checkStmt = $pdo->prepare("SELECT COUNT(*) FROM sa_profiles WHERE sa_number = ?");
    do {
        $candidate = $prefix . str_pad((string) $seq, 4, '0', STR_PAD_LEFT);
        $checkStmt->execute([$candidate]);
        $exists = (int) $checkStmt->fetchColumn() > 0;
        if ($exists) {
            $seq++;
        }
    } while ($exists && $seq < 99999);

    return $candidate;
}

/** Dropdown data for the Register / Edit form. */
function sa_form_options(): array
{
    global $pdo;
    if (!function_exists('schema_guard_ready') || !schema_guard_ready('users_fullname_backfill', 3600)) {
        $pdo->exec("
            UPDATE users
            SET full_name = TRIM(CONCAT_WS(' ', first_name, NULLIF(middle_name, ''), last_name, NULLIF(suffix, '')))
            WHERE full_name IS NULL OR TRIM(full_name) = ''
        ");
        if (function_exists('schema_guard_mark_ready')) {
            schema_guard_mark_ready('users_fullname_backfill');
        }
    }
    $semesters = $pdo->query(
        'SELECT s.*, r.hourly_rate FROM semesters s
         LEFT JOIN allowance_rates r ON r.semester_id = s.id ORDER BY s.start_date DESC'
    )->fetchAll();
    $offices = $pdo->query('SELECT id, code, name FROM offices WHERE is_active = 1 AND name != "PSMO/FMO" ORDER BY name')->fetchAll();
    $supervisors = $pdo->query(
        'SELECT id,
                COALESCE(NULLIF(TRIM(full_name), ""), TRIM(CONCAT_WS(" ", first_name, NULLIF(middle_name, ""), last_name, NULLIF(suffix, "")))) AS full_name,
                supervisor_category, office_id
         FROM users
         WHERE role = "SUPERVISOR" AND status IN ("ACTIVE","PENDING_ACTIVATION")
         ORDER BY full_name'
    )->fetchAll();

    // Fetch multi-office assignments for all supervisors
    $soMap = [];
    $soNamesMap = [];
    $soRows = $pdo->query('
        SELECT so.supervisor_id, so.office_id, o.name AS office_name
        FROM supervisor_offices so
        JOIN offices o ON o.id = so.office_id
    ')->fetchAll();

    foreach ($soRows as $row) {
        $sid = (int) $row['supervisor_id'];
        if (!isset($soMap[$sid])) $soMap[$sid] = [];
        if (!isset($soNamesMap[$sid])) $soNamesMap[$sid] = [];
        $soMap[$sid][] = (int) $row['office_id'];
        $soNamesMap[$sid][] = $row['office_name'];
    }

    $coursesList = [];
    $seenCodes = [];
    $cStmt = $pdo->query('SELECT course_code, course_name FROM courses ORDER BY course_code');
    while ($cRow = $cStmt->fetch()) {
        $coursesList[] = ['code' => $cRow['course_code'], 'name' => $cRow['course_name']];
        $seenCodes[strtoupper($cRow['course_code'])] = true;
    }
    foreach (COURSES as $cCode => $cName) {
        if (!isset($seenCodes[strtoupper($cCode)])) {
            $coursesList[] = ['code' => $cCode, 'name' => $cName];
            $seenCodes[strtoupper($cCode)] = true;
        }
    }

    $activeSem = active_semester();
    $activeSemId = $activeSem ? (int) $activeSem['id'] : null;

    $reqMap = [];
    if ($activeSemId) {
        $reqQ = $pdo->prepare('SELECT office_id, required_sa FROM office_requirements WHERE semester_id = ?');
        $reqQ->execute([$activeSemId]);
        foreach ($reqQ->fetchAll() as $rRow) {
            $reqMap[(int) $rRow['office_id']] = (int) $rRow['required_sa'];
        }
    }

    $assignedCounts = [];
    $cntQ = $pdo->query('SELECT office_id, COUNT(*) as cnt FROM sa_profiles WHERE office_id IS NOT NULL AND sa_status = "ACTIVE" AND assignment_status = "ASSIGNED" AND archived_at IS NULL GROUP BY office_id');
    foreach ($cntQ->fetchAll() as $cRow) {
        $assignedCounts[(int) $cRow['office_id']] = (int) $cRow['cnt'];
    }

    return [
        'courses' => $coursesList,
        'semesters' => array_map('format_semester', $semesters),
        'offices' => array_map(function($o) use ($reqMap, $assignedCounts) {
            $oid = (int) $o['id'];
            $req = $reqMap[$oid] ?? null;
            $assigned = $assignedCounts[$oid] ?? 0;
            $hasRequirement = ($req !== null && $req > 0);
            $isFull = !$hasRequirement || ($assigned >= $req);
            $vacant = $hasRequirement ? max(0, $req - $assigned) : 0;
            return [
                'id' => $oid,
                'code' => $o['code'],
                'name' => $o['name'],
                'requiredSa' => $req,
                'assignedSa' => $assigned,
                'vacancies' => $vacant,
                'isFull' => $isFull,
                'hasRequirement' => $hasRequirement,
            ];
        }, $offices),
        'supervisors' => array_map(function($s) use ($soMap, $soNamesMap, $offices) {
            $sid = (int) $s['id'];
            $officeIds = $soMap[$sid] ?? [];
            $officeNames = $soNamesMap[$sid] ?? [];
            if ($s['office_id'] && !in_array((int)$s['office_id'], $officeIds, true)) {
                $officeIds[] = (int) $s['office_id'];
                foreach ($offices as $of) {
                    if ((int)$of['id'] === (int)$s['office_id'] && !in_array($of['name'], $officeNames, true)) {
                        $officeNames[] = $of['name'];
                    }
                }
            }
            return [
                'id' => $sid,
                'name' => $s['full_name'],
                'category' => strtoupper($s['supervisor_category'] ?? 'OFFICE'),
                'officeId' => $s['office_id'] ? (int) $s['office_id'] : null,
                'officeIds' => array_values(array_unique($officeIds)),
                'officeNames' => array_values(array_unique($officeNames)),
            ];
        }, $supervisors),
        'coverage' => ['tuitionPct' => TUITION_COVERAGE_PCT, 'miscPct' => MISC_COVERAGE_PCT],
        'nextSaNumber' => generate_sa_number(),
    ];
}

/**
 * Validates Register / Edit input.
 * Returns [$clean, $errors] — $errors maps field name => message.
 * $existing = current sa_profiles row when editing (null when registering).
 */
function validate_sa(array $in, ?array $existing = null): array
{
    global $pdo;
    $e = [];
    $s = fn($k) => trim((string) ($in[$k] ?? ''));
    $opt = fn($k) => ($v = trim((string) ($in[$k] ?? ''))) === '' ? null : $v;

    $c = [
        'student_id' => $s('studentId'),
        'sa_number' => $opt('saNumber'),
        'first_name' => $s('firstName'),
        'middle_name' => $opt('middleName'),
        'last_name' => $s('lastName'),
        'suffix' => $opt('suffix'),
        'birth_date' => $opt('birthDate'),
        'sex' => $opt('sex'),
        'contact_number' => preg_replace('/[\s-]/', '', $s('contactNumber')),
        'school_email' => mb_strtolower($s('schoolEmail')),
        'personal_email' => ($pe = $opt('personalEmail')) ? mb_strtolower($pe) : null,
        'course' => $s('course'),
        'year_level' => (int) ($in['yearLevel'] ?? 0),
        'semester_id' => (int) ($in['semesterId'] ?? 0),
        'academic_status' => $s('academicStatus'),
        'enrollment_status' => $s('enrollmentStatus'),
        'expected_graduation' => $opt('expectedGraduation'),
        'sa_category' => $s('saCategory'),
        'department_type' => $s('departmentType'),
        'office_id' => ($in['officeId'] ?? null) ? (int) $in['officeId'] : null,
        'supervisor_id' => ($in['supervisorId'] ?? null) ? (int) $in['supervisorId'] : null,
        'sa_status' => $s('saStatus') ?: 'ACTIVE',
        'appointment_start' => $s('appointmentStart'),
        'appointment_end' => $opt('appointmentEnd'),
        'assignment_status' => $s('assignmentStatus') ?: 'UNASSIGNED',
        'weekly_target_hours' => $in['weeklyTargetHours'] ?? 35,
        'hourly_rate' => $in['hourlyRate'] ?? '',
        'is_reliever' => !empty($in['isReliever']),
        'emergency_name' => $opt('emergencyName'),
        'emergency_number' => ($en = $opt('emergencyNumber')) ? preg_replace('/[\s-]/', '', $en) : null,
        'emergency_relationship' => $opt('emergencyRelationship'),
        'tuition_fee' => $in['tuitionFee'] ?? '',
        'misc_fee' => $in['miscFee'] ?? '',
    ];

    // 1. Student information
    // Names keep single spaces, so "De  Guzman" and "De Guzman" are stored the same way
    foreach (['first_name', 'middle_name', 'last_name', 'suffix', 'emergency_name', 'emergency_relationship'] as $col) {
        if ($c[$col] !== null && $c[$col] !== '') $c[$col] = preg_replace('/\s+/u', ' ', trim($c[$col]));
    }

    if (!preg_match(STUDENT_ID_PATTERN, $c['student_id'])) $e['studentId'] = 'Use the format 2026-00123.';
    foreach (['first_name' => 'firstName', 'last_name' => 'lastName'] as $col => $field) {
        if ($c[$col] === '') $e[$field] = 'Required.';
        elseif (mb_strlen($c[$col]) > 60) $e[$field] = 'Use 60 characters or fewer.';
        elseif (!preg_match(NAME_PATTERN, $c[$col])) $e[$field] = NAME_MESSAGE;
    }
    if ($c['middle_name'] && mb_strlen($c['middle_name']) > 60) $e['middleName'] = 'Use 60 characters or fewer.';
    elseif ($c['middle_name'] && !preg_match(NAME_PATTERN, $c['middle_name'])) $e['middleName'] = NAME_MESSAGE;
    if ($c['suffix'] && mb_strlen($c['suffix']) > 10) $e['suffix'] = 'Use 10 characters or fewer.';
    elseif ($c['suffix'] && !preg_match(NAME_PATTERN, $c['suffix'])) $e['suffix'] = NAME_MESSAGE;
    if ($c['birth_date'] && !valid_date($c['birth_date'])) $e['birthDate'] = 'Enter a valid date.';
    elseif ($c['birth_date'] && $c['birth_date'] > date('Y-m-d', strtotime('-14 years'))) $e['birthDate'] = 'Check the date of birth.';
    if ($c['sex'] && !in_array($c['sex'], ['MALE', 'FEMALE'], true)) $e['sex'] = 'Choose an option.';
    if (!preg_match(PH_MOBILE_PATTERN, $c['contact_number'])) $e['contactNumber'] = 'Use a mobile number like 09171234567.';
    if (!filter_var($c['school_email'], FILTER_VALIDATE_EMAIL) || mb_strlen($c['school_email']) > 150) $e['schoolEmail'] = 'Enter a valid email address.';
    if ($c['personal_email'] && !filter_var($c['personal_email'], FILTER_VALIDATE_EMAIL)) $e['personalEmail'] = 'Enter a valid email address.';

    // Uniqueness (student ID, SA number, email, full name, and contact number cannot be duplicated)
    $userId = $existing['user_id'] ?? 0;
    $profileId = $existing['id'] ?? 0;
    if (!isset($e['studentId'])) {
        $q = $pdo->prepare('SELECT COUNT(*) FROM users WHERE LOWER(TRIM(username)) = LOWER(?) AND id <> ?');
        $q->execute([$c['student_id'], $userId]);
        $q2 = $pdo->prepare('SELECT COUNT(*) FROM sa_profiles WHERE LOWER(TRIM(student_id)) = LOWER(?) AND id <> ?');
        $q2->execute([$c['student_id'], $profileId]);
        if ($q->fetchColumn() || $q2->fetchColumn()) {
            $e['studentId'] = 'This Student ID is already registered as a Student Assistant. Duplicate registration is not allowed.';
        }
    }
    if (!isset($e['schoolEmail'])) {
        $q = $pdo->prepare('SELECT COUNT(*) FROM users WHERE LOWER(TRIM(email)) = LOWER(?) AND id <> ?');
        $q->execute([$c['school_email'], $userId]);
        if ($q->fetchColumn()) {
            $e['schoolEmail'] = 'This email already belongs to another account. Duplicate registration is not allowed.';
        }
    }
    if (!isset($e['firstName']) && !isset($e['lastName'])) {
        $qName = $pdo->prepare('
            SELECT COUNT(*) FROM sa_profiles
             WHERE LOWER(TRIM(first_name)) = LOWER(?)
               AND LOWER(TRIM(last_name)) = LOWER(?)
               AND COALESCE(LOWER(TRIM(suffix)), "") = LOWER(?)
               AND id <> ?
        ');
        $qName->execute([$c['first_name'], $c['last_name'], (string) ($c['suffix'] ?? ''), $profileId]);
        if ($qName->fetchColumn()) {
            $e['studentId'] = $e['studentId'] ?? 'This Student Assistant (same name) is already registered. Duplicate registration is not allowed.';
            $e['firstName'] = 'This student is already registered as a Student Assistant.';
        }
    }
    if (!isset($e['contactNumber']) && $c['contact_number'] !== '') {
        $qPhone = $pdo->prepare('
            SELECT COUNT(*) FROM sa_profiles
             WHERE REPLACE(REPLACE(contact_number, " ", ""), "-", "") = ?
               AND id <> ?
        ');
        $qPhone->execute([$c['contact_number'], $profileId]);
        if ($qPhone->fetchColumn()) {
            $e['contactNumber'] = 'This contact number is already registered to another Student Assistant.';
        }
    }

    // 2. Academic information
    $validCourse = array_key_exists($c['course'], COURSES);
    if (!$validCourse) {
        $cq = $pdo->prepare('SELECT COUNT(*) FROM courses WHERE course_code = ?');
        $cq->execute([$c['course']]);
        if ($cq->fetchColumn()) $validCourse = true;
    }
    if (!$validCourse) $e['course'] = 'Choose a course.';
    if ($c['year_level'] < 1 || $c['year_level'] > 5) $e['yearLevel'] = 'Choose a year level.';
    $q = $pdo->prepare('SELECT COUNT(*) FROM semesters WHERE id = ?');
    $q->execute([$c['semester_id']]);
    if (!$q->fetchColumn()) $e['semesterId'] = 'Choose a semester.';
    if (!in_array($c['academic_status'], ['REGULAR', 'IRREGULAR'], true)) $e['academicStatus'] = 'Choose an option.';
    if (!in_array($c['enrollment_status'], ['ENROLLED', 'NOT_ENROLLED'], true)) $e['enrollmentStatus'] = 'Choose an option.';
    if ($c['expected_graduation']) {
        if (preg_match('/^\d{4}$/', $c['expected_graduation'])) $c['expected_graduation'] .= '-06-01';
        elseif (preg_match('/^\d{4}-\d{2}$/', $c['expected_graduation'])) $c['expected_graduation'] .= '-01';
        if (!valid_date($c['expected_graduation'])) $e['expectedGraduation'] = 'Enter a valid year.';
    }

    // 3. Employment / assignment
    if ($c['assignment_status'] === 'ASSIGNED') {
        if (!in_array($c['sa_category'], ['ACADS', 'ITO', 'OFFICE', 'RELIEVER'], true)) {
            $e['saCategory'] = 'Choose a category.';
        } elseif ($c['sa_category'] !== 'RELIEVER') {
            $c['department_type'] = $c['sa_category'];      // department follows the category
        } else {
            $c['is_reliever'] = true;
        }
        if (!in_array($c['department_type'], ['ACADS', 'ITO', 'OFFICE'], true)) $e['departmentType'] = 'Choose a department type.';

        if ($c['department_type'] === 'OFFICE') {
            $q = $pdo->prepare('SELECT COUNT(*) FROM offices WHERE id = ? AND is_active = 1');
            $q->execute([(int) $c['office_id']]);
            if (!$q->fetchColumn()) {
                $e['officeId'] = 'Choose the office.';
            } else {
                $actSem = active_semester();
                $semId = (int) ($c['semester_id'] ?? ($actSem['id'] ?? 1));
                $reqStmt = $pdo->prepare('SELECT r.required_sa, o.name FROM offices o LEFT JOIN office_requirements r ON r.office_id = o.id AND r.semester_id = ? WHERE o.id = ?');
                $reqStmt->execute([$semId, (int) $c['office_id']]);
                $reqRow = $reqStmt->fetch();
                if (!$reqRow || $reqRow['required_sa'] === null || (int) $reqRow['required_sa'] <= 0) {
                    $offName = $reqRow['name'] ?? 'This office';
                    $e['officeId'] = "No vacancy! Ang opisina na {$offName} ay walang naka-set na S.A. requirement para sa semester na ito.";
                } else {
                    $reqCap = (int) $reqRow['required_sa'];
                    $existingId = $existing ? (int) $existing['id'] : 0;
                    $cntStmt = $pdo->prepare('SELECT COUNT(*) FROM sa_profiles WHERE office_id = ? AND id <> ? AND sa_status = "ACTIVE" AND assignment_status = "ASSIGNED" AND archived_at IS NULL');
                    $cntStmt->execute([(int) $c['office_id'], $existingId]);
                    $otherAssigned = (int) $cntStmt->fetchColumn();
                    if ($otherAssigned >= $reqCap) {
                        $e['officeId'] = "No vacancy! Ang opisina na {$reqRow['name']} ay puno na ({$otherAssigned}/{$reqCap} slots occupied · 0 vacant). Hindi maaaring mag-save.";
                    }
                }
            }
        } else {
            $c['office_id'] = null;
        }
    } else {
        // When UNASSIGNED or FOR_REASSIGNMENT
        if (!in_array($c['sa_category'], ['ACADS', 'ITO', 'OFFICE', 'RELIEVER'], true)) {
            $c['sa_category'] = 'ACADS';
        }
        $c['department_type'] = $c['sa_category'] === 'RELIEVER' ? 'ACADS' : $c['sa_category'];
        $c['office_id'] = null;
        $c['supervisor_id'] = null;
    }

    $c['sa_status'] = 'ACTIVE';
    if (!in_array($c['assignment_status'] ?? '', ['ASSIGNED', 'UNASSIGNED'], true)) {
        $c['assignment_status'] = 'UNASSIGNED';
    }

    if (!valid_date($c['appointment_start'])) $e['appointmentStart'] = 'Enter the start date.';
    if ($c['appointment_end'] && !valid_date($c['appointment_end'])) $e['appointmentEnd'] = 'Enter a valid date.';
    elseif ($c['appointment_end'] && !isset($e['appointmentStart']) && $c['appointment_end'] < $c['appointment_start']) $e['appointmentEnd'] = 'Must be on or after the start date.';

    if (!is_numeric($c['weekly_target_hours']) || $c['weekly_target_hours'] < 1 || $c['weekly_target_hours'] > 60) {
        $e['weeklyTargetHours'] = 'Enter 1 to 60 hours.';
    } else {
        $c['weekly_target_hours'] = round((float) $c['weekly_target_hours'], 1);
    }

    // Blank means "whatever the semester pays"; a number is this S.A.'s own rate
    if ($c['hourly_rate'] === '' || $c['hourly_rate'] === null) {
        $c['hourly_rate'] = null;
    } elseif (!is_numeric($c['hourly_rate']) || (float) $c['hourly_rate'] != (int) $c['hourly_rate']) {
        $e['hourlyRate'] = 'Enter whole pesos, no centavos.';
    } elseif ((int) $c['hourly_rate'] < MIN_HOURLY_RATE) {
        $e['hourlyRate'] = 'The allowance cannot be below ₱' . MIN_HOURLY_RATE . ' an hour.';
    } elseif ((int) $c['hourly_rate'] > MAX_HOURLY_RATE) {
        $e['hourlyRate'] = 'Enter ₱' . MAX_HOURLY_RATE . ' an hour or less.';
    } else {
        $c['hourly_rate'] = (int) $c['hourly_rate'];
    }

    // 4. Supervisor: must match the S.A.'s department/office (including multi-office mappings in supervisor_offices)
    if ($c['supervisor_id'] && !isset($e['departmentType'])) {
        $q = $pdo->prepare('SELECT id, supervisor_category, office_id FROM users WHERE id = ? AND role = "SUPERVISOR"');
        $q->execute([$c['supervisor_id']]);
        $sup = $q->fetch();
        $fits = false;
        if ($sup) {
            if ($c['department_type'] === 'OFFICE') {
                if ((int) $sup['office_id'] === (int) $c['office_id']) {
                    $fits = true;
                } else {
                    $soChk = $pdo->prepare('SELECT COUNT(*) FROM supervisor_offices WHERE supervisor_id = ? AND office_id = ?');
                    $soChk->execute([(int) $sup['id'], (int) $c['office_id']]);
                    $fits = ((int) $soChk->fetchColumn()) > 0;
                }
            } else {
                $fits = strtoupper((string) $sup['supervisor_category']) === $c['department_type'];
            }
        }
        if (!$fits) $e['supervisorId'] = 'Choose a supervisor from the same department or office.';
    }

    // 5. Benefits (optional source amounts)
    foreach (['tuition_fee' => 'tuitionFee', 'misc_fee' => 'miscFee'] as $col => $field) {
        if ($c[$col] === '' || $c[$col] === null) { $c[$col] = null; continue; }
        if (!is_numeric($c[$col]) || $c[$col] < 0 || $c[$col] > 1000000) $e[$field] = 'Enter an amount from 0 to 1,000,000.';
        else $c[$col] = round((float) $c[$col], 2);
    }

    // 7. Emergency contact (Required)
    if (empty($c['emergency_name'])) {
        $e['emergencyName'] = 'Emergency contact name is required.';
    } elseif (mb_strlen($c['emergency_name']) > 120) {
        $e['emergencyName'] = 'Use 120 characters or fewer.';
    } elseif (!preg_match(EMERGENCY_TEXT_PATTERN, $c['emergency_name'])) {
        $e['emergencyName'] = EMERGENCY_TEXT_MESSAGE;
    }

    if (empty($c['emergency_number'])) {
        $e['emergencyNumber'] = 'Emergency contact number is required.';
    } elseif (!preg_match(PH_MOBILE_PATTERN, $c['emergency_number'])) {
        $e['emergencyNumber'] = 'Use a mobile number like 09171234567.';
    }

    if (empty($c['emergency_relationship'])) {
        $e['emergencyRelationship'] = 'Emergency relationship is required.';
    } elseif (mb_strlen($c['emergency_relationship']) > 40) {
        $e['emergencyRelationship'] = 'Use 40 characters or fewer.';
    } elseif (!preg_match(EMERGENCY_TEXT_PATTERN, $c['emergency_relationship'])) {
        $e['emergencyRelationship'] = EMERGENCY_TEXT_MESSAGE;
    }

    return [$c, $e];
}

function valid_date(?string $d): bool
{
    if (!$d || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) return false;
    [$y, $m, $day] = array_map('intval', explode('-', $d));
    return checkdate($m, $day, $y);
}

function sa_full_name(array $c): string
{
    return trim($c['first_name'] . ' ' . $c['last_name'] . ($c['suffix'] ? ' ' . $c['suffix'] : ''));
}

/** Base query joining everything a profile screen shows. */
const SA_SELECT = '
    SELECT p.*, p.hourly_rate AS sa_hourly_rate,
           u.username, u.email AS school_email, u.status AS account_status, u.must_change_password,
           u.last_login_at, u.created_at AS account_created_at,
           o.code AS office_code, o.name AS office_name,
           COALESCE(NULLIF(TRIM(sup.full_name), ""), TRIM(CONCAT_WS(" ", sup.first_name, NULLIF(sup.middle_name, ""), sup.last_name, NULLIF(sup.suffix, "")))) AS supervisor_name,
           sem.academic_year, sem.term, sem.start_date AS sem_start, sem.end_date AS sem_end, sem.status AS sem_status,
           r.hourly_rate,
           b.tuition_fee, b.misc_fee, b.tuition_coverage_pct, b.misc_coverage_pct
      FROM sa_profiles p
      JOIN users u ON u.id = p.user_id
      JOIN semesters sem ON sem.id = p.semester_id
      LEFT JOIN offices o ON o.id = p.office_id
      LEFT JOIN users sup ON sup.id = p.supervisor_id
      LEFT JOIN allowance_rates r ON r.semester_id = p.semester_id
      LEFT JOIN sa_benefits b ON b.sa_profile_id = p.id AND b.semester_id = p.semester_id';

/** Shape of one S.A. for the frontend. $full = include personal/financial details. */
/**
 * The two things the roster screen shows beside a name that do not live on the
 * profile: whether a class schedule is on record for the running semester, and
 * where the S.A. is deployed once duty has been finalized.
 *
 * Done for the whole list in two queries rather than one per row.
 */
function roster_extras(array $items): array
{
    global $pdo;
    if (!$items) return $items;

    $semesterId = (int) ($pdo->query('SELECT id FROM semesters WHERE status = "ACTIVE" ORDER BY id DESC LIMIT 1')->fetchColumn() ?: 0);
    $classes = [];
    $duty = [];

    if ($semesterId) {
        $stmt = $pdo->prepare('SELECT sa_profile_id, COUNT(*) AS periods FROM class_schedules
                                WHERE semester_id = ? AND archived_at IS NULL GROUP BY sa_profile_id');
        $stmt->execute([$semesterId]);
        foreach ($stmt as $row) $classes[(int) $row['sa_profile_id']] = (int) $row['periods'];

        $stmt = $pdo->prepare(
            'SELECT sa_profile_id, COUNT(*) AS blocks,
                    ROUND(SUM(TIMESTAMPDIFF(MINUTE, start_time, end_time)) / 60, 1) AS hours,
                    GROUP_CONCAT(DISTINCT location ORDER BY location SEPARATOR ", ") AS places
               FROM schedule_assignments WHERE semester_id = ? GROUP BY sa_profile_id'
        );
        $stmt->execute([$semesterId]);
        foreach ($stmt as $row) {
            $duty[(int) $row['sa_profile_id']] = [
                'blocks' => (int) $row['blocks'],
                'hours' => (float) $row['hours'],
                'places' => $row['places'],
            ];
        }
    }

    return array_map(function ($sa) use ($classes, $duty) {
        $d = $duty[$sa['id']] ?? null;
        return $sa + [
            'classPeriods' => $classes[$sa['id']] ?? 0,
            'hasClassSchedule' => isset($classes[$sa['id']]),
            'dutyHours' => $d ? $d['hours'] : 0.0,
            'dutyBlocks' => $d ? $d['blocks'] : 0,
            'deployment' => $d ? $d['places'] : ($sa['office']['name'] ?? null),
            'deployed' => (bool) $d,
        ];
    }, $items);
}

function format_sa(array $r, bool $full = true): array
{
    $sa = [
        'id' => (int) $r['id'],
        'studentId' => $r['student_id'],
        'saNumber' => $r['sa_number'] ?? null,
        'name' => sa_full_name($r),
        'firstName' => $r['first_name'],
        'lastName' => $r['last_name'],
        'course' => $r['course'],
        'yearLevel' => (int) $r['year_level'],
        'saCategory' => $r['sa_category'],
        'departmentType' => $r['department_type'],
        'office' => ($r['office_id'] && ($r['assignment_status'] ?? '') === 'ASSIGNED') ? ['id' => (int) $r['office_id'], 'code' => $r['office_code'], 'name' => $r['office_name']] : null,
        'supervisor' => ($r['supervisor_id'] && ($r['assignment_status'] ?? '') === 'ASSIGNED') ? ['id' => (int) $r['supervisor_id'], 'name' => $r['supervisor_name']] : null,
        'saStatus' => $r['sa_status'],
        'assignmentStatus' => $r['assignment_status'],
        'disciplinaryStatus' => $r['disciplinary_status'] ?? 'GOOD_STANDING',
        'underAgreementAt' => $r['under_agreement_at'] ?? null,
        'accountStatus' => $r['account_status'],
        'archivedAt' => $r['archived_at'] ?? null,
        'archiveReason' => $r['archive_reason'] ?? null,
    ];
    if (!$full) return $sa;

    $tuition = $r['tuition_fee'] !== null ? (float) $r['tuition_fee'] : null;
    $misc = $r['misc_fee'] !== null ? (float) $r['misc_fee'] : null;
    $tPct = $r['tuition_coverage_pct'] !== null ? (float) $r['tuition_coverage_pct'] : TUITION_COVERAGE_PCT;
    $mPct = $r['misc_coverage_pct'] !== null ? (float) $r['misc_coverage_pct'] : MISC_COVERAGE_PCT;

    // Retrieve official Fee Assessment from Registrar (batch-loaded once per request to avoid N+1 queries)
    global $pdo;
    static $feeMapByStudent = null;
    if ($feeMapByStudent === null) {
        $feeMapByStudent = [];
        try {
            $faAll = $pdo->query('
                SELECT s.student_number, fa.*, e.enrollment_id AS enr_id
                  FROM fee_assessments fa
                  JOIN enrollments e ON e.enrollment_id = fa.enrollment_id
                  JOIN students s ON s.student_id = e.student_id
                 ORDER BY e.enrollment_id ASC
            ');
            foreach ($faAll as $faRow) {
                $feeMapByStudent[$faRow['student_number']] = $faRow;
            }
        } catch (Throwable $e) {}
    }
    $fa = $feeMapByStudent[$r['student_id']] ?? null;

    if ($fa) {
        if ($tuition === null) $tuition = (float) $fa['tuition_fee'];
        if ($misc === null) $misc = (float) $fa['misc_fee'];
    }

    $tuitionCovered = $tuition !== null ? round($tuition * $tPct / 100, 2) : 0.0;
    $miscCovered = $misc !== null ? round($misc * $mPct / 100, 2) : 0.0;
    $totalCovered = round($tuitionCovered + $miscCovered, 2);

    $cashTotal = $fa ? (float) $fa['cash_total'] : ($tuition !== null || $misc !== null ? (float)(($tuition ?? 0) + ($misc ?? 0)) : null);
    $balance = null;
    if ($cashTotal !== null) {
        $balance = round(max(0, $cashTotal - $totalCovered), 2);
    } elseif ($tuition !== null || $misc !== null) {
        $balance = round(($tuition ?? 0) * (100 - $tPct) / 100 + ($misc ?? 0) * (100 - $mPct) / 100, 2);
    }

    return $sa + [
        'middleName' => $r['middle_name'],
        'suffix' => $r['suffix'],
        'birthDate' => $r['birth_date'],
        'sex' => $r['sex'],
        'contactNumber' => $r['contact_number'],
        'schoolEmail' => $r['school_email'],
        'personalEmail' => $r['personal_email'],
        'semester' => [
            'id' => (int) $r['semester_id'],
            'label' => semester_label(['term' => $r['term'], 'academic_year' => $r['academic_year']]),
            'hourlyRate' => $r['hourly_rate'] !== null ? (float) $r['hourly_rate'] : null,
        ],
        'academicStatus' => $r['academic_status'],
        'enrollmentStatus' => $r['enrollment_status'],
        'expectedGraduation' => $r['expected_graduation'] ? substr($r['expected_graduation'], 0, 4) : null,
        'appointmentStart' => $r['appointment_start'],
        'appointmentEnd' => $r['appointment_end'],
        'weeklyTargetHours' => (float) $r['weekly_target_hours'],
        'isReliever' => (bool) $r['is_reliever'],
        'emergencyName' => $r['emergency_name'],
        'emergencyNumber' => $r['emergency_number'],
        'emergencyRelationship' => $r['emergency_relationship'],
        'benefits' => [
            // What this S.A. earns per duty hour: their own rate, else the
            // semester's, else the standard one.
            'saHourlyRate' => $r['sa_hourly_rate'] !== null ? (float) $r['sa_hourly_rate'] : null,
            'effectiveHourlyRate' => (float) ($r['sa_hourly_rate'] ?? $r['hourly_rate'] ?? DEFAULT_HOURLY_RATE),
            'tuitionFee' => $tuition,
            'miscFee' => $misc,
            'tuitionCoveragePct' => $tPct,
            'miscCoveragePct' => $mPct,
            'tuitionCovered' => $tuition !== null ? $tuitionCovered : null,
            'miscCovered' => $misc !== null ? $miscCovered : null,
            'totalCovered' => ($tuition !== null || $misc !== null) ? $totalCovered : null,
            'cashTotal' => $cashTotal,
            'balance' => $balance,
            'assessment' => $fa ? [
                'tuitionFee' => (float) $fa['tuition_fee'],
                'labFee' => (float) $fa['lab_fee'],
                'miscFee' => (float) $fa['misc_fee'],
                'lmsFee' => (float) $fa['lms_fee'],
                'nstpFee' => (float) $fa['nstp_fee'],
                'omrFee' => (float) $fa['omr_fee'],
                'cashTotal' => (float) $fa['cash_total'],
                'installmentCharge' => (float) $fa['installment_charge'],
                'installmentTotal' => (float) $fa['installment_total'],
            ] : null,
        ],
        'account' => [
            'username' => $r['username'],
            'status' => $r['account_status'],
            'mustChangePassword' => (bool) $r['must_change_password'],
            'lastLoginAt' => $r['last_login_at'],
            'createdAt' => $r['account_created_at'],
        ],
        'biometrics' => get_sa_biometrics((int) $r['id']),
        'classes' => sa_classes((int) $r['id'], (int) $r['semester_id']),
        'createdAt' => $r['created_at'],
        'updatedAt' => $r['updated_at'],
    ];
}

/** The S.A.'s imported class schedule for a semester (Scheduling > Class Schedules). */
function sa_classes(int $profileId, int $semesterId): array
{
    global $pdo;
    static $bySemester = [];
    if (!isset($bySemester[$semesterId])) {
        $bySemester[$semesterId] = [];
        $stmt = $pdo->prepare(
            'SELECT sa_profile_id, day_of_week, start_time, end_time, subject, section FROM class_schedules
              WHERE semester_id = ? AND archived_at IS NULL
              ORDER BY FIELD(day_of_week, "MON","TUE","WED","THU","FRI","SAT","SUN"), start_time'
        );
        $stmt->execute([$semesterId]);
        foreach ($stmt as $c) {
            $pid = (int) $c['sa_profile_id'];
            $bySemester[$semesterId][$pid][] = [
                'day' => $c['day_of_week'],
                'startTime' => date('g:i A', strtotime($c['start_time'])),
                'endTime' => date('g:i A', strtotime($c['end_time'])),
                'subject' => $c['subject'],
                'section' => $c['section'],
            ];
        }
    }
    return $bySemester[$semesterId][$profileId] ?? [];
}

/** Saves the source fee amounts for the S.A.'s semester of record. */
function save_benefits(int $profileId, array $c): void
{
    global $pdo;
    if ($c['tuition_fee'] === null && $c['misc_fee'] === null) {
        $pdo->prepare('DELETE FROM sa_benefits WHERE sa_profile_id = ? AND semester_id = ?')->execute([$profileId, $c['semester_id']]);
        return;
    }
    $pdo->prepare(
        'INSERT INTO sa_benefits (sa_profile_id, semester_id, tuition_fee, misc_fee, tuition_coverage_pct, misc_coverage_pct)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE tuition_fee = VALUES(tuition_fee), misc_fee = VALUES(misc_fee)'
    )->execute([$profileId, $c['semester_id'], $c['tuition_fee'] ?? 0, $c['misc_fee'] ?? 0, TUITION_COVERAGE_PCT, MISC_COVERAGE_PCT]);
}

/**
 * Parses day abbreviations (e.g. "TTh", "MWF", "Th", "W", "F", "S") into individual day codes.
 */
function parse_schedule_days(string $dayStr): array
{
    $dayStr = trim($dayStr);
    if ($dayStr === '') return [];

    $compoundMap = [
        'MWF'   => ['MON', 'WED', 'FRI'],
        'TTH'   => ['TUE', 'THU'],
        'T-TH'  => ['TUE', 'THU'],
        'MW'    => ['MON', 'WED'],
        'FS'    => ['FRI', 'SAT'],
        'TH'    => ['THU'],
        'MON'   => ['MON'],
        'TUE'   => ['TUE'],
        'WED'   => ['WED'],
        'THU'   => ['THU'],
        'FRI'   => ['FRI'],
        'SAT'   => ['SAT'],
        'SUN'   => ['SUN'],
        'M'     => ['MON'],
        'T'     => ['TUE'],
        'W'     => ['WED'],
        'F'     => ['FRI'],
        'S'     => ['SAT'],
    ];

    $clean = strtoupper(str_replace([' ', '/'], '', $dayStr));
    if (isset($compoundMap[$clean])) {
        return $compoundMap[$clean];
    }

    $tokens = [];
    if (preg_match_all('/(THU|TH|TUE|WED|FRI|SAT|SUN|MON|M|T|W|F|S)/i', $clean, $matches)) {
        foreach ($matches[0] as $m) {
            $u = strtoupper($m);
            if (isset($compoundMap[$u])) {
                foreach ($compoundMap[$u] as $d) {
                    $tokens[] = $d;
                }
            }
        }
    }

    return array_values(array_unique($tokens));
}

/**
 * Synchronizes an S.A.'s enrolled subjects (Registrar COR) to class_schedules
 * and official fee assessment to sa_benefits.
 * Only performs database writes when the Registrar records actually differ from stored records.
 */
function sync_sa_from_registrar(int $saProfileId, bool $forceFromEnrollment = false): array
{
    global $pdo;
    static $syncedInRequest = [];
    if (!$forceFromEnrollment && isset($syncedInRequest[$saProfileId])) {
        return $syncedInRequest[$saProfileId];
    }

    $stmt = $pdo->prepare('SELECT id, student_id, semester_id FROM sa_profiles WHERE id = ?');
    $stmt->execute([$saProfileId]);
    $sa = $stmt->fetch();
    if (!$sa) return ['synced' => false, 'error' => 'S.A. profile not found'];

    $studentNumber = $sa['student_id'];
    $semesterId = (int) $sa['semester_id'];

    // 1. Locate student & active enrollment in Registrar
    $studStmt = $pdo->prepare('SELECT student_id FROM students WHERE student_number = ? LIMIT 1');
    $studStmt->execute([$studentNumber]);
    $studentDbId = $studStmt->fetchColumn();
    if (!$studentDbId) return ['synced' => false, 'error' => 'Student not found in registrar'];

    $enrollStmt = $pdo->prepare('
        SELECT enrollment_id, term_id, status 
        FROM enrollments 
        WHERE student_id = ? 
        ORDER BY enrollment_id DESC 
        LIMIT 1
    ');
    $enrollStmt->execute([$studentDbId]);
    $enrollment = $enrollStmt->fetch();
    if (!$enrollment) return ['synced' => false, 'error' => 'No enrollment record found'];

    $enrollmentId = (int) $enrollment['enrollment_id'];

    // 2. Sync Tuition & Fee Assessment from fee_assessments (only write if missing or changed)
    $feeStmt = $pdo->prepare('SELECT * FROM fee_assessments WHERE enrollment_id = ? LIMIT 1');
    $feeStmt->execute([$enrollmentId]);
    $fa = $feeStmt->fetch();
    if ($fa) {
        $tuitionFee = round((float) $fa['tuition_fee'], 2);
        $miscFee = round((float) $fa['misc_fee'], 2);

        $curBenStmt = $pdo->prepare('SELECT tuition_fee, misc_fee FROM sa_benefits WHERE sa_profile_id = ? AND semester_id = ? LIMIT 1');
        $curBenStmt->execute([$saProfileId, $semesterId]);
        $curBen = $curBenStmt->fetch();

        $needsBenWrite = !$curBen
            || abs((float) $curBen['tuition_fee'] - $tuitionFee) > 0.009
            || abs((float) $curBen['misc_fee'] - $miscFee) > 0.009;

        if ($needsBenWrite) {
            $pdo->prepare('
                INSERT INTO sa_benefits (sa_profile_id, semester_id, tuition_fee, misc_fee, tuition_coverage_pct, misc_coverage_pct)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    tuition_fee = VALUES(tuition_fee),
                    misc_fee = VALUES(misc_fee)
            ')->execute([
                $saProfileId, $semesterId, $tuitionFee, $miscFee,
                TUITION_COVERAGE_PCT, MISC_COVERAGE_PCT
            ]);
        }
    }

    // Check existing class_schedules rows for this S.A.
    $existingStmt = $pdo->prepare('
        SELECT day_of_week, start_time, end_time, subject, section, imported_by, archived_at
          FROM class_schedules
         WHERE semester_id = ? AND sa_profile_id = ?
    ');
    $existingStmt->execute([$semesterId, $saProfileId]);
    $existingRows = $existingStmt->fetchAll();

    // If not forced from Registrar enrollment edit, check if this S.A. has explicit class_schedules
    // edits/imports/archives (imported_by IS NOT NULL or archived_at IS NOT NULL)
    if (!$forceFromEnrollment && !empty($existingRows)) {
        foreach ($existingRows as $er) {
            if ($er['imported_by'] !== null || $er['archived_at'] !== null) {
                return $syncedInRequest[$saProfileId] = [
                    'synced' => true,
                    'periods' => count($existingRows),
                    'hasFee' => !empty($fa),
                    'preservedCustom' => true,
                ];
            }
        }
    }

    // 3. Build expected Enrolled Subjects from Registrar
    $schedStmt = $pdo->prepare('
        SELECT ed.detail_id, ss.schedule_id, ss.section_code, ss.type, ss.units,
               ss.days, ss.start_time, ss.end_time, ss.room,
               sub.subject_code, sub.description
        FROM enrollment_details ed
        JOIN subject_schedules ss ON ss.schedule_id = ed.schedule_id
        JOIN subjects sub ON sub.subject_id = ss.subject_id
        WHERE ed.enrollment_id = ?
    ');
    $schedStmt->execute([$enrollmentId]);
    $enrolledSchedules = $schedStmt->fetchAll();

    $desiredMap = [];
    foreach ($enrolledSchedules as $sched) {
        $days = parse_schedule_days((string) $sched['days']);
        $subjectTitle = trim($sched['subject_code'] . ($sched['description'] ? ' - ' . $sched['description'] : ''));
        if (mb_strlen($subjectTitle) > 60) {
            $subjectTitle = mb_substr($subjectTitle, 0, 57) . '...';
        }
        $section = $sched['section_code'] ?: null;
        $startTime = $sched['start_time'];
        $endTime = $sched['end_time'];

        foreach ($days as $day) {
            $sig = "{$day}|{$startTime}|{$subjectTitle}";
            $desiredMap[$sig] = [
                'day' => $day,
                'start_time' => $startTime,
                'end_time' => $endTime,
                'subject' => $subjectTitle,
                'section' => $section,
            ];
        }
    }

    // Compare desired schedule rows against existing rows to avoid unnecessary DELETE + INSERT
    $currentMap = [];
    foreach ($existingRows as $er) {
        if ($er['archived_at'] !== null) {
            $currentMap['__ARCHIVED__'] = true;
            break;
        }
        $sig = "{$er['day_of_week']}|{$er['start_time']}|{$er['subject']}";
        $currentMap[$sig] = [
            'day' => $er['day_of_week'],
            'start_time' => $er['start_time'],
            'end_time' => $er['end_time'],
            'subject' => $er['subject'],
            'section' => $er['section'] ?: null,
        ];
    }

    if ($currentMap == $desiredMap) {
        return $syncedInRequest[$saProfileId] = [
            'synced' => true,
            'periods' => count($desiredMap),
            'hasFee' => !empty($fa),
        ];
    }

    $pdo->prepare('DELETE FROM class_schedules WHERE semester_id = ? AND sa_profile_id = ?')->execute([$semesterId, $saProfileId]);

    $ins = $pdo->prepare('
        INSERT INTO class_schedules (semester_id, sa_profile_id, student_id, day_of_week, start_time, end_time, subject, section)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            end_time = VALUES(end_time),
            section = VALUES(section),
            archived_at = NULL
    ');
    $syncedPeriods = 0;
    foreach ($desiredMap as $d) {
        $ins->execute([
            $semesterId, $saProfileId, $studentNumber, $d['day'], $d['start_time'], $d['end_time'], $d['subject'], $d['section']
        ]);
        $syncedPeriods++;
    }

    return $syncedInRequest[$saProfileId] = [
        'synced' => true,
        'periods' => $syncedPeriods,
        'hasFee' => !empty($fa)
    ];
}

/**
 * Synchronizes all active S.A.s from Registrar.
 * Uses a fast pre-check so read requests skip per-S.A. Registrar queries when all active S.A.s
 * already have their benefits and class schedules synced.
 */
function sync_all_active_sas_from_registrar(?int $semesterId = null, bool $force = false): void
{
    global $pdo;
    static $syncedKeys = [];
    $key = (string) ($semesterId ?? 'ALL');
    if (!$force && (isset($syncedKeys[$key]) || isset($syncedKeys['ALL']))) {
        return;
    }
    $syncedKeys[$key] = true;

    try {
        $guardKey = 'registrar_sync_v2_' . $key;
        if (!$force && function_exists('schema_guard_ready') && (schema_guard_ready($guardKey, 300) || schema_guard_ready('registrar_sync_v2_ALL', 300))) {
            // Fast 1-query check: only sync active S.A.s that have zero class_schedules on file
            $sql = '
                SELECT p.id
                  FROM sa_profiles p
                 WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL
                   AND NOT EXISTS (
                       SELECT 1 FROM class_schedules cs
                        WHERE cs.sa_profile_id = p.id AND cs.semester_id = p.semester_id
                   )
            ';
            $params = [];
            if ($semesterId) {
                $sql .= ' AND p.semester_id = ?';
                $params[] = $semesterId;
            }
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $missingIds = $stmt->fetchAll(PDO::FETCH_COLUMN);
            foreach ($missingIds as $id) {
                sync_sa_from_registrar((int) $id);
            }
            return;
        }

        $sql = 'SELECT id FROM sa_profiles WHERE sa_status = "ACTIVE" AND archived_at IS NULL';
        $params = [];
        if ($semesterId) {
            $sql .= ' AND semester_id = ?';
            $params[] = $semesterId;
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
        foreach ($ids as $id) {
            sync_sa_from_registrar((int) $id);
        }
        if (function_exists('schema_guard_mark_ready')) {
            schema_guard_mark_ready($guardKey);
            schema_guard_mark_ready('registrar_sync_v2_ALL');
            schema_guard_mark_ready('registrar_sync_v2_1');
        }
    } catch (Throwable $e) {
        error_log("sync_all_active_sas_from_registrar error: " . $e->getMessage());
    }
}

/**
 * Auto-creates the sa_biometrics table if it does not exist yet.
 */
function ensure_biometrics_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) return;
    $done = true;

    // Never execute DDL if inside an active transaction in MySQL
    if ($pdo->inTransaction()) {
        return;
    }

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `sa_biometrics` (
            `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            `sa_profile_id` INT UNSIGNED NOT NULL,
            `user_id` INT UNSIGNED DEFAULT NULL,
            `biometric_type` VARCHAR(20) DEFAULT 'FACE',
            `face_descriptor` MEDIUMTEXT NOT NULL,
            `photo_path` VARCHAR(255) DEFAULT NULL,
            `status` ENUM('CAPTURED','PENDING') DEFAULT 'CAPTURED',
            `captured_by` INT UNSIGNED DEFAULT NULL,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY `uk_sa_profile` (`sa_profile_id`),
            KEY `k_user_id` (`user_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    $dir = __DIR__ . '/../uploads/faces';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
}

/**
 * Retrieves biometric record for an S.A.
 */
function get_sa_biometrics(int $saProfileId): ?array
{
    global $pdo;
    if ($saProfileId <= 0) return null;
    ensure_biometrics_schema($pdo);

    $stmt = $pdo->prepare('SELECT id, biometric_type, photo_path, status, created_at, updated_at
                             FROM sa_biometrics
                            WHERE sa_profile_id = ? LIMIT 1');
    $stmt->execute([$saProfileId]);
    $row = $stmt->fetch();
    if (!$row) return null;

    return [
        'id' => (int) $row['id'],
        'hasFace' => true,
        'biometricType' => $row['biometric_type'],
        'photoPath' => $row['photo_path'],
        'photoUrl' => $row['photo_path'] ? (str_starts_with($row['photo_path'], 'http') ? $row['photo_path'] : $row['photo_path']) : null,
        'status' => $row['status'],
        'capturedAt' => $row['updated_at'] ?: $row['created_at'],
    ];
}

/**
 * Saves or updates face descriptor & photo for an S.A.
 */
function save_sa_biometrics(int $saProfileId, ?int $userId, $descriptor, ?string $photoBase64 = null, ?int $capturedBy = null): bool
{
    global $pdo;
    if ($saProfileId <= 0) return false;
    ensure_biometrics_schema($pdo);

    if (is_string($descriptor)) {
        $descArr = json_decode($descriptor, true);
    } elseif (is_array($descriptor)) {
        $descArr = $descriptor;
    } else {
        return false;
    }

    if (!is_array($descArr) || count($descArr) !== 128) {
        throw new InvalidArgumentException('Face capture did not produce a valid 128-point descriptor. Please re-align face and capture again.');
    }

    foreach ($descArr as $num) {
        if (!is_numeric($num)) {
            throw new InvalidArgumentException('Invalid numeric values in face descriptor.');
        }
    }

    $jsonDescriptor = json_encode(array_map('floatval', $descArr));

    $photoPath = null;
    if (!empty($photoBase64) && str_starts_with($photoBase64, 'data:image/')) {
        $uploadDir = __DIR__ . '/../uploads/faces';
        if (!is_dir($uploadDir)) @mkdir($uploadDir, 0777, true);

        // Strip data:image/...;base64,
        if (preg_match('/^data:image\/(\w+);base64,/', $photoBase64, $m)) {
            $ext = strtolower($m[1]) === 'png' ? 'png' : 'jpg';
            $data = substr($photoBase64, strpos($photoBase64, ',') + 1);
            $decoded = base64_decode($data);
            if ($decoded !== false) {
                $filename = 'face_' . $saProfileId . '_' . time() . '.' . $ext;
                $targetFile = $uploadDir . '/' . $filename;
                if (file_put_contents($targetFile, $decoded)) {
                    $photoPath = 'uploads/faces/' . $filename;
                }
            }
        }
    }

    $stmt = $pdo->prepare('
        INSERT INTO sa_biometrics (sa_profile_id, user_id, biometric_type, face_descriptor, photo_path, status, captured_by, created_at)
        VALUES (?, ?, "FACE", ?, ?, "CAPTURED", ?, NOW())
        ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            face_descriptor = VALUES(face_descriptor),
            photo_path = COALESCE(VALUES(photo_path), photo_path),
            status = "CAPTURED",
            captured_by = VALUES(captured_by),
            updated_at = NOW()
    ');

    return $stmt->execute([
        $saProfileId,
        $userId,
        $jsonDescriptor,
        $photoPath,
        $capturedBy
    ]);
}

