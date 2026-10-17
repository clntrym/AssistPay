<?php
// Scheduling setup API (Step 5). All requests: POST + CSRF token, Coordinator only.
//
//   semesters / semester_save / semester_activate / semester_delete
//   class_list / class_preview / class_import / class_save / class_archive / class_delete / class_clear
//   duty_preferences_save
//   room_list
//   rooms_overview / rooms_import / room_utilization / rooms_setup_save
//   office_list / office_save / office_delete
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_sa.php';
require __DIR__ . '/_scheduling.php';
require __DIR__ . '/_matching.php';
require_once __DIR__ . '/_violations.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
require_role($user, 'ADMIN', 'REGISTRAR');
$in = input();
$action = $in['action'] ?? '';

$semesterList = function () use ($pdo) {
    // Auto-sync academic_terms from Registrar
    try {
        $terms = $pdo->query("SELECT * FROM academic_terms")->fetchAll();
        foreach ($terms as $t) {
            $ay = str_replace(['–', '—', '−'], '-', trim($t['school_year']));
            $rawSem = $t['semester'];
            $term = '1ST';
            if (str_contains(strtolower($rawSem), '2')) $term = '2ND';
            elseif (str_contains(strtolower($rawSem), 'summer')) $term = 'SUMMER';

            $status = !empty($t['is_active']) ? 'ACTIVE' : 'PLANNED';
            $startDate = substr($ay, 0, 4) . ($term === '1ST' ? '-08-01' : ($term === '2ND' ? '-01-15' : '-06-01'));
            $endDate = ($term === '1ST' ? substr($ay, 0, 4) . '-12-30' : ($term === '2ND' ? (int)substr($ay, 0, 4) + 1 . '-05-30' : (int)substr($ay, 0, 4) + 1 . '-07-30'));

            $check = $pdo->prepare("SELECT id FROM semesters WHERE REPLACE(REPLACE(REPLACE(academic_year, '–', '-'), '—', '-'), '−', '-') = ? AND term = ?");
            $check->execute([$ay, $term]);
            $semId = $check->fetchColumn();

            if (!$semId) {
                $ins = $pdo->prepare("INSERT INTO semesters (academic_year, term, start_date, end_date, status, required_sa) VALUES (?, ?, ?, ?, ?, 80)");
                $ins->execute([$ay, $term, $startDate, $endDate, $status]);
                $semId = $pdo->lastInsertId();
                $pdo->prepare("INSERT IGNORE INTO allowance_rates (semester_id, hourly_rate) VALUES (?, 8.00)")->execute([$semId]);
                ensure_violation_settings($pdo, (int) $semId);
            }
        }
    } catch (Throwable $e) {}

    $rows = $pdo->query(
        'SELECT s.*, r.hourly_rate,
                (SELECT COUNT(*) FROM class_schedules c WHERE c.semester_id = s.id) AS class_count,
                (SELECT COUNT(*) FROM room_requirements q WHERE q.semester_id = s.id) AS room_count,
                (SELECT COUNT(*) FROM office_requirements o WHERE o.semester_id = s.id) AS office_count,
                (SELECT COUNT(*) FROM sa_profiles p WHERE p.semester_id = s.id) AS sa_count,
                (SELECT COUNT(*) FROM sa_profiles p WHERE p.semester_id = s.id
                   AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL) AS active_sa_count
           FROM semesters s
           LEFT JOIN allowance_rates r ON r.semester_id = s.id
          ORDER BY s.start_date DESC'
    )->fetchAll();
    return array_map(fn($s) => format_semester($s) + [
        'counts' => [
            'classes' => (int) $s['class_count'], 'rooms' => (int) $s['room_count'],
            'offices' => (int) $s['office_count'], 'sas' => (int) $s['sa_count'],
            'activeSas' => (int) $s['active_sa_count'],
        ],
    ], $rows);
};

