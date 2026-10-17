<?php
require_once __DIR__ . '/../api/_bootstrap.php';

$cols = $pdo->query("SHOW COLUMNS FROM sa_evaluations")->fetchAll(PDO::FETCH_COLUMN);

$toAdd = [
    'supervisor_recommendation' => "ALTER TABLE sa_evaluations ADD COLUMN supervisor_recommendation VARCHAR(40) NULL AFTER recommendation",
    'supervisor_reason' => "ALTER TABLE sa_evaluations ADD COLUMN supervisor_reason TEXT NULL AFTER supervisor_recommendation",
    'disclosed_feedback' => "ALTER TABLE sa_evaluations ADD COLUMN disclosed_feedback TEXT NULL AFTER coordinator_reason",
    'rejection_reason' => "ALTER TABLE sa_evaluations ADD COLUMN rejection_reason TEXT NULL AFTER last_return_reason",
    'rejected_at' => "ALTER TABLE sa_evaluations ADD COLUMN rejected_at DATETIME NULL AFTER rejection_reason",
    'rejected_by' => "ALTER TABLE sa_evaluations ADD COLUMN rejected_by INT UNSIGNED NULL AFTER rejected_at",
    'rejected_by_name' => "ALTER TABLE sa_evaluations ADD COLUMN rejected_by_name VARCHAR(160) NULL AFTER rejected_by",
];

foreach ($toAdd as $col => $sql) {
    if (!in_array($col, $cols, true)) {
        $pdo->exec($sql);
        echo "Added column: $col\n";
    } else {
        echo "Column already exists: $col\n";
    }
}
echo "Done!\n";

