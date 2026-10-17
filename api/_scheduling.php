<?php
// Shared Scheduling logic: day/time parsing, CSV import validation, output format.

const DAYS = ['MON' => 'Monday', 'TUE' => 'Tuesday', 'WED' => 'Wednesday', 'THU' => 'Thursday',
              'FRI' => 'Friday', 'SAT' => 'Saturday', 'SUN' => 'Sunday'];

const MAX_IMPORT_ROWS = 2000;

// The longest duty block Room Setup builds from a room's schedule. Anything
// longer is split, because an S.A. can't take a shift the engine would reject.
const MAX_DUTY_BLOCK_HOURS = 4.0;

/** "Monday", "MON", "M" -> "MON"; null when unrecognised. */
function parse_day(string $raw): ?string
{
    $v = strtoupper(trim($raw));
    if ($v === '') return null;
    if (str_starts_with($v, 'MON')) return 'MON';
    if (str_starts_with($v, 'TUES') || str_starts_with($v, 'TUE')) return 'TUE';
    if (str_starts_with($v, 'WED')) return 'WED';
    if (str_starts_with($v, 'THURS') || str_starts_with($v, 'THU')) return 'THU';
    if (str_starts_with($v, 'FRI')) return 'FRI';
    if (str_starts_with($v, 'SAT')) return 'SAT';
    if (str_starts_with($v, 'SUN')) return 'SUN';
    foreach (DAYS as $code => $name) {
        if ($v === $code || $v === strtoupper($name) || $v === substr(strtoupper($name), 0, 3)) return $code;
    }
    return match ($v) { 'M' => 'MON', 'T' => 'TUE', 'W' => 'WED', 'TH' => 'THU', 'F' => 'FRI',
                        'S' => 'SAT', 'SU' => 'SUN', 'R' => 'THU', 'U' => 'SUN', default => null };
}

/** "8:00 AM", "08:00", "13:30" -> "08:00:00"; null when unrecognised. */
function parse_time(string $raw): ?string
{
    if (preg_match('/[-–—]/', $raw)) {
        $parts = preg_split('/[-–—]/', $raw);
        $raw = trim($parts[0] ?? '');
    }
    $v = strtoupper(trim(str_replace(['.', ' '], ['', ' '], $raw)));
    if ($v === '') return null;
    if (!preg_match('/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?$/', $v, $m)) return null;
    $h = (int) $m[1];
    $min = (int) ($m[2] ?? 0);
    $ampm = $m[3] ?? null;
    if ($ampm === 'AM' && $h === 12) $h = 0;
    if ($ampm === 'PM' && $h < 12) $h += 12;
    if ($h > 23 || $min > 59) return null;
    return sprintf('%02d:%02d:00', $h, $min);
}

function format_time(string $sqlTime): string
{
    return date('g:i A', strtotime($sqlTime));
}

/** Minutes between two SQL times. */
function time_span_hours(string $start, string $end): float
{
    return round((strtotime($end) - strtotime($start)) / 3600, 2);
}

/**
 * Reads CSV text into rows keyed by canonical column names.
 * $columns maps canonical name => accepted header spellings.
 * Returns [rows, error]; each row is ['_line' => n, canonical => value, ...].
 */
function read_csv(string $text, array $columns, array $optional = ['section', 'requiredSa']): array
{
    $text = preg_replace('/^\xEF\xBB\xBF/', '', trim($text));     // strip BOM
    if ($text === '') return [[], 'The file is empty.'];

    $lines = preg_split('/\r\n|\r|\n/', $text);
    $header = null;
    $map = [];
    $rows = [];

    foreach ($lines as $i => $line) {
        if (trim($line) === '') continue;
        $cells = str_getcsv($line);

        if ($header === null) {
            $header = array_map(fn($h) => strtolower(preg_replace('/[^a-z0-9]/i', '', (string) $h)), $cells);
            foreach ($columns as $canonical => $accepted) {
                foreach ($accepted as $spelling) {
                    $pos = array_search(strtolower(preg_replace('/[^a-z0-9]/i', '', $spelling)), $header, true);
                    if ($pos !== false) { $map[$canonical] = $pos; break; }
                }
            }
            $missing = array_diff(array_keys($columns), array_keys($map), $optional);
            if ($missing) {
                return [[], 'The file is missing these columns: ' . implode(', ', $missing) . '. Download the template to see the expected format.'];
            }
            continue;
        }

        if (count($rows) >= MAX_IMPORT_ROWS) {
            return [$rows, 'The file has more than ' . MAX_IMPORT_ROWS . ' rows. Split it into smaller files.'];
        }
        $row = ['_line' => $i + 1];
        foreach (array_keys($columns) as $canonical) {
            $pos = $map[$canonical] ?? null;
            $row[$canonical] = $pos === null ? '' : trim((string) ($cells[$pos] ?? ''));
        }
        if (implode('', array_map(fn($k) => $row[$k], array_keys($map))) === '') continue; // blank line
        $rows[] = $row;
    }

    if ($header === null) return [[], 'The file has no header row.'];
    return [$rows, null];
}