switch ($action) {

// ---------------------------------------------------------------- SEMESTERS
case 'semesters':
    respond(['success' => true, 'semesters' => $semesterList()]);

case 'semester_save':
    $id = (int) ($in['id'] ?? 0);
    $ay = str_replace(['–', '—', '−'], '-', trim((string) ($in['academicYear'] ?? '')));
    $term = strtoupper(trim((string) ($in['term'] ?? '')));
    $start = trim((string) ($in['startDate'] ?? ''));
    $end = trim((string) ($in['endDate'] ?? ''));
    $status = strtoupper(trim((string) ($in['status'] ?? 'PLANNED')));
    $requiredSa = $in['requiredSa'] ?? '';

    $e = [];
    if (!preg_match('/^(\d{4})-(\d{4})$/', $ay, $m) || (int) $m[2] !== (int) $m[1] + 1) {
        $e['academicYear'] = 'Use two consecutive years, like 2026-2027.';
    }
    if (!in_array($term, ['1ST', '2ND', 'SUMMER'], true)) $e['term'] = 'Choose a term.';
    if (!valid_date($start)) $e['startDate'] = 'Enter the start date.';
    if (!valid_date($end)) $e['endDate'] = 'Enter the end date.';
    elseif (valid_date($start) && $end <= $start) $e['endDate'] = 'Must be after the start date.';
    if (!in_array($status, ['PLANNED', 'ACTIVE', 'CLOSED'], true)) $e['status'] = 'Choose a status.';
    if ($requiredSa === '' || $requiredSa === null) {
        $e['requiredSa'] = 'Say how many S.A.s this semester needs.';
    } elseif (!is_numeric($requiredSa) || (float) $requiredSa != (int) $requiredSa) {
        $e['requiredSa'] = 'Enter a whole number of S.A.s.';
    } elseif ((int) $requiredSa < 1 || (int) $requiredSa > 1000) {
        $e['requiredSa'] = 'Enter 1 to 1,000 S.A.s.';
    }

    if (!$e) {
        $dup = $pdo->prepare("SELECT COUNT(*) FROM semesters WHERE REPLACE(REPLACE(REPLACE(academic_year, '–', '-'), '—', '-'), '−', '-') = ? AND term = ? AND id <> ?");
        $dup->execute([$ay, $term, $id]);
        if ($dup->fetchColumn()) $e['term'] = 'This semester already exists.';
    }
    if ($e) fail('Check the highlighted fields.', 422, ['errors' => $e]);

    ensure_violation_schema($pdo);
    $pdo->beginTransaction();
    try {
        if ($status === 'ACTIVE') {
            $pdo->prepare('UPDATE semesters SET status = "CLOSED" WHERE status = "ACTIVE" AND id <> ?')->execute([$id]);
        }
        if ($id) {
            $pdo->prepare('UPDATE semesters SET academic_year = ?, term = ?, start_date = ?, end_date = ?, status = ?, required_sa = ? WHERE id = ?')
                ->execute([$ay, $term, $start, $end, $status, (int) $requiredSa, $id]);
        } else {
            $pdo->prepare('INSERT INTO semesters (academic_year, term, start_date, end_date, status, required_sa) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$ay, $term, $start, $end, $status, (int) $requiredSa]);
            $id = (int) $pdo->lastInsertId();
        }
        // Every semester starts at the standard rate; an S.A. who is paid
        // differently carries their own rate on their record.
        $pdo->prepare(
            'INSERT IGNORE INTO allowance_rates (semester_id, hourly_rate, created_by) VALUES (?, ?, ?)'
        )->execute([$id, DEFAULT_HOURLY_RATE, $user['id']]);
        ensure_violation_settings($pdo, $id, (int) $user['id']);
        audit($in['id'] ?? 0 ? 'SEMESTER_UPDATED' : 'SEMESTER_CREATED', "$ay $term, status $status, needs $requiredSa S.A.");
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        error_log('Semester save failed: ' . $ex->getMessage());
        fail('The semester could not be saved. Try again.', 500);
    }
    respond(['success' => true, 'semesters' => $semesterList(), 'semesterId' => $id]);

case 'semester_activate':
    $id = (int) ($in['id'] ?? 0);
    $stmt = $pdo->prepare('SELECT * FROM semesters WHERE id = ?');
    $stmt->execute([$id]);
    $sem = $stmt->fetch() ?: fail('Semester not found.', 404);

    ensure_violation_schema($pdo);
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE semesters SET status = "CLOSED" WHERE status = "ACTIVE" AND id <> ?')->execute([$id]);
    $pdo->prepare('UPDATE semesters SET status = "ACTIVE" WHERE id = ?')->execute([$id]);
    ensure_violation_settings($pdo, $id, (int) $user['id']);
    audit('SEMESTER_ACTIVATED', semester_label($sem));
    $pdo->commit();
    respond(['success' => true, 'semesters' => $semesterList()]);

case 'semester_delete':
    $id = (int) ($in['id'] ?? 0);
    $stmt = $pdo->prepare('SELECT * FROM semesters WHERE id = ?');
    $stmt->execute([$id]);
    $sem = $stmt->fetch() ?: fail('Semester not found.', 404);

    $used = $pdo->prepare('SELECT (SELECT COUNT(*) FROM sa_profiles WHERE semester_id = ?) + (SELECT COUNT(*) FROM class_schedules WHERE semester_id = ?)
                                + (SELECT COUNT(*) FROM room_requirements WHERE semester_id = ?) + (SELECT COUNT(*) FROM office_requirements WHERE semester_id = ?)');
    $used->execute([$id, $id, $id, $id]);
    if ((int) $used->fetchColumn() > 0) {
        fail('This semester already has records. Close it instead of deleting it.', 409);
    }
    $pdo->prepare('DELETE FROM allowance_rates WHERE semester_id = ?')->execute([$id]);
    $pdo->prepare('DELETE FROM semesters WHERE id = ?')->execute([$id]);
    audit('SEMESTER_DELETED', semester_label($sem));
    respond(['success' => true, 'semesters' => $semesterList()]);

// ---------------------------------------------------------- CLASS SCHEDULES
case 'class_list':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    sync_all_active_sas_from_registrar($sem['id']);
    $stmt = $pdo->prepare(
        'SELECT c.*, p.first_name, p.last_name, p.course, p.year_level
           FROM class_schedules c JOIN sa_profiles p ON p.id = c.sa_profile_id
          WHERE c.semester_id = ? AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL AND c.archived_at IS NULL
          ORDER BY p.last_name, p.first_name, FIELD(c.day_of_week, "MON","TUE","WED","THU","FRI","SAT","SUN"), c.start_time'
    );
    $stmt->execute([$sem['id']]);
    $items = array_map(fn($c) => [
        'id' => (int) $c['id'],
        'archived' => $c['archived_at'] !== null,
        'saProfileId' => (int) $c['sa_profile_id'],
        'studentId' => $c['student_id'],
        'name' => $c['first_name'] . ' ' . $c['last_name'],
        'course' => $c['course'],
        'yearLevel' => (int) $c['year_level'],
        'day' => $c['day_of_week'],
        'startTime' => format_time($c['start_time']),
        'endTime' => format_time($c['end_time']),
        'subject' => $c['subject'],
        'section' => $c['section'],
    ], $stmt->fetchAll());

    $covered = $pdo->prepare('SELECT COUNT(DISTINCT c.sa_profile_id) FROM class_schedules c JOIN sa_profiles p ON p.id = c.sa_profile_id
                                WHERE c.semester_id = ? AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL AND c.archived_at IS NULL');
    $covered->execute([$sem['id']]);
    respond(['success' => true, 'semester' => $sem, 'items' => $items,
             'saWithSchedule' => (int) $covered->fetchColumn(),
             'saTotal' => (int) $pdo->query('SELECT COUNT(*) FROM sa_profiles WHERE sa_status = "ACTIVE" AND archived_at IS NULL')->fetchColumn()]);

case 'class_preview':
case 'class_import':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    // Two sources, one validator: a CSV file, or rows an Excel file already
    // produced in the browser (Class Schedules > duty form import).
    if (isset($in['rows'])) {
        if (!is_array($in['rows'])) fail('No class rows were sent.', 422);
        [$rows, $readError] = read_rows($in['rows'], CLASS_COLUMNS);
    } else {
        [$rows, $readError] = read_csv((string) ($in['csv'] ?? ''), CLASS_COLUMNS);
    }
    if ($readError) fail($readError, 422);
    if (!$rows) fail('The file has no data rows.', 422);

    $checked = check_class_rows($rows, $sem['id']);
    $summary = import_summary($checked);

    if ($action === 'class_preview') {
        respond(['success' => true, 'semester' => $sem, 'summary' => $summary, 'rows' => $checked]);
    }

    $insert = $pdo->prepare(
        'INSERT INTO class_schedules (semester_id, sa_profile_id, student_id, day_of_week, start_time, end_time, subject, section, imported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE end_time = VALUES(end_time), section = VALUES(section), archived_at = NULL'
    );
    $imported = 0;
    $pdo->beginTransaction();
    foreach ($checked as $r) {
        if ($r['status'] !== 'VALID') continue;
        $insert->execute([$sem['id'], $r['saProfileId'], $r['studentId'], $r['day'], $r['startTime'], $r['endTime'],
                          $r['subject'], $r['section'] ?: null, $user['id']]);
        $imported += $insert->rowCount();
    }
    audit('CLASS_SCHEDULE_IMPORTED', "{$sem['label']}: $imported imported, {$summary['warnings']} skipped, {$summary['errors']} errors");
    $pdo->commit();
    respond(['success' => true, 'imported' => $imported, 'summary' => $summary,
             'clashes' => duty_class_clashes($sem['id'])]);

case 'class_save':
    if ($user['role'] !== 'REGISTRAR' && $user['role'] !== 'ADMIN') {
        fail('Only the Registrar can modify class schedules.', 403);
    }
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $id = (int) ($in['id'] ?? 0);
    $profileId = (int) ($in['saProfileId'] ?? 0);
    $stmt = $pdo->prepare('SELECT id, student_id, first_name, last_name FROM sa_profiles WHERE id = ?');
    $stmt->execute([$profileId]);
    $profile = $stmt->fetch();

    $day = parse_day((string) ($in['day'] ?? ''));
    $start = parse_time((string) ($in['startTime'] ?? ''));
    $end = parse_time((string) ($in['endTime'] ?? ''));
    $subject = trim((string) ($in['subject'] ?? ''));
    $section = trim((string) ($in['section'] ?? ''));

    $e = [];
    if (!$profile) $e['saProfileId'] = 'Choose the S.A.';
    if (!$day) $e['day'] = 'Choose a day.';
    if (!$start) $e['startTime'] = 'Enter the start time.';
    if (!$end) $e['endTime'] = 'Enter the end time.';
    elseif ($start && $end <= $start) $e['endTime'] = 'Must be after the start time.';
    if ($subject === '') $e['subject'] = 'Enter the subject or subject code.';
    elseif (mb_strlen($subject) > 60) $e['subject'] = 'Use 60 characters or fewer.';
    if (mb_strlen($section) > 40) $e['section'] = 'Use 40 characters or fewer.';

    if (!$e) {
        // The S.A. can't be in two classes at once
        $clash = $pdo->prepare(
            'SELECT subject, start_time, end_time FROM class_schedules
              WHERE semester_id = ? AND sa_profile_id = ? AND day_of_week = ? AND id <> ?
                AND archived_at IS NULL AND ? < end_time AND ? > start_time LIMIT 1'
        );
        $clash->execute([$sem['id'], $profileId, $day, $id, $start, $end]);
        if ($row = $clash->fetch()) {
            $e['startTime'] = 'Overlaps ' . $row['subject'] . ' (' . format_time($row['start_time'])
                . ' – ' . format_time($row['end_time']) . ').';
        }
    }
    if ($e) fail('Check the highlighted fields.', 422, ['errors' => $e]);

    // A class schedule only changes on someone's word, so the paper that says
    // so is filed with the change.
    [$doc, $reason] = require_change_proof($in);
    $detail = $subject . ($section ? ' ' . $section : '') . ' ' . DAYS[$day] . ' '
            . format_time($start) . ' - ' . format_time($end);

    $pdo->beginTransaction();
    try {
        if ($id) {
            $pdo->prepare(
                'UPDATE class_schedules SET sa_profile_id = ?, student_id = ?, day_of_week = ?, start_time = ?,
                        end_time = ?, subject = ?, section = ?, archived_at = NULL WHERE id = ? AND semester_id = ?'
            )->execute([$profileId, $profile['student_id'], $day, $start, $end, $subject, $section ?: null, $id, $sem['id']]);
            $classId = $id;
            audit('CLASS_SCHEDULE_UPDATED', "{$profile['student_id']} $detail; reason: $reason");
        } else {
            $pdo->prepare(
                'INSERT INTO class_schedules (semester_id, sa_profile_id, student_id, day_of_week, start_time, end_time, subject, section, imported_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE end_time = VALUES(end_time), section = VALUES(section), archived_at = NULL'
            )->execute([$sem['id'], $profileId, $profile['student_id'], $day, $start, $end, $subject, $section ?: null, $user['id']]);
            $classId = (int) $pdo->lastInsertId() ?: null;
            audit('CLASS_SCHEDULE_ADDED', "{$profile['student_id']} $detail; reason: $reason");
        }
        save_change_proof($doc, $reason, $sem['id'], $profileId, $classId,
                          $id ? 'UPDATED' : 'ADDED', $detail, (int) $user['id']);
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        fail('The change was not saved: ' . $ex->getMessage(), 500);
    }

    $clashes = duty_class_clashes($sem['id'], $profileId);
    $saName = trim(($profile['first_name'] ?? '') . ' ' . ($profile['last_name'] ?? ''));
    $clashNotice = !empty($clashes) ? ' [WARNING: Conflict detected with current duty schedule!]' : '';
    $notifMsg = "The Registrar updated the class schedule of {$saName} ({$detail}). Reason: {$reason}.{$clashNotice} Please check the duty schedule for possible conflicts.";

    $admins = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN'")->fetchAll(PDO::FETCH_COLUMN);
    $targetLink = '#/admin/sa-management/' . (int) $profileId . '?tab=CLASSES';
    foreach ($admins as $adminId) {
        $pdo->prepare('
            INSERT INTO notifications (user_id, sender_id, type, title, message, link, is_read, created_at)
            VALUES (?, ?, "CLASS_SCHEDULE_CHANGED", "Class Schedule Updated by Registrar", ?, ?, 0, NOW())
        ')->execute([$adminId, $user['id'], $notifMsg, $targetLink]);
    }

    respond(['success' => true, 'clashes' => $clashes]);

case 'duty_preferences_save':
    // The yellow blocks of the duty form: the hours an S.A. asked for. Matching
    // leans towards them when it ranks candidates, but the Coordinator still
    // decides, so these are stored apart from the schedule itself.
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $raw = (array) ($in['preferences'] ?? []);
    if (count($raw) > MAX_IMPORT_ROWS) fail('Too many rows in one go.', 422);

    $profiles = [];
    foreach ($pdo->query('SELECT id, student_id FROM sa_profiles') as $p) {
        $profiles[strtoupper($p['student_id'])] = (int) $p['id'];
    }

    $wanted = [];
    $skipped = 0;
    foreach ($raw as $row) {
        if (!is_array($row)) { $skipped++; continue; }
        $profileId = $profiles[strtoupper(trim((string) ($row['studentId'] ?? '')))] ?? null;
        $day = parse_day((string) ($row['day'] ?? ''));
        $start = parse_time((string) ($row['startTime'] ?? ''));
        $end = parse_time((string) ($row['endTime'] ?? ''));
        if (!$profileId || !$day || !$start || !$end || $end <= $start) { $skipped++; continue; }
        if (isset($wanted[$profileId][$day])) { $skipped++; continue; }
        $wanted[$profileId][$day] = [$day, $start, $end];
    }
    if (!$wanted) fail('No duty hours could be read from this file.', 422);

    $pdo->beginTransaction();
    try {
        $clear = $pdo->prepare('DELETE FROM duty_preferences WHERE semester_id = ? AND sa_profile_id = ?');
        $insert = $pdo->prepare(
            'INSERT IGNORE INTO duty_preferences (semester_id, sa_profile_id, day_of_week, start_time, end_time, imported_by)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $saved = 0;
        foreach ($wanted as $profileId => $blocks) {
            $clear->execute([$sem['id'], $profileId]);        // the newest form replaces the old wish
            foreach ($blocks as [$day, $start, $end]) {
                $insert->execute([$sem['id'], $profileId, $day, $start, $end, $user['id']]);
                $saved += $insert->rowCount();
            }
        }
        audit('DUTY_PREFERENCES_SAVED', sprintf('%s: %d S.A.(s), %d block(s)', $sem['label'], count($wanted), $saved));
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        error_log('Duty preferences failed: ' . $ex->getMessage());
        fail('The duty hours could not be saved. Try again.', 500);
    }

    respond(['success' => true, 'saved' => $saved, 'students' => count($wanted), 'skipped' => $skipped]);

case 'list_plotted_reviews':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $statusFilter = $in['status'] ?? null;

    $sql = '
        SELECT p.id, p.student_id, p.first_name, p.last_name, p.course, p.year_level,
               p.sa_category, p.department_type, p.weekly_target_hours, o.name AS office_name,
               dp.id AS pref_id, dp.day_of_week, dp.start_time, dp.end_time,
               dp.review_status, dp.reviewed_at, dp.review_notes, dp.created_at,
               dp.reason_category, dp.reason_details, dp.proposed_classes_json,
               u.full_name AS reviewer_name
          FROM duty_preferences dp
          JOIN sa_profiles p ON p.id = dp.sa_profile_id
     LEFT JOIN offices o ON o.id = p.office_id
     LEFT JOIN users u ON u.id = dp.reviewed_by
         WHERE dp.semester_id = ?
         ORDER BY dp.created_at DESC, FIELD(dp.day_of_week, "MON","TUE","WED","THU","FRI","SAT","SUN"), dp.start_time
    ';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$sem['id']]);
    $raw = $stmt->fetchAll();

    $bySa = [];
    foreach ($raw as $r) {
        $saId = (int) $r['id'];
        $isOffice = ($r['sa_category'] === 'OFFICE' || $r['department_type'] === 'OFFICE' || !empty($r['office_name']));
        $s = mins($r['start_time']);
        $e = mins($r['end_time']);
        $rawHrs = round(($e - $s) / 60, 1);

        if (!isset($bySa[$saId])) {
            $bySa[$saId] = [
                'saProfileId' => $saId,
                'studentId' => $r['student_id'],
                'name' => $r['first_name'] . ' ' . $r['last_name'],
                'course' => $r['course'],
                'yearLevel' => (int) $r['year_level'],
                'category' => $r['sa_category'],
                'officeName' => $r['office_name'] ?: 'Not assigned',
                'isOffice' => $isOffice,
                'targetHours' => (float) ($r['weekly_target_hours'] ?: min_weekly_hours()),
                'reviewStatus' => $r['review_status'] ?? 'PENDING',
                'reviewedAt' => $r['reviewed_at'],
                'reviewerName' => $r['reviewer_name'],
                'reviewNotes' => $r['review_notes'],
                'reasonCategory' => $r['reason_category'] ?? null,
                'reasonDetails' => $r['reason_details'] ?? null,
                'proposedClasses' => !empty($r['proposed_classes_json']) ? json_decode($r['proposed_classes_json'], true) : null,
                'submittedAt' => $r['created_at'],
                'blocks' => [],
                'totalHours' => 0.0,
            ];
        }

        if ($r['review_status'] === 'PENDING') {
            $bySa[$saId]['reviewStatus'] = 'PENDING';
        }

        $bySa[$saId]['blocks'][] = [
            'id' => (int) $r['pref_id'],
            'day' => $r['day_of_week'],
            'start' => $s,
            'end' => $e,
            'startLabel' => format_time($r['start_time']),
            'endLabel' => format_time($r['end_time']),
            'rawHours' => $rawHrs,
            'hours' => $rawHrs,
            'credited' => $rawHrs,
            'hasBreak' => false,
            'reviewStatus' => $r['review_status'],
            'coversLunch' => ($s < 780 && $e > 720),
            'isHalfDaySat' => ($isOffice && strtoupper(substr(trim($r['day_of_week']), 0, 3)) === 'SAT'),
        ];
    }

    foreach ($bySa as $saId => &$saData) {
        $saData['blocks'] = credit_once_per_day($saData['blocks'], !empty($saData['isOffice']));
        foreach ($saData['blocks'] as &$blk) {
            $blk['hours'] = $blk['credited'];
        }
        unset($blk);
        $saData['totalHours'] = round(array_sum(array_column($saData['blocks'], 'credited')), 1);
    }
    unset($saData);

    // Fetch enrolled classes for each SA to render visual schedule grid
    $saIds = array_keys($bySa);
    if (!empty($saIds)) {
        $inPlaceholders = implode(',', array_fill(0, count($saIds), '?'));
        $classStmt = $pdo->prepare("
            SELECT sa_profile_id, id, day_of_week, start_time, end_time, subject, section
              FROM class_schedules
             WHERE semester_id = ? AND archived_at IS NULL AND sa_profile_id IN ($inPlaceholders)
             ORDER BY FIELD(day_of_week, 'MON','TUE','WED','THU','FRI','SAT','SUN'), start_time
        ");
        $classStmt->execute(array_merge([$sem['id']], $saIds));
        $classRows = $classStmt->fetchAll();
        foreach ($classRows as $c) {
            $sid = (int) $c['sa_profile_id'];
            if (isset($bySa[$sid])) {
                if (!isset($bySa[$sid]['classes'])) {
                    $bySa[$sid]['classes'] = [];
                }
                $bySa[$sid]['classes'][] = [
                    'id' => (int) $c['id'],
                    'day' => $c['day_of_week'],
                    'start' => mins($c['start_time']),
                    'end' => mins($c['end_time']),
                    'startLabel' => format_time($c['start_time']),
                    'endLabel' => format_time($c['end_time']),
                    'startTime' => $c['start_time'],
                    'endTime' => $c['end_time'],
                    'subject' => $c['subject'],
                    'section' => $c['section'],
                    'hours' => round((mins($c['end_time']) - mins($c['start_time'])) / 60, 1),
                ];
            }
        }
    }
    foreach ($bySa as &$item) {
        if (!isset($item['classes'])) {
            $item['classes'] = [];
        }
    }
    unset($item);

    $list = array_values($bySa);
    if ($statusFilter && $statusFilter !== 'ALL') {
        $list = array_values(array_filter($list, fn($item) => $item['reviewStatus'] === $statusFilter));
    }

    respond([
        'success' => true,
        'semester' => $sem,
        'submissions' => $list,
        'pendingCount' => count(array_filter($bySa, fn($item) => $item['reviewStatus'] === 'PENDING')),
    ]);

case 'review_plotted_duty':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $saProfileId = (int) ($in['saProfileId'] ?? 0);
    $status = strtoupper(trim((string) ($in['status'] ?? '')));
    $notes = trim((string) ($in['notes'] ?? ''));

    if (!in_array($status, ['APPROVED', 'REJECTED', 'PENDING'], true)) {
        fail('Please select a valid decision: APPROVED or REJECTED.', 422);
    }

    $saStmt = $pdo->prepare('SELECT p.*, u.id AS user_id FROM sa_profiles p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?');
    $saStmt->execute([$saProfileId]);
    $sa = $saStmt->fetch();
    if (!$sa) fail('Student assistant record not found.', 404);

    // If the SA is assigned to an office and their plotted duty is approved,
    // write their approved duty directly to schedule_assignments (OFFICE) so it flows straight to Finalize Schedule,
    // but strictly block if the office is already full (no over-staffing).
    if (!empty($sa['office_id']) && $status === 'APPROVED') {
        $offReqStmt = $pdo->prepare('SELECT r.id, r.required_sa, o.name FROM office_requirements r JOIN offices o ON o.id = r.office_id WHERE r.semester_id = ? AND r.office_id = ?');
        $offReqStmt->execute([$sem['id'], (int) $sa['office_id']]);
        $offReq = $offReqStmt->fetch();

        if ($offReq) {
            $cntStmt = $pdo->prepare('SELECT COUNT(*) FROM sa_profiles WHERE office_id = ? AND id <> ? AND sa_status = "ACTIVE" AND archived_at IS NULL AND assignment_status = "ASSIGNED"');
            $cntStmt->execute([(int) $sa['office_id'], $saProfileId]);
            if ((int) $cntStmt->fetchColumn() >= (int) $offReq['required_sa']) {
                fail($offReq['name'] . ' already has the required ' . $offReq['required_sa'] . ' S.A.(s) assigned. Over-staffing is not allowed.', 409);
            }
        }
    }

    $upd = $pdo->prepare('
        UPDATE duty_preferences
           SET review_status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
         WHERE semester_id = ? AND sa_profile_id = ?
    ');
    $upd->execute([$status, $user['id'], $notes, $sem['id'], $saProfileId]);

    if (!empty($sa['office_id']) && $status === 'APPROVED' && !empty($offReq)) {
        $pStmt = $pdo->prepare('SELECT day_of_week, start_time, end_time FROM duty_preferences WHERE semester_id = ? AND sa_profile_id = ? AND review_status = "APPROVED" ORDER BY FIELD(day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), start_time');
        $pStmt->execute([$sem['id'], $saProfileId]);
        $prefRows = $pStmt->fetchAll();
        if ($prefRows) {
            $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? AND requirement_type = "OFFICE"')
                ->execute([$sem['id'], $saProfileId]);
            $insOff = $pdo->prepare(
                'INSERT IGNORE INTO schedule_assignments (semester_id, sa_profile_id, requirement_type, office_requirement_id, department, location, supervisor_id, day_of_week, start_time, end_time, source)
                 VALUES (?, ?, "OFFICE", ?, "OFFICE", ?, ?, ?, ?, ?, "OFFICE")'
            );
            $supId = supervisor_for('OFFICE', (int) $sa['office_id']);
            foreach ($prefRows as $pr) {
                $insOff->execute([$sem['id'], $saProfileId, (int) $offReq['id'], $offReq['name'], $supId, $pr['day_of_week'], $pr['start_time'], $pr['end_time']]);
            }
            $pdo->prepare('UPDATE sa_profiles SET assignment_status = "ASSIGNED", department_type = "OFFICE" WHERE id = ?')
                ->execute([$saProfileId]);
        }
    }

    // If approved, sync proposed class schedules if submitted with the request
    if ($status === 'APPROVED') {
        $propStmt = $pdo->prepare('SELECT proposed_classes_json FROM duty_preferences WHERE semester_id = ? AND sa_profile_id = ? AND proposed_classes_json IS NOT NULL LIMIT 1');
        $propStmt->execute([$sem['id'], $saProfileId]);
        $propJson = $propStmt->fetchColumn();
        if ($propJson) {
            $propClasses = json_decode($propJson, true);
            if (is_array($propClasses) && count($propClasses) > 0) {
                $pdo->prepare('UPDATE class_schedules SET archived_at = NOW() WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NULL')
                    ->execute([$sem['id'], $saProfileId]);
                $insCls = $pdo->prepare('INSERT INTO class_schedules (semester_id, sa_profile_id, student_id, day_of_week, start_time, end_time, subject, section, imported_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
                foreach ($propClasses as $pc) {
                    $cDay = strtoupper(trim((string) ($pc['day'] ?? '')));
                    $cStart = parse_time((string) ($pc['startTime'] ?? ''));
                    $cEnd = parse_time((string) ($pc['endTime'] ?? ''));
                    $cSubj = trim((string) ($pc['subject'] ?? ''));
                    $cSec = trim((string) ($pc['section'] ?? ''));
                    if ($cDay && $cStart && $cEnd && $cSubj) {
                        $insCls->execute([$sem['id'], $saProfileId, $sa['student_id'], $cDay, $cStart, $cEnd, $cSubj, $cSec ?: null, $user['id']]);
                    }
                }
            }
        }

        // Also sync updated duty schedule into schedule_assignments if previously assigned in room/office
        $prefApprovedStmt = $pdo->prepare('SELECT day_of_week, start_time, end_time FROM duty_preferences WHERE semester_id = ? AND sa_profile_id = ? AND review_status = "APPROVED" ORDER BY FIELD(day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), start_time');
        $prefApprovedStmt->execute([$sem['id'], $saProfileId]);
        $approvedBlocks = $prefApprovedStmt->fetchAll();

        if ($approvedBlocks && empty($sa['office_id'])) {
            $existingAssignStmt = $pdo->prepare('SELECT requirement_type, room_requirement_id, office_requirement_id, department, location, supervisor_id FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? LIMIT 1');
            $existingAssignStmt->execute([$sem['id'], $saProfileId]);
            $existingAssign = $existingAssignStmt->fetch();

            if ($existingAssign) {
                $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ?')
                    ->execute([$sem['id'], $saProfileId]);
                $insNew = $pdo->prepare(
                    'INSERT IGNORE INTO schedule_assignments (semester_id, sa_profile_id, requirement_type, room_requirement_id, office_requirement_id, department, location, supervisor_id, day_of_week, start_time, end_time, source)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "CHANGE")'
                );
                foreach ($approvedBlocks as $ab) {
                    $insNew->execute([
                        $sem['id'],
                        $saProfileId,
                        $existingAssign['requirement_type'],
                        $existingAssign['room_requirement_id'] ?: null,
                        $existingAssign['office_requirement_id'] ?: null,
                        $existingAssign['department'],
                        $existingAssign['location'],
                        $existingAssign['supervisor_id'],
                        $ab['day_of_week'],
                        $ab['start_time'],
                        $ab['end_time']
                    ]);
                }
            }
        }
    }

    $saName = $sa['first_name'] . ' ' . $sa['last_name'];
    audit('SA_PLOTTED_DUTY_REVIEWED', "Coordinator {$user['full_name']} set {$sa['student_id']} ({$saName}) plotted duty to {$status}. Notes: {$notes}");

    // Send in-app notification to the SA
    if (!empty($sa['user_id'])) {
        if ($status === 'APPROVED') {
            create_notification(
                (int) $sa['user_id'],
                'Plotted Duty Approved',
                "The S.A. Coordinator approved your plotted duty schedule and included it in the official recommendation for {$sem['label']}." . ($notes ? " Note: {$notes}" : ""),
                'DUTY_PLOT_APPROVED',
                '#/sa/schedule',
                (int) $user['id']
            );
        } elseif ($status === 'REJECTED') {
            create_notification(
                (int) $sa['user_id'],
                'Plotted Duty Not Included',
                "The S.A. Coordinator did not include your plotted duty schedule in the recommendation for {$sem['label']}." . ($notes ? " Reason: {$notes}" : " You may submit an alternative schedule if needed."),
                'DUTY_PLOT_REJECTED',
                '#/sa/schedule',
                (int) $user['id']
            );
        }
    }

    $statusMsg = match($status) {
        'APPROVED' => "Duty schedule of {$saName} approved.",
        'REJECTED' => "Duty schedule of {$saName} rejected.",
        'PENDING'  => "Duty schedule of {$saName} reset to pending review.",
        default    => "Decision saved."
    };
    respond([
        'success' => true,
        'message' => $statusMsg
    ]);

case 'class_archive':
    // Archiving keeps the schedule but takes it out of matching, which is what
    // the Coordinator wants when a schedule is outdated rather than wrong.
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $profileId = (int) ($in['saProfileId'] ?? 0);
    $restore = !empty($in['restore']);
    $stmt = $pdo->prepare('SELECT student_id, first_name, last_name FROM sa_profiles WHERE id = ?');
    $stmt->execute([$profileId]);
    $profile = $stmt->fetch() ?: fail('This S.A. record was not found.', 404);

    [$doc, $reason] = require_change_proof($in);

    $update = $pdo->prepare($restore
        ? 'UPDATE class_schedules SET archived_at = NULL WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NOT NULL'
        : 'UPDATE class_schedules SET archived_at = NOW() WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NULL');
    $update->execute([$sem['id'], $profileId]);
    $changed = $update->rowCount();
    if (!$changed) {
        fail($restore ? 'There is no archived schedule to restore.' : 'This S.A. has no schedule in use to archive.', 409);
    }
    save_change_proof($doc, $reason, $sem['id'], $profileId, null,
                      $restore ? 'RESTORED' : 'ARCHIVED',
                      ($restore ? 'Restored ' : 'Archived ') . $changed . ' class period(s)', (int) $user['id']);

    audit($restore ? 'CLASS_SCHEDULE_RESTORED' : 'CLASS_SCHEDULE_ARCHIVED',
          "{$profile['student_id']} {$profile['first_name']} {$profile['last_name']}: $changed period(s); reason: $reason");
    respond(['success' => true, 'changed' => $changed, 'clashes' => duty_class_clashes($sem['id'], $profileId)]);

case 'class_delete':
    if ($user['role'] !== 'REGISTRAR' && $user['role'] !== 'ADMIN') {
        fail('Only the Registrar can modify class schedules.', 403);
    }
    $stmt = $pdo->prepare('SELECT c.*, p.first_name, p.last_name FROM class_schedules c JOIN sa_profiles p ON p.id = c.sa_profile_id WHERE c.id = ?');
    $stmt->execute([(int) ($in['id'] ?? 0)]);
    $row = $stmt->fetch() ?: fail('Class schedule row not found.', 404);
    [$doc, $reason] = require_change_proof($in);

    $detail = $row['subject'] . ' ' . DAYS[$row['day_of_week']] . ' '
            . format_time($row['start_time']) . ' - ' . format_time($row['end_time']);

    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM class_schedules WHERE id = ?')->execute([$row['id']]);
        save_change_proof($doc, $reason, (int) $row['semester_id'], (int) $row['sa_profile_id'], null,
                          'DELETED', $detail, (int) $user['id']);
        audit('CLASS_SCHEDULE_DELETED', "{$row['student_id']} $detail; reason: $reason");
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        fail('The period was not removed: ' . $ex->getMessage(), 500);
    }

    $clashes = duty_class_clashes((int) $row['semester_id'], (int) $row['sa_profile_id']);
    $saName = trim($row['first_name'] . ' ' . $row['last_name']);
    $notifMsg = "The Registrar removed a class period of {$saName} ({$detail}). Reason: {$reason}. Please check the duty schedule for possible updates.";

    $admins = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN'")->fetchAll(PDO::FETCH_COLUMN);
    $targetLink = '#/admin/sa-management/' . (int) $row['sa_profile_id'] . '?tab=CLASSES';
    foreach ($admins as $adminId) {
        $pdo->prepare('
            INSERT INTO notifications (user_id, sender_id, type, title, message, link, is_read, created_at)
            VALUES (?, ?, "CLASS_SCHEDULE_CHANGED", "Class Schedule Removed by Registrar", ?, ?, 0, NOW())
        ')->execute([$adminId, $user['id'], $notifMsg, $targetLink]);
    }

    respond(['success' => true, 'clashes' => $clashes]);

// Everything filed for one S.A.: what changed, why, and the paper that says so.
case 'class_documents':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $profileId = (int) ($in['saProfileId'] ?? 0);
    if (!$profileId) fail('Which S.A.?', 422);
    respond(['success' => true, 'documents' => change_proofs($sem['id'], $profileId)]);

case 'class_clear':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $stmt = $pdo->prepare('DELETE FROM class_schedules WHERE semester_id = ?');
    $stmt->execute([$sem['id']]);
    audit('CLASS_SCHEDULE_CLEARED', "{$sem['label']}: {$stmt->rowCount()} rows");
    respond(['success' => true, 'deleted' => $stmt->rowCount()]);

// ------------------------------------------------------ ROOM / LAB SCHEDULES
case 'room_list':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $stmt = $pdo->prepare(
        'SELECT q.*, r.building, r.room_type
           FROM room_requirements q LEFT JOIN rooms r ON r.id = q.room_id
          WHERE q.semester_id = ?
          ORDER BY q.department_type, q.room, FIELD(q.day_of_week, "MON","TUE","WED","THU","FRI","SAT","SUN"), q.start_time'
    );
    $stmt->execute([$sem['id']]);
    $items = array_map(fn($r) => [
        'id' => (int) $r['id'],
        'roomId' => (int) ($r['room_id'] ?? 0),
        'departmentType' => $r['department_type'],
        'room' => $r['room'],
        'roomCount' => $r['room_ids'] ? count(explode(',', $r['room_ids'])) : 1,
        'building' => $r['building'],
        'roomType' => $r['room_type'],
        'day' => $r['day_of_week'],
        'startTime' => $r['start_time'],
        'endTime' => $r['end_time'],
        'startLabel' => format_time($r['start_time']),
        'endLabel' => format_time($r['end_time']),
        'hours' => time_span_hours($r['start_time'], $r['end_time']),
        'className' => $r['class_name'],
        'requiredSa' => (int) $r['required_sa'],
        'assignedSa' => 0,
        'notes' => $r['notes'],
    ], $stmt->fetchAll());
    respond(['success' => true, 'semester' => $sem, 'items' => $items]);

case 'office_list':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    ensure_assigned_office_schedules($sem['id']);
    $stmt = $pdo->prepare(
        'SELECT o.id AS office_id, o.code, o.name, o.is_active, r.id, r.required_sa, r.operating_start, r.operating_end,
                r.weekly_target_hours, r.notes,
                (SELECT COUNT(*) FROM sa_profiles p
                  WHERE p.office_id = o.id AND p.sa_status = "ACTIVE" AND p.assignment_status = "ASSIGNED") AS assigned
           FROM offices o
           LEFT JOIN office_requirements r ON r.office_id = o.id AND r.semester_id = ?
          ORDER BY o.is_active DESC, o.name ASC'
    );
    $stmt->execute([$sem['id']]);
    $items = array_map(function ($o) {
        $required = $o['required_sa'] !== null ? (int) $o['required_sa'] : null;
        $assigned = (int) $o['assigned'];
        return [
            'id' => $o['id'] ? (int) $o['id'] : null,
            'officeId' => (int) $o['office_id'],
            'code' => $o['code'],
            'name' => $o['name'],
            'isActive' => (bool) $o['is_active'],
            'requiredSa' => $required,
            'assignedSa' => $assigned,
            'vacant' => $required === null ? 0 : max(0, $required - $assigned),
            'operatingStart' => $o['operating_start'],
            'operatingEnd' => $o['operating_end'],
            'operatingLabel' => $o['operating_start'] ? format_time($o['operating_start']) . ' – ' . format_time($o['operating_end']) : null,
            'weeklyTargetHours' => $o['weekly_target_hours'] !== null ? (float) $o['weekly_target_hours'] : null,
            'notes' => $o['notes'],
        ];
    }, $stmt->fetchAll());
    respond(['success' => true, 'semester' => $sem, 'items' => $items, 'minWeekly' => min_weekly_hours(), 'maxWeekly' => hard_weekly_cap()]);

// Who holds this office now, and who the system would put in a vacant slot.
case 'office_staff':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    ensure_assigned_office_schedules($sem['id']);
    $reqId = (int) ($in['id'] ?? 0);
    $req = $pdo->prepare('SELECT r.*, o.name, o.code FROM office_requirements r
                            JOIN offices o ON o.id = r.office_id WHERE r.id = ? AND r.semester_id = ?');
    $req->execute([$reqId, $sem['id']]);
    $req = $req->fetch() ?: fail('Set the office requirement first.', 404);

    $openFrom = mins($req['operating_start']);
    $openTo = mins($req['operating_end']);
    $extFrom = min($openFrom, mins(OFFICE_EARLIEST));
    $extTo = max($openTo, mins(OFFICE_LATEST));
    $target = max(min_weekly_hours(), (float) $req['weekly_target_hours']);

    // ---- who is on it already
    $held = $pdo->prepare(
        'SELECT p.id, p.student_id, p.first_name, p.last_name, p.course, p.year_level, p.sa_category,
                a.id AS assignment_id, a.day_of_week, a.start_time, a.end_time, a.source
           FROM sa_profiles p
           LEFT JOIN schedule_assignments a ON a.sa_profile_id = p.id AND a.semester_id = ?
                                           AND a.office_requirement_id = ?
          WHERE p.office_id = ? AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL
            AND p.assignment_status = "ASSIGNED"
          ORDER BY p.last_name, p.first_name,
                   FIELD(a.day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), a.start_time'
    );
    $held->execute([$sem['id'], $reqId, (int) $req['office_id']]);

    $staff = [];
    foreach ($held as $r) {
        $id = (int) $r['id'];
        if (!isset($staff[$id])) {
            $staff[$id] = [
                'saId' => $id,
                'studentId' => $r['student_id'],
                'name' => $r['first_name'] . ' ' . $r['last_name'],
                'course' => $r['course'],
                'yearLevel' => (int) $r['year_level'],
                'category' => $r['sa_category'],
                'duty' => [],
                'spans' => [],
                'rows' => [],
            ];
        }
        if ($r['day_of_week']) {
            $staff[$id]['spans'][$r['day_of_week']][] = [mins($r['start_time']), mins($r['end_time'])];
            $staff[$id]['rows'][] = [
                'id' => (int) $r['assignment_id'],
                'day' => $r['day_of_week'],
                'startLabel' => format_time($r['start_time']),
                'endLabel' => format_time($r['end_time']),
                'hours' => round((mins($r['end_time']) - mins($r['start_time'])) / 60, 1),
            ];
        }
    }
    foreach ($staff as $id => $s) {
        $blocks = [];
        foreach ($s['spans'] as $day => $spans) {
            foreach (merge_spans($spans) as $sp) $blocks[] = duty_block($day, $sp[0], $sp[1], true);
        }
        $blocks = credit_once_per_day($blocks, true);
        $credited = round(array_sum(array_column($blocks, 'credited')), 1);
        unset($staff[$id]['spans']);
        $staff[$id]['duty'] = $blocks;
        $staff[$id]['creditedHours'] = $credited;
        $staff[$id]['dutyHours'] = round(array_sum(array_column($blocks, 'hours')), 1);
        $staff[$id]['belowMinimum'] = $credited < min_weekly_hours();
        $staff[$id]['scheduled'] = (bool) $blocks;
    }
    $staff = array_values($staff);
    $vacancies = max(0, (int) $req['required_sa'] - count($staff));

    // ---- and who could take a vacant slot
    $candidates = [];
    if ($vacancies) {
        $targetOfficeId = (int) $req['office_id'];
        foreach (office_pool($sem['id'], $targetOfficeId) as $id => $sa) {
            $conflicts = [];
            $banned = $sa['evalBanned'] ?? [];
            if (!empty($banned) && in_array('OFFICE', $banned, true)) {
                $conflicts[] = 'Banned from office by evaluation';
            }
            if (!empty($sa['retainOfficeId']) && (int) $sa['retainOfficeId'] !== $targetOfficeId) {
                $conflicts[] = 'Evaluated to retain in ' . ($sa['currentOfficeName'] ?? 'assigned office');
            }
            $saForCalc = $sa;
            $saForCalc['duty'] = []; // Evaluate schedule strictly against classes for this office
            ['pattern' => $pattern, 'hours' => $hours] = office_pattern($saForCalc, $openFrom, $openTo, $target);
            if (!$conflicts && $hours < MIN_OFFICE_BLOCK) $conflicts[] = 'No free window inside the office hours';

            $credited = $pattern ? credited_with($saForCalc, $pattern) : 0.0;
            if (!$conflicts && $credited > hard_weekly_cap()) $conflicts[] = 'Over the ' . hard_weekly_cap() . '-hour weekly cap';

            // Their classes can leave the office day too short. Then the duty may
            // start earlier or end later, and the page offers that as a choice.
            $extended = null;
            if (!$conflicts && $credited < min_weekly_hours()) {
                ['pattern' => $wide, 'hours' => $wideHours] = office_pattern($saForCalc, $extFrom, $extTo, $target);
                $wideCredited = $wide ? credited_with($saForCalc, $wide) : 0.0;
                if ($wideCredited > $credited && $wideCredited <= hard_weekly_cap()) {
                    $extended = [
                        'dutyHours' => $wideHours,
                        'creditedHours' => $wideCredited,
                        'belowMinimum' => $wideCredited < min_weekly_hours(),
                        'window' => format_time(hhmm($extFrom)) . ' - ' . format_time(hhmm($extTo)),
                        'pattern' => array_map(fn($p) => [
                            'day' => $p[0],
                            'startLabel' => format_time(hhmm($p[1])),
                            'endLabel' => format_time(hhmm($p[2])),
                            'hours' => round(($p[2] - $p[1]) / 60, 1),
                        ], $wide),
                    ];
                }
            }

            $prefFit = pattern_preference_fit($sa, $pattern);
            $score = candidate_score($sa, $hours, 'OFFICE', $targetOfficeId, $prefFit);
            if ($sa['category'] === 'OFFICE') $score += 25;
            if (!empty($sa['isCurrentlyAssigned'])) $score += 15;

            $candidates[] = [
                'saId' => $id,
                'extended' => $extended,
                'studentId' => $sa['studentId'],
                'name' => $sa['name'],
                'course' => $sa['course'],
                'yearLevel' => $sa['yearLevel'],
                'category' => $sa['category'],
                'currentHours' => round($sa['hours'], 1),
                'currentOfficeId' => $sa['currentOfficeId'] ?? null,
                'currentOfficeName' => $sa['currentOfficeName'] ?? null,
                'isCurrentlyAssigned' => !empty($sa['isCurrentlyAssigned']),
                'dutyHours' => $hours,
                'creditedHours' => $credited,
                'belowMinimum' => $credited < min_weekly_hours(),
                'eligible' => !$conflicts,
                'conflicts' => $conflicts,
                'pattern' => array_map(fn($p) => [
                    'day' => $p[0],
                    'startLabel' => format_time(hhmm($p[1])),
                    'endLabel' => format_time(hhmm($p[2])),
                    'hours' => round(($p[2] - $p[1]) / 60, 1),
                ], $pattern),
                'preference' => preference_note($sa, $prefFit),
                'score' => $conflicts ? 0 : $score,
            ];
        }
        usort($candidates, fn($a, $b) => [$b['eligible'], $b['score']] <=> [$a['eligible'], $a['score']]);
    }

    respond([
        'success' => true,
        'office' => ['id' => (int) $req['id'], 'officeId' => (int) $req['office_id'], 'name' => $req['name'],
                     'code' => $req['code'], 'requiredSa' => (int) $req['required_sa'],
                     'hours' => format_time($req['operating_start']) . ' - ' . format_time($req['operating_end']),
                     'weeklyTargetHours' => (float) $req['weekly_target_hours']],
        'staff' => $staff,
        'vacancies' => $vacancies,
        'candidates' => $candidates,
        'limits' => ['minWeekly' => min_weekly_hours(), 'maxWeekly' => hard_weekly_cap(),
                     'maxDaily' => MAX_DAILY_HOURS,
                     'open' => format_time(OFFICE_OPEN), 'close' => format_time(OFFICE_CLOSE),
                     'earliest' => format_time(OFFICE_EARLIEST), 'latest' => format_time(OFFICE_LATEST)],
    ]);

// Put an S.A. on an office: the office becomes theirs and the week is written.
case 'office_assign':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    ensure_assigned_office_schedules($sem['id']);
    $reqId = (int) ($in['id'] ?? 0);
    $saId = (int) ($in['saProfileId'] ?? 0);
    $allowShort = !empty($in['allowBelowMinimum']);

    $req = $pdo->prepare('SELECT r.*, o.name FROM office_requirements r JOIN offices o ON o.id = r.office_id
                           WHERE r.id = ? AND r.semester_id = ?');
    $req->execute([$reqId, $sem['id']]);
    $req = $req->fetch() ?: fail('Set the office requirement first.', 404);

    $onIt = $pdo->prepare('SELECT COUNT(*) FROM sa_profiles WHERE office_id = ? AND sa_status = "ACTIVE"
                             AND archived_at IS NULL AND assignment_status = "ASSIGNED"');
    $onIt->execute([(int) $req['office_id']]);
    if ((int) $onIt->fetchColumn() >= (int) $req['required_sa']) {
        fail($req['name'] . ' already has the ' . $req['required_sa'] . ' S.A. it asked for. Over-staffing is not allowed.', 409);
    }

    $targetOfficeId = (int) $req['office_id'];
    $pool = office_pool($sem['id'], $targetOfficeId);
    $sa = $pool[$saId] ?? fail('That S.A. is not free to be assigned this semester.', 422);

    $banned = $sa['evalBanned'] ?? [];
    if (!empty($banned) && in_array('OFFICE', $banned, true)) {
        fail($sa['name'] . ' is not eligible for office assignments due to evaluation policy.', 422);
    }

    $target = max(min_weekly_hours(), (float) $req['weekly_target_hours']);
    $from = mins($req['operating_start']);
    $to = mins($req['operating_end']);
    if (!empty($in['extend'])) {                       // start earlier, end later
        $from = min($from, mins(OFFICE_EARLIEST));
        $to = max($to, mins(OFFICE_LATEST));
    }
    $saForCalc = $sa;
    $saForCalc['duty'] = []; // Fresh duty schedule for this office
    ['pattern' => $pattern, 'hours' => $hours] = office_pattern($saForCalc, $from, $to, $target);
    if ($hours < MIN_OFFICE_BLOCK) {
        fail($sa['name'] . ' has no free window inside ' . format_time(hhmm($from))
             . ' - ' . format_time(hhmm($to)) . '.', 422);
    }

    $credited = credited_with($saForCalc, $pattern);
    if ($credited > hard_weekly_cap()) fail('That would put ' . $sa['name'] . ' over the ' . hard_weekly_cap() . '-hour weekly cap.', 422);
    if ($credited < min_weekly_hours() && !$allowShort) {
        fail('Only ' . $credited . ' hours fit around ' . $sa['name'] . "'s classes, below the "
             . min_weekly_hours() . '-hour minimum.', 422, ['code' => 'BELOW_MINIMUM', 'creditedHours' => $credited]);
    }

    $supervisorId = supervisor_for('OFFICE', (int) $req['office_id']);
    $oldOfficeId = (int) ($sa['currentOfficeId'] ?? 0);
    $oldOfficeName = $sa['currentOfficeName'] ?? null;
    $newOfficeName = $req['name'];
    $newOfficeId = (int) $req['office_id'];

    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ?')
            ->execute([$sem['id'], $saId]);

        $insert = $pdo->prepare(
            'INSERT INTO schedule_assignments (semester_id, sa_profile_id, requirement_type, office_requirement_id,
                    department, location, supervisor_id, day_of_week, start_time, end_time, source)
             VALUES (?, ?, "OFFICE", ?, "OFFICE", ?, ?, ?, ?, ?, "CHANGE")'
        );
        foreach ($pattern as [$day, $start, $end]) {
            $insert->execute([$sem['id'], $saId, $reqId, $req['name'], $supervisorId, $day, hhmm($start), hhmm($end)]);
        }

        $pdo->prepare('UPDATE sa_profiles SET office_id = ?, department_type = "OFFICE", sa_category = "OFFICE", assignment_status = "ASSIGNED",
                              supervisor_id = COALESCE(?, supervisor_id) WHERE id = ?')
            ->execute([(int) $req['office_id'], $supervisorId, $saId]);

        // Send notifications to supervisors
        $currentUserId = (int) ($user['id'] ?? 1);

        // 1. If reassigned from another office, notify previous supervisor(s)
        if ($oldOfficeId > 0 && $oldOfficeId !== $newOfficeId) {
            $oldOfficeTitle = $oldOfficeName ?: ($pdo->query("SELECT name FROM offices WHERE id = $oldOfficeId")->fetchColumn() ?: 'Previous Department');
            notify_office_supervisors(
                $pdo,
                $oldOfficeId,
                $currentUserId,
                'S.A. Reassignment Notice',
                "Notice: S.A. {$sa['name']} ({$sa['studentId']}) has been reassigned from {$oldOfficeTitle} to {$newOfficeName} by the S.A. Coordinator.",
                '/supervisor/team'
            );
        }

        // 2. Notify new supervisor(s) of this office that they have a new S.A.
        notify_office_supervisors(
            $pdo,
            $newOfficeId,
            $currentUserId,
            'New S.A. Assigned',
            "Notice: S.A. {$sa['name']} ({$sa['studentId']}) has been assigned to your department ({$newOfficeName}) by the S.A. Coordinator.",
            '/supervisor/team'
        );

        audit('OFFICE_SA_ASSIGNED', "{$sa['studentId']} {$sa['name']} -> {$req['name']}, $credited credited hour(s)"
              . ($oldOfficeId > 0 ? " (reassigned from $oldOfficeName)" : "")
              . ($credited < min_weekly_hours() ? ' (below the minimum, allowed by the Coordinator)' : ''));
        $pdo->commit();
        ensure_assigned_office_schedules($sem['id']);
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('The assignment was not saved: ' . $e->getMessage(), 500);
    }

    respond([
        'success' => true,
        'name' => $sa['name'],
        'creditedHours' => $credited,
        'blocks' => count($pattern),
        'belowMinimum' => $credited < min_weekly_hours(),
        'isReassignment' => ($oldOfficeId > 0 && $oldOfficeId !== $newOfficeId),
        'oldOfficeName' => $oldOfficeName,
        'newOfficeName' => $newOfficeName,
    ]);

// An office week can fall short of the minimum, so the Coordinator adds hours
// by hand: an earlier start, a later finish, a Saturday. Everything the engine
// checks is checked here too.
case 'office_hours_add':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $reqId = (int) ($in['id'] ?? 0);
    $saId = (int) ($in['saProfileId'] ?? 0);
    $day = strtoupper(trim((string) ($in['day'] ?? '')));
    $start = parse_time((string) ($in['startTime'] ?? ''));
    $end = parse_time((string) ($in['endTime'] ?? ''));

    $req = $pdo->prepare('SELECT r.*, o.name FROM office_requirements r JOIN offices o ON o.id = r.office_id
                           WHERE r.id = ? AND r.semester_id = ?');
    $req->execute([$reqId, $sem['id']]);
    $req = $req->fetch() ?: fail('Set the office requirement first.', 404);

    $p = $pdo->prepare('SELECT id, student_id, first_name, last_name, office_id, assignment_status
                          FROM sa_profiles WHERE id = ?');
    $p->execute([$saId]);
    $profile = $p->fetch() ?: fail('This S.A. record was not found.', 404);
    if ((int) $profile['office_id'] !== (int) $req['office_id'] || $profile['assignment_status'] !== 'ASSIGNED') {
        fail('Put them on ' . $req['name'] . ' first, then add hours.', 409);
    }

    $e = [];
    if (!in_array($day, DAY_ORDER, true)) $e['day'] = 'Choose a day.';
    if (!$start) $e['startTime'] = 'Enter the start time.';
    if (!$end) $e['endTime'] = 'Enter the end time.';
    if ($start && $end && $end <= $start) $e['endTime'] = 'Must be after the start time.';
    if ($start && $start < OFFICE_EARLIEST) $e['startTime'] = 'Duty starts at ' . format_time(OFFICE_EARLIEST) . ' at the earliest.';
    if ($end && $end > OFFICE_LATEST) $e['endTime'] = 'Duty ends at ' . format_time(OFFICE_LATEST) . ' at the latest.';
    if ($e) fail('Check the highlighted fields.', 422, ['errors' => $e]);

    $from = mins($start);
    $to = mins($end);
    if ($to - $from < 30) fail('A duty block is at least half an hour.', 422, ['errors' => ['endTime' => 'Too short.']]);

    // against their classes
    $clash = $pdo->prepare('SELECT subject, start_time, end_time FROM class_schedules
                             WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NULL
                               AND day_of_week = ? AND start_time < ? AND end_time > ?');
    $clash->execute([$sem['id'], $saId, $day, $end, $start]);
    if ($row = $clash->fetch()) {
        fail('That sits on top of their class ' . $row['subject'] . ' ('
             . format_time($row['start_time']) . ' - ' . format_time($row['end_time']) . ').', 422);
    }

    // against duty they already hold
    $busy = $pdo->prepare('SELECT location, start_time, end_time FROM schedule_assignments
                            WHERE semester_id = ? AND sa_profile_id = ? AND day_of_week = ?
                              AND start_time < ? AND end_time > ?');
    $busy->execute([$sem['id'], $saId, $day, $end, $start]);
    if ($row = $busy->fetch()) {
        fail('They are already on duty at ' . $row['location'] . ' ('
             . format_time($row['start_time']) . ' - ' . format_time($row['end_time']) . ').', 422);
    }

    // the day and the week
    $spans = [];
    $all = $pdo->prepare('SELECT day_of_week, start_time, end_time FROM schedule_assignments
                           WHERE semester_id = ? AND sa_profile_id = ?');
    $all->execute([$sem['id'], $saId]);
    foreach ($all as $row) $spans[$row['day_of_week']][] = [mins($row['start_time']), mins($row['end_time'])];
    $spans[$day][] = [$from, $to];

    $dayMins = span_minutes(merge_spans($spans[$day]));
    if ($dayMins / 60 > MAX_DAILY_HOURS) {
        fail('That would make ' . round($dayMins / 60, 1) . ' hours on ' . DAYS[$day]
             . ', past the ' . MAX_DAILY_HOURS . '-hour day.', 422);
    }
    $credited = credited_week($spans);
    if ($credited > hard_weekly_cap()) {
        fail('That would put them on ' . $credited . ' credited hours, past the ' . hard_weekly_cap() . '-hour weekly cap.', 422);
    }

    $pdo->prepare(
        'INSERT INTO schedule_assignments (semester_id, sa_profile_id, requirement_type, office_requirement_id,
                department, location, supervisor_id, day_of_week, start_time, end_time, source)
         VALUES (?, ?, "OFFICE", ?, "OFFICE", ?, ?, ?, ?, ?, "CHANGE")'
    )->execute([$sem['id'], $saId, $reqId, $req['name'], supervisor_for('OFFICE', (int) $req['office_id']),
                $day, $start, $end]);

    audit('OFFICE_HOURS_ADDED', "{$profile['student_id']} {$profile['first_name']} {$profile['last_name']}: "
          . DAYS[$day] . ' ' . format_time($start) . ' - ' . format_time($end) . " at {$req['name']}");

    respond(['success' => true, 'creditedHours' => $credited, 'belowMinimum' => $credited < min_weekly_hours()]);

case 'office_hours_delete':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $stmt = $pdo->prepare('SELECT a.*, p.student_id, p.first_name, p.last_name FROM schedule_assignments a
                             JOIN sa_profiles p ON p.id = a.sa_profile_id
                            WHERE a.id = ? AND a.semester_id = ? AND a.requirement_type = "OFFICE"');
    $stmt->execute([(int) ($in['id'] ?? 0), $sem['id']]);
    $row = $stmt->fetch() ?: fail('That duty block was not found.', 404);

    $pdo->prepare('DELETE FROM schedule_assignments WHERE id = ?')->execute([$row['id']]);
    audit('OFFICE_HOURS_REMOVED', "{$row['student_id']} {$row['first_name']} {$row['last_name']}: "
          . DAYS[$row['day_of_week']] . ' ' . format_time($row['start_time']) . ' - ' . format_time($row['end_time']));
    respond(['success' => true]);

case 'office_unassign':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $saId = (int) ($in['saProfileId'] ?? 0);
    $p = $pdo->prepare('SELECT id, student_id, first_name, last_name, office_id FROM sa_profiles WHERE id = ?');
    $p->execute([$saId]);
    $profile = $p->fetch() ?: fail('This S.A. record was not found.', 404);

    $pdo->beginTransaction();
    try {
        $del = $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ?
                                AND requirement_type = "OFFICE"');
        $del->execute([$sem['id'], $saId]);
        $pdo->prepare('UPDATE sa_profiles SET assignment_status = "UNASSIGNED", office_id = NULL WHERE id = ?')->execute([$saId]);
        audit('OFFICE_SA_UNASSIGNED', "{$profile['student_id']} {$profile['first_name']} {$profile['last_name']}: "
              . $del->rowCount() . ' duty period(s) removed');
        $pdo->commit();
        ensure_assigned_office_schedules($sem['id']);
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('The S.A. was not taken off the office: ' . $e->getMessage(), 500);
    }

    respond(['success' => true, 'name' => $profile['first_name'] . ' ' . $profile['last_name']]);

case 'office_save':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $officeId = (int) ($in['officeId'] ?? 0);
    $statusType = trim((string) ($in['statusType'] ?? ''));

    // If user explicitly chose "NONE" / No S.A. Needed
    if ($statusType === 'NONE') {
        $del = $pdo->prepare('DELETE FROM office_requirements WHERE semester_id = ? AND office_id = ?');
        $del->execute([$sem['id'], $officeId]);
        ensure_assigned_office_schedules($sem['id']);
        $name = $pdo->prepare('SELECT name FROM offices WHERE id = ?');
        $name->execute([$officeId]);
        audit('OFFICE_REQUIREMENT_CLEARED', ($name->fetchColumn() ?: 'Office') . ": marked as No S.A. Needed");
        respond(['success' => true]);
    }

    $required = (int) ($in['requiredSa'] ?? 0);
    $start = parse_time((string) ($in['operatingStart'] ?? ''));
    $end = parse_time((string) ($in['operatingEnd'] ?? ''));
    $target = $in['weeklyTargetHours'] ?? min_weekly_hours();
    $notes = trim((string) ($in['notes'] ?? '')) ?: null;

    $e = [];
    $check = $pdo->prepare('SELECT COUNT(*) FROM offices WHERE id = ?');
    $check->execute([$officeId]);
    if (!$check->fetchColumn()) $e['officeId'] = 'Choose an office.';
    if ($required < 1 || $required > 20) $e['requiredSa'] = 'Enter how many S.A.s this office needs (1 to 20).';
    if (!$start) $e['operatingStart'] = 'Enter the opening time.';
    elseif ($start < OFFICE_OPEN) $e['operatingStart'] = 'Office duty starts at ' . format_time(OFFICE_OPEN) . ' at the earliest.';
    if (!$end) $e['operatingEnd'] = 'Enter the closing time.';
    elseif ($end > OFFICE_CLOSE) $e['operatingEnd'] = 'Office duty ends at ' . format_time(OFFICE_CLOSE) . ' at the latest.';
    elseif ($start && $end <= $start) $e['operatingEnd'] = 'Must be after the opening time.';
    if (!is_numeric($target) || $target < 1 || $target > 60) $e['weeklyTargetHours'] = 'Enter 1 to 60 hours.';
    if ($notes && mb_strlen($notes) > 160) $e['notes'] = 'Use 160 characters or fewer.';
    if ($e) fail('Check the highlighted fields.', 422, ['errors' => $e]);

    $pdo->prepare(
        'INSERT INTO office_requirements (semester_id, office_id, required_sa, operating_start, operating_end, weekly_target_hours, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE required_sa = VALUES(required_sa), operating_start = VALUES(operating_start),
                                 operating_end = VALUES(operating_end), weekly_target_hours = VALUES(weekly_target_hours),
                                 notes = VALUES(notes)'
    )->execute([$sem['id'], $officeId, $required, $start, $end, round((float) $target, 1), $notes, $user['id']]);

    // Ensure the office is active and enforce assigned <= required_sa (no over-staffing)
    $pdo->prepare('UPDATE offices SET is_active = 1 WHERE id = ?')->execute([$officeId]);
    ensure_assigned_office_schedules($sem['id']);

    $name = $pdo->prepare('SELECT name FROM offices WHERE id = ?');
    $name->execute([$officeId]);
    audit('OFFICE_REQUIREMENT_SAVED', $name->fetchColumn() . ": needs $required S.A., {$sem['label']}");
    respond(['success' => true]);

case 'office_delete':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $reqId = (int) ($in['id'] ?? 0);
    $officeId = (int) ($in['officeId'] ?? 0);

    if ($reqId > 0) {
        $stmt = $pdo->prepare('SELECT r.*, o.name FROM office_requirements r JOIN offices o ON o.id = r.office_id WHERE r.id = ?');
        $stmt->execute([$reqId]);
    } else {
        $stmt = $pdo->prepare('SELECT r.*, o.name FROM office_requirements r JOIN offices o ON o.id = r.office_id WHERE r.office_id = ? AND r.semester_id = ?');
        $stmt->execute([$officeId, $sem['id']]);
    }
    $row = $stmt->fetch() ?: fail('Requirement not found.', 404);
    $pdo->prepare('DELETE FROM office_requirements WHERE id = ?')->execute([$row['id']]);
    ensure_assigned_office_schedules($sem['id']);
    audit('OFFICE_REQUIREMENT_DELETED', $row['name']);
    respond(['success' => true]);

case 'office_toggle_active':
    $officeId = (int) ($in['officeId'] ?? 0);
    $stmt = $pdo->prepare('SELECT id, name, is_active FROM offices WHERE id = ?');
    $stmt->execute([$officeId]);
    $o = $stmt->fetch() ?: fail('Office not found.', 404);
    $newStatus = $o['is_active'] ? 0 : 1;
    $pdo->prepare('UPDATE offices SET is_active = ? WHERE id = ?')->execute([$newStatus, $officeId]);
    audit('OFFICE_STATUS_CHANGED', "{$o['name']} is now " . ($newStatus ? 'ACTIVE' : 'INACTIVE'));
    respond(['success' => true, 'isActive' => (bool) $newStatus]);

// --------------------------------------------------------- ASSIGNMENT REVIEW
// Existing valid assignments are never rematched automatically. The Coordinator
// decides, per S.A., who enters the matching pool (PDF business rules 1–4).
case 'review_list':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);

    // Check latest matching run for this semester
    $matchingRunStmt = $pdo->prepare('SELECT id, pool_count, recommended, created_at FROM matching_runs WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
    $matchingRunStmt->execute([$sem['id']]);
    $latestRun = $matchingRunStmt->fetch();
    $matchingDone = !empty($latestRun);

    // Recommended matches from latest matching run
    $recs = [];
    if ($latestRun) {
        $recStmt = $pdo->prepare(
            'SELECT mc.sa_profile_id,
                    COUNT(DISTINCT mc.slot_id) AS rec_slots,
                    MAX(mc.projected_hours) AS rec_hours,
                    GROUP_CONCAT(DISTINCT ms.label SEPARATOR ", ") AS rec_labels,
                    GROUP_CONCAT(DISTINCT ms.department SEPARATOR ", ") AS rec_depts
               FROM match_candidates mc
               JOIN match_slots ms ON ms.id = mc.slot_id
              WHERE ms.run_id = ? AND mc.rank_no = 1
              GROUP BY mc.sa_profile_id'
        );
        $recStmt->execute([$latestRun['id']]);
        foreach ($recStmt->fetchAll() as $r) {
            $recs[(int) $r['sa_profile_id']] = [
                'slots' => (int) $r['rec_slots'],
                'hours' => (float) $r['rec_hours'],
                'labels' => $r['rec_labels'],
                'departments' => $r['rec_depts'],
            ];
        }

        // Direct/accepted slots in matching run
        $slotAssignedStmt = $pdo->prepare(
            'SELECT ms.assigned_sa_profile_id AS sa_profile_id,
                    COUNT(*) AS assigned_slots,
                    GROUP_CONCAT(DISTINCT ms.label SEPARATOR ", ") AS assigned_labels,
                    GROUP_CONCAT(DISTINCT ms.department SEPARATOR ", ") AS assigned_depts
               FROM match_slots ms
              WHERE ms.run_id = ? AND ms.assigned_sa_profile_id IS NOT NULL
              GROUP BY ms.assigned_sa_profile_id'
        );
        $slotAssignedStmt->execute([$latestRun['id']]);
        foreach ($slotAssignedStmt->fetchAll() as $r) {
            $saId = (int) $r['sa_profile_id'];
            if (!isset($recs[$saId])) {
                $recs[$saId] = [
                    'slots' => (int) $r['assigned_slots'],
                    'hours' => 0.0,
                    'labels' => $r['assigned_labels'],
                    'departments' => $r['assigned_depts'],
                ];
            }
        }
    }

    // Direct schedule assignments for this semester
    $assignedStmt = $pdo->prepare(
        'SELECT sa_profile_id, COUNT(*) AS assigned_slots,
                COALESCE(SUM(TIMESTAMPDIFF(MINUTE, start_time, end_time)/60), 0) AS assigned_hours,
                MAX(department) AS assigned_dept,
                MAX(location) AS assigned_loc
           FROM schedule_assignments
          WHERE semester_id = ?
          GROUP BY sa_profile_id'
    );
    $assignedStmt->execute([$sem['id']]);
    $directAssignments = [];
    foreach ($assignedStmt->fetchAll() as $r) {
        $directAssignments[(int) $r['sa_profile_id']] = [
            'slots' => (int) $r['assigned_slots'],
            'hours' => (float) $r['assigned_hours'],
            'dept' => $r['assigned_dept'],
            'location' => $r['assigned_loc'],
        ];
    }

    $stmt = $pdo->prepare(
        'SELECT p.id, p.student_id, p.first_name, p.last_name, p.course, p.year_level, p.sa_category,
                p.department_type, p.sa_status, p.assignment_status, p.weekly_target_hours,
                o.name AS office_name, sup.full_name AS supervisor_name,
                r.decision, r.reason, r.decided_at, u.full_name AS decided_by,
                (SELECT COUNT(*) FROM class_schedules c WHERE c.sa_profile_id = p.id AND c.semester_id = ? AND c.archived_at IS NULL) AS class_rows
           FROM sa_profiles p
           LEFT JOIN offices o ON o.id = p.office_id
           LEFT JOIN users sup ON sup.id = p.supervisor_id
           LEFT JOIN assignment_reviews r ON r.sa_profile_id = p.id AND r.semester_id = ?
           LEFT JOIN users u ON u.id = r.decided_by
          ORDER BY p.last_name, p.first_name'
    );
    $stmt->execute([$sem['id'], $sem['id']]);

    $items = array_map(function($p) use ($recs, $directAssignments, $matchingDone) {
        $id = (int) $p['id'];
        $hasRec = isset($recs[$id]);
        $hasDirect = isset($directAssignments[$id]);
        $isMatched = $hasRec || $hasDirect;

        $matchedHours = 0.0;
        $matchedSlots = 0;
        $matchedSummary = '';

        if ($hasDirect) {
            $matchedHours = $directAssignments[$id]['hours'];
            $matchedSlots = $directAssignments[$id]['slots'];
            $matchedSummary = $directAssignments[$id]['location'] ? ($directAssignments[$id]['dept'] . ' ' . $directAssignments[$id]['location']) : $directAssignments[$id]['dept'];
        } elseif ($hasRec) {
            $matchedHours = $recs[$id]['hours'];
            $matchedSlots = $recs[$id]['slots'];
            $matchedSummary = $recs[$id]['departments'] . ($recs[$id]['slots'] > 1 ? " ({$recs[$id]['slots']} slots)" : " ({$recs[$id]['labels']})");
        }

        return [
            'id' => $id,
            'studentId' => $p['student_id'],
            'name' => $p['first_name'] . ' ' . $p['last_name'],
            'course' => $p['course'],
            'yearLevel' => (int) $p['year_level'],
            'saCategory' => $p['sa_category'],
            'departmentType' => $p['department_type'],
            'currentAssignment' => $isMatched ? ($matchedSummary ?: ($p['office_name'] ?: $p['department_type'])) : ($p['office_name'] ?: $p['department_type']),
            'originalAssignment' => $p['office_name'] ?: $p['department_type'],
            'supervisor' => $p['supervisor_name'],
            'saStatus' => $p['sa_status'],
            'assignmentStatus' => $p['assignment_status'],
            'weeklyTargetHours' => (float) $p['weekly_target_hours'],
            'classRows' => (int) $p['class_rows'],
            'decision' => $p['decision'],
            'reason' => $p['reason'],
            'decidedAt' => $p['decided_at'],
            'decidedBy' => $p['decided_by'],
            'inPool' => in_array($p['decision'], ['REASSIGN', 'POOL'], true),
            'isMatched' => $isMatched,
            'matchedHours' => $matchedHours,
            'matchedSlots' => $matchedSlots,
            'matchedSummary' => $matchedSummary,
        ];
    }, $stmt->fetchAll());

    $sem['matchingDone'] = $matchingDone;
    respond(['success' => true, 'semester' => $sem, 'matchingDone' => $matchingDone, 'items' => $items]);

case 'review_decide':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $decision = strtoupper(trim((string) ($in['decision'] ?? '')));
    $reason = trim((string) ($in['reason'] ?? '')) ?: null;
    if (!in_array($decision, ['CONTINUE', 'REASSIGN', 'POOL', 'HOLD'], true)) fail('Unknown review decision.', 422);
    if ($reason && mb_strlen($reason) > 200) fail('Keep the reason to 200 characters or fewer.', 422, ['errors' => ['reason' => 'Use 200 characters or fewer.']]);

    $ids = array_values(array_unique(array_map('intval', (array) ($in['ids'] ?? [$in['id'] ?? 0]))));
    $ids = array_filter($ids);
    if (!$ids) fail('Choose at least one S.A.', 422);

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT * FROM sa_profiles WHERE id IN ($placeholders)");
    $stmt->execute($ids);
    $profiles = $stmt->fetchAll();
    if (!$profiles) fail('No matching S.A. records.', 404);

    $save = $pdo->prepare(
        'INSERT INTO assignment_reviews (semester_id, sa_profile_id, decision, reason, decided_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE decision = VALUES(decision), reason = VALUES(reason), decided_by = VALUES(decided_by)'
    );
    $setStatus = $pdo->prepare('UPDATE sa_profiles SET assignment_status = ? WHERE id = ?');

    $applied = 0;
    $skipped = [];
    $pdo->beginTransaction();
    foreach ($profiles as $p) {
        if ($p['sa_status'] !== 'ACTIVE') { $skipped[] = $p['student_id']; continue; }
        if ($decision === 'CONTINUE' && $p['assignment_status'] !== 'ASSIGNED') { $skipped[] = $p['student_id']; continue; }

        $save->execute([$sem['id'], $p['id'], $decision, $reason, $user['id']]);

        // The decision drives the assignment status the matching pool reads
        $newStatus = match ($decision) {
            'CONTINUE' => 'ASSIGNED',
            'REASSIGN' => 'FOR_REASSIGNMENT',
            'POOL' => $p['assignment_status'] === 'ASSIGNED' ? 'FOR_REASSIGNMENT' : 'UNASSIGNED',
            'HOLD' => $p['assignment_status'],   // status unchanged; only kept out of the pool
        };
        if ($newStatus !== $p['assignment_status']) $setStatus->execute([$newStatus, $p['id']]);
        $applied++;
    }
    audit('ASSIGNMENT_REVIEWED', "{$sem['label']}: $decision for $applied S.A." . ($reason ? " — $reason" : ''));
    $pdo->commit();
    ensure_assigned_office_schedules($sem['id']);

    respond(['success' => true, 'applied' => $applied, 'skipped' => $skipped]);

case 'review_reset':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $id = (int) ($in['id'] ?? 0);
    $stmt = $pdo->prepare('SELECT p.*, r.decision FROM sa_profiles p
                             LEFT JOIN assignment_reviews r ON r.sa_profile_id = p.id AND r.semester_id = ?
                            WHERE p.id = ?');
    $stmt->execute([$sem['id'], $id]);
    $p = $stmt->fetch() ?: fail('S.A. not found.', 404);
    if (!$p['decision']) fail('This S.A. has not been reviewed yet.', 409);

    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM assignment_reviews WHERE semester_id = ? AND sa_profile_id = ?')->execute([$sem['id'], $id]);
    // Undo returns a "for reassignment" S.A. to its previous assigned state
    if ($p['decision'] === 'REASSIGN' && $p['assignment_status'] === 'FOR_REASSIGNMENT') {
        $pdo->prepare('UPDATE sa_profiles SET assignment_status = "ASSIGNED" WHERE id = ?')->execute([$id]);
    }
    audit('ASSIGNMENT_REVIEW_UNDONE', "{$sem['label']}: {$p['student_id']} ({$p['decision']})");
    $pdo->commit();
    ensure_assigned_office_schedules($sem['id']);
    respond(['success' => true]);

// -------------------------------------------------------- SEMESTER MATCHING & RECOMMENDATIONS (Pages 5 & 6)
case 'matching_summary':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    ensure_matching_board_tables();
    ensure_assigned_office_schedules($sem['id']);
    $ready = matching_inputs($sem['id']);
    $run = matching_result($sem['id'], false);
    $grid = room_grid($sem['id']);
    $lockInfo = get_matching_batch_lock_info($sem['id']);
    $pool = array_values(matching_pool($sem['id'], true));
    respond([
        'success' => true,
        'semester' => $sem,
        'ready' => $ready,
        'run' => $run,
        'runs' => get_matching_runs_list($sem['id']),
        'grid' => $grid,
        'lockInfo' => $lockInfo,
        'publication' => publication($sem['id']),
        'pool' => array_map(fn($sa) => [
            'id' => $sa['id'],
            'studentId' => $sa['studentId'],
            'name' => $sa['name'],
            'course' => $sa['course'],
            'yearLevel' => $sa['yearLevel'],
            'category' => $sa['category'],
            'department' => $sa['department'],
            'assignmentStatus' => $sa['assignmentStatus'] ?? 'UNASSIGNED',
            'markedForReassignment' => !empty($sa['markedForReassignment']),
            'reassignmentReason' => $sa['reassignmentReason'] ?? null,
            'classBlocks' => array_sum(array_map('count', $sa['classes'])),
        ], $pool),
        'minWeekly' => min_weekly_hours(),
        'maxWeekly' => hard_weekly_cap(),
    ]);

case 'matching_run':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $mode = strtolower(trim((string) ($in['mode'] ?? 'standard')));
    if (!in_array($mode, ['standard', 'alternative', 'incremental', 'cross_shuffle'], true)) $mode = 'standard';
    $crossShuffle = !empty($in['crossShuffle']) || $mode === 'cross_shuffle';
    $runLabel = trim((string) ($in['runLabel'] ?? '')) ?: null;

    $ready = matching_inputs($sem['id']);
    if (!$ready['canRun']) {
        if ($ready['pool'] === 0) fail('No active ITO or ACADS S.A.s in the matching pool.', 422);
        if ($ready['roomPosts'] === 0) fail('No room or laboratory requirements configured for this semester.', 422);
        if (!empty($ready['missingSchedule'])) {
            fail('Some S.A.s have missing official Registrar class schedules. Review Class Schedules first.', 422);
        }
    }

    $run = run_matching($sem['id'], (int) $user['id'], $mode, false, $crossShuffle, $runLabel);
    audit('MATCHING_RUN', "{$sem['label']} ({$mode}): {$run['recommended']}/{$run['totalSlots']} room slots matched, {$run['unfilled']} gap(s)");
    $grid = room_grid($sem['id']);
    if ($grid && !empty($run['recheck'])) {
        $grid['recheck'] = $run['recheck'];
    }
    respond([
        'success' => true,
        'semester' => $sem,
        'mode' => $mode,
        'ready' => matching_inputs($sem['id']),
        'run' => $run,
        'runs' => get_matching_runs_list($sem['id']),
        'recheck' => $run['recheck'] ?? null,
        'grid' => $grid,
        'lockInfo' => get_matching_batch_lock_info($sem['id']),
        'progress' => $grid['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
        'minWeekly' => min_weekly_hours(),
        'maxWeekly' => hard_weekly_cap(),
    ]);

case 'switch_matching_run':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $runId = (int) ($in['runId'] ?? 0);
    if (!$runId) fail('Please select a matching run.', 422);

    $chk = $pdo->prepare('SELECT id, run_name FROM matching_runs WHERE id = ? AND semester_id = ?');
    $chk->execute([$runId, $sem['id']]);
    $runRow = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$runRow) fail('Matching run not found for this semester.', 404);

    $pdo->prepare('UPDATE matching_runs SET is_active = 0 WHERE semester_id = ?')->execute([$sem['id']]);
    $pdo->prepare('UPDATE matching_runs SET is_active = 1 WHERE id = ?')->execute([$runId]);

    sync_approved_to_assignments($sem['id']);
    $runName = $runRow['run_name'] ?: ("Match #" . $runId);
    audit('MATCHING_RUN_SWITCHED', "{$sem['label']}: switched active matching run to {$runName} (ID #{$runId})");

    $run = matching_result($sem['id'], false);
    $grid = room_grid($sem['id']);
    respond([
        'success' => true,
        'semester' => $sem,
        'run' => $run,
        'runs' => get_matching_runs_list($sem['id']),
        'grid' => $grid,
        'lockInfo' => get_matching_batch_lock_info($sem['id']),
        'message' => "Switched to {$runName}",
    ]);

case 'save_current_match':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $runName = trim((string) ($in['runName'] ?? '')) ?: null;
    $cloneRes = clone_matching_run($sem['id'], $runName, (int) $user['id']);
    audit('MATCHING_RUN_SAVED', "{$sem['label']}: saved matching run snapshot {$cloneRes['name']} (ID #{$cloneRes['newRunId']})");

    $run = matching_result($sem['id'], false);
    $grid = room_grid($sem['id']);
    respond([
        'success' => true,
        'semester' => $sem,
        'run' => $run,
        'runs' => get_matching_runs_list($sem['id']),
        'grid' => $grid,
        'lockInfo' => get_matching_batch_lock_info($sem['id']),
        'message' => "Saved snapshot {$cloneRes['name']}",
    ]);

case 'delete_matching_run':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $runId = (int) ($in['runId'] ?? 0);
    if (!$runId) fail('Select a matching run to delete.', 422);

    $delRes = delete_matching_run_record($sem['id'], $runId);
    audit('MATCHING_RUN_DELETED', "{$sem['label']}: deleted matching run snapshot {$delRes['name']} (ID #{$runId})");

    $run = matching_result($sem['id'], false);
    $grid = room_grid($sem['id']);
    respond([
        'success' => true,
        'semester' => $sem,
        'run' => $run,
        'runs' => get_matching_runs_list($sem['id']),
        'grid' => $grid,
        'lockInfo' => get_matching_batch_lock_info($sem['id']),
        'message' => "Deleted {$delRes['name']}",
    ]);

case 'recommendations':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $run = matching_result($sem['id'], false);
    respond([
        'success' => true,
        'semester' => $sem,
        'run' => $run,
        'runs' => get_matching_runs_list($sem['id']),
        'lockInfo' => get_matching_batch_lock_info($sem['id']),
    ]);

case 'recommendation_clear':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    ensure_matching_board_tables();
    $oldRuns = $pdo->prepare('SELECT id FROM matching_runs WHERE semester_id = ?');
    $oldRuns->execute([$sem['id']]);
    $oldIds = $oldRuns->fetchAll(PDO::FETCH_COLUMN);
    if ($oldIds) {
        $inIds = implode(',', array_map('intval', $oldIds));
        $pdo->exec("DELETE FROM match_candidates WHERE slot_id IN (SELECT id FROM match_slots WHERE run_id IN ($inIds))");
        $pdo->exec("DELETE FROM match_slots WHERE run_id IN ($inIds)");
        $pdo->exec("DELETE FROM matching_runs WHERE id IN ($inIds)");
    }
    $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ?')
        ->execute([$sem['id']]);
    $pdo->prepare('DELETE FROM schedule_publications WHERE semester_id = ?')
        ->execute([$sem['id']]);
    $pdo->prepare('DELETE FROM schedule_changes WHERE semester_id = ?')
        ->execute([$sem['id']]);
    $pdo->prepare('DELETE FROM room_relief_coverages WHERE semester_id = ?')
        ->execute([$sem['id']]);
    $pdo->prepare('DELETE FROM room_assignment_history WHERE semester_id = ?')
        ->execute([$sem['id']]);
    $pdo->exec('UPDATE sa_profiles SET assignment_status = "UNASSIGNED", marked_for_reassignment = 0, reassignment_reason = NULL WHERE sa_category IN ("ITO", "ACADS", "RELIEVER")');
    audit('RECOMMENDATIONS_CLEARED', "{$sem['label']}: matching recommendations, finalized schedule, and final schedule cleared to zero");
    respond(['success' => true, 'semester' => $sem, 'run' => null]);

case 'schedule_export':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $sched = schedule_view($sem['id']);
    respond([
        'success' => true,
        'semester' => $sem,
        'schedule' => $sched,
        'sheets' => [
            'assignments' => $sched['assignments'],
            'staff' => $sched['staff'],
        ],
    ]);

// ------------------------------------------------------ ONE S.A.'s WEEK
// The record page shows an S.A. their own week: the classes on file and the
// duty the finalized schedule gave them, with the clashes between the two.
case 'sa_schedule':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $saId = (int) ($in['saProfileId'] ?? 0);
    if (!$saId) fail('Which S.A.?', 422);
    sync_sa_from_registrar($saId);
    ensure_assigned_office_schedules($sem['id']);

    $classes = $pdo->prepare('SELECT id, day_of_week, start_time, end_time, subject, section, archived_at
                                FROM class_schedules
                               WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NULL
                               ORDER BY FIELD(day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), start_time');
    $classes->execute([$sem['id'], $saId]);
    $classRows = array_map(fn($c) => [
        'id' => (int) $c['id'],
        'day' => $c['day_of_week'],
        'start' => mins($c['start_time']),
        'end' => mins($c['end_time']),
        'startLabel' => format_time($c['start_time']),
        'endLabel' => format_time($c['end_time']),
        'subject' => $c['subject'],
        'section' => $c['section'],
        'hours' => round((mins($c['end_time']) - mins($c['start_time'])) / 60, 1),
    ], $classes->fetchAll());

    $saStmt = $pdo->prepare('SELECT p.*, o.name AS office_name FROM sa_profiles p LEFT JOIN offices o ON o.id = p.office_id WHERE p.id = ?');
    $saStmt->execute([$saId]);
    $saProfile = $saStmt->fetch();
    $isOffice = $saProfile && ($saProfile['sa_category'] === 'OFFICE' || $saProfile['department_type'] === 'OFFICE' || !empty($saProfile['office_name']));

    $duty = $pdo->prepare('SELECT a.id, a.day_of_week, a.start_time, a.end_time, a.location, a.department,
                                  u.full_name AS supervisor_name
                             FROM schedule_assignments a
                             LEFT JOIN users u ON u.id = a.supervisor_id
                            WHERE a.semester_id = ? AND a.sa_profile_id = ?
                            ORDER BY FIELD(a.day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), a.start_time');
    $duty->execute([$sem['id'], $saId]);
    $dutyRows = [];
    foreach ($duty as $d) {
        $s = mins($d['start_time']);
        $e = mins($d['end_time']);
        $hours = round(($e - $s) / 60, 1);
        $credited = credited_hours($hours, $d['day_of_week'], $isOffice, $s, $e);
        $dutyRows[] = [
            'id' => (int) $d['id'],
            'day' => $d['day_of_week'],
            'start' => $s,
            'end' => $e,
            'startLabel' => format_time($d['start_time']),
            'endLabel' => format_time($d['end_time']),
            'location' => $d['location'],
            'department' => $d['department'],
            'supervisor' => $d['supervisor_name'],
            'hours' => $hours,
            'credited' => $credited,
            'hasBreak' => $credited < $hours,
        ];
    }

    if (empty($dutyRows)) {
        // Fall back to latest matching run recommendations for ITO/ACADS SAs
        $recs = $pdo->prepare(
            'SELECT mc.*, ms.label, ms.department, ms.day_of_week, ms.start_time, ms.end_time
               FROM match_candidates mc
               JOIN match_slots ms ON ms.id = mc.slot_id
               JOIN matching_runs mr ON mr.id = ms.run_id
              WHERE mr.semester_id = ? AND mc.sa_profile_id = ? AND mc.rank_no = 1
              ORDER BY FIELD(ms.day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), ms.start_time'
        );
        $recs->execute([$sem['id'], $saId]);
        $idx = 1;
        foreach ($recs->fetchAll() as $r) {
            if (!empty($r['day_of_week']) && !empty($r['start_time']) && !empty($r['end_time'])) {
                $s = mins($r['start_time']);
                $e = mins($r['end_time']);
                $hours = round(($e - $s) / 60, 1);
                $credited = credited_hours($hours, $r['day_of_week'], $isOffice, $s, $e);
                $dutyRows[] = [
                    'id' => $idx++,
                    'day' => $r['day_of_week'],
                    'start' => $s,
                    'end' => $e,
                    'startLabel' => format_time($r['start_time']),
                    'endLabel' => format_time($r['end_time']),
                    'location' => $r['label'],
                    'department' => $r['department'],
                    'supervisor' => null,
                    'hours' => $hours,
                    'credited' => $credited,
                    'hasBreak' => $credited < $hours,
                    'isRecommended' => true,
                ];
            } else {
                $pattern = json_decode($r['duty_pattern'] ?? '[]', true) ?: [];
                foreach ($pattern as $span) {
                    if (count($span) >= 3) {
                        $day = $span[0];
                        $s = (int) $span[1];
                        $e = (int) $span[2];
                        $hours = round(($e - $s) / 60, 1);
                        $credited = credited_hours($hours, $day, $isOffice, $s, $e);
                        $dutyRows[] = [
                            'id' => $idx++,
                            'day' => $day,
                            'start' => $s,
                            'end' => $e,
                            'startLabel' => format_time(hhmm($s)),
                            'endLabel' => format_time(hhmm($e)),
                            'location' => $r['label'],
                            'department' => $r['department'],
                            'supervisor' => null,
                            'hours' => $hours,
                            'credited' => $credited,
                            'hasBreak' => $credited < $hours,
                            'isRecommended' => true,
                        ];
                    }
                }
            }
        }
    }

    // merged blocks, so a run of periods in one room reads as one duty block
    $byDay = [];
    foreach ($dutyRows as $d) $byDay[$d['day'] . '|' . $d['location']][] = [$d['start'], $d['end']];
    $blocks = [];
    foreach ($byDay as $key => $spans) {
        [$day, $where] = explode('|', $key, 2);
        foreach (merge_spans($spans) as $sp) $blocks[] = duty_block($day, $sp[0], $sp[1], $isOffice) + ['location' => $where];
    }
    $blocks = credit_once_per_day($blocks, $isOffice);
    $dutyRows = credit_once_per_day($dutyRows, $isOffice);

    $prefs = $pdo->prepare('SELECT id, day_of_week, start_time, end_time, review_status, reviewed_at, review_notes, created_at
                              FROM duty_preferences
                             WHERE semester_id = ? AND sa_profile_id = ?
                             ORDER BY FIELD(day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), start_time');
    $prefs->execute([$sem['id'], $saId]);
    $prefRows = array_map(function($p) use ($isOffice) {
        $s = mins($p['start_time']);
        $e = mins($p['end_time']);
        $raw = round(($e - $s) / 60, 1);
        return [
            'id' => (int) $p['id'],
            'day' => $p['day_of_week'],
            'start' => $s,
            'end' => $e,
            'startLabel' => format_time($p['start_time']),
            'endLabel' => format_time($p['end_time']),
            'rawHours' => $raw,
            'hours' => $raw,
            'credited' => $raw,
            'hasBreak' => false,
            'coversLunch' => ($s < 780 && $e > 720),
            'isHalfDaySat' => ($isOffice && strtoupper(substr(trim($p['day_of_week']), 0, 3)) === 'SAT'),
            'reviewStatus' => $p['review_status'] ?? 'PENDING',
            'reviewNotes' => $p['review_notes'] ?? null,
            'reviewedAt' => $p['reviewed_at'] ?? null,
            'createdAt' => $p['created_at'],
        ];
    }, $prefs->fetchAll());
    $prefRows = credit_once_per_day($prefRows, $isOffice);
    foreach ($prefRows as &$pr) {
        $pr['hours'] = $pr['credited'];
    }
    unset($pr);

    respond([
        'success' => true,
        'semester' => $sem,
        'classes' => $classRows,
        'classHours' => round(array_sum(array_column($classRows, 'hours')), 1),
        'duty' => $dutyRows,
        'blocks' => $blocks,
        'dutyHours' => round(array_sum(array_column($blocks, 'hours')), 1),
        'creditedHours' => round(array_sum(array_column($blocks, 'credited')), 1),
        'preferences' => $prefRows,
        'preferenceHours' => round(array_sum(array_column($prefRows, 'credited')), 1),
        'clashes' => duty_class_clashes($sem['id'], $saId),
        'publication' => publication($sem['id']),
    ]);

// ------------------------------------------------ WEEKLY DUTY GRID & FINALIZED SCHEDULE (Pages 6 & 7)
case 'room_grid':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $grid = room_grid($sem['id']);
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $grid,
        'progress' => $grid['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'post_accept':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $room = trim((string) ($in['room'] ?? ''));
    if ($room === '') fail('Specify the room post to approve.', 422);
    $grid = post_accept($sem['id'], $room, (int) $user['id']);
    audit('ROOM_POST_APPROVED', "{$sem['label']}: approved room {$room}");
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $grid,
        'progress' => $grid['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'post_accept_all':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $grid = post_accept_all($sem['id'], (int) $user['id']);
    audit('ALL_ROOM_POSTS_APPROVED', "{$sem['label']}: approved all matched room recommendations");
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $grid,
        'progress' => $grid['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'post_swap':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $room = trim((string) ($in['room'] ?? ''));
    $dropSaId = (int) ($in['dropSaId'] ?? 0);
    $pickSaId = (int) ($in['pickSaId'] ?? 0);
    if ($room === '' || !$pickSaId) fail('Choose a room and replacement S.A.', 422);
    $grid = post_swap($sem['id'], $room, $dropSaId, $pickSaId, (int) $user['id']);
    audit('ROOM_SA_SWAPPED', "{$sem['label']}: {$room} swapped SA #{$dropSaId} -> SA #{$pickSaId}");
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $grid,
        'progress' => $grid['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'post_staff_approve':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $room = trim((string) ($in['room'] ?? ''));
    $saId = (int) ($in['saId'] ?? 0);
    $targetRoom = isset($in['targetRoom']) ? trim((string) $in['targetRoom']) : null;
    if ($room === '' || !$saId) fail('Select an S.A. and room post to approve.', 422);
    $grid = post_staff_approve($sem['id'], $room, $saId, (int) $user['id'], $targetRoom);
    audit('ROOM_SA_APPROVED', "{$sem['label']}: approved SA #{$saId} on " . ($targetRoom ?: $room));
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $grid,
        'progress' => $grid['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'post_staff_fit_rooms':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $saId = (int) ($in['saId'] ?? 0);
    if (!$saId) fail('Select an S.A.', 422);
    respond([
        'success' => true,
        'rooms' => sa_fitting_rooms($sem['id'], $saId),
    ]);

case 'post_staff_reject':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $room = trim((string) ($in['room'] ?? ''));
    $saId = (int) ($in['saId'] ?? 0);
    if ($room === '' || !$saId) fail('Select an S.A. and room post to unassign.', 422);
    $grid = post_staff_reject($sem['id'], $room, $saId, (int) $user['id']);
    audit('ROOM_SA_REJECTED', "{$sem['label']}: unassigned SA #{$saId} from {$room}");
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $grid,
        'progress' => $grid['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'post_duty_save':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $room = trim((string) ($in['room'] ?? ''));
    $slotId = (int) ($in['slotId'] ?? 0);
    $saId = (int) ($in['saId'] ?? 0);
    $blocksInput = is_array($in['blocks'] ?? null) ? $in['blocks'] : [];
    $resetToAuto = !empty($in['resetToAuto']);
    if ($room === '' || !$saId) {
        fail('Pumili ng room at S.A. na ie-edit ang duty hours.', 422);
    }
    $grid = post_duty_save($sem['id'], $room, $slotId, $saId, $blocksInput, (int) $user['id'], $resetToAuto);
    audit(
        'ROOM_SA_DUTY_ADJUSTED',
        "{$sem['label']}: " . ($resetToAuto ? 'reset' : 'adjusted') . " duty hours for SA #{$saId} in room {$room}"
    );
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $grid,
        'progress' => $grid['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'batch_approve_lock':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $notes = trim((string) ($in['notes'] ?? ''));
    $res = batch_approve_lock($sem['id'], (int) $user['id'], $notes);
    audit('MATCHING_BATCH_APPROVED_LOCKED', "{$sem['label']}: approved and locked room assignment batch");
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $res['grid'],
        'lockInfo' => $res['lockInfo'],
        'run' => $res['currentRun'],
        'ready' => $res['inputs'],
        'progress' => $res['grid']['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'batch_unlock':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $pdo->prepare('UPDATE matching_runs SET batch_status = "DRAFT", approved_by = NULL, approved_at = NULL, lock_notes = NULL WHERE semester_id = ?')->execute([$sem['id']]);
    audit('MATCHING_BATCH_UNLOCKED', "{$sem['label']}: unlocked room assignment batch for editing");
    $grid = room_grid($sem['id']);
    $lockInfo = get_matching_batch_lock_info($sem['id']);
    $activeRun = matching_result($sem['id'], false);
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $grid,
        'lockInfo' => $lockInfo,
        'run' => $activeRun,
        'progress' => $grid['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'authorized_reassign_room_sa':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $res = authorized_reassign_room_sa($sem['id'], $in, (int) $user['id']);
    $roomLabel = trim((string) ($in['room'] ?? ''));
    $reasonLabel = trim((string) ($in['reason'] ?? ''));
    audit('AUTHORIZED_ROOM_REASSIGNMENT', "{$sem['label']}: authorized reassignment on {$roomLabel} — Reason: {$reasonLabel}");
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $res['grid'],
        'lockInfo' => $res['lockInfo'],
        'run' => $res['currentRun'],
        'ready' => $res['inputs'],
        'progress' => $res['grid']['progress'] ?? ['total' => 0, 'decided' => 0, 'pending' => 0, 'gaps' => 0],
        'publication' => publication($sem['id']),
    ]);

case 'mark_sa_for_reassignment':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $saId = (int) ($in['saId'] ?? 0);
    $marked = !empty($in['marked']);
    $reason = trim((string) ($in['reason'] ?? ''));
    $res = mark_sa_for_reassignment($sem['id'], $saId, $marked, $reason, (int) $user['id']);
    audit(
        $marked ? 'SA_MARKED_FOR_REASSIGNMENT' : 'SA_REASSIGNMENT_CLEARED',
        "{$sem['label']}: SA #{$saId} " . ($marked ? "marked for reassignment ({$reason})" : 'reassignment flag cleared')
    );
    respond([
        'success' => true,
        'semester' => $sem,
        'ready' => $res['inputs'],
        'grid' => $res['grid'],
        'lockInfo' => $res['lockInfo'],
    ]);

case 'relief_coverage_candidates':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $room = trim((string) ($in['room'] ?? ''));
    $coverageDate = trim((string) ($in['coverageDate'] ?? ''));
    $startTime = trim((string) ($in['startTime'] ?? ''));
    $endTime = trim((string) ($in['endTime'] ?? ''));
    $primarySaId = !empty($in['primarySaId']) ? (int) $in['primarySaId'] : null;
    $cand = relief_coverage_candidates($sem['id'], $room, $coverageDate, $startTime, $endTime, $primarySaId);
    respond([
        'success' => true,
        'semester' => $sem,
        'candidates' => $cand,
    ]);

case 'relief_coverage_save':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $res = relief_coverage_save($sem['id'], $in, (int) $user['id']);
    $roomLabel = trim((string) ($in['room'] ?? ''));
    $dateLabel = trim((string) ($in['coverageDate'] ?? ''));
    $relSaId = (int) ($in['relieverSaId'] ?? 0);
    audit('RELIEF_COVERAGE_CONFIRMED', "{$sem['label']}: Reliever SA #{$relSaId} confirmed for {$roomLabel} on {$dateLabel}");
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $res['grid'],
        'details' => $res['details'],
    ]);

case 'relief_coverage_update_status':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $coverageId = (int) ($in['coverageId'] ?? 0);
    $status = trim((string) ($in['status'] ?? 'COMPLETED'));
    $outcome = trim((string) ($in['outcome'] ?? ''));
    if ($coverageId <= 0) fail('Coverage ID is required.', 422);
    $res = relief_coverage_update_status($sem['id'], $coverageId, $status, $outcome, (int) $user['id']);
    audit('RELIEF_COVERAGE_STATUS_UPDATED', "{$sem['label']}: Reliever coverage #{$coverageId} marked {$status}");
    respond([
        'success' => true,
        'semester' => $sem,
        'grid' => $res['grid'],
        'details' => $res['details'],
    ]);

case 'room_board_details':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $room = trim((string) ($in['room'] ?? ''));
    if ($room === '') fail('Room is required.', 422);
    respond([
        'success' => true,
        'semester' => $sem,
        'details' => room_board_details($sem['id'], $room),
    ]);

case 'schedule_view':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $sched = schedule_view($sem['id']);
    respond([
        'success' => true,
        'semester' => $sem,
        'schedule' => $sched,
        'decided' => $sched['summary']['roomSlotsAccepted'] ?? 0,
        'pending' => $sched['summary']['roomSlotsPending'] ?? 0,
    ]);

case 'schedule_finalize':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $sched = finalize_schedule($sem['id'], (int) $user['id']);
    audit('SCHEDULE_FINALIZED', "{$sem['label']}: finalized {$sched['summary']['sas']} S.A. schedules ({$sched['summary']['hours']} credited hrs)");
    respond([
        'success' => true,
        'semester' => $sem,
        'schedule' => $sched,
    ]);

case 'schedule_publish':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $sched = publish_schedule($sem['id'], (int) $user['id']);
    audit('SCHEDULE_PUBLISHED', "{$sem['label']}: published official semester duty schedule");
    respond([
        'success' => true,
        'semester' => $sem,
        'schedule' => $sched,
    ]);

case 'final_schedule_save_sa':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $saId = (int) ($in['saId'] ?? 0);
    $blocksInput = is_array($in['blocks'] ?? null) ? $in['blocks'] : [];
    $reason = trim((string) ($in['reason'] ?? ''));
    if (!$saId) fail('Select a Student Assistant to edit.', 422);
    if ($reason === '') fail('Please enter a reason for modifying this Student Assistant schedule.', 422);

    $sched = final_schedule_save_sa($sem['id'], $saId, $blocksInput, $reason, (int) $user['id']);
    audit(
        'FINAL_SCHEDULE_SA_EDITED',
        "{$sem['label']}: edited final schedule of {$sched['notifiedSaName']} (SA #{$saId}) | Reason: {$reason}"
    );
    respond([
        'success' => true,
        'semester' => $sem,
        'schedule' => $sched,
        'notifiedSaName' => $sched['notifiedSaName'] ?? '',
        'notifiedSupervisorNames' => $sched['notifiedSupervisorNames'] ?? [],
    ]);

case 'apply_enrollment_schedule':
    require_role($user, 'ADMIN');
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $res = apply_enrollment_schedule($sem['id'], (int) $user['id']);
    respond($res);

case 'reset_semester_schedule':
    require_role($user, 'ADMIN');
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $res = reset_semester_schedule($sem['id'], (int) $user['id']);
    respond($res);

// ------------------------------------------------- ROOM MASTER + UTILIZATION
// Imported from the NCST room assignment workbook (parsed in the browser).
// Utilization = when a room is in use. Duty requirements are generated from it.
case 'rooms_overview':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $stmt = $pdo->prepare(
        'SELECT r.*,
                (SELECT COUNT(*) FROM room_utilization u WHERE u.room_id = r.id AND u.semester_id = ?) AS periods,
                (SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, u.start_time, u.end_time)),0) / 60
                   FROM room_utilization u WHERE u.room_id = r.id AND u.semester_id = ?) AS hours,
                (SELECT COUNT(*) FROM room_requirements q WHERE q.room_id = r.id AND q.semester_id = ?) AS legacy_requirements
           FROM rooms r WHERE r.is_active = 1 ORDER BY r.building, r.code'
    );
    $stmt->execute([$sem['id'], $sem['id'], $sem['id']]);

    // How each room is set up now. One duty can cover several rooms, so the
    // rooms it serves are read from room_ids rather than room_id alone.
    $setup = [];
    $q = $pdo->prepare('SELECT room_ids, room_id, room, department_type, required_sa, COUNT(*) AS periods
                          FROM room_requirements WHERE semester_id = ?
                         GROUP BY room_ids, room_id, room, department_type, required_sa');
    $q->execute([$sem['id']]);
    foreach ($q as $row) {
        $ids = $row['room_ids'] ? array_map('intval', explode(',', $row['room_ids']))
             : ($row['room_id'] ? [(int) $row['room_id']] : []);
        foreach ($ids as $roomId) {
            $setup[$roomId] = [
                'departmentType' => $row['department_type'],
                'requiredSa' => (int) $row['required_sa'],
                'sharedWith' => count($ids) > 1 ? $row['room'] : null,
                'periods' => (int) $row['periods'],
            ];
        }
    }

    respond(['success' => true, 'semester' => $sem,
             'rooms' => array_map(fn($r) => [
                 'id' => (int) $r['id'],
                 'code' => $r['code'],
                 'building' => $r['building'],
                 'description' => $r['description'],
                 'roomType' => $r['room_type'],
                 'capacity' => $r['capacity'] !== null ? (int) $r['capacity'] : null,
                 'periods' => (int) $r['periods'],
                 'hours' => round((float) $r['hours'], 1),
                 'requirements' => $setup[(int) $r['id']]['periods'] ?? 0,
                 'departmentType' => $setup[(int) $r['id']]['departmentType'] ?? null,
                 'requiredSa' => $setup[(int) $r['id']]['requiredSa'] ?? null,
                 'sharedWith' => $setup[(int) $r['id']]['sharedWith'] ?? null,
                 'schedule' => room_schedule_summary((int) $r['id'], $sem['id']),
             ], $stmt->fetchAll())]);

case 'rooms_import':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $roomRows = $in['rooms'] ?? [];
    $periodRows = $in['periods'] ?? [];
    if (!is_array($roomRows) || !$roomRows) fail('No rooms were found in that file.', 422);
    if (count($roomRows) > 500 || count($periodRows) > 20000) fail('That file is larger than this import supports.', 422);

    $types = ['COMPUTER_LAB', 'LABORATORY', 'LECTURE', 'OTHER'];
    $pdo->beginTransaction();
    try {
        $upsertRoom = $pdo->prepare(
            'INSERT INTO rooms (code, building, description, room_type, capacity)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE building = VALUES(building), description = VALUES(description),
                                     room_type = VALUES(room_type), capacity = VALUES(capacity), is_active = 1'
        );
        $roomIds = [];
        $newRooms = 0;
        foreach ($roomRows as $r) {
            $code = mb_substr(trim((string) ($r['code'] ?? '')), 0, 40);
            if ($code === '') continue;
            $type = strtoupper((string) ($r['roomType'] ?? 'OTHER'));
            $upsertRoom->execute([
                $code,
                mb_substr(trim((string) ($r['building'] ?? 'Unknown')), 0, 60),
                mb_substr(trim((string) ($r['description'] ?? '')), 0, 160) ?: null,
                in_array($type, $types, true) ? $type : 'OTHER',
                isset($r['capacity']) && $r['capacity'] !== null ? (int) $r['capacity'] : null,
            ]);
            if ($upsertRoom->rowCount() === 1) $newRooms++;
            $lookup = $pdo->prepare('SELECT id FROM rooms WHERE code = ?');
            $lookup->execute([$code]);
            $roomIds[$code] = (int) $lookup->fetchColumn();
        }

        // The workbook is the whole truth for this semester: replace what it covers
        $pdo->prepare('DELETE FROM room_utilization WHERE semester_id = ?')->execute([$sem['id']]);
        $insert = $pdo->prepare(
            'INSERT IGNORE INTO room_utilization (semester_id, room_id, day_of_week, start_time, end_time, class_name)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
        $imported = 0;
        $skipped = 0;
        foreach ($periodRows as $p) {
            $roomId = $roomIds[trim((string) ($p['room'] ?? ''))] ?? null;
            $day = strtoupper((string) ($p['day'] ?? ''));
            $start = parse_time((string) ($p['startTime'] ?? ''));
            $end = parse_time((string) ($p['endTime'] ?? ''));
            if (!$roomId || !in_array($day, $days, true) || !$start || !$end || $end <= $start) { $skipped++; continue; }
            $subj = trim((string) ($p['subject'] ?? ''));
            $sec = trim((string) ($p['section'] ?? ''));
            $className = mb_substr($subj . ($sec !== '' ? ' ' . $sec : ''), 0, 120) ?: null;
            $insert->execute([$sem['id'], $roomId, $day, $start, $end, $className]);
            $imported += $insert->rowCount();
        }

        audit('ROOMS_IMPORTED', sprintf('%s: %d room(s) (%d new), %d utilization period(s), %d skipped',
              $sem['label'], count($roomIds), $newRooms, $imported, $skipped));
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        error_log('Room import failed: ' . $ex->getMessage());
        fail('The rooms could not be imported. Try again.', 500);
    }

    respond(['success' => true, 'rooms' => count($roomIds), 'newRooms' => $newRooms,
             'periods' => $imported, 'skipped' => $skipped]);

case 'room_utilization':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $roomId = (int) ($in['roomId'] ?? 0);
    $roomCode = trim((string) ($in['roomCode'] ?? ''));
    if (!$roomId && $roomCode !== '') {
        $st = $pdo->prepare('SELECT id FROM rooms WHERE code = ? LIMIT 1');
        $st->execute([$roomCode]);
        $roomId = (int) $st->fetchColumn();
    }
    $stmt = $pdo->prepare(
        'SELECT u.*, r.code FROM room_utilization u JOIN rooms r ON r.id = u.room_id
          WHERE u.semester_id = ? AND (u.room_id = ? OR (? != "" AND r.code = ?))
          ORDER BY FIELD(u.day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), u.start_time'
    );
    $stmt->execute([$sem['id'], $roomId, $roomCode, $roomCode]);
    $rows = $stmt->fetchAll();
    if (empty($rows) && ($roomId || $roomCode !== '')) {
        $stmt2 = $pdo->prepare(
            'SELECT q.id, q.day_of_week, q.start_time, q.end_time, q.class_name, q.room as code
               FROM room_requirements q
              WHERE q.semester_id = ? AND (q.room_id = ? OR (? != "" AND q.room = ?))
              ORDER BY FIELD(q.day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), q.start_time'
        );
        $stmt2->execute([$sem['id'], $roomId, $roomCode, $roomCode]);
        $rows = $stmt2->fetchAll();
    }
    respond(['success' => true, 'items' => array_map(fn($u) => [
        'id' => (int) $u['id'],
        'day' => $u['day_of_week'],
        'startTime' => $u['start_time'],
        'endTime' => $u['end_time'],
        'startLabel' => format_time($u['start_time']),
        'endLabel' => format_time($u['end_time']),
        'className' => $u['class_name'],
    ], $rows)]);

case 'room_utilization_save':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $roomId = (int) ($in['roomId'] ?? 0);
    $id = (int) ($in['id'] ?? 0);
    $day = parse_day((string) ($in['day'] ?? ''));
    $start = parse_time((string) ($in['startTime'] ?? ''));
    $end = parse_time((string) ($in['endTime'] ?? ''));
    $className = trim((string) ($in['className'] ?? ''));

    $e = [];
    if (!$roomId) $e['roomId'] = 'Room is required.';
    if (!$day) $e['day'] = 'Choose a day.';
    if (!$start) $e['startTime'] = 'Enter valid start time.';
    if (!$end) $e['endTime'] = 'Enter valid end time.';
    elseif ($start && $end <= $start) $e['endTime'] = 'End time must be after start time.';

    if ($e) fail('Check highlighted fields.', 422, ['errors' => $e]);

    try {
        if ($id) {
            $stmt = $pdo->prepare('UPDATE room_utilization SET day_of_week = ?, start_time = ?, end_time = ?, class_name = ? WHERE id = ? AND semester_id = ?');
            $stmt->execute([$day, $start, $end, $className ?: null, $id, $sem['id']]);
        } else {
            $stmt = $pdo->prepare('INSERT INTO room_utilization (semester_id, room_id, day_of_week, start_time, end_time, class_name) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$sem['id'], $roomId, $day, $start, $end, $className ?: null]);
            $id = (int) $pdo->lastInsertId();
        }
        sync_room_requirements_for_room($sem['id'], $roomId, (int) $user['id']);
    } catch (\PDOException $ex) {
        if ($ex->getCode() == 23000) {
            fail('A class period already exists at this exact day and time for this room.', 422);
        }
        throw $ex;
    }
    respond(['success' => true, 'id' => $id]);

case 'room_utilization_delete':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $id = (int) ($in['id'] ?? 0);
    $rStmt = $pdo->prepare('SELECT room_id FROM room_utilization WHERE id = ? AND semester_id = ? LIMIT 1');
    $rStmt->execute([$id, $sem['id']]);
    $delRoomId = (int) $rStmt->fetchColumn();
    $pdo->prepare('DELETE FROM room_utilization WHERE id = ? AND semester_id = ?')->execute([$id, $sem['id']]);
    if ($delRoomId) {
        sync_room_requirements_for_room($sem['id'], $delRoomId, (int) $user['id']);
    }
    respond(['success' => true]);

// Turns a room's utilization into duty requirements the matching engine can fill.
case 'rooms_setup_save':
    // Room Setup decides which rooms the scheduling engine sees at all:
    // every room sent here gets duty requirements built from its imported
    // schedule, and any room left out loses the ones it had.
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);

    // Each entry is one duty post: usually a single room, but an ACADS S.A.
    // often watches a few rooms at once, so a post can list several.
    $posts = [];
    foreach ((array) ($in['posts'] ?? []) as $post) {
        if (!is_array($post)) continue;
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) ($post['roomIds'] ?? [])))));
        $dept = strtoupper(trim((string) ($post['departmentType'] ?? '')));
        $required = (int) ($post['requiredSa'] ?? 1);
        if (!$ids) continue;
        if (!in_array($dept, ['ACADS', 'ITO'], true)) {
            fail('Choose ACADS or ITO for every room. Offices are staffed in Office Staffing.', 422,
                 ['errors' => ['departmentType' => 'Choose a department.']]);
        }
        if ($required < 1 || $required > 20) {
            fail('Required S.A. must be 1 to 20.', 422, ['errors' => ['requiredSa' => 'Enter 1 to 20.']]);
        }
        $posts[] = ['rooms' => $ids, 'department' => $dept, 'required' => $required];
    }

    $allIds = array_values(array_unique(array_merge(...array_column($posts, 'rooms') ?: [[]])));
    $periods = [];
    if ($allIds) {
        $placeholders = implode(',', array_fill(0, count($allIds), '?'));
        $stmt = $pdo->prepare(
            "SELECT u.room_id, r.code, u.day_of_week, u.start_time, u.end_time, u.class_name AS subject
               FROM room_utilization u JOIN rooms r ON r.id = u.room_id
              WHERE u.semester_id = ? AND u.room_id IN ($placeholders)
              ORDER BY FIELD(u.day_of_week,'MON','TUE','WED','THU','FRI','SAT','SUN'), u.start_time"
        );
        $stmt->execute([$sem['id'], ...$allIds]);
        $periods = $stmt->fetchAll();
    }
    $byRoom = [];
    foreach ($periods as $row) $byRoom[(int) $row['room_id']][] = $row;

    // Back-to-back periods become one duty block, so an S.A. covers the post for
    // a stretch instead of a string of short shifts. A room in use 7:00 AM to
    // 10:00 PM would otherwise make one 15-hour duty nobody can take, so a block
    // closes once it reaches MAX_DUTY_BLOCK_HOURS and the next one starts there.
    // A post covering several rooms merges all of their periods into one timeline.
    $blocks = [];
    foreach ($posts as $index => $post) {
        $rows = [];
        foreach ($post['rooms'] as $roomId) {
            foreach ($byRoom[$roomId] ?? [] as $row) $rows[] = $row;
        }
        $dayOrder = array_flip(array_keys(DAYS));            // MON..SUN
        usort($rows, fn($a, $b) => [$dayOrder[$a['day_of_week']], $a['start_time']]
                               <=> [$dayOrder[$b['day_of_week']], $b['start_time']]);

        $codes = [];
        foreach ($post['rooms'] as $roomId) {
            $code = $byRoom[$roomId][0]['code'] ?? null;
            if ($code !== null) $codes[] = $code;
        }
        $label = mb_substr(implode(' / ', $codes), 0, 40);

        foreach ($rows as $row) {
            $key = $index . '|' . $row['day_of_week'];
            $i = count($blocks[$key] ?? []) - 1;
            $subject = trim((string) ($row['subject'] ?? ''));
            if ($i >= 0 && $blocks[$key][$i]['end'] >= $row['start_time']
                && time_span_hours($blocks[$key][$i]['start'], max($blocks[$key][$i]['end'], $row['end_time'])) <= MAX_DUTY_BLOCK_HOURS) {
                $blocks[$key][$i]['end'] = max($blocks[$key][$i]['end'], $row['end_time']);
                if ($subject && !in_array($subject, $blocks[$key][$i]['classes'], true)) {
                    $blocks[$key][$i]['classes'][] = $subject;
                }
                continue;
            }
            $blocks[$key][] = ['post' => $index, 'label' => $label, 'roomId' => $post['rooms'][0],
                               'roomIds' => implode(',', $post['rooms']), 'day' => $row['day_of_week'],
                               'start' => $row['start_time'], 'end' => $row['end_time'],
                               'classes' => $subject ? [$subject] : []];
        }
    }

    $pdo->beginTransaction();
    try {
        // Rows added by hand (no room_id) are left alone
        $pdo->prepare('DELETE FROM room_requirements WHERE semester_id = ? AND room_id IS NOT NULL')->execute([$sem['id']]);

        $insert = $pdo->prepare(
            'INSERT IGNORE INTO room_requirements (semester_id, department_type, room, room_id, room_ids, day_of_week, start_time, end_time, class_name, required_sa, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $created = 0;
        foreach ($blocks as $list) {
            foreach ($list as $b) {
                $post = $posts[$b['post']];
                $className = $b['classes'] ? mb_substr(implode(' / ', $b['classes']), 0, 120) : null;
                $insert->execute([$sem['id'], $post['department'], $b['label'], $b['roomId'], $b['roomIds'],
                                  $b['day'], $b['start'], $b['end'], $className, $post['required'],
                                  'From Room Setup', $user['id']]);
                $created += $insert->rowCount();
            }
        }
        audit('ROOM_SETUP_SAVED', sprintf('%s: %d duty post(s) over %d room(s), %d duty period(s)',
              $sem['label'], count($posts), count($allIds), $created));
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        error_log('Room setup failed: ' . $ex->getMessage());
        fail('The room setup could not be saved. Try again.', 500);
    }

    reconcile_matching_with_live_data($sem['id']);
    respond(['success' => true, 'rooms' => count($allIds), 'posts' => count($posts), 'created' => $created]);

case 'room_requirement_update':
    $sem = target_semester(isset($in['semesterId']) ? (int) $in['semesterId'] : null);
    $room = trim((string) ($in['room'] ?? ''));
    if (!$room) fail('Room name is required.', 422);

    $dept = strtoupper(trim((string) ($in['departmentType'] ?? '')));
    if (!in_array($dept, ['ACADS', 'ITO'], true)) {
        fail('Choose ACADS or ITO.', 422);
    }

    $required = (int) ($in['requiredSa'] ?? 1);
    if ($required < 1 || $required > 20) {
        fail('Required S.A. must be between 1 and 20.', 422);
    }

    $stmt = $pdo->prepare('UPDATE room_requirements SET department_type = ?, required_sa = ? WHERE semester_id = ? AND room = ?');
    $stmt->execute([$dept, $required, $sem['id'], $room]);
    $affected = $stmt->rowCount();

    if (!empty($in['roomType'])) {
        $rt = strtoupper(trim((string) $in['roomType']));
        if (in_array($rt, ['COMPUTER_LAB', 'LABORATORY', 'LECTURE', 'OTHER'], true)) {
            $pdo->prepare('UPDATE rooms SET room_type = ? WHERE code = ?')->execute([$rt, $room]);
        }
    }

    reconcile_matching_with_live_data($sem['id']);
    audit('ROOM_REQUIREMENT_UPDATED', "{$sem['label']}: Room {$room} updated to {$dept}, {$required} S.A.");
    respond(['success' => true, 'affected' => $affected]);

default:
    fail('Unknown action.', 400);
}
