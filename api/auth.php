<?php
// Authentication API
//   GET  api/auth.php               -> current user (or null) + CSRF token
//   POST api/auth.php {action:"login", username, password}
//   POST api/auth.php {action:"logout"}
//
// Login flow (PDF security checklist): validate input -> rate limit -> verify password
// -> check account -> create secure session -> load role from DB -> log the event.
// MFA for Coordinator/Supervisor accounts will be added after the core modules.
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_sa.php';

const GENERIC_LOGIN_ERROR = 'Invalid username or password.';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $user = null;
    if (!empty($_SESSION['user_id'])) {
        $row = session_user();
        if ($row) {
            $user = public_user($row);
        } else {
            reset_anonymous_session();
        }
    }
    $expired = !empty($_SESSION['expired']);
    unset($_SESSION['expired']);
    $csrfToken = $_SESSION['csrf_token'] ?? null;
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    respond([
        'success' => true,
        'user' => $user,
        'semester' => $user ? active_semester() : null,
        'expired' => $expired,
        'csrfToken' => $csrfToken,
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Method not allowed.', 405);
}

require_csrf();
if (input_has_json_error()) {
    fail('Malformed JSON request.', 400);
}

$rawAction = input()['action'] ?? '';
if (!is_string($rawAction) || $rawAction === '') {
    fail('Unknown action.', 400);
}
$action = $rawAction;

// ---------------- LOGIN ----------------
if ($action === 'login') {
    // 1. Validate input types, required fields, and reasonable length limits.
    // Never trim, sanitize, or transform the password value entered by the user.
    $in = input();
    $rawLogin = $in['login'] ?? $in['username'] ?? '';
    $rawPassword = $in['password'] ?? '';
    if (!is_string($rawLogin) || !is_string($rawPassword)) {
        fail('Invalid login request format.', 400);
    }

    // "login" = username / student ID, or email address (anything containing "@")
    $login = trim($rawLogin);
    $password = $rawPassword;
    if ($login === '' || $password === '') {
        fail('Enter your username or email, and your password.', 422);
    }
    if (mb_strlen($login) > 150) {
        fail('Username or email must be 150 characters or fewer.', 422);
    }
    if (strlen($password) > PASSWORD_MAX_LENGTH || mb_strlen($password) > PASSWORD_MAX_LENGTH) {
        fail('Password must be ' . PASSWORD_MAX_LENGTH . ' characters or fewer.', 422);
    }

    // Migrate any legacy plain-text passwords stored in users.password_hash
    migrate_legacy_password_hashes($pdo);

    // 2. Rate limit by IP
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM login_attempts
         WHERE ip_address = ? AND success = 0 AND attempted_at > (NOW() - INTERVAL ? MINUTE)'
    );
    $stmt->execute([client_ip(), LOCK_MINUTES]);
    if ((int) $stmt->fetchColumn() >= MAX_ATTEMPTS_PER_IP) {
        audit('LOGIN_RATE_LIMITED', "login: $login");
        fail('Too many sign-in attempts from this device. Try again in ' . LOCK_MINUTES . ' minutes.', 429);
    }

    $recordAttempt = function (bool $ok) use ($pdo, $login) {
        $pdo->prepare('INSERT INTO login_attempts (ip_address, username, success) VALUES (?, ?, ?)')
            ->execute([client_ip(), mb_substr($login, 0, 150), $ok ? 1 : 0]);
    };

    // 3. Verify password (a dummy hash keeps timing similar when the user doesn't exist)
    // Usernames never contain "@", so an email can't collide with someone's username
    if (str_contains($login, '@')) {
        $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$login]);
        $user = $stmt->fetch();
    } else {
        $stmt = $pdo->prepare('
            SELECT u.* 
            FROM users u
            LEFT JOIN sa_profiles sap ON sap.user_id = u.id
            WHERE u.username = ? OR sap.sa_number = ?
            LIMIT 1
        ');
        $stmt->execute([$login, $login]);
        $user = $stmt->fetch();
    }

    if ($user) {
        $passwordOk = verify_user_password($pdo, $user, $password);
    } else {
        password_verify($password, '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG');
        $passwordOk = false;
    }
    $locked = $user && $user['locked_until'] && strtotime($user['locked_until']) > time();

    if (!$user || !$passwordOk || $locked) {
        $recordAttempt(false);
        if ($user && !$locked) {
            $failed = (int) $user['failed_attempts'] + 1;
            $lockNow = $failed >= MAX_FAILED_ATTEMPTS;
            $pdo->prepare(
                'UPDATE users SET failed_attempts = ?, locked_until = IF(?, NOW() + INTERVAL ? MINUTE, locked_until) WHERE id = ?'
            )->execute([$lockNow ? 0 : $failed, $lockNow ? 1 : 0, LOCK_MINUTES, $user['id']]);
            audit($lockNow ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', "login: $login", (int) $user['id']);
        } else {
            audit($locked ? 'LOGIN_WHILE_LOCKED' : 'LOGIN_FAILED', "login: $login", $user ? (int) $user['id'] : null);
        }
        // Same message whether the account exists, the password is wrong, or it's locked
        fail(GENERIC_LOGIN_ERROR . ' After ' . MAX_FAILED_ATTEMPTS . ' failed attempts, sign-in is paused for ' . LOCK_MINUTES . ' minutes.', 401);
    }

    // 4. Check account status (only after the credentials are proven valid)
    if ($user['status'] !== 'ACTIVE' && $user['status'] !== 'PENDING_ACTIVATION') {
        $recordAttempt(false);
        audit('LOGIN_BLOCKED_STATUS', "status: {$user['status']}", (int) $user['id']);
        fail('This account is ' . strtolower($user['status']) . '. Contact the S.A. Coordinator.', 403);
    }

    // 5. Create a secure session (new ID prevents session fixation)
    start_user_session($user);

    $pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?')
        ->execute([$user['id']]);
    $recordAttempt(true);

    // 6. Role comes from the database  7. Log the event
    audit('LOGIN_SUCCESS', "role: {$user['role']}", (int) $user['id']);

    respond([
        'success' => true,
        'user' => public_user($user),
        'semester' => active_semester(),
        'csrfToken' => $_SESSION['csrf_token'],
    ]);
}

// ---------------- CHANGE PASSWORD ----------------
// Used for the required first-login change (temporary password) and for
// ordinary changes from the profile menu. Both verify the current password.
if ($action === 'change_password') {
    $user = require_auth(allowPendingPasswordChange: true);
    $in = input();
    $rawCurrent = $in['currentPassword'] ?? '';
    $rawNew = $in['newPassword'] ?? '';
    $rawConfirm = $in['confirmPassword'] ?? '';
    if (!is_string($rawCurrent) || !is_string($rawNew) || !is_string($rawConfirm)) {
        fail('Invalid password change request format.', 400);
    }

    $current = $rawCurrent;
    $new = $rawNew;
    $confirm = $rawConfirm;

    if ($current === '' || $new === '' || $confirm === '') {
        fail('Fill in all three password fields.', 422);
    }
    if (strlen($current) > PASSWORD_MAX_LENGTH || mb_strlen($current) > PASSWORD_MAX_LENGTH) {
        fail('Your current password is incorrect.', 422, ['field' => 'currentPassword']);
    }

    if (!verify_user_password($pdo, $user, $current)) {
        // Counts toward the same lockout as failed sign-ins
        $failed = (int) $user['failed_attempts'] + 1;
        if ($failed >= MAX_FAILED_ATTEMPTS) {
            $pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NOW() + INTERVAL ? MINUTE WHERE id = ?')
                ->execute([LOCK_MINUTES, $user['id']]);
            audit('ACCOUNT_LOCKED', 'too many wrong current passwords', (int) $user['id']);
            destroy_session();
            fail('Too many wrong attempts. You were signed out; sign-in is paused for ' . LOCK_MINUTES . ' minutes.', 401);
        }
        $pdo->prepare('UPDATE users SET failed_attempts = ? WHERE id = ?')->execute([$failed, $user['id']]);
        audit('PASSWORD_CHANGE_FAILED', 'wrong current password', (int) $user['id']);
        fail('Your current password is incorrect.', 422, ['field' => 'currentPassword']);
    }

    if (!hash_equals($new, $confirm)) {
        fail('The new passwords don\'t match.', 422, ['field' => 'confirmPassword']);
    }
    if ($error = password_policy_error($new, $user)) {
        fail($error, 422, ['field' => 'newPassword']);
    }

    $wasPending = (bool) $user['must_change_password'];
    $pdo->prepare(
        'UPDATE users
            SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL,
                status = IF(status = "PENDING_ACTIVATION", "ACTIVE", status),
                password_changed_at = NOW()
          WHERE id = ?'
    )->execute([password_hash($new, PASSWORD_DEFAULT), $user['id']]);

    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$user['id']]);
    $user = $stmt->fetch();

    start_user_session($user, newLogin: false);
    audit($wasPending ? 'ACCOUNT_ACTIVATED' : 'PASSWORD_CHANGED', null, (int) $user['id']);

    // Send email confirmation of password change
    try {
        require_once __DIR__ . '/_mailer.php';
        $recipients = [$user['email']];
        if ($user['role'] === 'SA') {
            $pEmail = $pdo->prepare('SELECT personal_email FROM sa_profiles WHERE user_id = ? LIMIT 1');
            $pEmail->execute([$user['id']]);
            $pe = $pEmail->fetchColumn();
            if ($pe) $recipients[] = $pe;
        }
        send_password_changed_notice_email($recipients, (string) $user['full_name']);
    } catch (Throwable $_) {}

    respond([
        'success' => true,
        'message' => $wasPending ? 'Password set. Your account is now active.' : 'Password changed.',
        'user' => public_user($user),
        'csrfToken' => $_SESSION['csrf_token'],
    ]);
}

