<?php
// Database connection (PDO). This folder is blocked from the web by config/.htaccess.
// XAMPP default: root with no password. Use a dedicated MySQL user with a password
// before deploying anywhere other than your own machine.

$dbHost = getenv('DB_HOST') ?: '127.0.0.1';
$dbPort = getenv('DB_PORT') ?: '3306';
$dbName = getenv('DB_NAME') ?: 'assistpay';
$dbUser = getenv('DB_USER') ?: 'root';
$dbPass = getenv('DB_PASS') !== false ? getenv('DB_PASS') : '';

// Session rules (seconds)
const SESSION_IDLE_TIMEOUT = 30 * 60;      // sign out after 30 minutes of inactivity
const SESSION_ABSOLUTE_TIMEOUT = 8 * 3600; // sign out 8 hours after login, regardless

// Brute-force protection
const MAX_FAILED_ATTEMPTS = 5;             // per account, then temporary lock
const LOCK_MINUTES = 15;
const MAX_ATTEMPTS_PER_IP = 20;            // per IP within LOCK_MINUTES

date_default_timezone_set('Asia/Manila');

try {
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    // Enable SSL for Cloud MySQL (e.g. TiDB Cloud)
    if ($dbHost !== '127.0.0.1' && $dbHost !== 'localhost') {
        $options[PDO::MYSQL_ATTR_SSL_CA] = true;
        $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = false;
    }

    $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";
    $pdo = new PDO($dsn, $dbUser, $dbPass, $options);
    $pdo->exec("SET time_zone = '+08:00'");
} catch (PDOException $e) {
    error_log('AssistPay DB connection failed: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'message' => 'The database is unavailable. Check that MySQL is running in XAMPP.']);
    exit;
}
