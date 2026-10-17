<?php
$lines = file(__DIR__ . '/../api/evaluations.php');
foreach ($lines as $num => $line) {
    if (preg_match('/^\s*case\s+\'([^\']+)\'/', $line, $m)) {
        echo ($num + 1) . ': ' . $m[1] . PHP_EOL;
    }
}

