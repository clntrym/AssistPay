<?php
// Shared setup for every API endpoint: DB, secure session, JSON helpers,
// CSRF check, authentication/role checks and audit logging.
ob_start();
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');

set_exception_handler(function (Throwable $e): void {
    error_log(sprintf(
        '[AssistPay Uncaught %s] %s in %s:%d',
        get_class($e),
        $e->getMessage(),
        $e->getFile(),
        $e->getLine()
    ));
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
    }
    echo json_encode([
        'success' => false,
        'message' => 'An unexpected server error occurred. Please try again.',
    ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
});

register_shutdown_function(function (): void {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        error_log(sprintf(
            '[AssistPay Fatal Error] %s in %s:%d',
            $err['message'],
            $err['file'],
            $err['line']
        ));
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: no-store');
        }
        echo json_encode([
            'success' => false,
            'message' => 'An unexpected server error occurred. Please try again.',
        ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }
});

require __DIR__ . '/../config/config.php';
require __DIR__ . '/_passwords.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

// ---------- Secure session ----------
$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
if (session_status() === PHP_SESSION_NONE) {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name('ASSISTPAY_SID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $isHttps,   // true automatically once the site runs on HTTPS
        'httponly' => true,     // JavaScript cannot read the session cookie
        'samesite' => 'Strict',
    ]);
    session_start();
}

// Expire idle or too-old sessions safely (reset session BEFORE audit logging)
if (isset($_SESSION['user_id'])) {
    $now = time();
    $idle = $now - ($_SESSION['last_activity'] ?? $now);
    $age = $now - ($_SESSION['login_time'] ?? $now);
    if ($idle > SESSION_IDLE_TIMEOUT || $age > SESSION_ABSOLUTE_TIMEOUT) {
        $expiredUserId = (int) $_SESSION['user_id'];
        reset_anonymous_session(expired: true);
        audit('SESSION_EXPIRED', null, $expiredUserId);
    } else {
        $_SESSION['last_activity'] = $now;
    }
}

