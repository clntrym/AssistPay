<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$stmt = $pdo->query('SELECT DISTINCT department FROM sa_evaluations');
echo json_encode($stmt->fetchAll(PDO::FETCH_COLUMN), JSON_PRETTY_PRINT);

