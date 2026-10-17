<?php
// Password policy (PDF security checklist #5, following OWASP guidance):
// long passphrases are allowed, no forced symbol/number rules, and weak or
// context-specific passwords are rejected.

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

// Common / previously-leaked passwords (lowercase). Extend as needed.
const COMMON_PASSWORDS = [
    'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword123',
    '123456', '1234567', '12345678', '123456789', '1234567890', '12345678910', '123123123', '111111111111',
    '000000000000', '123456123456', '987654321', '1q2w3e4r5t6y', 'qwerty', 'qwerty123', 'qwertyuiop',
    'qwertyuiop123', 'asdfghjkl', 'asdfghjkl123', 'zxcvbnm123', 'iloveyou', 'iloveyou123', 'iloveyou1234',
    'princess', 'princess123', 'sunshine', 'sunshine123', 'football', 'football123', 'baseball', 'basketball',
    'basketball123', 'welcome', 'welcome123', 'welcome1234', 'letmein', 'letmein123', 'admin', 'admin123',
    'admin12345', 'administrator', 'monkey123', 'dragon123', 'master123', 'superman123', 'batman123',
    'trustno1', 'starwars', 'whatever123', 'changeme', 'changeme123', 'default123', 'secret123',
    'student', 'student123', 'student12345', 'teacher123', 'school123', 'college123', 'university',
    'philippines', 'philippines123', 'pilipinas', 'mahalkita', 'mahalkita123', 'iloveyou143', 'iloveu143',
    'pinoy123', 'manila123', 'cavite123', 'jesus123', 'godisgood', 'blessed123', 'loveyou123', 'imissyou',
    'abcdefghijkl', 'abcd12345678', 'abc123456789', 'aaaaaaaaaaaa', 'qazwsxedcrfv', 'zaq12wsxcde3',
];

// Words that make a password easy to guess for THIS system
const CONTEXT_WORDS = ['assistpay', 'ncst', 'studentassistant', 'coordinator', 'supervisor'];

/**
 * Returns an error message, or null if the password is acceptable.
 * $user needs: username, full_name, password_hash (optional: to block reuse).
 */
function password_policy_error(string $password, array $user): ?string
{
    $length = mb_strlen($password);
    if ($length < PASSWORD_MIN_LENGTH) {
        return 'Use at least ' . PASSWORD_MIN_LENGTH . ' characters. A short phrase of 3–4 words works well.';
    }
    if ($length > PASSWORD_MAX_LENGTH) {
        return 'Use ' . PASSWORD_MAX_LENGTH . ' characters or fewer.';
    }

    $lower = mb_strtolower($password);
    $compact = preg_replace('/[^a-z0-9]/', '', $lower);

    if (in_array($lower, COMMON_PASSWORDS, true) || in_array($compact, COMMON_PASSWORDS, true)) {
        return 'This password is too common. Choose something harder to guess.';
    }
    if (preg_match('/^(.)\1+$/u', $password)) {
        return 'Don\'t repeat one character. Choose something harder to guess.';
    }
    foreach (CONTEXT_WORDS as $word) {
        if (str_contains($compact, $word)) {
            return 'Don\'t use words like "' . $word . '" that are easy to guess for this system.';
        }
    }

    $username = mb_strtolower($user['username'] ?? '');
    if ($username !== '' && (str_contains($lower, $username) || str_contains($compact, preg_replace('/[^a-z0-9]/', '', $username)))) {
        return 'Don\'t include your username or student ID.';
    }
    $emailName = mb_strtolower(strstr($user['email'] ?? '', '@', true) ?: '');
    if (mb_strlen($emailName) >= 3 && str_contains($lower, $emailName)) {
        return 'Don\'t include your email address.';
    }
    foreach (preg_split('/\s+/', mb_strtolower($user['full_name'] ?? '')) as $part) {
        if (mb_strlen($part) >= 3 && str_contains($lower, $part)) {
            return 'Don\'t include your name.';
        }
    }

    if (!empty($user['password_hash'])) {
        $stored = (string) $user['password_hash'];
        $info = password_get_info($stored);
        $isSame = !empty($info['algo'])
            ? password_verify($password, $stored)
            : hash_equals($stored, $password);
        if ($isSame) {
            return 'Choose a password different from your current one.';
        }
    }
    return null;
}

/**
 * Verifies a user's password against `users.password_hash` without assuming all
 * existing rows use the same format, and automatically migrates legacy plain-text
 * or outdated hashes to `password_hash($password, PASSWORD_DEFAULT)`.
 */
function verify_user_password(PDO $pdo, array &$user, string $password): bool
{
    $stored = (string) ($user['password_hash'] ?? '');
    if ($stored === '') {
        password_verify($password, '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG');
        return false;
    }

    $info = password_get_info($stored);
    if (!empty($info['algo'])) {
        $ok = password_verify($password, $stored);
        if ($ok && password_needs_rehash($stored, PASSWORD_DEFAULT)) {
            $newHash = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $stmt->execute([$newHash, (int) $user['id']]);
            $user['password_hash'] = $newHash;
        }
        return $ok;
    }

    // Legacy non-password_hash() value (e.g. plain-text or legacy hex digest):
    // Run a dummy bcrypt verification first to keep response timing consistent.
    password_verify($password, '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG');

    $matched = false;
    if (hash_equals($stored, $password)) {
        $matched = true;
    } elseif (preg_match('/^[a-f0-9]{32}$/i', $stored) && hash_equals(strtolower($stored), md5($password))) {
        $matched = true;
    } elseif (preg_match('/^[a-f0-9]{40}$/i', $stored) && hash_equals(strtolower($stored), sha1($password))) {
        $matched = true;
    } elseif (preg_match('/^[a-f0-9]{64}$/i', $stored) && hash_equals(strtolower($stored), hash('sha256', $password))) {
        $matched = true;
    }

    if ($matched) {
        $newHash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $stmt->execute([$newHash, (int) $user['id']]);
        $user['password_hash'] = $newHash;
        if (function_exists('audit')) {
            audit('PASSWORD_HASH_MIGRATED', 'Migrated legacy password format to bcrypt hash', (int) $user['id']);
        }
        return true;
    }

    return false;
}

/**
 * Scans `users.password_hash` for any legacy plain-text passwords and migrates
 * them in-place to `password_hash(..., PASSWORD_DEFAULT)`.
 */
function migrate_legacy_password_hashes(PDO $pdo): int
{
    $migrated = 0;
    $stmt = $pdo->query("SELECT id, password_hash FROM users WHERE password_hash NOT LIKE '\$2%' AND password_hash NOT LIKE '\$argon2%'");
    $updateStmt = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $stored = (string) ($row['password_hash'] ?? '');
        if ($stored === '') {
            continue;
        }
        $info = password_get_info($stored);
        if (!empty($info['algo'])) {
            continue;
        }
        // Skip legacy hex digests (32/40/64 hex chars), which migrate upon next login verification
        if (preg_match('/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i', $stored)) {
            continue;
        }
        $newHash = password_hash($stored, PASSWORD_DEFAULT);
        $updateStmt->execute([$newHash, (int) $row['id']]);
        $migrated++;
    }
    return $migrated;
}

/** Temporary password for new or reset accounts, e.g. "k7Qm-9xTe-4pWz". */
function generate_temp_password(): string
{
    // No look-alike characters (0/O, 1/l/I)
    $alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $groups = [];
    for ($g = 0; $g < 3; $g++) {
        $chunk = '';
        for ($i = 0; $i < 4; $i++) {
            $chunk .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $groups[] = $chunk;
    }
    return implode('-', $groups);
}
