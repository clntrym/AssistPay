<?php
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['HTTP_ACCEPT'] = 'application/json';
require_once __DIR__ . '/../api/_bootstrap.php';
global $pdo;

$stmt = $pdo->query("SELECT * FROM users WHERE id = 2");
$coord = $stmt->fetch(PDO::FETCH_ASSOC);

$_SESSION['user_id'] = $coord['id'];
$_SESSION['role'] = $coord['role'];
$_SESSION['password_changed_at'] = $coord['password_changed_at'];
$_SESSION['csrf_token'] = 'test_token_123';
$_SERVER['HTTP_X_CSRF_TOKEN'] = 'test_token_123';

$GLOBALS['__TEST_RAW_INPUT'] = json_encode(['action' => 'list']);
ob_start();
include __DIR__ . '/../api/allowance.php';
$out = ob_get_clean();

$res = json_decode($out, true);
echo "COORDINATOR SEMESTER BASE RATE: " . ($res['semRate'] ?? 'N/A') . "\n";
echo "ACTIVE CUTOFF: " . json_encode($res['activeCutoff'] ?? []) . "\n";

foreach ($res['items'] ?? [] as $it) {
    if (stripos($it['name'], 'Janice') !== false) {
        echo "JANICE IN COORDINATOR ALLOWANCE LIST:\n";
        print_r($it);
    }
}

