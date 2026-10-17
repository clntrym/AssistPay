<?php
// Gives every registered S.A. a believable class schedule, so Schedule Matching
// has something real to work with while it is being tried out.
//
//   php database/seed-class-schedules.php            writes the schedules
//   php database/seed-class-schedules.php --dry-run  shows what it would write
//
// Three S.A.s are left without one on purpose, so the "no class schedule yet"
// path stays visible. An S.A. who already has a schedule is never touched.
require __DIR__ . '/../config/config.php';
require __DIR__ . '/../api/_sa.php';

const SKIP_STUDENT_IDS = ['2026-44772', '2024-58030', '2024-58194'];   // Janice, Daizy, Cleint

// Three-hour teaching blocks, the way the room workbook uses them
const BLOCKS = [['07:00:00', '10:00:00'], ['10:00:00', '13:00:00'],
                ['13:00:00', '16:00:00'], ['16:00:00', '19:00:00']];
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Subject prefixes per course, so the codes read like the real ones
const PREFIXES = [
    'BSIT' => 'IT', 'BSCS' => 'CS', 'BSCpE' => 'CPE', 'BSECE' => 'ECE', 'BSIE' => 'IE',
    'BSBA' => 'BA', 'BSA' => 'ACC', 'BSHM' => 'HM', 'BSTM' => 'TM', 'BSPsy' => 'PSY',
    'BSCrim' => 'CRIM', 'BSEd' => 'EDUC', 'BEEd' => 'EEd',
];

$dryRun = in_array('--dry-run', $argv, true);
mt_srand(20260927);

$semester = $pdo->query('SELECT * FROM semesters WHERE status = "ACTIVE" ORDER BY start_date DESC LIMIT 1')->fetch();
if (!$semester) exit("No active semester. Set one in Scheduling > Semester Setup first.\n");

$coordinator = (int) $pdo->query('SELECT id FROM users WHERE role = "ADMIN" ORDER BY id LIMIT 1')->fetchColumn();
$stmt = $pdo->prepare(
    'SELECT p.id, p.student_id, p.first_name, p.last_name, p.course, p.year_level,
            (SELECT COUNT(*) FROM class_schedules c WHERE c.sa_profile_id = p.id AND c.semester_id = ?) AS rows_now
       FROM sa_profiles p
      WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL
      ORDER BY p.last_name, p.first_name'
);
$stmt->execute([$semester['id']]);

$insert = $pdo->prepare(
    'INSERT IGNORE INTO class_schedules (semester_id, sa_profile_id, student_id, day_of_week, start_time, end_time, subject, section, imported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

$written = 0;
$given = 0;
$skipped = [];

foreach ($stmt as $sa) {
    if (in_array($sa['student_id'], SKIP_STUDENT_IDS, true)) {
        $skipped[] = "{$sa['first_name']} {$sa['last_name']} (left without one on purpose)";
        continue;
    }
    if ((int) $sa['rows_now'] > 0) {
        $skipped[] = "{$sa['first_name']} {$sa['last_name']} (already has {$sa['rows_now']} period(s))";
        continue;
    }

    // Four or five class days, one or two blocks each: 15 to 21 hours a week,
    // which still leaves whole afternoons or mornings free for duty.
    $days = DAYS;
    shuffle($days);
    $days = array_slice($days, 0, mt_rand(4, 5));
    sort($days);

    $prefix = PREFIXES[$sa['course']] ?? 'GE';
    $section = sprintf('%s - %d%s%d', $sa['course'], $sa['year_level'], chr(65 + mt_rand(0, 3)), mt_rand(1, 4));
    $periods = [];

    foreach ($days as $day) {
        $slots = [0, 1, 2, 3];
        shuffle($slots);
        foreach (array_slice($slots, 0, mt_rand(1, 2)) as $slot) {
            [$start, $end] = BLOCKS[$slot];
            $periods[] = [$day, $start, $end,
                          sprintf('%s %d%02d', $prefix, $sa['year_level'], mt_rand(1, 12))];
        }
    }

    if ($dryRun) {
        printf("%-12s %-26s %-6s %2d period(s): %s\n", $sa['student_id'],
            $sa['first_name'] . ' ' . $sa['last_name'], $sa['course'], count($periods),
            implode(', ', array_map(fn($p) => $p[0] . ' ' . substr($p[1], 0, 5), $periods)));
        $given++;
        $written += count($periods);
        continue;
    }

    foreach ($periods as [$day, $start, $end, $subject]) {
        $insert->execute([$semester['id'], $sa['id'], $sa['student_id'], $day, $start, $end, $subject, $section, $coordinator ?: null]);
        $written += $insert->rowCount();
    }
    $given++;
}

printf("\n%s %d class period(s) for %d S.A.(s) in %s\n",
    $dryRun ? 'Would write' : 'Wrote', $written, $given, semester_label($semester));
foreach ($skipped as $line) echo "  skipped: $line\n";