if (empty($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

// ---------- Helpers ----------
function respond(array $data, int $status = 200): never
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
    } else {
        http_response_code($status);
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    echo $json !== false ? $json : '{"success":false,"message":"Failed to encode response."}';
    exit;
}

function fail(string $message, int $status = 400, array $extra = []): never
{
    respond(['success' => false, 'message' => $message] + $extra, $status);
}

/**
 * Returns a configured setting value from system_settings, or $default if not set.
 */
function get_system_setting(PDO $pdo, string $key, mixed $default = null): mixed
{
    static $settingsCache = null;
    if ($settingsCache === null) {
        try {
            $stmt = $pdo->query("SELECT setting_key, setting_value FROM system_settings");
            $settingsCache = $stmt ? $stmt->fetchAll(PDO::FETCH_KEY_PAIR) : [];
        } catch (Throwable) {
            $settingsCache = [];
        }
    }
    return $settingsCache[$key] ?? $default;
}

/**
 * Recursively checks incoming non-password request strings for dangerous patterns.
 * Passwords and authentication credentials are never blocked or modified here;
 * SQL injection is prevented via PDO prepared statements with parameter binding.
 */
function guard_input_against_sqli(mixed $value, string $key = ''): void
{
    // 1. Any base64 data URI (signatures, snapshots, uploaded proof files, attachments) is binary media
    if (is_string($value) && (str_starts_with($value, 'data:image/') || str_starts_with($value, 'data:application/') || str_starts_with($value, 'data:video/'))) {
        return;
    }

    // 2. Keys that hold passwords/auth credentials, base64 files, OCR text, or bulk spreadsheet arrays
    $exemptKeys = [
        'password', 'currentPassword', 'newPassword', 'confirmPassword', 'login', 'username',
        'imageData', 'fileData', 'corImage', 'base64', 'ocrText', 'rawText', 'extractedText',
        'rows', 'scheduleData', 'subjects', 'blocks', 'dutyBlocks', 'schedules',
        'saSignature', 'supervisorSignature', 'coordinatorSignature', 'signature',
        'proofData', 'proofFile', 'proofFileName', 'attachmentData',
        'faceDescriptor', 'descriptor', 'facePhoto', 'photo', 'snapshot',
        'avatarData', 'avatar',
    ];
    if (in_array($key, $exemptKeys, true) || stripos($key, 'signature') !== false || stripos($key, 'photo') !== false || stripos($key, 'image') !== false || stripos($key, 'avatar') !== false) {
        return;
    }

    if (is_array($value)) {
        foreach ($value as $k => $v) {
            guard_input_against_sqli($v, is_string($k) ? $k : $key);
        }
        return;
    }

    if (!is_string($value) || $value === '') {
        return;
    }

    // 3. Block real SQL Injection attack patterns across all non-credential text
    // (UNION SELECT, DROP TABLE, OR 1=1, AND 1=1, SLEEP(), BENCHMARK(), SQL comment syntax -- )
    if (preg_match('/(\bUNION\s+ALL\s+SELECT\b|\bUNION\s+SELECT\b|\bDROP\s+TABLE\b|\bDROP\s+DATABASE\b|\bOR\s+1\s*=\s*1\b|\bAND\s+1\s*=\s*1\b|\bSLEEP\s*\(|\bBENCHMARK\s*\(|--\s|--$|\/\*|\*\/)/i', $value)) {
        audit('SQLI_ATTEMPT_BLOCKED', "Blocked SQL injection pattern in field '{$key}'");
        fail('Invalid input: Special characters or SQL keywords are not allowed for security reasons.', 422);
    }

    // 4. Block dangerous HTML tags / script tags (< and >), shell backticks (`), null bytes (\0), and escape backslashes (\).
    // All normal human writing, sentences, and paragraphs are FULLY ALLOWED:
    // letters, numbers, accents (ñ, é), spaces, newlines, and sentence punctuation:
    // apostrophes ('), quotes ("), periods (.), commas (,), colons (:), semicolons (;),
    // hyphens (-), question marks (?), exclamation marks (!), parentheses (()), brackets ([]),
    // slashes (/), ampersands (&), currency ($ ₱), percentage (%), at (@), hash (#), etc.
    if (preg_match('/[<>`\\\\\0]/', $value)) {
        audit('SPECIAL_CHAR_BLOCKED', "Blocked HTML tag or dangerous character in field '{$key}'");
        fail('Invalid input: HTML tags (< or >) and backslashes are not allowed in text fields.', 422);
    }
}

function parse_request_input(): array
{
    static $parsed = null;
    if ($parsed === null) {
        $raw = (string) file_get_contents('php://input');
        if ($raw === '' && PHP_SAPI === 'cli' && isset($GLOBALS['__TEST_RAW_INPUT'])) {
            $raw = (string) $GLOBALS['__TEST_RAW_INPUT'];
        }
        $trimmed = trim($raw);
        if ($trimmed === '') {
            $parsed = ['data' => [], 'jsonError' => false];
        } else {
            $decoded = json_decode($raw, true);
            $hasErr = (json_last_error() !== JSON_ERROR_NONE) || !is_array($decoded);
            $data = is_array($decoded) ? $decoded : [];
            if (!$hasErr) {
                guard_input_against_sqli($data);
            }
            $parsed = ['data' => $data, 'jsonError' => $hasErr];
        }
    }
    return $parsed;
}

function input_has_json_error(): bool
{
    return parse_request_input()['jsonError'];
}

function input(): array
{
    return parse_request_input()['data'];
}

function client_ip(): string
{
    return substr($_SERVER['REMOTE_ADDR'] ?? 'unknown', 0, 45);
}

function audit(string $action, ?string $details = null, ?int $userId = null): void
{
    global $pdo;
    try {
        // Automatically append reason from request payload if present and not yet included
        if ($action !== 'SQLI_ATTEMPT_BLOCKED' && $action !== 'SPECIAL_CHAR_BLOCKED') {
            $rawIn = (string) file_get_contents('php://input');
            if ($rawIn === '' && PHP_SAPI === 'cli' && isset($GLOBALS['__TEST_RAW_INPUT'])) {
                $rawIn = (string) $GLOBALS['__TEST_RAW_INPUT'];
            }
            $in = json_decode($rawIn, true);
            $reason = (is_array($in) && isset($in['reason']) && is_string($in['reason']))
                ? trim($in['reason'])
                : '';
            if ($reason !== '' && ($details === null || stripos($details, 'Reason:') === false)) {
                $details = ($details !== null && $details !== '')
                    ? "{$details} | Reason: {$reason}"
                    : "Reason: {$reason}";
            }
        }
        $targetUserId = $userId ?? (isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null);
        $pdo->prepare(
            'INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent)
             VALUES ((SELECT id FROM users WHERE id = ?), ?, ?, ?, ?)'
        )->execute([
            $targetUserId,
            $action,
            $details === null ? null : mb_substr($details, 0, 500),
            client_ip(),
            mb_substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
        ]);
    } catch (Throwable $e) {
        error_log('[AssistPay Audit Error] ' . $e->getMessage());
    }
}

function reset_anonymous_session(bool $expired = false): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        @session_regenerate_id(true);
    } else {
        @session_start();
    }
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    if ($expired) {
        $_SESSION['expired'] = true;
    }
}

