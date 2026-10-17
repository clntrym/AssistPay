<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$stmt = $pdo->query('SELECT id, cutoff_code, start_date, end_date FROM allowance_cutoffs');
print_r($stmt->fetchAll(PDO::FETCH_ASSOC));

