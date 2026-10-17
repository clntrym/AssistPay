<?php
// System Settings API (S.A. Coordinator & Registrar Configuration)
require __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_violations.php';

// Auto-create system_settings table and violation tables if needed
ensure_violation_schema($pdo);

$user = require_auth();
$method = $_SERVER['REQUEST_METHOD'];
$action = input()['action'] ?? ($method === 'GET' ? 'get' : '');

function get_all_settings(PDO $pdo): array
{
    $defaults = [
        'tuitionDiscountPct' => 100,
        'miscDiscountPct' => 30,
        'minWeeklyDutyHours' => 35,
        'maxWeeklyDutyHours' => 50,
        'defaultRequiredSa' => 80,
        'defaultHourlyRate' => 8.00,
        'excuseSlipGraceDays' => 2,
        'overtimeGraceDays' => 2,
        'sms_provider' => 'ANDROID_GATEWAY',
        'android_gateway_url' => 'http://192.168.1.50:8080',
        'android_gateway_user' => '',
        'android_gateway_pass' => '',
        'textbee_api_key' => '',
        'textbee_device_id' => '',
        'semaphore_api_key' => 'd344578926adb485d0c8f4ccab1118d7',
        'semaphore_sender_name' => '',
        'gemini_api_key' => ''
    ];

    $stmt = $pdo->query("SELECT setting_key, setting_value FROM system_settings");
    $rows = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);

    $out = [];
    foreach ($defaults as $k => $defVal) {
        if (array_key_exists($k, $rows)) {
            $val = $rows[$k];
            if (is_numeric($defVal)) {
                $out[$k] = str_contains((string) $defVal, '.') ? (float) $val : (int) $val;
            } else {
                $out[$k] = $val;
            }
        } else {
            $out[$k] = $defVal;
        }
    }
    return $out;
}

if ($action === 'get') {
    $semesters = $pdo->query('SELECT * FROM semesters ORDER BY start_date DESC')->fetchAll();
    $activeSem = active_semester();
    $semId = (int) (input()['semesterId'] ?? ($activeSem['id'] ?? ($semesters[0]['id'] ?? 0)));

    respond([
        'success' => true,
        'user' => public_user(session_user()),
        'settings' => get_all_settings($pdo),
        'semesterId' => $semId,
        'semesters' => array_map('format_semester', $semesters),
        'violationSettings' => $semId > 0 ? get_violation_settings($pdo, $semId) : [],
        'escalationMode' => get_warning_escalation_mode($pdo),
        'violationHistory' => $semId > 0 ? get_violation_settings_history($pdo, $semId) : [],
    ]);
}

if ($method !== 'POST') {
    fail('Method not allowed.', 405);
}

require_csrf();

if ($action === 'save_violation_settings') {
    require_role($user, 'ADMIN');
    $in = input();
    $activeSem = active_semester();
    $semesterId = (int) ($in['semesterId'] ?? ($activeSem['id'] ?? 0));
    if ($semesterId <= 0) {
        fail('Select a valid semester.', 422);
    }
    $categories = is_array($in['categories'] ?? null) ? $in['categories'] : [];
    $escalationMode = isset($in['escalationMode']) ? (string) $in['escalationMode'] : null;
    $reason = isset($in['reason']) ? trim((string) $in['reason']) : null;

    $res = save_violation_settings($pdo, $semesterId, $categories, $escalationMode, (int) $user['id'], $reason);
    if (!$res['success']) {
        fail($res['message'], 422, ['errors' => $res['errors'] ?? []]);
    }
    respond([
        'success' => true,
        'message' => 'Attendance violation settings saved!',
        'semesterId' => $semesterId,
        'violationSettings' => $res['settings'],
        'escalationMode' => $res['escalationMode'],
        'violationHistory' => $res['history'],
    ]);
}

