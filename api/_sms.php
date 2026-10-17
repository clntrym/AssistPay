<?php
// AssistPay SMS Gateway & Notification Module
// Supports:
// 1. ANDROID_GATEWAY: 100% Free local SMS via Android Phone + SIM with Unli-Text Promo
//    (Compatible with Capcom6 Android SMS Gateway, SMS Gateway API, and local HTTP REST apps)
// 2. TEXTBEE: Free cloud-paired Android gateway via textbee.dev
// 3. SEMAPHORE: Cloud SMS API via semaphore.co

function ensure_sms_tables(): void
{
    global $pdo;
    static $ensured = false;
    if ($ensured) return;

    if (!isset($pdo) || !$pdo) {
        if (file_exists(__DIR__ . '/_bootstrap.php')) {
            require_once __DIR__ . '/_bootstrap.php';
        }
    }

    try {
        if ($pdo) {
            $pdo->exec("
                CREATE TABLE IF NOT EXISTS `sms_logs` (
                    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    `sa_profile_id` INT UNSIGNED DEFAULT NULL,
                    `recipient_phone` VARCHAR(30) NOT NULL,
                    `message` TEXT NOT NULL,
                    `status_type` VARCHAR(50) NOT NULL,
                    `provider` VARCHAR(30) NOT NULL DEFAULT 'ANDROID_GATEWAY',
                    `semaphore_response` TEXT DEFAULT NULL,
                    `is_success` TINYINT(1) NOT NULL DEFAULT 0,
                    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX `idx_sa` (`sa_profile_id`),
                    INDEX `idx_status` (`status_type`),
                    INDEX `idx_created` (`created_at`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            ");

            // Migration: ensure provider column exists
            try {
                $cols = $pdo->query("SHOW COLUMNS FROM `sms_logs` LIKE 'provider'")->fetchAll();
                if (empty($cols)) {
                    $pdo->exec("ALTER TABLE `sms_logs` ADD COLUMN `provider` VARCHAR(30) NOT NULL DEFAULT 'ANDROID_GATEWAY' AFTER `status_type`");
                }
            } catch (Throwable $e) {}

            $ensured = true;
        }
    } catch (Throwable $e) {
        error_log('[AssistPay SMS DB Error] ' . $e->getMessage());
    }
}

function get_sms_config(): array
{
    global $pdo;
    static $config = null;
    if ($config !== null) return $config;

    $defaults = [
        'sms_provider' => 'ANDROID_GATEWAY', // ANDROID_GATEWAY | SEMAPHORE | TEXTBEE
        'android_gateway_url' => 'http://192.168.1.50:8080',
        'android_gateway_user' => '',
        'android_gateway_pass' => '',
        'textbee_api_key' => '',
        'textbee_device_id' => '',
        'semaphore_api_key' => 'd344578926adb485d0c8f4ccab1118d7',
        'semaphore_sender_name' => ''
    ];

    try {
        if ($pdo) {
            $stmt = $pdo->query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key LIKE 'sms_%' OR setting_key LIKE 'android_%' OR setting_key LIKE 'textbee_%' OR setting_key LIKE 'semaphore_%'");
            $rows = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
            foreach ($defaults as $k => $v) {
                if (!empty($rows[$k])) {
                    $defaults[$k] = trim($rows[$k]);
                }
            }
        }
    } catch (Throwable $e) {}

    $config = $defaults;
    return $config;
}

function normalize_ph_phone(?string $phone): ?string
{
    if (empty($phone)) return null;
    $digits = preg_replace('/\D/', '', $phone);
    if (strlen($digits) === 10 && str_starts_with($digits, '9')) {
        return '0' . $digits;
    }
    if (strlen($digits) === 12 && str_starts_with($digits, '639')) {
        return '0' . substr($digits, 2);
    }
    if (strlen($digits) === 11 && str_starts_with($digits, '09')) {
        return $digits;
    }
    return null;
}

function phone_to_e164(string $normalized): string
{
    if (str_starts_with($normalized, '09')) {
        return '+63' . substr($normalized, 1);
    }
    if (str_starts_with($normalized, '+63')) {
        return $normalized;
    }
    return '+63' . ltrim($normalized, '0');
}

// -------------------------------------------------------------
// 1. ANDROID SMS GATEWAY (Local Wi-Fi / Hotspot with Unli-Text SIM)
// -------------------------------------------------------------
function send_android_gateway_sms(string $phone, string $message, ?int $saProfileId = null, string $statusType = 'GENERAL'): array
{
    global $pdo;
    ensure_sms_tables();

    $cfg = get_sms_config();
    $rawUrl = rtrim($cfg['android_gateway_url'] ?? 'http://192.168.1.50:8080', '/');
    $user = $cfg['android_gateway_user'] ?? '';
    $pass = $cfg['android_gateway_pass'] ?? '';

    $normalized = normalize_ph_phone($phone);
    if (!$normalized) {
        return [
            'success' => false,
            'provider' => 'ANDROID_GATEWAY',
            'error' => "Invalid Philippine mobile number: '{$phone}'"
        ];
    }

    $targetUrl = $rawUrl;
    if (!preg_match('#/(messages?|send|sms)$#i', $targetUrl)) {
        $targetUrl = $rawUrl . '/message';
    }

    $e164Phone = phone_to_e164($normalized);
    $payload = json_encode([
        'message' => $message,
        'phoneNumbers' => [$e164Phone]
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init();
    $curlOpts = [
        CURLOPT_URL => $targetUrl,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 6,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json']
    ];

    if (!empty($user) || !empty($pass)) {
        $curlOpts[CURLOPT_HTTPAUTH] = CURLAUTH_BASIC;
        $curlOpts[CURLOPT_USERPWD] = "{$user}:{$pass}";
    }

    curl_setopt_array($ch, $curlOpts);
    $rawResponse = curl_exec($ch);
    $curlErr = curl_error($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // Fallback: If /message returns 404, try /messages
    if ($httpCode === 404 && str_ends_with($targetUrl, '/message')) {
        $targetUrl = $rawUrl . '/messages';
        $ch2 = curl_init();
        $curlOpts[CURLOPT_URL] = $targetUrl;
        curl_setopt_array($ch2, $curlOpts);
        $rawResponse = curl_exec($ch2);
        $curlErr = curl_error($ch2);
        $httpCode = (int)curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        curl_close($ch2);
    }

    $isSuccess = ($httpCode >= 200 && $httpCode < 300);
    $errorMsg = null;
    if (!$isSuccess) {
        $errorMsg = $curlErr
            ? "Cannot reach Android Gateway ({$curlErr}). Please ensure Android phone is on the same Wi-Fi/Hotspot."
            : "Android Gateway returned HTTP {$httpCode}: " . substr((string)$rawResponse, 0, 150);
    }

    try {
        $stmt = $pdo->prepare("
            INSERT INTO sms_logs (sa_profile_id, recipient_phone, message, status_type, provider, semaphore_response, is_success, created_at)
            VALUES (?, ?, ?, ?, 'ANDROID_GATEWAY', ?, ?, NOW())
        ");
        $stmt->execute([
            $saProfileId,
            $normalized,
            $message,
            $statusType,
            $rawResponse ?: $errorMsg,
            $isSuccess ? 1 : 0
        ]);
    } catch (Throwable $e) {
        error_log('[AssistPay SMS Log Error] ' . $e->getMessage());
    }

    return [
        'success' => $isSuccess,
        'phone' => $normalized,
        'provider' => 'ANDROID_GATEWAY',
        'gatewayUrl' => $targetUrl,
        'httpCode' => $httpCode,
        'response' => $rawResponse,
        'error' => $errorMsg
    ];
}

// -------------------------------------------------------------
// 2. TEXTBEE GATEWAY (Cloud-Paired Android Gateway via textbee.dev)
// -------------------------------------------------------------
function send_textbee_sms(string $phone, string $message, ?int $saProfileId = null, string $statusType = 'GENERAL'): array
{
    global $pdo;
    ensure_sms_tables();

    $cfg = get_sms_config();
    $apiKey = $cfg['textbee_api_key'] ?? '';
    $deviceId = $cfg['textbee_device_id'] ?? '';

    $normalized = normalize_ph_phone($phone);
    if (!$normalized) {
        return ['success' => false, 'provider' => 'TEXTBEE', 'error' => "Invalid phone number: '{$phone}'"];
    }
    if (empty($apiKey)) {
        return ['success' => false, 'provider' => 'TEXTBEE', 'error' => 'TextBee API Key is not configured.'];
    }

    $e164Phone = phone_to_e164($normalized);
    $payload = [
        'recipients' => [$e164Phone],
        'message' => $message
    ];
    if (!empty($deviceId)) {
        $payload['deviceId'] = $deviceId;
    }

    $ch = curl_init('https://api.textbee.dev/api/v1/gateway/send-sms');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 7,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-api-key: ' . $apiKey
        ]
    ]);

    $rawResponse = curl_exec($ch);
    $curlErr = curl_error($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $isSuccess = ($httpCode >= 200 && $httpCode < 300);
    $errorMsg = $isSuccess ? null : ($curlErr ? "cURL error: {$curlErr}" : "TextBee HTTP {$httpCode}: {$rawResponse}");

    try {
        $stmt = $pdo->prepare("
            INSERT INTO sms_logs (sa_profile_id, recipient_phone, message, status_type, provider, semaphore_response, is_success, created_at)
            VALUES (?, ?, ?, ?, 'TEXTBEE', ?, ?, NOW())
        ");
        $stmt->execute([
            $saProfileId,
            $normalized,
            $message,
            $statusType,
            $rawResponse ?: $errorMsg,
            $isSuccess ? 1 : 0
        ]);
    } catch (Throwable $e) {}

    return [
        'success' => $isSuccess,
        'phone' => $normalized,
        'provider' => 'TEXTBEE',
        'httpCode' => $httpCode,
        'response' => $rawResponse,
        'error' => $errorMsg
    ];
}

// -------------------------------------------------------------
// 3. SEMAPHORE CLOUD SMS GATEWAY (semaphore.co)
// -------------------------------------------------------------
function send_semaphore_sms(string $phone, string $message, ?int $saProfileId = null, string $statusType = 'GENERAL'): array
{
    global $pdo;
    ensure_sms_tables();

    $cfg = get_sms_config();
    $apiKey = !empty($cfg['semaphore_api_key']) ? $cfg['semaphore_api_key'] : 'd344578926adb485d0c8f4ccab1118d7';
    $senderName = $cfg['semaphore_sender_name'] ?? '';

    $normalized = normalize_ph_phone($phone);
    if (!$normalized) {
        return [
            'success' => false,
            'provider' => 'SEMAPHORE',
            'error' => "Invalid Philippine mobile number: '{$phone}'"
        ];
    }

    $payload = [
        'apikey' => $apiKey,
        'number' => $normalized,
        'message' => $message
    ];
    if (!empty($senderName)) {
        $payload['sendername'] = $senderName;
    }

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => 'https://api.semaphore.co/api/v4/messages',
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 7,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/x-www-form-urlencoded'
        ]
    ]);

    $rawResponse = curl_exec($ch);
    $curlErr = curl_error($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $isSuccess = false;
    $errorMsg = null;

    if ($rawResponse === false) {
        $errorMsg = "cURL error: {$curlErr}";
        $respToSave = json_encode(['error' => $errorMsg]);
    } else {
        $respToSave = $rawResponse;
        $decoded = json_decode($rawResponse, true);
        if (is_array($decoded) && !empty($decoded) && isset($decoded[0]['message_id'])) {
            $isSuccess = true;
        } elseif ($httpCode === 200 && stripos($rawResponse, 'message_id') !== false) {
            $isSuccess = true;
        } else {
            $errorMsg = is_string($rawResponse) ? $rawResponse : 'Semaphore pending or error';
        }
    }

    try {
        $stmt = $pdo->prepare("
            INSERT INTO sms_logs (sa_profile_id, recipient_phone, message, status_type, provider, semaphore_response, is_success, created_at)
            VALUES (?, ?, ?, ?, 'SEMAPHORE', ?, ?, NOW())
        ");
        $stmt->execute([
            $saProfileId,
            $normalized,
            $message,
            $statusType,
            $respToSave,
            $isSuccess ? 1 : 0
        ]);
    } catch (Throwable $e) {
        error_log('[AssistPay SMS Log Error] ' . $e->getMessage());
    }

    return [
        'success' => $isSuccess,
        'phone' => $normalized,
        'provider' => 'SEMAPHORE',
        'httpCode' => $httpCode,
        'response' => $rawResponse,
        'error' => $errorMsg
    ];
}

// -------------------------------------------------------------
// 4. UNIFIED DISPATCHER
// -------------------------------------------------------------
function dispatch_sms(string $phone, string $message, ?int $saProfileId = null, string $statusType = 'GENERAL'): array
{
    $cfg = get_sms_config();
    $provider = strtoupper($cfg['sms_provider'] ?? 'ANDROID_GATEWAY');

    if ($provider === 'ANDROID_GATEWAY') {
        return send_android_gateway_sms($phone, $message, $saProfileId, $statusType);
    } elseif ($provider === 'TEXTBEE') {
        return send_textbee_sms($phone, $message, $saProfileId, $statusType);
    } else {
        return send_semaphore_sms($phone, $message, $saProfileId, $statusType);
    }
}

// -------------------------------------------------------------
// 5. ATTENDANCE STATUS NOTIFICATIONS (Present, Late, Undertime, Overtime, Absent)
// -------------------------------------------------------------
function send_attendance_status_sms(int $saProfileId, string $statusType, array $ctx = []): array
{
    global $pdo;

    $stmt = $pdo->prepare('
        SELECT p.id, p.first_name, p.last_name, p.contact_number, p.office_id, o.name AS office_name, u.phone AS user_phone
        FROM sa_profiles p
        LEFT JOIN offices o ON o.id = p.office_id
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.id = ? LIMIT 1
    ');
    $stmt->execute([$saProfileId]);
    $sa = $stmt->fetch();
    if (!$sa) {
        return ['success' => false, 'error' => 'SA profile not found'];
    }

    $phone = !empty($sa['contact_number']) ? $sa['contact_number'] : ($sa['user_phone'] ?? null);
    if (empty($phone)) {
        return ['success' => false, 'error' => 'No contact number available for this Student Assistant'];
    }

    $name = trim($sa['first_name'] ?? 'Student');
    $time = $ctx['time'] ?? date('g:i A');
    $date = $ctx['date'] ?? date('M d, Y');
    $location = $ctx['location'] ?? ($sa['office_name'] ?? 'NCST Campus');
    $schedStart = $ctx['schedStart'] ?? null;
    $schedEnd = $ctx['schedEnd'] ?? null;
    $hours = isset($ctx['hours']) ? number_format((float)$ctx['hours'], 1) : null;
    $lateMins = (int)($ctx['lateMinutes'] ?? 0);
    $underMins = (int)($ctx['undertimeMinutes'] ?? 0);
    $otHours = isset($ctx['overtimeHours']) ? number_format((float)$ctx['overtimeHours'], 1) : null;

    $message = '';
    switch (strtoupper($statusType)) {
        case 'PRESENT':
            $message = "AssistPay: Hi {$name}, your CHECK-IN was recorded at {$time} ({$location}). Status: PRESENT. Have a great duty shift!";
            break;

        case 'LATE':
            $schedText = $schedStart ? " (Sched: {$schedStart})" : "";
            $message = "AssistPay Notice: Hi {$name}, your CHECK-IN was recorded at {$time} ({$location}). Status: LATE ({$lateMins} mins late){$schedText}.";
            break;

        case 'UNDERTIME':
            $schedText = $schedEnd ? " (Sched Time-Out: {$schedEnd})" : "";
            $message = "AssistPay Notice: Hi {$name}, your CHECK-OUT was recorded at {$time} ({$location}). Status: UNDERTIME ({$underMins} mins early){$schedText}. Hours worked: {$hours} hrs.";
            break;

        case 'OVERTIME':
            $otText = $otHours ? " with {$otHours} hrs OT" : "";
            $message = "AssistPay Notice: Hi {$name}, your CHECK-OUT was recorded at {$time} ({$location}). Status: OVERTIME{$otText}. Total duty: {$hours} hrs. Great effort!";
            break;

        case 'COMPLETED':
            $message = "AssistPay: Hi {$name}, your CHECK-OUT was recorded at {$time} ({$location}). Status: COMPLETED. Total credited: {$hours} hrs. Thank you!";
            break;

        case 'ABSENT':
            $reason = !empty($ctx['reason']) ? " Reason: {$ctx['reason']}." : "";
            $message = "AssistPay Alert: Hi {$name}, you have been recorded as ABSENT for duty date {$date}.{$reason} If this is in error, submit an attendance request in the portal.";
            break;

        default:
            $message = "AssistPay Update: Hi {$name}, your attendance for {$date} was recorded as: {$statusType}.";
            break;
    }

    return dispatch_sms($phone, $message, $saProfileId, strtoupper($statusType));
}