function destroy_session(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000, 'path' => $p['path'], 'secure' => $p['secure'],
            'httponly' => $p['httponly'], 'samesite' => $p['samesite'],
        ]);
        session_destroy();
    }
}

// Every POST (state-changing) request must carry the session's CSRF token.
function require_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $expected = $_SESSION['csrf_token'] ?? '';
    if (!is_string($sent) || $sent === '' || !is_string($expected) || $expected === '' || !hash_equals($expected, $sent)) {
        fail('Your session token is invalid. Refresh the page and try again.', 419);
    }
}

// The signed-in user if the session is still valid, otherwise null.
// A session becomes invalid when the account is deactivated or its password was
// changed elsewhere (every other device is signed out after a password change).
function session_user(): ?array
{
    global $pdo;
    if (empty($_SESSION['user_id'])) return null;

    static $cachedUid = null;
    static $cachedUser = null;
    $uid = (int) $_SESSION['user_id'];
    if ($cachedUid === $uid && $cachedUser !== null && PHP_SAPI !== 'cli') {
        $user = $cachedUser;
    } else {
        $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$uid]);
        $user = $stmt->fetch() ?: null;
        $cachedUid = $uid;
        $cachedUser = $user;
    }

    $statusOk = $user && in_array($user['status'], ['ACTIVE', 'PENDING_ACTIVATION'], true);
    $passwordUnchanged = $user && ($user['password_changed_at'] ?? null) === ($_SESSION['password_changed_at'] ?? null);
    return ($statusOk && $passwordUnchanged) ? $user : null;
}