if ($action === 'save_system_settings') {
    if (!in_array($user['role'], ['ADMIN', 'REGISTRAR'], true)) {
        fail('Only S.A. Coordinators or System Administrators can change system settings.', 403);
    }

    $in = input();
    $tuitionDiscountPct = isset($in['tuitionDiscountPct']) ? (float) $in['tuitionDiscountPct'] : 100;
    $miscDiscountPct    = isset($in['miscDiscountPct']) ? (float) $in['miscDiscountPct'] : 30;
    $minWeeklyDutyHours = isset($in['minWeeklyDutyHours']) ? (float) $in['minWeeklyDutyHours'] : 35;
    $maxWeeklyDutyHours = isset($in['maxWeeklyDutyHours']) ? (float) $in['maxWeeklyDutyHours'] : 50;
    $defaultRequiredSa  = isset($in['defaultRequiredSa']) ? (int) $in['defaultRequiredSa'] : 80;
    $defaultHourlyRate  = isset($in['defaultHourlyRate']) ? (float) $in['defaultHourlyRate'] : 8.00;
    $excuseSlipGraceDays = isset($in['excuseSlipGraceDays']) ? (int) $in['excuseSlipGraceDays'] : 2;
    $overtimeGraceDays   = isset($in['overtimeGraceDays']) ? (int) $in['overtimeGraceDays'] : 2;

    // Validation
    if ($tuitionDiscountPct < 0 || $tuitionDiscountPct > 100) {
        fail('Tuition discount percentage must be between 0% and 100%.', 422);
    }
    if ($miscDiscountPct < 0 || $miscDiscountPct > 100) {
        fail('Miscellaneous discount percentage must be between 0% and 100%.', 422);
    }
    if ($minWeeklyDutyHours < 1) {
        fail('Minimum required weekly duty hours must be at least 1 hour.', 422);
    }
    if ($maxWeeklyDutyHours > 168) {
        fail('Maximum allowed weekly duty hours cannot exceed 168 hours.', 422);
    }
    if ($minWeeklyDutyHours > $maxWeeklyDutyHours) {
        fail('Minimum duty hours cannot be greater than maximum duty hours.', 422);
    }
    if ($defaultRequiredSa < 1) {
        fail('Default required S.A. headcount must be at least 1.', 422);
    }
    $rawDefaultRate = trim((string) ($in['defaultHourlyRate'] ?? '8'));
    if (!is_numeric($rawDefaultRate) || floor((float) $rawDefaultRate) != (float) $rawDefaultRate || str_contains($rawDefaultRate, '.')) {
        fail('Default hourly allowance rate must be a whole number (decimals like 9.5 or 9.25 are not allowed).', 422);
    }
    if ($defaultHourlyRate < 8) {
        fail('Default hourly allowance rate cannot be less than ₱8.00 per hour.', 422);
    }
    if ($excuseSlipGraceDays < 0 || $excuseSlipGraceDays > 14) {
        fail('Excuse slip grace period must be between 0 and 14 calendar days.', 422);
    }
    if ($overtimeGraceDays < 0 || $overtimeGraceDays > 14) {
        fail('Overtime filing grace period must be between 0 and 14 calendar days.', 422);
    }

    $toSave = [
        'tuitionDiscountPct'  => $tuitionDiscountPct,
        'miscDiscountPct'     => $miscDiscountPct,
        'minWeeklyDutyHours'  => $minWeeklyDutyHours,
        'maxWeeklyDutyHours'  => $maxWeeklyDutyHours,
        'defaultRequiredSa'   => $defaultRequiredSa,
        'defaultHourlyRate'   => $defaultHourlyRate,
        'excuseSlipGraceDays' => $excuseSlipGraceDays,
        'overtimeGraceDays'   => $overtimeGraceDays,
    ];

    $smsKeys = ['sms_provider', 'android_gateway_url', 'android_gateway_user', 'android_gateway_pass', 'textbee_api_key', 'textbee_device_id', 'semaphore_api_key', 'semaphore_sender_name', 'gemini_api_key'];
    foreach ($smsKeys as $sk) {
        if (isset($in[$sk])) {
            $toSave[$sk] = trim((string)$in[$sk]);
        }
    }

    $stmt = $pdo->prepare("INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)");
    foreach ($toSave as $key => $val) {
        $stmt->execute([$key, (string) $val]);
    }

    // Automatically re-adapt OFFICE, ITO, and ACADS schedules for the active semester to obey updated min/max duty hours
    require_once __DIR__ . '/_matching.php';
    $activeSem = active_semester();
    $semId = (int) ($in['semesterId'] ?? ($activeSem['id'] ?? 0));
    if ($semId > 0) {
        ensure_assigned_office_schedules($semId);
        reconcile_matching_with_live_data($semId);
    }

    audit('UPDATE_SYSTEM_SETTINGS', "Updated system settings (Tuition: {$tuitionDiscountPct}%, Misc: {$miscDiscountPct}%, Duty: {$minWeeklyDutyHours}-{$maxWeeklyDutyHours}h, S.A. Target: {$defaultRequiredSa})", $user['id']);

    respond([
        'success' => true,
        'message' => 'Settings saved successfully!',
        'settings' => get_all_settings($pdo)
    ]);
}

