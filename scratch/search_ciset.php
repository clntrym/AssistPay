<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$st = $pdo->query("SELECT id, user_id, student_id, first_name, last_name, sa_number, sa_status, assignment_status, archived_at FROM sa_profiles WHERE sa_number LIKE '%0081%' OR sa_status = 'INACTIVE'");
print_r($st->fetchAll(PDO::FETCH_ASSOC));

$all = $pdo->query("SELECT COUNT(*) as total, sa_status FROM sa_profiles GROUP BY sa_status")->fetchAll(PDO::FETCH_ASSOC);
print_r($all);

