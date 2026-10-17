<?php
require_once __DIR__ . '/../api/_bootstrap.php';
require_once __DIR__ . '/../api/_matching.php';
$sem = target_semester(null);
$sched = schedule_view($sem['id']);
foreach ($sched['staff'] as $st) {
    if (strpos($st['name'], 'Janice') !== false || strpos($st['name'], 'Kirtz') !== false) {
        echo "NAME: " . $st['name'] . "\n";
        echo "DEPARTMENT: " . $st['department'] . "\n";
        echo "LOCATION: " . $st['location'] . "\n";
        echo "BLOCKS:\n";
        foreach ($st['blocks'] as $b) {
            echo "  {$b['day']} {$b['startLabel']}-{$b['endLabel']} at '{$b['location']}'\n";
        }
        echo "\n";
    }
}