if ($action === 'test_sms_connection') {
    if (!in_array($user['role'], ['ADMIN', 'REGISTRAR', 'SUPERVISOR'], true)) {
        fail('Unauthorized.', 403);
    }
    require_once __DIR__ . '/_sms.php';
    $in = input();
    $phone = trim($in['phone'] ?? '');
    if (empty($phone)) {
        fail('Please enter a mobile number to receive the test SMS.', 422);
    }

    $provider = strtoupper(trim($in['provider'] ?? 'ANDROID_GATEWAY'));
    $testMsg = "AssistPay: " . ($provider === 'ANDROID_GATEWAY' ? "Android SMS Gateway (Unli-Text SIM)" : $provider) . " test connection SUCCESSFUL! Time: " . date('g:i A');

    if (!empty($in['androidGatewayUrl'])) {
        $pdo->prepare("INSERT INTO system_settings (setting_key, setting_value) VALUES ('android_gateway_url', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")->execute([trim($in['androidGatewayUrl'])]);
    }
    if (isset($in['androidGatewayUser'])) {
        $pdo->prepare("INSERT INTO system_settings (setting_key, setting_value) VALUES ('android_gateway_user', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")->execute([trim($in['androidGatewayUser'])]);
    }
    if (isset($in['androidGatewayPass'])) {
        $pdo->prepare("INSERT INTO system_settings (setting_key, setting_value) VALUES ('android_gateway_pass', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")->execute([trim($in['androidGatewayPass'])]);
    }
    if (isset($in['provider'])) {
        $pdo->prepare("INSERT INTO system_settings (setting_key, setting_value) VALUES ('sms_provider', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")->execute([$provider]);
    }

    $result = dispatch_sms($phone, $testMsg, null, 'TEST_CONNECTION');

    respond([
        'success' => $result['success'] ?? false,
        'message' => ($result['success'] ?? false)
            ? 'Test SMS successfully sent to ' . ($result['phone'] ?? $phone) . '!'
            : 'Test SMS failed: ' . ($result['error'] ?? 'Connection error'),
        'details' => $result
    ]);
}