// Returns the logged-in user (fresh from the database) or stops with 401.
// Accounts still using a temporary password can only change it
// ($allowPendingPasswordChange = true on that one endpoint).
function require_auth(bool $allowPendingPasswordChange = false): array
{
    if (empty($_SESSION['user_id'])) {
        fail(!empty($_SESSION['expired']) ? 'Your session expired. Sign in again.' : 'Sign in to continue.', 401);
    }
    $user = session_user();
    if (!$user) {
        reset_anonymous_session();
        fail('You were signed out. Sign in again.', 401);
    }
    if ($user['must_change_password'] && !$allowPendingPasswordChange) {
        fail('Set a new password before continuing.', 403, ['code' => 'PASSWORD_CHANGE_REQUIRED']);
    }
    // Release exclusive PHP session file lock once authentication & last_activity are verified
    // so concurrent requests from the same user can execute in parallel.
    $script = basename($_SERVER['SCRIPT_NAME'] ?? '');
    if ($script !== 'auth.php' && session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    return $user;
}

/**
 * Lightweight schema/DDL guard so CREATE TABLE / SHOW COLUMNS checks run once
 * per schema version instead of on every HTTP request.
 */
function schema_guard_ready(string $key, int $ttlSeconds = 86400): bool
{
    static $mem = [];
    if (!empty($mem[$key])) return true;
    $file = sys_get_temp_dir() . '/assistpay_schema_' . preg_replace('/[^a-zA-Z0-9_.-]/', '_', $key) . '.flag';
    if (is_file($file) && (time() - (int) @filemtime($file)) < $ttlSeconds) {
        $mem[$key] = true;
        return true;
    }
    return false;
}

function schema_guard_mark_ready(string $key): void
{
    static $mem = [];
    $mem[$key] = true;
    $file = sys_get_temp_dir() . '/assistpay_schema_' . preg_replace('/[^a-zA-Z0-9_.-]/', '_', $key) . '.flag';
    @file_put_contents($file, (string) time());
}

// Starts a fresh session for $user (new ID prevents session fixation).
// $newLogin = false keeps the original login time (used after a password change).
function start_user_session(array $user, bool $newLogin = true): void
{
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];
    $_SESSION['password_changed_at'] = $user['password_changed_at'];
    if ($newLogin || empty($_SESSION['login_time'])) $_SESSION['login_time'] = time();
    $_SESSION['last_activity'] = time();
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

// Role check — the role always comes from the database, never from the request.
function require_role(array $user, string ...$roles): void
{
    if (!in_array($user['role'], $roles, true)) {
        audit('ACCESS_DENIED', ($_SERVER['SCRIPT_NAME'] ?? '') . ' ' . (input()['action'] ?? ''), (int) $user['id']);
        fail('You do not have access to this action.', 403);
    }
}

// The user data the frontend is allowed to see (no hashes, no lock counters).
function public_user(array $user): array
{
    global $pdo;
    $office = null;
    if ($user['office_id']) {
        $stmt = $pdo->prepare('SELECT code, name FROM offices WHERE id = ?');
        $stmt->execute([$user['office_id']]);
        $office = $stmt->fetch() ?: null;
    }
    $avatarUrl = null;
    if (!empty($user['avatar_path'])) {
        $v = isset($user['updated_at']) ? strtotime((string) $user['updated_at']) : time();
        $avatarUrl = 'api/avatar.php?id=' . (int) $user['id'] . '&v=' . $v;
    }
    return [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'name' => $user['full_name'],
        'fullName' => $user['full_name'],
        'email' => $user['email'],
        'role' => $user['role'],
        'supervisorCategory' => $user['supervisor_category'],
        'office' => $office,
        'mustChangePassword' => (bool) $user['must_change_password'],
        'lastLoginAt' => $user['last_login_at'] ?? null,
        'passwordChangedAt' => $user['password_changed_at'] ?? null,
        'avatarUrl' => $avatarUrl,
    ];
}

/**
 * Create an in-app notification for a user.
 */
function create_notification(int $userId, string $title, string $message, string $type = 'SYSTEM', ?string $link = null, ?int $senderId = null): ?int
{
    global $pdo;
    try {
        $stmt = $pdo->prepare('
            INSERT INTO notifications (user_id, sender_id, type, title, message, link, is_read, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, NOW())
        ');
        $stmt->execute([$userId, $senderId, $type, $title, $message, $link]);
        return (int) $pdo->lastInsertId();
    } catch (Throwable $e) {
        error_log("Failed to create notification: " . $e->getMessage());
        return null;
    }
}

/**
 * AssistPay Standard S.A. Automatic Meal Break & Attendance Computation
 *
 * Policy:
 * - Fixed office meal break: 60 minutes (1.00 hour), 12:00 NN–1:00 PM.
 * - Deducted automatically from credited attendance hours without manual punches.
 * - Standard 1-hour deduction applies once per qualifying attendance day.
 * - Qualifies if:
 *     a) Total elapsed attendance duration >= 5.00 hours, OR
 *     b) Attendance window spans the fixed lunch break (time_in <= 12:15 PM and time_out >= 12:45 PM).
 * - Net Credited Hours = max(0.00, round(Valid Elapsed Hours - Automatic Break Deduction, 2)).
 * - If scheduled hours > 0, credited hours can be capped at scheduled duty if system policy dictates.
 * - Gross Attendance-Based Allowance = Net Credited Hours * Hourly Rate.
 */
function compute_daily_attendance_hours(?string $timeInStr, ?string $timeOutStr, float $schedHours = 0.0, float $hourlyRate = 8.0): array
{
    if (!$timeInStr || !$timeOutStr) {
        return [
            'isComplete' => false,
            'elapsedHours' => 0.0,
            'breakDeduction' => 0.0,
            'netHours' => 0.0,
            'creditedHours' => 0.0,
            'hourlyRate' => round($hourlyRate, 2),
            'computedAllowance' => 0.0,
            'qualifiesForBreak' => false,
            'ruleDescription' => 'Incomplete attendance. Check-In or Check-Out missing.'
        ];
    }

    $tIn = strtotime($timeInStr);
    $tOut = strtotime($timeOutStr);
    if ($tOut <= $tIn) {
        return [
            'isComplete' => false,
            'elapsedHours' => 0.0,
            'breakDeduction' => 0.0,
            'netHours' => 0.0,
            'creditedHours' => 0.0,
            'hourlyRate' => round($hourlyRate, 2),
            'computedAllowance' => 0.0,
            'qualifiesForBreak' => false,
            'ruleDescription' => 'Invalid timestamps: Time Out is not after Time In.'
        ];
    }

    $diffSec = $tOut - $tIn;
    $elapsedHours = round($diffSec / 3600, 2);

    // Check lunch window span (12:00 NN - 1:00 PM)
    $inHi = (int)date('Hi', $tIn);
    $outHi = (int)date('Hi', $tOut);
    $spansLunch = ($inHi <= 1215 && $outHi >= 1245);
    $qualifies = ($elapsedHours >= 5.00 || $spansLunch);

    $breakDeduction = 0.0;
    if ($qualifies) {
        $breakDeduction = min(1.00, $elapsedHours);
    }

    $netHours = max(0.0, round($elapsedHours - $breakDeduction, 2));
    $creditedHours = $schedHours > 0 ? min($schedHours, $netHours) : $netHours;
    $computedAllowance = round($creditedHours * $hourlyRate, 2);

    return [
        'isComplete' => true,
        'elapsedHours' => $elapsedHours,
        'breakDeduction' => $breakDeduction,
        'netHours' => $netHours,
        'creditedHours' => $creditedHours,
        'hourlyRate' => round($hourlyRate, 2),
        'computedAllowance' => $computedAllowance,
        'qualifiesForBreak' => $qualifies,
        'ruleDescription' => $qualifies
            ? 'Standard 1-hour unpaid lunch break (12:00 NN–1:00 PM) automatically deducted.'
            : 'Short shift: automatic meal break deduction not applicable.'
    ];
}

/**
 * Notify all active supervisors associated with an office (via users.office_id or supervisor_offices).
 */
function notify_office_supervisors(PDO $pdo, int $officeId, ?int $senderId, string $title, string $message, ?string $link = null): void
{
    if ($officeId <= 0) return;
    try {
        $stmt = $pdo->prepare('
            SELECT DISTINCT u.id
              FROM users u
              LEFT JOIN supervisor_offices so ON so.supervisor_id = u.id
             WHERE u.role = "supervisor" AND u.status = "ACTIVE"
               AND (u.office_id = ? OR so.office_id = ?)
        ');
        $stmt->execute([$officeId, $officeId]);
        $supIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

        if (empty($supIds)) return;

        $ins = $pdo->prepare('
            INSERT INTO notifications (user_id, sender_id, type, title, message, link, is_read, created_at)
            VALUES (?, ?, "SYSTEM", ?, ?, ?, 0, NOW())
        ');
        foreach ($supIds as $sid) {
            $ins->execute([(int) $sid, $senderId, $title, $message, $link]);
        }
    } catch (Throwable $e) {
        error_log("[AssistPay notify_office_supervisors] " . $e->getMessage());
    }
}
