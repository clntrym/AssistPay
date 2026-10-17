<?php
require __DIR__ . '/../config/config.php';
$stmt = $pdo->query("SELECT id, supervisor_id, evaluated_by FROM sa_evaluations WHERE id = 25");
$ev = $stmt->fetch(PDO::FETCH_ASSOC);
echo "sa_evaluations row 25:\n";
print_r($ev);

$uStmt = $pdo->prepare("SELECT id, role, full_name FROM users WHERE id = ?");
$uStmt->execute([$ev['supervisor_id']]);
echo "User matching supervisor_id ({$ev['supervisor_id']}):\n";
print_r($uStmt->fetch(PDO::FETCH_ASSOC));

$u2Stmt = $pdo->prepare("SELECT id, role, full_name FROM users WHERE id = ?");
$u2Stmt->execute([$ev['evaluated_by']]);
echo "User matching evaluated_by ({$ev['evaluated_by']}):\n";
print_r($u2Stmt->fetch(PDO::FETCH_ASSOC));
