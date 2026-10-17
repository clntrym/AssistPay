<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$stmt = $pdo->query("SHOW COLUMNS FROM semesters");
$cols = [];
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $cols[] = $c['Field'];
}
echo implode("\n", $cols);

