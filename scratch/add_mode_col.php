<?php
require_once __DIR__ . '/../api/_bootstrap.php';
try {
    $pdo->exec("ALTER TABLE semesters ADD COLUMN duty_schedule_mode VARCHAR(20) NOT NULL DEFAULT 'SEMESTER'");
    echo "Column added successfully\n";
} catch (Exception $e) {
    echo "Notice: " . $e->getMessage() . "\n";
}
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS schedule_assignments_backup LIKE schedule_assignments");
    echo "Backup table ready\n";
} catch (Exception $e) {
    echo "Notice: " . $e->getMessage() . "\n";
}

