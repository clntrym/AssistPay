<?php
require __DIR__ . '/../config/config.php';
$stmt = $pdo->query('SELECT * FROM evaluation_action_history ORDER BY id DESC LIMIT 20');
print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
