<?php
require_once __DIR__ . '/../api/_bootstrap.php';
$stmt = $pdo->query("
    SELECT sp.id, sp.student_id, u.full_name, sp.office_id, o.name as office_name, sp.supervisor_id, su.full_name as supervisor_name
    FROM sa_profiles sp
    JOIN users u ON u.id = sp.user_id
    LEFT JOIN offices o ON o.id = sp.office_id
    LEFT JOIN users su ON su.id = sp.supervisor_id
    WHERE u.full_name LIKE '%Janice%' OR u.full_name LIKE '%Kirtz%' OR u.full_name LIKE '%Leeann%'
");
echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC), JSON_PRETTY_PRINT);