// ---------------- UPDATE PROFILE ----------------
if ($action === 'update_profile') {
    $user = require_auth();
    $in = input();
    $firstName  = trim((string) ($in['firstName'] ?? ''));
    $middleName = trim((string) ($in['middleName'] ?? ''));
    $lastName   = trim((string) ($in['lastName'] ?? ''));
    $suffix     = trim((string) ($in['suffix'] ?? ''));
    $fullName   = trim((string) ($in['fullName'] ?? ''));
    $email      = trim((string) ($in['email'] ?? ''));

    if (!$fullName && ($firstName || $lastName)) {
        $fullName = implode(' ', array_filter([$firstName, $middleName, $lastName, $suffix]));
    }
    if (!$fullName) fail('Name fields are required.', 422);

    $pdo->prepare('UPDATE users SET full_name = ?, email = ? WHERE id = ?')
        ->execute([$fullName, $email ?: null, $user['id']]);

    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$user['id']]);
    $user = $stmt->fetch();

    $_SESSION['user_full_name'] = $user['full_name'];
    audit('UPDATE_PROFILE', "Profile updated: $fullName", (int) $user['id']);

    respond([
        'success' => true,
        'message' => 'Profile updated.',
        'user' => public_user($user)
    ]);
}

// ---------------- LOGOUT ----------------
if ($action === 'logout') {
    if (!empty($_SESSION['user_id'])) {
        audit('LOGOUT');
    }
    destroy_session();
    respond(['success' => true]);
}

fail('Unknown action.', 400);
