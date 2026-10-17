<?php
// Remove an S.A. record for good — profile, login account and everything that
// hangs off them (class schedule, duty preferences, review, duty).
//
// This is NOT what the Coordinator uses day to day: Archive takes an S.A. off
// the roster and keeps their history, which is what a graduating or resigning
// S.A. needs. This script is for records that should never have existed — test
// rows, a double registration — where keeping the history is pointless.
//
//   php database/delete-sa.php 2026-44756              show what would go
//   php database/delete-sa.php 2026-44756 --confirm    actually delete it
//
// Several student numbers can be given at once.
require __DIR__ . '/../api/_bootstrap.php';

$args = array_slice($argv, 1);
$confirm = in_array('--confirm', $args, true);
$ids = array_values(array_filter($args, fn($a) => $a !== '--confirm'));

if (!$ids) {
    fwrite(STDERR, "Give at least one student number.\n"
        . "  php database/delete-sa.php 2026-44756 [--confirm]\n");
    exit(1);
}

$placeholders = implode(',', array_fill(0, count($ids), '?'));
$stmt = $pdo->prepare(
    "SELECT p.id, p.user_id, p.student_id, p.first_name, p.last_name, p.sa_category,
            p.sa_status, p.assignment_status, u.username, u.email,
            (SELECT COUNT(*) FROM class_schedules c WHERE c.sa_profile_id = p.id) AS classes,
            (SELECT COUNT(*) FROM duty_preferences d WHERE d.sa_profile_id = p.id) AS prefs,
            (SELECT COUNT(*) FROM schedule_assignments a WHERE a.sa_profile_id = p.id) AS duty,
            (SELECT COUNT(*) FROM assignment_reviews r WHERE r.sa_profile_id = p.id) AS reviews
       FROM sa_profiles p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.student_id IN ($placeholders)"
);
$stmt->execute($ids);
$rows = $stmt->fetchAll();

$found = array_column($rows, 'student_id');
foreach ($ids as $id) {
    if (!in_array($id, $found, true)) fwrite(STDERR, "!! $id is not on the roster.\n");
}
if (!$rows) exit(1);

$total = (int) $pdo->query('SELECT COUNT(*) FROM sa_profiles')->fetchColumn();
echo ($confirm ? "Deleting" : "Would delete") . " " . count($rows) . " of $total S.A. record(s):\n\n";
foreach ($rows as $r) {
    printf("  %-12s %-28s %-7s %-11s  classes:%-3d duty:%-3d prefs:%-3d review:%d\n",
           $r['student_id'], $r['first_name'] . ' ' . $r['last_name'], $r['sa_category'],
           $r['sa_status'], $r['classes'], $r['duty'], $r['prefs'], $r['reviews']);
    echo "               login " . ($r['username'] ?? '(none)') . " / " . ($r['email'] ?? '-') . "\n";
}

if (!$confirm) {
    echo "\nNothing was changed. Add --confirm to delete these for good.\n";
    exit(0);
}

// The profile goes first: everything below it cascades, and the login account
// cannot be removed while a profile still points at it.
$pdo->beginTransaction();
try {
    $delProfile = $pdo->prepare('DELETE FROM sa_profiles WHERE id = ?');
    $delUser = $pdo->prepare('DELETE FROM users WHERE id = ? AND role = "SA"');
    foreach ($rows as $r) {
        $delProfile->execute([$r['id']]);
        if ($r['user_id']) $delUser->execute([$r['user_id']]);
        $pdo->prepare('INSERT INTO audit_logs (user_id, action, details) VALUES (NULL, "SA_DELETED", ?)')
            ->execute(["{$r['student_id']} {$r['first_name']} {$r['last_name']} removed with database/delete-sa.php"]);
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "Nothing was deleted: " . $e->getMessage() . "\n");
    exit(1);
}

echo "\nDone. " . $pdo->query('SELECT COUNT(*) FROM sa_profiles')->fetchColumn() . " S.A. left on the roster.\n";
