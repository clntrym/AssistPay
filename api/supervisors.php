<?php
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_sa.php';
require_once __DIR__ . '/_scheduling.php';
require_once __DIR__ . '/_matching.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
$action = input()['action'] ?? '';

if ($action === 'my_team_schedules') {
    require_role($user, 'SUPERVISOR', 'ADMIN');
} else {
    require_role($user, 'ADMIN');
}

const DEFAULT_OFFICE_DEPTS = [
    "SHS-TVL", "TOOLS ROOM", "HRM BAR", "HR", "PSMO", "FMO", "PURCHASING",
    "OCM", "PRD", "REGISTRAR", "ACAD OFFICE", "OSA",
    "HSO", "LIBRARY", "NSTP", "SIR ALEX", "SHS OFFICE",
    "ITO OFFICE", "RECORDS", "ITJPO"
];

function format_supervisor_name($fn, $mn, $ln, $suf) {
    $parts = array_filter([$fn, $mn, $ln, $suf]);
    return implode(' ', $parts);
}

function resolve_office_id(?string $deptName, ?int $existingOfficeId = null) {
    global $pdo;
    if ($deptName) {
        $upper = strtoupper(trim($deptName));
        if (in_array($upper, ['ITO', 'ACADS'], true)) {
            return null; // Category-level scope, not an office row
        }
        if ($upper === 'PRD' || $upper === 'PRMD') {
            $stmt = $pdo->query("SELECT id FROM offices WHERE name IN ('PRD', 'PRMD') OR code IN ('PRD', 'PRMD') LIMIT 1");
            $found = $stmt->fetchColumn();
            if ($found) return (int) $found;
        }
        $stmt = $pdo->prepare('SELECT id FROM offices WHERE name = ? OR code = ? LIMIT 1');
        $stmt->execute([$deptName, $deptName]);
        $found = $stmt->fetchColumn();
        if ($found) return (int) $found;
    }
    if ($existingOfficeId) {
        $chk = $pdo->prepare('SELECT id FROM offices WHERE id = ? LIMIT 1');
        $chk->execute([$existingOfficeId]);
        if ($chk->fetchColumn()) return $existingOfficeId;
    }
    if (!$deptName) return null;

    // Create office if not exists
    $code = strtoupper(preg_replace('/[^A-Z0-9]/i', '', substr($deptName, 0, 10))) ?: 'DEPT';
    $codeStmt = $pdo->prepare('SELECT id FROM offices WHERE code = ?');
    $codeStmt->execute([$code]);
    if ($codeStmt->fetchColumn()) {
        $code .= rand(10, 99);
    }

    $ins = $pdo->prepare('INSERT INTO offices (code, name, is_active) VALUES (?, ?, 1)');
    $ins->execute([$code, $deptName]);
    return (int) $pdo->lastInsertId();
}

