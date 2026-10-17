<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$stmt = $pdo->query('SELECT id, student_name, supervisor_name, status, recommendation, supervisor_recommendation, coordinator_decision, acknowledgment_status, revision_count, last_return_reason, rejection_reason FROM sa_evaluations');
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Total evaluations in DB: " . count($rows) . "\n";
print_r($rows);

