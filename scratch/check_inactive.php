<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$st = $pdo->query("SELECT id, user_id, student_id, first_name, last_name, sa_status, assignment_status, archived_at FROM sa_profiles ORDER BY id DESC LIMIT 10");
print_r($st->fetchAll(PDO::FETCH_ASSOC));

