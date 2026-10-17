<?php
require_once __DIR__ . '/../api/_bootstrap.php';

$cols = $pdo->query('SHOW COLUMNS FROM sa_requests')->fetchAll(PDO::FETCH_COLUMN);

if (!in_array('sa_signature', $cols)) {
    $pdo->exec('ALTER TABLE sa_requests ADD COLUMN sa_signature mediumtext NULL AFTER notes');
    echo "Added sa_signature\n";
}
if (!in_array('sa_sign_date', $cols)) {
    $pdo->exec('ALTER TABLE sa_requests ADD COLUMN sa_sign_date date NULL AFTER sa_signature');
    echo "Added sa_sign_date\n";
}
if (!in_array('supervisor_signature', $cols)) {
    $pdo->exec('ALTER TABLE sa_requests ADD COLUMN supervisor_signature mediumtext NULL AFTER supervisor_remarks');
    echo "Added supervisor_signature\n";
}
if (!in_array('supervisor_sign_date', $cols)) {
    $pdo->exec('ALTER TABLE sa_requests ADD COLUMN supervisor_sign_date date NULL AFTER supervisor_signature');
    echo "Added supervisor_sign_date\n";
}
if (!in_array('coordinator_signature', $cols)) {
    $pdo->exec('ALTER TABLE sa_requests ADD COLUMN coordinator_signature mediumtext NULL AFTER coordinator_remarks');
    echo "Added coordinator_signature\n";
}
if (!in_array('coordinator_sign_date', $cols)) {
    $pdo->exec('ALTER TABLE sa_requests ADD COLUMN coordinator_sign_date date NULL AFTER coordinator_signature');
    echo "Added coordinator_sign_date\n";
}
echo "Migration successful!\n";