/**
 * Rows already parsed in the browser (Excel import) reshaped exactly like
 * read_csv() output, so both import paths share one validator.
 * Returns [rows, error].
 */
function read_rows(array $raw, array $columns): array
{
    if (count($raw) > MAX_IMPORT_ROWS) {
        return [[], 'That file holds more than ' . MAX_IMPORT_ROWS . ' rows. Import it in smaller parts.'];
    }
    $rows = [];
    foreach (array_values($raw) as $i => $item) {
        if (!is_array($item)) continue;
        $row = ['_line' => isset($item['_line']) ? (int) $item['_line'] : $i + 1];
        foreach (array_keys($columns) as $canonical) {
            $value = $item[$canonical] ?? '';
            $row[$canonical] = is_scalar($value) ? trim((string) $value) : '';
        }
        $rows[] = $row;
    }
    return [$rows, $rows ? null : 'The file has no rows to import.'];
}

const CLASS_COLUMNS = [
    'studentId' => ['student_id', 'studentid', 'student number', 'student no', 'student'],
    'day' => ['day', 'day_of_week', 'weekday'],
    'startTime' => ['start_time', 'start', 'time_start', 'from'],
    'endTime' => ['end_time', 'end', 'time_end', 'to'],
    'subject' => ['subject', 'subject_code', 'course_code', 'code'],
    'section' => ['section', 'block', 'class_section'],
];

/**
 * Validates class-schedule rows against the S.A. records already registered.
 * Returns rows with status VALID | WARNING (skipped) | ERROR (skipped).
 */
