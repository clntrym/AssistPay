<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$stmt = $pdo->query("SHOW COLUMNS FROM sa_evaluations");
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    if (in_array($row['Field'], ['status', 'acknowledgment_status'])) {
        echo "{$row['Field']}: {$row['Type']}\n";
    }
}

