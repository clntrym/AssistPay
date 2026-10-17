<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$stmt = $pdo->query('SELECT id, semester_id, sa_profile_id, student_name, department, coordinator_decision, supervisor_recommendation, status FROM sa_evaluations LIMIT 10');
echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC), JSON_PRETTY_PRINT);