function check_class_rows(array $rows, int $semesterId): array
{
    global $pdo;

    $profiles = [];
    foreach ($pdo->query('SELECT id, student_id, first_name, last_name FROM sa_profiles') as $p) {
        $profiles[strtoupper($p['student_id'])] = $p;
    }
    $existing = [];
    $stmt = $pdo->prepare('SELECT sa_profile_id, day_of_week, start_time, end_time, subject FROM class_schedules
                            WHERE semester_id = ? AND archived_at IS NULL');
    $stmt->execute([$semesterId]);
    foreach ($stmt as $c) {
        $existing[$c['sa_profile_id']][] = $c;
    }

    $seen = [];
    $checked = [];
    foreach ($rows as $row) {
        $out = $row + ['status' => 'VALID', 'message' => '', 'name' => '', 'saProfileId' => null];
        $key = strtoupper($row['studentId']);
        $profile = $profiles[$key] ?? null;
        $day = parse_day($row['day']);
        $start = parse_time($row['startTime']);
        $end = parse_time($row['endTime']);

        if (!$profile) {
            $out['status'] = 'ERROR';
            $out['message'] = 'No S.A. is registered with this student ID.';
        } elseif (!$day) {
            $out['status'] = 'ERROR';
            $out['message'] = 'Day not recognised. Use Monday–Sunday.';
        } elseif (!$start || !$end) {
            $out['status'] = 'ERROR';
            $out['message'] = 'Time not recognised. Use 8:00 AM or 08:00.';
        } elseif ($end <= $start) {
            $out['status'] = 'ERROR';
            $out['message'] = 'End time must be after the start time.';
        } elseif ($row['subject'] === '') {
            $out['status'] = 'ERROR';
            $out['message'] = 'Subject is required.';
        } elseif (mb_strlen($row['subject']) > 60 || mb_strlen($row['section']) > 40) {
            $out['status'] = 'ERROR';
            $out['message'] = 'Subject or section is too long.';
        }

        if ($profile) {
            $out['name'] = $profile['first_name'] . ' ' . $profile['last_name'];
            $out['saProfileId'] = (int) $profile['id'];
        }
        $out['day'] = $day ?? $row['day'];
        $out['startTime'] = $start ?? $row['startTime'];
        $out['endTime'] = $end ?? $row['endTime'];
        $out['startLabel'] = $start ? format_time($start) : $row['startTime'];
        $out['endLabel'] = $end ? format_time($end) : $row['endTime'];

        if ($out['status'] === 'VALID') {
            $dup = $profile['id'] . '|' . $day . '|' . $start . '|' . strtoupper($row['subject']);
            if (isset($seen[$dup])) {
                $out['status'] = 'WARNING';
                $out['message'] = 'Same row appears earlier in this file. It will be skipped.';
            } else {
                $seen[$dup] = true;
                foreach ($existing[$profile['id']] ?? [] as $c) {
                    if ($c['day_of_week'] === $day && $c['start_time'] === $start && strcasecmp($c['subject'], $row['subject']) === 0) {
                        $out['status'] = 'WARNING';
                        $out['message'] = 'Already imported for this semester. It will be skipped.';
                        break;
                    }
                    if ($c['day_of_week'] === $day && $start < $c['end_time'] && $end > $c['start_time']) {
                        $out['status'] = 'WARNING';
                        $out['message'] = 'Overlaps an existing class (' . $c['subject'] . ' ' . format_time($c['start_time']) . '). It will be skipped.';
                        break;
                    }
                }
            }
        }
        $checked[] = $out;
    }
    return $checked;
}

function import_summary(array $checked): array
{
    $count = fn($status) => count(array_filter($checked, fn($r) => $r['status'] === $status));
    return [
        'found' => count($checked),
        'valid' => $count('VALID'),
        'warnings' => $count('WARNING'),
        'errors' => $count('ERROR'),
    ];
}

/**
 * A room's week in a few lines: the distinct time ranges it is in use and the
 * days each one runs, e.g. [{days: "Mon - Fri", time: "7:00 AM - 10:00 AM"}].
 */
function room_schedule_summary(int $roomId, int $semesterId, int $limit = 4): array
{
    global $pdo;
    static $short = ['MON' => 'Mon', 'TUE' => 'Tue', 'WED' => 'Wed', 'THU' => 'Thu',
                     'FRI' => 'Fri', 'SAT' => 'Sat', 'SUN' => 'Sun'];
    static $rangesBySem = [];

    if (!array_key_exists($semesterId, $rangesBySem)) {
        $rangesBySem[$semesterId] = [];
        $stmt = $pdo->prepare(
            'SELECT room_id, start_time, end_time, day_of_week FROM room_utilization
              WHERE semester_id = ?
              ORDER BY room_id, start_time, FIELD(day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN")'
        );
        $stmt->execute([$semesterId]);
        foreach ($stmt as $row) {
            $rid = (int) $row['room_id'];
            $rangesBySem[$semesterId][$rid][$row['start_time'] . '|' . $row['end_time']][$row['day_of_week']] = true;
        }
    }

    $ranges = $rangesBySem[$semesterId][$roomId] ?? [];
    if (!$ranges) return [];

    $order = array_keys($short);
    $out = [];
    foreach (array_slice($ranges, 0, $limit, true) as $key => $days) {
        [$start, $end] = explode('|', $key);
        $indexes = [];
        foreach (array_keys($days) as $day) $indexes[] = array_search($day, $order, true);
        sort($indexes);

        // Consecutive days read as a range: Mon, Tue, Wed -> Mon - Wed
        $parts = [];
        $from = $to = $indexes[0];
        foreach (array_slice($indexes, 1) as $i) {
            if ($i === $to + 1) { $to = $i; continue; }
            $parts[] = $from === $to ? $short[$order[$from]] : $short[$order[$from]] . ' - ' . $short[$order[$to]];
            $from = $to = $i;
        }
        $parts[] = $from === $to ? $short[$order[$from]] : $short[$order[$from]] . ' - ' . $short[$order[$to]];

        $out[] = ['days' => implode(', ', $parts), 'time' => format_time($start) . ' - ' . format_time($end)];
    }
    if (count($ranges) > $limit) $out[] = ['days' => '', 'time' => '+ ' . (count($ranges) - $limit) . ' more'];
    return $out;
}

/** The semester a scheduling screen is working on (defaults to the active one). */
function target_semester(?int $id): array
{
    global $pdo;
    if ($id) {
        $stmt = $pdo->prepare('SELECT s.*, r.hourly_rate FROM semesters s LEFT JOIN allowance_rates r ON r.semester_id = s.id WHERE s.id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if ($row) return format_semester($row);
    }
    return active_semester() ?? fail('Create a semester first in Scheduling > Semester Setup.', 409);
}

// ---------------------------------------------------------------------------
// Supporting documents for a class-schedule change
//
// A class schedule is only changed on someone's word - an add/drop form, a new
// COR, a note from the registrar - so every change carries the file that
// justifies it. The file is kept outside the web root's reach (uploads/ denies
// direct access) and is read back through api/document.php, which checks the
// session first.
// ---------------------------------------------------------------------------

const CLASS_DOC_MAX_BYTES = 4 * 1024 * 1024;        // 4 MB, enough for a phone photo
const CLASS_DOC_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/webp' => 'webp',
    'application/pdf' => 'pdf',
];

function class_documents_dir(): string
{
    $dir = dirname(__DIR__) . '/uploads/class-documents';
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        fail('The document folder could not be created on the server.', 500);
    }
    return $dir;
}

/**
 * Take the file and the reason a change came with, check both, and fail loudly
 * if either is missing. Returns [$document, $reason].
 */
function require_change_proof(array $in): array
{
    $doc = (array) ($in['document'] ?? []);
    $reason = trim((string) ($in['reason'] ?? ''));

    $e = [];
    if (mb_strlen($reason) < 5) $e['reason'] = 'Say why the schedule is changing (at least 5 characters).';
    elseif (mb_strlen($reason) > 200) $e['reason'] = 'Use 200 characters or fewer.';

    $data = (string) ($doc['data'] ?? '');
    $type = strtolower(trim((string) ($doc['type'] ?? '')));
    $name = trim((string) ($doc['name'] ?? ''));

    if ($data === '') $e['document'] = 'Attach the document that supports this change.';
    elseif (!isset(CLASS_DOC_TYPES[$type])) $e['document'] = 'Attach a photo (JPG, PNG, WEBP) or a PDF.';
    if ($name === '') $name = 'document.' . (CLASS_DOC_TYPES[$type] ?? 'bin');
    if (mb_strlen($name) > 160) $name = mb_substr($name, -160);

    if ($e) fail('A supporting document is required.', 422, ['errors' => $e]);

    $binary = base64_decode(preg_replace('#^data:[^,]+,#', '', $data), true);
    if ($binary === false || $binary === '') {
        fail('The document could not be read. Try attaching it again.', 422, ['errors' => ['document' => 'Unreadable file.']]);
    }
    if (strlen($binary) > CLASS_DOC_MAX_BYTES) {
        fail('Keep the document under 4 MB.', 422, ['errors' => ['document' => 'That file is over 4 MB.']]);
    }

    return [['name' => $name, 'type' => $type, 'binary' => $binary], $reason];
}

/** Write the file down and record what it was for. */
function save_change_proof(array $doc, string $reason, int $semesterId, int $profileId, ?int $classId,
                           string $actionName, string $detail, int $userId): int
{
    global $pdo;

    $stored = bin2hex(random_bytes(16)) . '.' . CLASS_DOC_TYPES[$doc['type']];
    $path = class_documents_dir() . '/' . $stored;
    if (file_put_contents($path, $doc['binary']) === false) {
        fail('The document could not be saved on the server.', 500);
    }

    $pdo->prepare(
        'INSERT INTO class_change_documents (semester_id, sa_profile_id, class_id, action, detail, reason,
                file_name, stored_name, mime_type, file_size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$semesterId, $profileId, $classId, $actionName, mb_substr($detail, 0, 200), $reason,
                $doc['name'], $stored, $doc['type'], strlen($doc['binary']), $userId]);

    return (int) $pdo->lastInsertId();
}

/** Everything filed for one S.A. this semester, newest first. */
function change_proofs(int $semesterId, int $profileId): array
{
    global $pdo;
    $stmt = $pdo->prepare(
        'SELECT d.*, u.full_name FROM class_change_documents d
           LEFT JOIN users u ON u.id = d.uploaded_by
          WHERE d.semester_id = ? AND d.sa_profile_id = ? ORDER BY d.id DESC'
    );
    $stmt->execute([$semesterId, $profileId]);
    return array_map(fn($d) => [
        'id' => (int) $d['id'],
        'action' => $d['action'],
        'detail' => $d['detail'],
        'reason' => $d['reason'],
        'fileName' => $d['file_name'],
        'mimeType' => $d['mime_type'],
        'fileSize' => (int) $d['file_size'],
        'isImage' => str_starts_with($d['mime_type'], 'image/'),
        'by' => $d['full_name'],
        'at' => $d['created_at'],
        'url' => 'api/document.php?id=' . (int) $d['id'],
    ], $stmt->fetchAll());
}
