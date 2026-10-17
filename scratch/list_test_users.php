<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$stmt = $pdo->query('SELECT id, username, full_name, role, status FROM users WHERE role IN ("ADMIN", "SUPERVISOR", "SA") ORDER BY role, id');
print_r($stmt->fetchAll(PDO::FETCH_ASSOC));

