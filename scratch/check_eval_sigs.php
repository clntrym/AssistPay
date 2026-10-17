<?php
require __DIR__ . '/../config/config.php';
$stmt = $pdo->query('SHOW COLUMNS FROM sa_evaluations');
while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
    echo $r['Field'] . " (" . $r['Type'] . ")\n";
}
echo "\n--- Recent Evaluations ---\n";
$stmt2 = $pdo->query('SELECT * FROM sa_evaluations ORDER BY id DESC LIMIT 2');
while ($r = $stmt2->fetch(PDO::FETCH_ASSOC)) {
    print_r($r);
}
