<?php
require_once __DIR__ . '/../config/config.php';

$tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
echo "SEARCHING TABLES FOR RATE OR DECISION COLUMNS:\n";
foreach ($tables as $t) {
    $cols = $pdo->query("SHOW COLUMNS FROM `$t`")->fetchAll(PDO::FETCH_ASSOC);
    $matched = [];
    foreach ($cols as $c) {
        if (preg_match('/(rate|decision|coordinator|amount|hourly)/i', $c['Field'])) {
            $matched[] = $c['Field'];
        }
    }
    if (!empty($matched)) {
        echo "Table: $t -> " . implode(', ', $matched) . "\n";
    }
}