if ($action === 'list') {
    $stmt = $pdo->query("
        SELECT u.id, u.username, u.full_name, u.first_name, u.middle_name, u.last_name, u.suffix,
               u.email, u.phone, u.supervisor_category, u.office_id, u.status,
               o.name AS office_name, o.code AS office_code,
               (SELECT COUNT(*) FROM sa_profiles sa 
                WHERE sa.sa_status = 'ACTIVE' AND sa.archived_at IS NULL AND (
                    sa.supervisor_id = u.id 
                    OR (u.supervisor_category = 'ITO' AND sa.sa_category = 'ITO')
                    OR (u.supervisor_category = 'ACADS' AND sa.sa_category = 'ACADS')
                    OR (u.office_id IS NOT NULL AND sa.office_id = u.office_id)
                    OR (sa.office_id IN (SELECT office_id FROM supervisor_offices WHERE supervisor_id = u.id))
                )
               ) AS current_sa
        FROM users u
        LEFT JOIN offices o ON o.id = u.office_id
        WHERE u.role = 'SUPERVISOR'
        ORDER BY u.id ASC
    ");
    $rawSupervisors = $stmt->fetchAll();

    // Pre-fetch multi-office assignments for all supervisors
    $officesMap = [];
    $soStmt = $pdo->query("
        SELECT so.supervisor_id, o.name AS office_name, o.id AS office_id
        FROM supervisor_offices so
        JOIN offices o ON o.id = so.office_id
        ORDER BY so.id ASC
    ");
    while ($row = $soStmt->fetch()) {
        $supId = (int) $row['supervisor_id'];
        if (!isset($officesMap[$supId])) $officesMap[$supId] = [];
        $oName = $row['office_name'] === 'PRMD' ? 'PRD' : $row['office_name'];
        $officesMap[$supId][] = $oName;
    }

    $supervisors = array_map(function($s) use ($officesMap) {
        $supId = (int) $s['id'];
        $category = $s['supervisor_category'] ?? 'OFFICE';
        if ($category === 'OFFICE') $category = 'OFFICES'; // UI naming convention

        $assignedDepts = $officesMap[$supId] ?? [];
        $primaryName = $s['office_name'] === 'PRMD' ? 'PRD' : $s['office_name'];
        if ($primaryName && !in_array($primaryName, $assignedDepts, true)) {
            array_unshift($assignedDepts, $primaryName);
        }
        $assignedDepts = array_values(array_unique(array_filter($assignedDepts)));
        $hasOfficeUnits = !empty($assignedDepts);

        if ($category === 'ITO') {
            if (!in_array('ITO', $assignedDepts, true)) {
                $assignedDepts[] = 'ITO';
            }
        } elseif ($category === 'ACADS') {
            if (!in_array('ACADS', $assignedDepts, true)) {
                $assignedDepts[] = 'ACADS';
            }
        } elseif (empty($assignedDepts)) {
            $assignedDepts = [$primaryName ?: 'SHS-TVL'];
        }

        $deptDisplay = implode(', ', $assignedDepts);

        // Extract first, middle, last name if empty
        $fn = $s['first_name'];
        $ln = $s['last_name'];
        if (!$fn || !$ln) {
            $nameParts = explode(' ', $s['full_name']);
            $fn = $nameParts[0] ?? '';
            $ln = count($nameParts) > 1 ? end($nameParts) : '';
            $mn = count($nameParts) > 2 ? $nameParts[1] : '';
        } else {
            $mn = $s['middle_name'] ?? '';
        }

        return [
            'id' => $supId,
            'firstName' => $fn,
            'middleName' => $mn,
            'lastName' => $ln,
            'suffix' => $s['suffix'] ?? '',
            'empId' => $s['username'],
            'category' => $category,
            'hasOfficeUnits' => $hasOfficeUnits,
            'dept' => $deptDisplay,
            'depts' => $assignedDepts,
            'officeId' => $s['office_id'] ? (int) $s['office_id'] : null,
            'email' => $s['email'] ?? '',
            'phone' => $s['phone'] ?? '',
            'currentSa' => (int) $s['current_sa'],
            'status' => in_array($s['status'], ['ACTIVE', 'PENDING_ACTIVATION']) ? 'Active' : 'Inactive'
        ];
    }, $rawSupervisors);

    // Get offices list
    $officesStmt = $pdo->query("SELECT CASE WHEN name = 'PRMD' THEN 'PRD' ELSE name END AS name FROM offices WHERE is_active = 1 AND name != 'PSMO/FMO' ORDER BY name");
    $dbOffices = $officesStmt->fetchAll(PDO::FETCH_COLUMN);
    $departments = array_values(array_unique(array_merge(DEFAULT_OFFICE_DEPTS, $dbOffices)));

    $totalUniqueSa = (int)$pdo->query("
        SELECT COUNT(DISTINCT sp.id)
        FROM sa_profiles sp
        JOIN users su ON su.id = sp.user_id
        WHERE su.status = 'ACTIVE'
    ")->fetchColumn();

    respond([
        'success' => true,
        'supervisors' => $supervisors,
        'departments' => $departments,
        'totalUniqueSa' => $totalUniqueSa
    ]);
}

if ($action === 'create') {
    $data = input();
    $firstName  = trim($data['firstName'] ?? '');
    $middleName = trim($data['middleName'] ?? '');
    $lastName   = trim($data['lastName'] ?? '');
    $suffix     = trim($data['suffix'] ?? '');
    $empId      = trim($data['empId'] ?? '');
    $category   = trim($data['category'] ?? 'OFFICES');
    $email      = trim($data['email'] ?? '');
    $phone      = trim($data['phone'] ?? '');

    // Extract depts list
    $inputDepts = $data['depts'] ?? ($data['dept'] ?? []);
    if (!is_array($inputDepts)) {
        $inputDepts = array_filter(array_map('trim', explode(',', (string)$inputDepts)));
    }
    $upperDepts = array_map('strtoupper', $inputDepts);
    if (in_array('ITO', $upperDepts, true)) {
        $category = 'ITO';
    } elseif (in_array('ACADS', $upperDepts, true)) {
        $category = 'ACADS';
    }
    if (empty($inputDepts)) {
        $inputDepts = $category === 'ITO' ? ['ITO OFFICE', 'ITO'] : ($category === 'ACADS' ? ['ACAD OFFICE', 'ACADS'] : ['SHS-TVL']);
    }

    if (!$firstName || !$lastName || !$empId || !$email) {
        fail('First name, last name, employee ID, and email address are required.', 422);
    }

    // Name validation: no special characters
    $namePattern = '/^[a-zA-Z\s\-\.\'\x{00F1}\x{00D1}]+$/u';
    if (!preg_match($namePattern, $firstName)) {
        fail('First Name contains invalid characters. Special characters are not allowed.', 422);
    }
    if ($middleName !== '' && !preg_match($namePattern, $middleName)) {
        fail('Middle Name contains invalid characters. Special characters are not allowed.', 422);
    }
    if (!preg_match($namePattern, $lastName)) {
        fail('Last Name contains invalid characters. Special characters are not allowed.', 422);
    }

    // Phone validation: 11 digits starting with 09
    if ($phone !== '') {
        $cleanPhone = preg_replace('/\D/', '', $phone);
        if (strlen($cleanPhone) !== 11) {
            fail('Contact phone number must be exactly 11 digits (e.g. 09171234567).', 422);
        }
        if (substr($cleanPhone, 0, 2) !== '09') {
            fail('Contact phone number must start with 09 (e.g. 09171234567).', 422);
        }
        $phone = $cleanPhone;
    }

    // Convert category string for DB
    $dbCategory = $category === 'OFFICES' ? 'OFFICE' : $category;
    $fullName = format_supervisor_name($firstName, $middleName, $lastName, $suffix);

    // Check duplicate Employee ID (username)
    $chkEmp = $pdo->prepare("SELECT id FROM users WHERE LOWER(TRIM(username)) = LOWER(?) LIMIT 1");
    $chkEmp->execute([$empId]);
    if ($chkEmp->fetch()) {
        fail("Employee ID '{$empId}' is already registered in the system. Duplicate Supervisor registration is not allowed.", 422);
    }

    // Check duplicate Email
    $chkEmail = $pdo->prepare("SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(?) LIMIT 1");
    $chkEmail->execute([$email]);
    if ($chkEmail->fetch()) {
        fail("Email address '{$email}' is already registered in the system. Duplicate Supervisor registration is not allowed.", 422);
    }

    // Check duplicate Full Name among Supervisors
    $chkName = $pdo->prepare("
        SELECT id FROM users
         WHERE role = 'SUPERVISOR'
           AND (
               LOWER(TRIM(full_name)) = LOWER(?)
               OR (
                   LOWER(TRIM(first_name)) = LOWER(?)
                   AND LOWER(TRIM(last_name)) = LOWER(?)
                   AND COALESCE(LOWER(TRIM(suffix)), '') = LOWER(?)
               )
           )
         LIMIT 1
    ");
    $chkName->execute([$fullName, $firstName, $lastName, $suffix]);
    if ($chkName->fetch()) {
        fail("Supervisor '{$fullName}' is already registered in the system. Duplicate Supervisor registration is not allowed.", 422);
    }

    // Check duplicate Phone Number if provided
    if ($phone !== '') {
        $chkPhone = $pdo->prepare("
            SELECT id FROM users
             WHERE REPLACE(REPLACE(COALESCE(phone, ''), ' ', ''), '-', '') = ?
             LIMIT 1
        ");
        $chkPhone->execute([$phone]);
        if ($chkPhone->fetch()) {
            fail("Contact phone number '{$phone}' is already registered to another user.", 422);
        }
    }

    // Resolve office IDs for all selected office departments
    $officeIds = [];
    foreach ($inputDepts as $dName) {
        $oid = resolve_office_id($dName);
        if ($oid && !in_array($oid, $officeIds, true)) {
            $officeIds[] = $oid;
        }
    }
    $primaryOfficeId = !empty($officeIds) ? $officeIds[0] : null;

    $tempPassword = generate_temp_password();

    $stmt = $pdo->prepare("
        INSERT INTO users (
            username, password_hash, role, full_name, first_name, middle_name, last_name, suffix,
            email, phone, supervisor_category, office_id, status, must_change_password
        ) VALUES (
            ?, ?, 'SUPERVISOR', ?, ?, ?, ?, ?,
            ?, ?, ?, ?, 'ACTIVE', 1
        )
    ");

    $stmt->execute([
        $empId,
        password_hash($tempPassword, PASSWORD_DEFAULT),
        $fullName,
        $firstName,
        $middleName ?: null,
        $lastName,
        $suffix ?: null,
        $email,
        $phone ?: null,
        $dbCategory,
        $primaryOfficeId
    ]);
    $newSupId = (int) $pdo->lastInsertId();

    // Insert all multi-office assignments
    $soIns = $pdo->prepare("INSERT IGNORE INTO supervisor_offices (supervisor_id, office_id) VALUES (?, ?)");
    foreach ($officeIds as $oid) {
        $soIns->execute([$newSupId, $oid]);
    }

    audit('SUPERVISOR_REGISTERED', "Supervisor $fullName ($empId) registered under $category with " . count($officeIds) . " departments", $user['id']);

    respond([
        'success' => true,
        'message' => "Supervisor $fullName registered successfully!",
        'credentials' => [
            'username' => $empId,
            'email' => $email,
            'temporaryPassword' => $tempPassword
        ]
    ]);
}

if ($action === 'update') {
    $data = input();
    $id         = (int) ($data['id'] ?? 0);
    $firstName  = trim($data['firstName'] ?? '');
    $middleName = trim($data['middleName'] ?? '');
    $lastName   = trim($data['lastName'] ?? '');
    $suffix     = trim($data['suffix'] ?? '');
    $empId      = trim($data['empId'] ?? '');
    $category   = trim($data['category'] ?? 'OFFICES');
    $email      = trim($data['email'] ?? '');
    $phone      = trim($data['phone'] ?? '');

    // Extract depts list
    $inputDepts = $data['depts'] ?? ($data['dept'] ?? []);
    if (!is_array($inputDepts)) {
        $inputDepts = array_filter(array_map('trim', explode(',', (string)$inputDepts)));
    }
    $upperDepts = array_map('strtoupper', $inputDepts);
    if (in_array('ITO', $upperDepts, true)) {
        $category = 'ITO';
    } elseif (in_array('ACADS', $upperDepts, true)) {
        $category = 'ACADS';
    }
    if (empty($inputDepts)) {
        $inputDepts = $category === 'ITO' ? ['ITO OFFICE', 'ITO'] : ($category === 'ACADS' ? ['ACAD OFFICE', 'ACADS'] : ['SHS-TVL']);
    }

    if (!$id || !$firstName || !$lastName || !$empId || !$email) {
        fail('First name, last name, employee ID, and email address are required.', 422);
    }

    // Name validation: no special characters
    $namePattern = '/^[a-zA-Z\s\-\.\'\x{00F1}\x{00D1}]+$/u';
    if (!preg_match($namePattern, $firstName)) {
        fail('First Name contains invalid characters. Special characters are not allowed.', 422);
    }
    if ($middleName !== '' && !preg_match($namePattern, $middleName)) {
        fail('Middle Name contains invalid characters. Special characters are not allowed.', 422);
    }
    if (!preg_match($namePattern, $lastName)) {
        fail('Last Name contains invalid characters. Special characters are not allowed.', 422);
    }

    // Phone validation: 11 digits starting with 09
    if ($phone !== '') {
        $cleanPhone = preg_replace('/\D/', '', $phone);
        if (strlen($cleanPhone) !== 11) {
            fail('Contact phone number must be exactly 11 digits (e.g. 09171234567).', 422);
        }
        if (substr($cleanPhone, 0, 2) !== '09') {
            fail('Contact phone number must start with 09 (e.g. 09171234567).', 422);
        }
        $phone = $cleanPhone;
    }

    // Check existing
    $chk = $pdo->prepare("SELECT id FROM users WHERE id = ? AND role = 'SUPERVISOR'");
    $chk->execute([$id]);
    if (!$chk->fetch()) {
        fail('Supervisor record not found.', 444);
    }

    $fullName = format_supervisor_name($firstName, $middleName, $lastName, $suffix);

    // Check unique employee ID, email, full name, and phone
    $dupEmp = $pdo->prepare("SELECT id FROM users WHERE LOWER(TRIM(username)) = LOWER(?) AND id != ? LIMIT 1");
    $dupEmp->execute([$empId, $id]);
    if ($dupEmp->fetch()) {
        fail("Employee ID '{$empId}' already belongs to another user.", 422);
    }

    $dupEmail = $pdo->prepare("SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(?) AND id != ? LIMIT 1");
    $dupEmail->execute([$email, $id]);
    if ($dupEmail->fetch()) {
        fail("Email address '{$email}' already belongs to another user.", 422);
    }

    $dupName = $pdo->prepare("
        SELECT id FROM users
         WHERE role = 'SUPERVISOR'
           AND id != ?
           AND (
               LOWER(TRIM(full_name)) = LOWER(?)
               OR (
                   LOWER(TRIM(first_name)) = LOWER(?)
                   AND LOWER(TRIM(last_name)) = LOWER(?)
                   AND COALESCE(LOWER(TRIM(suffix)), '') = LOWER(?)
               )
           )
         LIMIT 1
    ");
    $dupName->execute([$id, $fullName, $firstName, $lastName, $suffix]);
    if ($dupName->fetch()) {
        fail("Supervisor '{$fullName}' is already registered under another record.", 422);
    }

    if ($phone !== '') {
        $dupPhone = $pdo->prepare("
            SELECT id FROM users
             WHERE REPLACE(REPLACE(COALESCE(phone, ''), ' ', ''), '-', '') = ?
               AND id != ?
             LIMIT 1
        ");
        $dupPhone->execute([$phone, $id]);
        if ($dupPhone->fetch()) {
            fail("Contact phone number '{$phone}' already belongs to another user.", 422);
        }
    }

    $dbCategory = $category === 'OFFICES' ? 'OFFICE' : $category;

    // Resolve office IDs for all selected departments
    $officeIds = [];
    foreach ($inputDepts as $dName) {
        $oid = resolve_office_id($dName);
        if ($oid && !in_array($oid, $officeIds, true)) {
            $officeIds[] = $oid;
        }
    }
    $primaryOfficeId = !empty($officeIds) ? $officeIds[0] : null;

    $fullName = format_supervisor_name($firstName, $middleName, $lastName, $suffix);

    $stmt = $pdo->prepare("
        UPDATE users SET
            username = ?, full_name = ?, first_name = ?, middle_name = ?, last_name = ?, suffix = ?,
            email = ?, phone = ?, supervisor_category = ?, office_id = ?
        WHERE id = ? AND role = 'SUPERVISOR'
    ");

    $stmt->execute([
        $empId,
        $fullName,
        $firstName,
        $middleName ?: null,
        $lastName,
        $suffix ?: null,
        $email,
        $phone ?: null,
        $dbCategory,
        $primaryOfficeId,
        $id
    ]);

    // Sync supervisor_offices
    $pdo->prepare("DELETE FROM supervisor_offices WHERE supervisor_id = ?")->execute([$id]);
    $soIns = $pdo->prepare("INSERT IGNORE INTO supervisor_offices (supervisor_id, office_id) VALUES (?, ?)");
    foreach ($officeIds as $oid) {
        $soIns->execute([$id, $oid]);
    }

    audit('SUPERVISOR_UPDATED', "Supervisor $fullName ($empId) updated with " . count($officeIds) . " departments", $user['id']);

    respond([
        'success' => true,
        'message' => "Supervisor $fullName updated successfully!"
    ]);
}

if ($action === 'toggle_status') {
    $id = (int) (input()['id'] ?? 0);
    $stmt = $pdo->prepare("SELECT id, status, full_name FROM users WHERE id = ? AND role = 'SUPERVISOR'");
    $stmt->execute([$id]);
    $sup = $stmt->fetch();
    if (!$sup) fail('Supervisor not found.', 404);

    $newStatus = in_array($sup['status'], ['ACTIVE', 'PENDING_ACTIVATION']) ? 'INACTIVE' : 'ACTIVE';
    $upd = $pdo->prepare("UPDATE users SET status = ? WHERE id = ?");
    $upd->execute([$newStatus, $id]);

    audit('SUPERVISOR_STATUS_TOGGLED', "Supervisor {$sup['full_name']} status changed to $newStatus", $user['id']);

    respond([
        'success' => true,
        'message' => "Supervisor {$sup['full_name']} is now " . ($newStatus === 'ACTIVE' ? 'Active' : 'Inactive') . "."
    ]);
}

function get_supervisor_scope(int $supId): ?array
{
    global $pdo;
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
    ];
}

if ($action === 'my_team_schedules') {
    $supId = ($user['role'] === 'ADMIN' && !empty(input()['supervisorId']))
        ? (int) input()['supervisorId']
        : (int) $user['id'];
    $scope = get_supervisor_scope($supId);
    if (!$scope) fail('Supervisor profile not found.', 404);

    $sem = target_semester(null);
    ensure_assigned_office_schedules($sem['id']);
    sync_approved_to_assignments($sem['id']);
    $pub = publication($sem['id']);
    $isPublished = (($pub['status'] ?? 'DRAFT') === 'PUBLISHED');

    // Map SA profile IDs -> office_id, supervisor_id, and supporting records
    $warningsBySa = [];
    try {
        $wStmt = $pdo->query("SELECT sa_profile_id, COUNT(*) AS cnt FROM sa_warning_memos GROUP BY sa_profile_id");
        foreach ($wStmt as $wr) {
            $warningsBySa[(int) $wr['sa_profile_id']] = (int) $wr['cnt'];
        }
    } catch (Throwable $e) {}

    $saMetaMap = [];
    $pStmt = $pdo->query("
        SELECT id, office_id, supervisor_id, sa_category,
               academic_status, enrollment_status, disciplinary_status, weekly_target_hours
          FROM sa_profiles
         WHERE sa_status = 'ACTIVE' AND archived_at IS NULL
    ");
    foreach ($pStmt as $pr) {
        $pid = (int) $pr['id'];
        $saMetaMap[$pid] = [
            'officeId' => $pr['office_id'] ? (int) $pr['office_id'] : null,
            'supervisorId' => $pr['supervisor_id'] ? (int) $pr['supervisor_id'] : null,
            'category' => strtoupper((string) $pr['sa_category']),
            'academicStatus' => $pr['academic_status'] ?: 'REGULAR',
            'enrollmentStatus' => $pr['enrollment_status'] ?: 'ENROLLED',
            'disciplinaryStatus' => $pr['disciplinary_status'] ?: 'GOOD_STANDING',
            'weeklyTargetHours' => (float) ($pr['weekly_target_hours'] ?? 35),
            'warningCount' => $warningsBySa[$pid] ?? 0,
        ];
    }

    // Load evaluation action history and notification logs per SA for this semester
    $evalHistoryBySa = [];
    $evalNotifsBySa = [];
    try {
        $evStmt = $pdo->prepare("SELECT id, sa_profile_id FROM sa_evaluations WHERE semester_id = ?");
        $evStmt->execute([(int) $sem['id']]);
        $evalIdToSa = [];
        foreach ($evStmt as $er) {
            $evalIdToSa[(int) $er['id']] = (int) $er['sa_profile_id'];
        }
        if (!empty($evalIdToSa)) {
            $inIds = implode(',', array_keys($evalIdToSa));
            $ahStmt = $pdo->query("SELECT * FROM evaluation_action_history WHERE evaluation_id IN ({$inIds}) ORDER BY id DESC");
            foreach ($ahStmt as $ah) {
                $spId = $evalIdToSa[(int) $ah['evaluation_id']] ?? 0;
                if ($spId) {
                    $evalHistoryBySa[$spId][] = [
                        'id' => (int) $ah['id'],
                        'actionType' => $ah['action_type'],
                        'actorName' => $ah['actor_name'],
                        'actorRole' => $ah['actor_role'],
                        'toStatus' => $ah['to_status'],
                        'remarks' => $ah['remarks'],
                        'createdAt' => $ah['created_at'],
                    ];
                }
            }
            $nlStmt = $pdo->query("SELECT * FROM evaluation_notification_logs WHERE evaluation_id IN ({$inIds}) ORDER BY id DESC");
            foreach ($nlStmt as $nl) {
                $spId = $evalIdToSa[(int) $nl['evaluation_id']] ?? 0;
                if ($spId) {
                    $evalNotifsBySa[$spId][] = [
                        'id' => (int) $nl['id'],
                        'channel' => $nl['channel'],
                        'subject' => $nl['subject'],
                        'recipientName' => $nl['recipient_name'] ?? $nl['recipient'] ?? '',
                        'deliveryStatus' => $nl['delivery_status'],
                        'createdAt' => $nl['created_at'],
                    ];
                }
            }
        }
    } catch (Throwable $e) {}

    $staffOut = [];
    if ($isPublished || $user['role'] === 'ADMIN') {
        $sched = schedule_view($sem['id']);
        foreach ($sched['staff'] ?? [] as $st) {
            $sid = (int) ($st['saId'] ?? 0);
            $meta = $saMetaMap[$sid] ?? [
                'officeId' => null,
                'supervisorId' => null,
                'category' => '',
                'academicStatus' => 'REGULAR',
                'enrollmentStatus' => 'ENROLLED',
                'disciplinaryStatus' => 'GOOD_STANDING',
                'weeklyTargetHours' => 35.0,
                'warningCount' => 0,
            ];
            $dept = strtoupper((string) ($st['department'] ?? ''));

            $inScope = ($meta['supervisorId'] === $scope['id'])
                || ($scope['category'] === 'ITO' && $dept === 'ITO')
                || ($scope['category'] === 'ACADS' && $dept === 'ACADS')
                || ($meta['officeId'] && in_array($meta['officeId'], $scope['officeIds'], true));

            if ($inScope) {
                $st['records'] = [
                    'disciplinaryStatus' => $meta['disciplinaryStatus'],
                    'warningCount' => $meta['warningCount'],
                    'creditedHours' => (float) ($st['creditedHours'] ?? 0),
                    'weeklyTargetHours' => $meta['weeklyTargetHours'],
                    'academicStatus' => $meta['academicStatus'],
                    'enrollmentStatus' => $meta['enrollmentStatus'],
                ];
                $st['actionHistory'] = $evalHistoryBySa[$sid] ?? [];
                $st['notificationLogs'] = $evalNotifsBySa[$sid] ?? [];
                $staffOut[] = $st;
            }
        }
    }

    $totalHours = round(array_sum(array_column($staffOut, 'creditedHours')), 1);
    $totalBlocks = array_sum(array_map(fn($s) => count($s['blocks'] ?? []), $staffOut));

    respond([
        'success' => true,
        'semester' => $sem,
        'publication' => [
            'status' => $pub['status'] ?? 'DRAFT',
            'finalizedAt' => $pub['finalized_at'] ?? null,
            'publishedAt' => $pub['published_at'] ?? null,
            'publishedBy' => $pub['published_by_name'] ?? null,
        ],
        'supervisor' => $scope,
        'staff' => $staffOut,
        'summary' => [
            'sas' => count($staffOut),
            'hours' => $totalHours,
            'blocks' => $totalBlocks,
        ],
    ]);
}

if ($action === 'get_sa_list') {
    $id = (int) (input()['id'] ?? 0);
    $scope = get_supervisor_scope($id);
    if (!$scope) fail('Supervisor not found.', 404);

    $sem = target_semester(null);
    ensure_assigned_office_schedules($sem['id']);
    sync_approved_to_assignments($sem['id']);
    $sched = schedule_view($sem['id']);
    $bySaSched = [];
    foreach ($sched['staff'] ?? [] as $st) {
        $bySaSched[(int) $st['saId']] = $st;
    }

    $saStmt = $pdo->prepare("
        SELECT 
            p.id, p.student_id, p.sa_number,
            CONCAT(p.first_name, ' ', COALESCE(p.middle_name, ''), ' ', p.last_name, ' ', COALESCE(p.suffix, '')) AS name,
            p.sa_category, o.name AS office_name, p.sa_status
        FROM sa_profiles p
        LEFT JOIN offices o ON o.id = p.office_id
        WHERE p.sa_status = 'ACTIVE' AND p.archived_at IS NULL AND (
            p.supervisor_id = ?
            OR (? = 'ITO' AND p.sa_category = 'ITO')
            OR (? = 'ACADS' AND p.sa_category = 'ACADS')
            OR (p.office_id IS NOT NULL AND p.office_id = ?)
            OR (p.office_id IN (SELECT office_id FROM supervisor_offices WHERE supervisor_id = ?))
        )
        ORDER BY p.sa_category, p.last_name, p.first_name
    ");
    $primaryOid = $scope['officeIds'][0] ?? null;
    $saStmt->execute([$id, $scope['category'], $scope['category'], $primaryOid, $id]);
    $saList = $saStmt->fetchAll();

    $formattedList = array_map(function($sa, $idx) use ($bySaSched) {
        $sid = (int) $sa['id'];
        $cat = $sa['sa_category'] === 'OFFICE' ? 'OFFICES' : $sa['sa_category'];
        $oName = $sa['office_name'] === 'PRMD' ? 'PRD' : $sa['office_name'];
        $stSched = $bySaSched[$sid] ?? null;
        $location = $stSched['location'] ?? ($oName ?: ($cat . ' ROOMS & LABS'));
        $shiftSummary = 'Schedule pending approval';
        if ($stSched && !empty($stSched['blocks'])) {
            $parts = [];
            foreach (array_slice($stSched['blocks'], 0, 3) as $b) {
                $parts[] = "{$b['day']} {$b['startLabel']}–{$b['endLabel']}";
            }
            if (count($stSched['blocks']) > 3) {
                $parts[] = '+' . (count($stSched['blocks']) - 3) . ' more';
            }
            $shiftSummary = implode(' · ', $parts) . " ({$stSched['creditedHours']}h/wk)";
        }

        return [
            'id' => $sa['student_id'] ?: ("SA-2026-0" . (10 + $idx)),
            'studentId' => $sa['student_id'],
            'saNumber' => $sa['sa_number'],
            'profileId' => $sid,
            'name' => preg_replace('/\s+/', ' ', trim($sa['name'])),
            'category' => $cat,
            'dept' => $location,
            'shift' => $shiftSummary,
            'status' => $sa['sa_status'] === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'
        ];
    }, $saList, array_keys($saList));

    respond([
        'success' => true,
        'supervisorName' => $scope['name'],
        'category' => $scope['category'] === 'OFFICE' ? 'OFFICES' : $scope['category'],
        'saList' => $formattedList
    ]);
}

if ($action === 'reset_password') {
    $id = (int) (input()['id'] ?? 0);
    $stmt = $pdo->prepare("SELECT id, username, email, full_name FROM users WHERE id = ? AND role = 'SUPERVISOR'");
    $stmt->execute([$id]);
    $sup = $stmt->fetch();
    if (!$sup) fail('Supervisor not found.', 404);

    $tempPassword = generate_temp_password();
    $pdo->prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL,
                password_changed_at = NOW() WHERE id = ?'
    )->execute([password_hash($tempPassword, PASSWORD_DEFAULT), $id]);

    audit('PASSWORD_RESET_BY_ADMIN', "supervisor: {$sup['username']}", $user['id']);

    respond([
        'success' => true,
        'message' => "Password reset for {$sup['full_name']}.",
        'credentials' => [
            'username' => $sup['username'],
            'email' => $sup['email'],
            'temporaryPassword' => $tempPassword
        ]
    ]);
}

fail('Unknown action.', 400);


