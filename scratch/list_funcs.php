<?php
$lines = file(__DIR__ . '/../api/_evaluation_workflow.php');
foreach ($lines as $num => $line) {
    if (preg_match('/^\s*function\s+([a-zA-Z0-9_]+)\s*\(/', $line, $m)) {
        echo ($num + 1) . ': ' . $m[1] . PHP_EOL;
    }
}

