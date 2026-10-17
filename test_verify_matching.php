<?php
require __DIR__ . '/api/_bootstrap.php';
require __DIR__ . '/api/_scheduling.php';
require __DIR__ . '/api/_matching.php';

echo "Running matching with new continuous non-fragmented engine...\n";
$runId = run_matching(1, 2, 'standard');
$res = matching_result(1);

echo "Run ID: $runId\n";
echo "Recommended Slots: {$res['recommended']}\n";
echo "Needs Review: {$res['needsReview']}\n";
echo "Coverage Gaps: {$res['coverageGaps']}\n";

// Find HR slots for Bulanon and Beler
$hrSlots = array_filter($res['slots'], fn($s) => stripos($s['label'], 'HR') !== false || stripos($s['label'], 'HUMAN') !== false);
echo "\nHR Slots found: " . count($hrSlots) . "\n";
foreach ($hrSlots as $s) {
    echo "Slot #{$s['id']} ({$s['label']}):\n";
    foreach ($s['candidates'] as $c) {
        echo "  Candidate: {$c['name']} (duty {$c['dutyHours']} hrs, projected {$c['projectedHours']} hrs)\n";
        foreach ($c['pattern'] as [$d, $st, $en]) {
            $h = ($en - $st) / 60;
            echo "    -> {$d} " . format_time(hhmm($st)) . " – " . format_time(hhmm($en)) . " ({$h} hrs)\n";
        }
    }
}
