<?php
require_once __DIR__ . '/../api/_bootstrap.php';

$tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
foreach ($tables as $t) {
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM `$t`")->fetchAll(PDO::FETCH_COLUMN);
        $where = [];
        foreach ($cols as $col) {
            $where[] = "`$col` LIKE '%58123%'";
            $where[] = "`$col` LIKE '%salert%'";
            $where[] = "`$col` LIKE '%0081%'";
        }
        $sql = "SELECT * FROM `$t` WHERE " . implode(' OR ', $where) . " LIMIT 5";
        $res = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        if (!empty($res)) {
            echo "Found in table: $t\n";
            print_r($res);
        }
    } catch (Throwable $_) {}
}