// ---------------- PROFILE PICTURE UPLOAD & REMOVAL ----------------
if ($action === 'upload_avatar') {
    $userId = (int) $user['id'];
    $in = input();
    $rawBase64 = (string) ($in['avatarData'] ?? ($in['image'] ?? ($in['photo'] ?? '')));
    $rawBase64 = trim($rawBase64);
    if ($rawBase64 === '') {
        fail('Please select an image file to upload.', 422);
    }

    // Strip data URI prefix if present
    if (preg_match('/^data:([^;]+);base64,(.*)$/s', $rawBase64, $m)) {
        $rawBase64 = $m[2];
    }

    $binary = base64_decode($rawBase64, true);
    if ($binary === false || strlen($binary) === 0) {
        fail('Invalid image encoding. Please upload a valid JPG, PNG, or WebP image.', 422);
    }

    // Maximum file size: 2 MB
    $size = strlen($binary);
    if ($size > 2 * 1024 * 1024) {
        fail('The uploaded file exceeds the 2 MB maximum size limit.', 422);
    }

    // Validate signature via finfo
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $detectedMime = (string) $finfo->buffer($binary);
    $allowedMimes = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
    ];
    if (!isset($allowedMimes[$detectedMime])) {
        fail('Unsupported file format. Please upload a JPG, PNG, or WebP image.', 422);
    }

    // Validate actual image content integrity
    $imageInfo = @getimagesizefromstring($binary);
    if ($imageInfo === false || empty($imageInfo[0]) || empty($imageInfo[1])) {
        fail('The uploaded image appears to be corrupted or invalid.', 422);
    }

    $ext = $allowedMimes[$detectedMime];
    $uploadDir = dirname(__DIR__) . '/uploads/avatars';
    if (!is_dir($uploadDir)) {
        @mkdir($uploadDir, 0755, true);
    }

    // Unique random filename: avatar_<userId>_<timestamp>_<random>.<ext>
    $storedFilename = 'avatar_' . $userId . '_' . time() . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    $targetPath = $uploadDir . DIRECTORY_SEPARATOR . $storedFilename;

    if (@file_put_contents($targetPath, $binary) === false) {
        fail('Failed to save profile picture. Please try again.', 500);
    }

    // Clean up previous avatar if it exists
    $oldStmt = $pdo->prepare('SELECT avatar_path FROM users WHERE id = ?');
    $oldStmt->execute([$userId]);
    $oldAvatar = (string) ($oldStmt->fetchColumn() ?: '');
    if ($oldAvatar !== '') {
        $oldFile = $uploadDir . DIRECTORY_SEPARATOR . basename($oldAvatar);
        if (is_file($oldFile) && $oldFile !== $targetPath) {
            @unlink($oldFile);
        }
    }

    $savedRelativePath = 'uploads/avatars/' . $storedFilename;
    $pdo->prepare('UPDATE users SET avatar_path = ?, updated_at = NOW() WHERE id = ?')
        ->execute([$savedRelativePath, $userId]);

    $freshStmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $freshStmt->execute([$userId]);
    $freshUser = $freshStmt->fetch();

    audit('AVATAR_UPLOADED', "User #{$userId} updated profile picture", $userId);

    respond([
        'success' => true,
        'message' => 'Profile picture updated successfully.',
        'user' => public_user($freshUser)
    ]);
}

if ($action === 'remove_avatar') {
    $userId = (int) $user['id'];
    $uploadDir = dirname(__DIR__) . '/uploads/avatars';

    $oldStmt = $pdo->prepare('SELECT avatar_path FROM users WHERE id = ?');
    $oldStmt->execute([$userId]);
    $oldAvatar = (string) ($oldStmt->fetchColumn() ?: '');
    if ($oldAvatar !== '') {
        $oldFile = $uploadDir . DIRECTORY_SEPARATOR . basename($oldAvatar);
        if (is_file($oldFile)) {
            @unlink($oldFile);
        }
    }

    $pdo->prepare('UPDATE users SET avatar_path = NULL, updated_at = NOW() WHERE id = ?')
        ->execute([$userId]);

    $freshStmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $freshStmt->execute([$userId]);
    $freshUser = $freshStmt->fetch();

    audit('AVATAR_REMOVED', "User #{$userId} removed profile picture", $userId);

    respond([
        'success' => true,
        'message' => 'Profile picture removed successfully.',
        'user' => public_user($freshUser)
    ]);
}

fail('Unknown action.', 400);
