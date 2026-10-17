<?php
require __DIR__ . '/api/_bootstrap.php';

$res = $pdo->query("SELECT id, first_name, last_name, office_id, assignment_status, department_type, sa_category FROM sa_profiles WHERE last_name IN ('Bulanon', 'Beler')")->fetchAll(PDO::FETCH_ASSOC);
print_r($res);
