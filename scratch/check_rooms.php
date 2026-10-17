<?php
require_once __DIR__ . '/../api/_bootstrap.php';
require_once __DIR__ . '/../api/_matching.php';
$sem = target_semester(null);
$sched = schedule_view($sem['id']);
echo "TOTAL ASSIGNMENTS: " . count($sched['assignments']) . "\n";
foreach ($sched['assignments'] as $as) {
    if (strpos($as['room'], 'HR') !== false) {
        echo "ROOM: {$as['room']} | DEPT: {$as['department']} | SAs: " . implode(', ', array_column($as['assigned'], 'name')) . "\n";
    }
}

