<?php
require __DIR__ . '/../config/config.php';
$stmt = $pdo->prepare('SELECT * FROM notifications WHERE user_id = 19 ORDER BY id DESC LIMIT 5');
$stmt->execute();
print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
