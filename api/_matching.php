<?php
require_once __DIR__ . '/_sa.php';
require_once __DIR__ . '/_scheduling.php';

// Shared constants and scheduling/matching engine for AssistPay Pages 2–7.
// Scope:
//   - Page 4 (Office Staffing): OFFICE SAs only (8:00 AM–5:00 PM Mon–Fri with 12–1 lunch break; Sat 8:00 AM–12:00 PM half-day).
//     Approved OFFICE assignments go directly to Finalize Schedule (schedule_assignments with requirement_type = 'OFFICE').
//   - Page 5 (Schedule Matching): Automatic matching for ITO & ACADS rooms/labs ONLY (excludes OFFICE SAs).
//   - Page 6 (Recommendations): Review, approve, reject/unassign, swap, or re-run room/lab partner recommendations.
//   - Page 7 (Finalize Schedule): Combines approved ITO/ACADS room assignments + approved OFFICE assignments.

const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MIN_WEEKLY_HOURS = 20.0;
const HARD_WEEKLY_CAP = 40.0;
const MIN_OFFICE_BLOCK = 1.0;
const MAX_DAILY_HOURS = 9.0;
const OFFICE_OPEN = '08:00:00';
const OFFICE_CLOSE = '17:00:00';
const OFFICE_EARLIEST = '07:00:00';
const OFFICE_LATEST = '18:00:00';
const BREAK_AFTER_HOURS = 5.0;
const BREAK_DEDUCTION = 1.0;

function min_weekly_hours(): float
{
    global $pdo;
    static $cached = null;
    if ($cached !== null) return $cached;
    try {
        $stmt = $pdo->query("SELECT setting_value FROM system_settings WHERE setting_key = 'minWeeklyDutyHours'");
        $res = $stmt ? $stmt->fetchColumn() : false;
        if ($res !== false && is_numeric($res)) {
            $cached = (float) $res;
            return $cached;
        }
    } catch (Throwable $e) {}
    $cached = MIN_WEEKLY_HOURS;
    return $cached;
}

function hard_weekly_cap(): float
{
    global $pdo;
    static $cached = null;
    if ($cached !== null) return $cached;
    try {
        $stmt = $pdo->query("SELECT setting_value FROM system_settings WHERE setting_key = 'maxWeeklyDutyHours'");
        $res = $stmt ? $stmt->fetchColumn() : false;
        if ($res !== false && is_numeric($res)) {
            $cached = (float) $res;
            return $cached;
        }
    } catch (Throwable $e) {}
    $cached = HARD_WEEKLY_CAP;
    return $cached;
}

function mins(string $t): int
{
    $parts = explode(':', trim($t));
    $h = (int) ($parts[0] ?? 0);
    $m = (int) ($parts[1] ?? 0);
    return $h * 60 + $m;
}

function hhmm(int $m): string
{
    return sprintf('%02d:%02d:00', intdiv($m, 60), $m % 60);
}

function overlaps(int $aStart, int $aEnd, int $bStart, int $bEnd): bool
{
    return $aStart < $bEnd && $bStart < $aEnd;
}

function merge_spans(array $spans): array
{
    if (!$spans) return [];
    usort($spans, fn($a, $b) => $a[0] <=> $b[0]);
    $out = [];
    $cur = array_shift($spans);
    foreach ($spans as $s) {
        if ($s[0] <= $cur[1]) {
            $cur[1] = max($cur[1], $s[1]);
        } else {
            $out[] = $cur;
            $cur = $s;
        }
    }
    $out[] = $cur;
    return $out;
}

function subtract_spans(array $free, array $busy): array
{
    foreach ($busy as [$bStart, $bEnd]) {
        $next = [];
        foreach ($free as [$fStart, $fEnd]) {
            if ($bEnd <= $fStart || $bStart >= $fEnd) {
                $next[] = [$fStart, $fEnd];
                continue;
            }
            if ($bStart > $fStart) $next[] = [$fStart, $bStart];
            if ($bEnd < $fEnd) $next[] = [$bEnd, $fEnd];
        }
        $free = $next;
    }
    return $free;
}

function intersect_spans(array $a, array $b): array
{
    $out = [];
    foreach ($a as [$as, $ae]) {
        foreach ($b as [$bs, $be]) {
            $s = max($as, $bs);
            $e = min($ae, $be);
            if ($e > $s) $out[] = [$s, $e];
        }
    }
    return merge_spans($out);
}

function span_minutes(array $spans): int
{
    return array_sum(array_map(fn($s) => max(0, $s[1] - $s[0]), $spans));
}

function credited_hours(float $hours, string $day = 'MON', bool $isOffice = false, int $start = 0, int $end = 0): float
{
    $day = strtoupper(substr(trim($day), 0, 3));
    if (!in_array($day, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
        return round($hours, 1);
    }
    if ($isOffice) {
        if ($day === 'SAT') return round($hours, 1);
        $spansLunch = ($start > 0 && $end > 0 && $start <= 720 && $end >= 780);
        $isLongShift = ($hours >= BREAK_AFTER_HOURS && ($start === 0 || ($start < 780 && $end > 720)));
        return ($spansLunch || $isLongShift) ? round(max(0.0, $hours - BREAK_DEDUCTION), 1) : round($hours, 1);
    }
    return ($hours >= BREAK_AFTER_HOURS) ? round(max(0.0, $hours - BREAK_DEDUCTION), 1) : round($hours, 1);
}

function credited_week(array $duty, bool $isOffice = false): float
{
    $total = 0.0;
    foreach ($duty as $day => $spans) {
        $dayStr = strtoupper(substr(trim(is_string($day) ? $day : 'MON'), 0, 3));
        $merged = merge_spans($spans);
        if (!$merged) continue;
        $dayRaw = round(span_minutes($merged) / 60.0, 1);
        if (!in_array($dayStr, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
            $total += $dayRaw;
            continue;
        }
        if ($isOffice) {
            if ($dayStr === 'SAT') {
                $total += $dayRaw;
            } else {
                $hasLunchDeduct = false;
                foreach ($merged as $span) {
                    $st = (int) $span[0];
                    $en = (int) $span[1];
                    $raw = ($en - $st) / 60.0;
                    if (($st <= 720 && $en >= 780) || ($raw >= BREAK_AFTER_HOURS && $st < 780 && $en > 720)) {
                        $hasLunchDeduct = true;
                        break;
                    }
                }
                $total += $hasLunchDeduct ? max(0.0, $dayRaw - BREAK_DEDUCTION) : $dayRaw;
            }
        } else {
            $total += ($dayRaw >= BREAK_AFTER_HOURS) ? max(0.0, $dayRaw - BREAK_DEDUCTION) : $dayRaw;
        }
    }
    return round($total, 1);
}

function credited_with(array $sa, array $blocks): float
{
    $duty = $sa['duty'] ?? [];
    foreach ($blocks as [$day, $start, $end]) {
        $duty[$day][] = [$start, $end];
    }
    $isOffice = (($sa['category'] ?? $sa['sa_category'] ?? '') === 'OFFICE'
        || ($sa['department'] ?? $sa['department_type'] ?? '') === 'OFFICE');
    return credited_week($duty, $isOffice);
}

function credit_once_per_day(array $blocks, bool $isOffice = false): array
{
    if (!$blocks) return [];
    usort($blocks, function ($a, $b) {
        $da = array_search(strtoupper(substr(trim((string) ($a['day'] ?? 'MON')), 0, 3)), DAY_ORDER);
        $db = array_search(strtoupper(substr(trim((string) ($b['day'] ?? 'MON')), 0, 3)), DAY_ORDER);
        $sa = isset($a['start']) ? (int) $a['start'] : mins((string) ($a['startTime'] ?? '00:00:00'));
        $sb = isset($b['start']) ? (int) $b['start'] : mins((string) ($b['startTime'] ?? '00:00:00'));
        return [$da, $sa] <=> [$db, $sb];
    });

    $byDayIdx = [];
    foreach ($blocks as $idx => $b) {
        $dayKey = strtoupper(substr(trim((string) ($b['day'] ?? 'MON')), 0, 3));
        $byDayIdx[$dayKey][] = $idx;
    }

    foreach ($byDayIdx as $dayKey => $indices) {
        $eligibleDay = in_array($dayKey, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true);
        $dayRaw = 0.0;
        foreach ($indices as $i) {
            $dayRaw += (float) ($blocks[$i]['rawHours'] ?? $blocks[$i]['hours'] ?? 0.0);
        }
        $dayRaw = round($dayRaw, 1);

        $deductIdx = null;
        if ($eligibleDay) {
            if ($isOffice) {
                if ($dayKey !== 'SAT') {
                    foreach ($indices as $i) {
                        $st = isset($blocks[$i]['start']) ? (int) $blocks[$i]['start'] : mins((string) ($blocks[$i]['startTime'] ?? '00:00:00'));
                        $en = isset($blocks[$i]['end']) ? (int) $blocks[$i]['end'] : mins((string) ($blocks[$i]['endTime'] ?? '00:00:00'));
                        $rawH = (float) ($blocks[$i]['rawHours'] ?? $blocks[$i]['hours'] ?? 0.0);
                        if (($st > 0 && $en > 0 && $st <= 720 && $en >= 780)
                            || ($rawH >= BREAK_AFTER_HOURS && ($st === 0 || ($st < 780 && $en > 720)))) {
                            $deductIdx = $i;
                            break;
                        }
                    }
                }
            } elseif ($dayRaw >= BREAK_AFTER_HOURS) {
                $bestHours = -1.0;
                foreach ($indices as $i) {
                    $rawH = (float) ($blocks[$i]['rawHours'] ?? $blocks[$i]['hours'] ?? 0.0);
                    if ($rawH >= BREAK_DEDUCTION && $rawH > $bestHours) {
                        $bestHours = $rawH;
                        $deductIdx = $i;
                    }
                }
            }
        }

        foreach ($indices as $i) {
            $rawH = round((float) ($blocks[$i]['rawHours'] ?? $blocks[$i]['hours'] ?? 0.0), 1);
            $cred = ($i === $deductIdx) ? round(max(0.0, $rawH - BREAK_DEDUCTION), 1) : $rawH;
            $blocks[$i]['credited'] = $cred;
            if (array_key_exists('creditedHours', $blocks[$i])) {
                $blocks[$i]['creditedHours'] = $cred;
            }
            $blocks[$i]['hasBreak'] = ($cred < $rawH);
        }
    }

    return $blocks;
}

function duty_block(string $day, int $start, int $end, bool $isOffice = false): array
{
    $hours = round(($end - $start) / 60, 1);
    $credited = credited_hours($hours, $day, $isOffice, $start, $end);
    return [
        'day' => $day,
        'start' => $start,
        'end' => $end,
        'startTime' => sprintf('%02d:%02d', intdiv($start, 60), $start % 60),
        'endTime' => sprintf('%02d:%02d', intdiv($end, 60), $end % 60),
        'startLabel' => format_time(hhmm($start)),
        'endLabel' => format_time(hhmm($end)),
        'hours' => $hours,
        'credited' => $credited,
        'hasBreak' => $credited < $hours,
    ];
}

function is_tech_course(string $course): bool
{
    $c = strtoupper(trim($course));
    foreach (['BSIT', 'BSCS', 'BSCPE', 'BSECE', 'BSEE', 'ACT', 'IT', 'COMPUTER'] as $kw) {
        if (str_contains($c, $kw)) return true;
    }
    return false;
}

function get_sa_evaluation_rules(int $semesterId): array
{
    global $pdo;
    static $cache = [];
    if (isset($cache[$semesterId])) {
        return $cache[$semesterId];
    }

    $offices = $pdo->query('SELECT id, name FROM offices')->fetchAll(PDO::FETCH_ASSOC);
    $officeMapByName = [];
    foreach ($offices as $o) {
        $officeMapByName[strtoupper(trim($o['name']))] = (int) $o['id'];
    }

    $stmt = $pdo->query("
        SELECT e.id, e.sa_profile_id, e.department, e.coordinator_decision, e.supervisor_recommendation, e.status,
               p.sa_category, p.department_type, p.office_id, o.name AS office_name
          FROM sa_evaluations e
          JOIN sa_profiles p ON p.id = e.sa_profile_id
          LEFT JOIN offices o ON o.id = p.office_id
         WHERE e.status IN ('FINALIZED', 'FOR_FINAL_DECISION', 'COMPLETED')
           AND (
               (e.coordinator_decision IS NOT NULL AND e.coordinator_decision <> '')
               OR (e.supervisor_recommendation IS NOT NULL AND e.supervisor_recommendation <> '')
           )
         ORDER BY e.id ASC
    ");

    $rulesBySa = [];
    foreach ($stmt as $row) {
        $saId = (int) $row['sa_profile_id'];
        $rawDecision = strtoupper(trim((string) ($row['coordinator_decision'] ?: $row['supervisor_recommendation'])));

        $decision = match ($rawDecision) {
            'RETAIN', 'IMPROVEMENT_PLAN' => 'RETAIN',
            'REASSIGNMENT' => 'REASSIGNMENT',
            'NOT_RENEWED', 'NON_RENEWAL', 'DISQUALIFIED' => 'NOT_RENEWED',
            default => 'STANDARD'
        };

        $deptStr = strtoupper(trim((string) $row['department']));
        $evalCat = 'OFFICE';
        $evalOfficeId = null;

        if (str_contains($deptStr, 'ITO') || str_contains($deptStr, 'LAB') || str_contains($deptStr, 'CITE') || str_contains($deptStr, 'COMPUTER')) {
            $evalCat = 'ITO';
        } elseif (str_contains($deptStr, 'ACAD') || str_contains($deptStr, 'LECTURE') || str_contains($deptStr, 'FLOOR')) {
            $evalCat = 'ACADS';
        } else {
            $evalCat = 'OFFICE';
            foreach ($officeMapByName as $offName => $offId) {
                if (str_contains($deptStr, $offName) || str_contains($offName, $deptStr)) {
                    $evalOfficeId = $offId;
                    break;
                }
            }
            if (!$evalOfficeId && $row['office_id']) {
                $evalOfficeId = (int) $row['office_id'];
            }
        }

        $bannedCategories = [];
        $allowedCategories = ['ITO', 'ACADS', 'OFFICE'];

        if ($decision === 'NOT_RENEWED') {
            if ($evalCat === 'OFFICE') {
                $bannedCategories = ['OFFICE'];
                $allowedCategories = ['ACADS', 'ITO'];
            } elseif ($evalCat === 'ITO') {
                $bannedCategories = ['ITO', 'OFFICE'];
                $allowedCategories = ['ACADS'];
            } elseif ($evalCat === 'ACADS') {
                $bannedCategories = ['ACADS'];
                $allowedCategories = ['ITO'];
            }
        }

        $rulesBySa[$saId] = [
            'saId' => $saId,
            'decision' => $decision,
            'rawDecision' => $rawDecision,
            'evalDepartment' => $row['department'],
            'evalCategory' => $evalCat,
            'evalOfficeId' => $evalOfficeId,
            'bannedCategories' => $bannedCategories,
            'allowedCategories' => $allowedCategories,
            'retainOffice' => ($decision === 'RETAIN' && $evalCat === 'OFFICE'),
            'retainOfficeId' => ($decision === 'RETAIN' && $evalCat === 'OFFICE') ? $evalOfficeId : null,
            'retainCategory' => ($decision === 'RETAIN' && in_array($evalCat, ['ITO', 'ACADS'], true)) ? $evalCat : null,
            'mustTransfer' => ($decision === 'REASSIGNMENT'),
        ];
    }

    $cache[$semesterId] = $rulesBySa;
    return $rulesBySa;
}

function eligible_for(array $sa, string $departmentType, ?int $officeId = null, bool $crossShuffle = false): bool
{
    $cat = strtoupper(trim((string) ($sa['category'] ?? $sa['sa_category'] ?? '')));
    $dept = strtoupper(trim($departmentType));

    // Evaluation Rules Integration
    $saId = (int) ($sa['id'] ?? 0);
    $evalDecision = $sa['evalDecision'] ?? null;
    $banned = $sa['evalBanned'] ?? null;
    $allowed = $sa['evalAllowed'] ?? null;
    $retainCat = $sa['retainCategory'] ?? null;
    $mustTransfer = !empty($sa['mustTransfer']);
    $evalCat = $sa['evalCategory'] ?? null;

    if ($saId > 0 && $evalDecision === null) {
        $rules = get_sa_evaluation_rules(1);
        if (isset($rules[$saId])) {
            $r = $rules[$saId];
            $evalDecision = $r['decision'];
            $banned = $r['bannedCategories'];
            $allowed = $r['allowedCategories'];
            $retainCat = $r['retainCategory'];
            $mustTransfer = $r['mustTransfer'];
            $evalCat = $r['evalCategory'];
        }
    }

    // 1. NON-RENEWAL BAN
    if (!empty($banned) && in_array($dept, $banned, true)) {
        return false;
    }
    if ($evalDecision === 'NOT_RENEWED' && !empty($allowed)) {
        if (!in_array($dept, $allowed, true)) {
            return false;
        }
    }

    // 2. RETAIN
    if ($evalDecision === 'RETAIN') {
        if ($dept === 'OFFICE') {
            if (!empty($sa['retainOfficeId']) && $officeId !== null && (int)$sa['retainOfficeId'] !== (int)$officeId) {
                return false;
            }
            return in_array($cat, ['OFFICE', 'ALL'], true);
        }
        if ($retainCat) {
            // Retained in evaluated category (ITO stays ITO, ACADS stays ACADS)
            return $dept === $retainCat;
        }
    }

    // 3. REASSIGNMENT
    if ($mustTransfer && $evalCat) {
        if ($dept === $evalCat) {
            return false;
        }
    }

    // 4. CROSS-DEPARTMENT SHUFFLE (Coordinator option)
    if ($crossShuffle && in_array($dept, ['ITO', 'ACADS'], true) && in_array($cat, ['ITO', 'ACADS', 'RELIEVER'], true)) {
        return true;
    }

    // 5. STANDARD DEFAULT CATEGORY MATCHING
    if ($dept === 'OFFICE') {
        return $cat === 'OFFICE';
    }
    if ($dept === 'ITO') {
        if ($cat === 'ITO') return true;
        if ($cat === 'RELIEVER' || !empty($sa['isReliever'])) {
            $saDept = strtoupper(trim((string) ($sa['department_type'] ?? $sa['departmentType'] ?? '')));
            return ($saDept === 'ITO' || empty($saDept));
        }
        return false;
    }
    if ($dept === 'ACADS') {
        if ($cat === 'ACADS') return true;
        if ($cat === 'RELIEVER' || !empty($sa['isReliever'])) {
            $saDept = strtoupper(trim((string) ($sa['department_type'] ?? $sa['departmentType'] ?? '')));
            return ($saDept === 'ACADS' || empty($saDept));
        }
        return false;
    }
    return $cat === $dept;
}

function ensure_matching_board_tables(): void
{
    global $pdo;
    static $done = false;
    if ($done) return;
    $done = true;

    if (function_exists('schema_guard_ready') && schema_guard_ready('matching_board_tables_v2', 86400)) {
        return;
    }

    try {
        $colsRun = $pdo->query("SHOW COLUMNS FROM matching_runs")->fetchAll(PDO::FETCH_COLUMN);
        if (!in_array('batch_status', $colsRun, true)) {
            $pdo->exec("ALTER TABLE matching_runs ADD COLUMN batch_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' AFTER preserved_count");
        }
        if (!in_array('approved_by', $colsRun, true)) {
            $pdo->exec("ALTER TABLE matching_runs ADD COLUMN approved_by INT UNSIGNED NULL AFTER batch_status");
        }
        if (!in_array('approved_at', $colsRun, true)) {
            $pdo->exec("ALTER TABLE matching_runs ADD COLUMN approved_at DATETIME NULL AFTER approved_by");
        }
        if (!in_array('lock_notes', $colsRun, true)) {
            $pdo->exec("ALTER TABLE matching_runs ADD COLUMN lock_notes VARCHAR(255) NULL AFTER approved_at");
        }
    } catch (Throwable $_) {}

    try {
        $colsSa = $pdo->query("SHOW COLUMNS FROM sa_profiles")->fetchAll(PDO::FETCH_COLUMN);
        if (!in_array('marked_for_reassignment', $colsSa, true)) {
            $pdo->exec("ALTER TABLE sa_profiles ADD COLUMN marked_for_reassignment TINYINT(1) NOT NULL DEFAULT 0 AFTER assignment_status");
        }
        if (!in_array('reassignment_reason', $colsSa, true)) {
            $pdo->exec("ALTER TABLE sa_profiles ADD COLUMN reassignment_reason VARCHAR(255) NULL AFTER marked_for_reassignment");
        }
        if (!in_array('reassignment_marked_at', $colsSa, true)) {
            $pdo->exec("ALTER TABLE sa_profiles ADD COLUMN reassignment_marked_at DATETIME NULL AFTER reassignment_reason");
        }
    } catch (Throwable $_) {}

    try {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS room_assignment_history (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                semester_id INT UNSIGNED NOT NULL,
                room VARCHAR(120) NOT NULL,
                department VARCHAR(20) NOT NULL,
                slot_no INT NOT NULL DEFAULT 1,
                role_type VARCHAR(20) NOT NULL DEFAULT 'PRIMARY',
                action_type VARCHAR(50) NOT NULL,
                previous_sa_id INT UNSIGNED NULL,
                new_sa_id INT UNSIGNED NULL,
                summary VARCHAR(255) NOT NULL,
                reason TEXT NULL,
                actor_user_id INT UNSIGNED NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_sem_room (semester_id, room),
                INDEX idx_sem_created (semester_id, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
    } catch (Throwable $_) {}

    try {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS room_relief_coverages (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                semester_id INT UNSIGNED NOT NULL,
                room VARCHAR(120) NOT NULL,
                department VARCHAR(20) NOT NULL,
                primary_sa_id INT UNSIGNED NULL,
                reliever_sa_id INT UNSIGNED NOT NULL,
                coverage_date DATE NOT NULL,
                day_of_week VARCHAR(3) NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                reason TEXT NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
                outcome VARCHAR(255) NULL,
                confirmed_by INT UNSIGNED NOT NULL,
                completed_at DATETIME NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_sem_room_status (semester_id, room, status),
                INDEX idx_reliever_date (reliever_sa_id, coverage_date, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
    } catch (Throwable $_) {}

    if (function_exists('schema_guard_mark_ready')) {
        schema_guard_mark_ready('matching_board_tables_v2');
    }
}

function get_matching_batch_lock_info(int $semesterId): array
{
    global $pdo;
    ensure_matching_board_tables();
    $stmt = $pdo->prepare(
        'SELECT r.id, r.batch_status, r.approved_by, r.approved_at, r.lock_notes, u.full_name AS approved_by_name
           FROM matching_runs r
           LEFT JOIN users u ON u.id = r.approved_by
          WHERE r.semester_id = ?
          ORDER BY r.id DESC LIMIT 1'
    );
    $stmt->execute([$semesterId]);
    $row = $stmt->fetch();
    if (!$row) {
        return [
            'hasRun' => false,
            'runId' => 0,
            'batchStatus' => 'NONE',
            'isLocked' => false,
            'approvedBy' => null,
            'approvedByName' => null,
            'approvedAt' => null,
            'lockNotes' => null,
        ];
    }
    $status = strtoupper((string) ($row['batch_status'] ?: 'DRAFT'));
    return [
        'hasRun' => true,
        'runId' => (int) $row['id'],
        'batchStatus' => $status,
        'isLocked' => ($status === 'APPROVED_LOCKED'),
        'approvedBy' => $row['approved_by'] ? (int) $row['approved_by'] : null,
        'approvedByName' => $row['approved_by_name'] ?: ($row['approved_by'] ? 'Coordinator' : null),
        'approvedAt' => $row['approved_at'] ?: null,
        'lockNotes' => $row['lock_notes'] ?: null,
    ];
}

function is_matching_batch_locked(int $semesterId): bool
{
    $info = get_matching_batch_lock_info($semesterId);
    return !empty($info['isLocked']);
}

function require_batch_unlocked_or_fail(int $semesterId, string $contextAction = 'edit'): void
{
    if (is_matching_batch_locked($semesterId)) {
        fail(
            "Approved room assignments are locked against ordinary edits ({$contextAction}). Use the Authorized Reassignment / Exception workflow with a required reason.",
            409
        );
    }
}

function log_room_assignment_history(
    int $semesterId,
    string $room,
    string $department,
    int|string $slotNoOrActionType,
    string $roleType,
    ?string $actionTypeOrPrevSa = null,
    ?int $prevSaIdOrNewSa = null,
    int|string|null $newSaIdOrSummary = null,
    ?string $summaryOrReason = null,
    int|string|null $reasonOrActorId = null,
    ?int $actorUserId = null
): void {
    global $pdo;
    ensure_matching_board_tables();

    if (is_int($slotNoOrActionType)) {
        $slotNo = $slotNoOrActionType;
        $actionType = (string) $actionTypeOrPrevSa;
        $prevSaId = $prevSaIdOrNewSa;
        $newSaId = is_int($newSaIdOrSummary) ? $newSaIdOrSummary : null;
        $summary = (string) $summaryOrReason;
        $reason = is_string($reasonOrActorId) ? $reasonOrActorId : null;
        $actorId = $actorUserId;
    } else {
        $slotNo = 1;
        $actionType = $slotNoOrActionType;
        $prevSaId = $actionTypeOrPrevSa !== null ? (int) $actionTypeOrPrevSa : null;
        $newSaId = $prevSaIdOrNewSa;
        $summary = (string) $newSaIdOrSummary;
        $reason = $summaryOrReason;
        $actorId = $reasonOrActorId !== null ? (int) $reasonOrActorId : null;
    }

    try {
        $stmt = $pdo->prepare(
            'INSERT INTO room_assignment_history
                (semester_id, room, department, slot_no, role_type, action_type, previous_sa_id, new_sa_id, summary, reason, actor_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $semesterId,
            mb_substr(trim($room), 0, 120),
            strtoupper(trim($department)),
            max(1, $slotNo),
            in_array(strtoupper($roleType), ['PRIMARY', 'RELIEVER'], true) ? strtoupper($roleType) : 'PRIMARY',
            strtoupper(trim($actionType)),
            $prevSaId ?: null,
            $newSaId ?: null,
            mb_substr(trim($summary), 0, 255),
            $reason !== null && trim($reason) !== '' ? trim($reason) : null,
            $actorId ?: null,
        ]);
    } catch (Throwable $_) {}
}

function compute_candidate_suitability(
    array $sa,
    string $department,
    float $creditedHours,
    float $rawHours,
    bool $isReliever = false,
    array $checks = [],
    ?string $donorRoom = null
): array {
    $minW = min_weekly_hours();
    $capW = hard_weekly_cap();
    $dept = strtoupper(trim($department));
    $cat = strtoupper(trim((string) ($sa['category'] ?? $sa['sa_category'] ?? '')));
    $course = trim((string) ($sa['course'] ?? ''));

    $reasons = [];
    $failed = [];
    $warnings = [];

    if (!eligible_for($sa, $dept)) {
        $failed[] = "Department mismatch ({$cat} S.A. is not eligible for {$dept})";
    } else {
        $reasons[] = "Eligible category ({$cat} → {$dept})";
    }

    $reasons[] = '0 Registrar class schedule conflicts';

    if ($dept === 'ITO') {
        if (is_tech_course($course)) {
            $reasons[] = "Relevant technical course ({$course})";
        } else {
            $warnings[] = "Non-IT course ({$course}) in ITO Laboratory — verify technical skills";
        }
    } elseif ($course !== '') {
        $reasons[] = "Academic program verified ({$course})";
    }

    if ($isReliever) {
        $reasons[] = $donorRoom
            ? "Backup/Reliever coverage from Room {$donorRoom} ({$creditedHours}h/wk)"
            : "Backup/Reliever coverage ({$creditedHours}h/wk)";
    } else {
        if ($creditedHours < $minW) {
            $warnings[] = "Below minimum weekly duty hours ({$creditedHours}h credited vs {$minW}h required minimum)";
        } elseif ($creditedHours > $capW) {
            $failed[] = "Exceeds maximum weekly duty cap ({$creditedHours}h credited vs {$capW}h cap)";
        } else {
            $reasons[] = "Meets weekly duty target ({$creditedHours}h credited within {$minW}–{$capW}h)";
        }
    }

    foreach ($checks as $chk) {
        $chkStr = (string) $chk;
        if (stripos($chkStr, 'Complementary partner') !== false || stripos($chkStr, '0 class-duty gap') !== false) {
            if (!in_array($chkStr, $reasons, true)) $reasons[] = $chkStr;
        }
    }

    if (!empty($failed)) {
        $status = 'UNSUITABLE';
        $label = 'Unsuitable — Failed Requirement';
        $isFullyMatched = false;
    } elseif (!empty($warnings)) {
        $status = 'PARTIAL_WARNING';
        $label = 'Partial Match — Review Warning';
        $isFullyMatched = false;
    } else {
        $status = 'FULLY_MATCHED';
        $label = $isReliever ? 'Qualified Reliever' : 'Fully Matched';
        $isFullyMatched = true;
    }

    return [
        'status' => $status,
        'label' => $label,
        'isFullyMatched' => $isFullyMatched,
        'reasons' => array_values(array_unique($reasons)),
        'failedRequirements' => array_values(array_unique(array_merge($failed, $warnings))),
        'warnings' => array_values(array_unique($warnings)),
    ];
}

function matching_pool(int $semesterId, bool $roomOnly = false): array
{
    global $pdo;
    ensure_matching_board_tables();
    sync_all_active_sas_from_registrar($semesterId);

    $sql = 'SELECT p.id, p.student_id, p.first_name, p.last_name, p.course, p.year_level, p.sa_category,
                   p.department_type, p.office_id, p.assignment_status, p.marked_for_reassignment,
                   p.reassignment_reason, p.reassignment_marked_at, p.weekly_target_hours
              FROM sa_profiles p
             WHERE p.sa_status = "ACTIVE" AND (p.enrollment_status = "ENROLLED" OR p.enrollment_status IS NULL) AND p.archived_at IS NULL';
    // If an S.A. has zero class schedules on file and is not enrolled, do not allow them to block the whole department run
    $sql .= ' AND p.enrollment_status != "NOT_ENROLLED"';
    if ($roomOnly) {
        // Strictly ITO and ACADS SAs only — approved/assigned OFFICE SAs are NEVER included in Schedule Matching!
        $sql .= ' AND p.sa_category IN ("ITO", "ACADS", "RELIEVER") AND (p.office_id IS NULL OR p.department_type != "OFFICE")';
    }
    $sql .= ' ORDER BY p.last_name, p.first_name';

    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    $evalRules = get_sa_evaluation_rules($semesterId);
    $pool = [];
    foreach ($stmt as $p) {
        $sid = (int) $p['id'];
        $er = $evalRules[$sid] ?? null;
        $markedReassign = !empty($p['marked_for_reassignment']);
        $asgStatus = strtoupper((string) ($p['assignment_status'] ?: 'UNASSIGNED'));
        $poolEligibility = $markedReassign
            ? 'MARKED_FOR_REASSIGNMENT'
            : ($asgStatus !== 'ASSIGNED' ? 'NEW_UNASSIGNED' : 'CURRENTLY_ASSIGNED');
        $pool[$sid] = [
            'id' => $sid,
            'studentId' => $p['student_id'],
            'name' => $p['first_name'] . ' ' . $p['last_name'],
            'course' => $p['course'],
            'yearLevel' => (int) $p['year_level'],
            'category' => $p['sa_category'],
            'department' => $p['department_type'],
            'officeId' => $p['office_id'] ? (int) $p['office_id'] : null,
            'assignmentStatus' => $p['assignment_status'],
            'markedForReassignment' => $markedReassign,
            'reassignmentReason' => $p['reassignment_reason'] ?? null,
            'reassignmentMarkedAt' => $p['reassignment_marked_at'] ?? null,
            'poolEligibility' => $poolEligibility,
            'eligibleForPool' => ($asgStatus !== 'ASSIGNED' || $markedReassign),
            'target' => (float) $p['weekly_target_hours'],
            'evalDecision' => $er['decision'] ?? null,
            'evalBanned' => $er['bannedCategories'] ?? [],
            'evalAllowed' => $er['allowedCategories'] ?? [],
            'retainCategory' => $er['retainCategory'] ?? null,
            'retainOfficeId' => $er['retainOfficeId'] ?? null,
            'mustTransfer' => $er['mustTransfer'] ?? false,
            'evalCategory' => $er['evalCategory'] ?? null,
            'classes' => [],
            'duty' => [],
            'prefers' => [],
            'hours' => 0.0,
        ];
    }
    if (!$pool) return [];

    $ids = implode(',', array_map('intval', array_keys($pool)));
    $classes = $pdo->prepare("SELECT sa_profile_id, day_of_week, start_time, end_time, subject, section
                                FROM class_schedules
                               WHERE semester_id = ? AND sa_profile_id IN ($ids) AND archived_at IS NULL
                               ORDER BY FIELD(day_of_week,'MON','TUE','WED','THU','FRI','SAT','SUN'), start_time");
    $classes->execute([$semesterId]);
    foreach ($classes as $c) {
        $sid = (int) $c['sa_profile_id'];
        $pool[$sid]['classes'][$c['day_of_week']][] = [mins($c['start_time']), mins($c['end_time'])];
    }

    $prefs = $pdo->prepare("SELECT sa_profile_id, day_of_week, start_time, end_time
                              FROM duty_preferences
                             WHERE semester_id = ? AND sa_profile_id IN ($ids)");
    $prefs->execute([$semesterId]);
    foreach ($prefs as $pr) {
        $sid = (int) $pr['sa_profile_id'];
        $pool[$sid]['prefers'][$pr['day_of_week']][] = [mins($pr['start_time']), mins($pr['end_time'])];
    }

    return $pool;
}

function office_pool(int $semesterId, ?int $targetOfficeId = null): array
{
    global $pdo;
    $all = matching_pool($semesterId, false);
    if (!$all) return [];

    $officeNames = $pdo->query('SELECT id, name FROM offices')->fetchAll(PDO::FETCH_KEY_PAIR);

    $pool = [];
    foreach ($all as $id => $sa) {
        $saOfficeId = !empty($sa['officeId']) ? (int) $sa['officeId'] : null;

        // If target office is specified, do not include SAs already assigned to this exact office
        if ($targetOfficeId !== null && $saOfficeId === (int) $targetOfficeId) {
            continue;
        }

        // Check evaluation ban
        $banned = $sa['evalBanned'] ?? [];
        if (!empty($banned) && in_array('OFFICE', $banned, true)) {
            continue;
        }

        $isOfficeCat = ($sa['category'] === 'OFFICE');
        $isUnassigned = ($sa['assignmentStatus'] !== 'ASSIGNED');

        // Allow any Office S.A. (reassignable from another office) or any unassigned S.A.
        if (!$isOfficeCat && !$isUnassigned) {
            continue;
        }

        $sa['currentOfficeId'] = $saOfficeId;
        $sa['currentOfficeName'] = $saOfficeId ? ($officeNames[$saOfficeId] ?? 'Office') : null;
        $sa['isCurrentlyAssigned'] = ($sa['assignmentStatus'] === 'ASSIGNED');

        $pool[$id] = $sa;
    }
    if (!$pool) return [];

    $ids = implode(',', array_map('intval', array_keys($pool)));
    $rows = $pdo->prepare("SELECT sa_profile_id, day_of_week, start_time, end_time FROM schedule_assignments
                            WHERE semester_id = ? AND sa_profile_id IN ($ids)");
    $rows->execute([$semesterId]);
    foreach ($rows as $r) {
        $id = (int) $r['sa_profile_id'];
        if (isset($pool[$id])) {
            $pool[$id]['duty'][$r['day_of_week']][] = [mins($r['start_time']), mins($r['end_time'])];
        }
    }
    foreach ($pool as $id => $sa) {
        $pool[$id]['hours'] = round(array_sum(array_map(
            fn($spans) => array_sum(array_map(fn($s) => ($s[1] - $s[0]) / 60, $spans)),
            $sa['duty'] ?? []
        )), 1);
    }
    return $pool;
}

function office_pattern(array $sa, int $openFrom, int $openTo, float $target = 0.0, bool $allowStretch = false): array
{
    $minBlock = (int) round(MIN_OFFICE_BLOCK * 60);
    $from = max(mins(OFFICE_OPEN), $openFrom);
    $to = min(mins(OFFICE_CLOSE), $openTo);
    if ($to <= $from) {
        $from = mins(OFFICE_OPEN);
        $to = mins(OFFICE_CLOSE);
    }

    $cap = hard_weekly_cap();
    $goal = $target > 0 ? min($target, $cap) : min_weekly_hours();

    $pattern = [];
    $rawMinutes = 0;

    foreach (WEEK_DAYS as $day) {
        $busy = array_merge($sa['classes'][$day] ?? [], $sa['duty'][$day] ?? []);
        $rawFree = subtract_spans([[$from, $to]], $busy);
        $free = [];
        foreach ($rawFree as [$rfS, $rfE]) {
            // Monday-Friday automatic lunch break is 12:00 PM - 1:00 PM (720-780).
            // If the free window has duty both before 12:00 PM and after 1:00 PM, it spans across lunch
            // and receives the 1-hour lunch deduction once. Otherwise, subtract 12:00-1:00 PM so duty never lands inside lunch.
            if ($rfS < 720 && $rfE > 780) {
                $free[] = [$rfS, $rfE];
            } else {
                foreach (subtract_spans([[$rfS, $rfE]], [[720, 780]]) as $sub) {
                    $free[] = $sub;
                }
            }
        }

        $dayMins = 0;
        foreach ($free as [$s, $e]) {
            if ($e - $s < $minBlock) continue;
            $touchStart = ($s > $from);
            $touchEnd = ($e < $to);

            $blockMins = $e - $s;
            if (($dayMins + $blockMins) / 60.0 > MAX_DAILY_HOURS) {
                $allowed = (int) round(MAX_DAILY_HOURS * 60) - $dayMins;
                if ($allowed < $minBlock) break;
                if ($touchEnd && !$touchStart) {
                    $s = $e - $allowed;
                    if ($s > 720 && $s < 780) $s = 780;
                } else {
                    $e = $s + $allowed;
                    if ($e > 720 && $e < 780) $e = 720;
                }
            }
            $testPattern = array_merge($pattern, [[$day, $s, $e]]);
            $testCred = credited_with($sa, $testPattern);
            if ($testCred > $cap) {
                $over = $testCred - $cap;
                $trimMins = (int) ceil($over * 60 / 30) * 30;
                if ($touchEnd && !$touchStart) {
                    $s += $trimMins;
                    if ($s > 720 && $s < 780) $s = 780;
                } else {
                    $e -= $trimMins;
                    if ($e > 720 && $e < 780) $e = 720;
                }
                if ($e - $s < $minBlock) continue;
            }
            $pattern[] = [$day, $s, $e];
            $dayMins += ($e - $s);
            $rawMinutes += ($e - $s);
        }
    }

    // Saturday: half-day schedule (8:00 AM - 12:00 PM, no lunch deduction) is REQUIRED for Office SAs
    // whenever Saturday 8:00 AM - 12:00 PM has a conflict-free window (Monday to Saturday duty).
    $satFrom = mins('08:00:00');
    $satTo = mins('12:00:00');
    $busySat = array_merge($sa['classes']['SAT'] ?? [], $sa['duty']['SAT'] ?? []);
    $freeSat = subtract_spans([[$satFrom, $satTo]], $busySat);
    foreach ($freeSat as [$s, $e]) {
        if ($e - $s < $minBlock) continue;
        $touchStart = ($s > $satFrom);
        $touchEnd = ($e < $satTo);
        $testPattern = array_merge($pattern, [['SAT', $s, $e]]);
        $testCred = credited_with($sa, $testPattern);
        if ($testCred > $cap) {
            // Trim from weekday blocks first so Saturday 8:00 AM - 12:00 PM duty is preserved
            $overMins = (int) ceil(($testCred - $cap) * 60 / 30) * 30;
            for ($pIdx = count($pattern) - 1; $pIdx >= 0 && $overMins > 0; $pIdx--) {
                [$pDay, $pS, $pE] = $pattern[$pIdx];
                if ($pDay === 'SAT') continue;
                $availTrim = ($pE - $pS) - $minBlock;
                if ($availTrim <= 0) continue;
                $cut = min($overMins, $availTrim);
                $newEnd = $pE - $cut;
                if ($newEnd > 720 && $newEnd < 780) $newEnd = 720;
                if ($newEnd - $pS >= $minBlock) {
                    $pattern[$pIdx][2] = $newEnd;
                    $overMins = max(0, (int) ceil((credited_with($sa, array_merge($pattern, [['SAT', $s, $e]])) - $cap) * 60 / 30) * 30);
                }
            }
            $testCred = credited_with($sa, array_merge($pattern, [['SAT', $s, $e]]));
            if ($testCred > $cap) {
                $over = $testCred - $cap;
                $trimMins = (int) ceil($over * 60 / 30) * 30;
                if ($touchEnd && !$touchStart) {
                    $s += $trimMins;
                } else {
                    $e -= $trimMins;
                }
                if ($e - $s < $minBlock) continue;
            }
        }
        $pattern[] = ['SAT', $s, $e];
        $rawMinutes += ($e - $s);
    }

    $currentCred = credited_with($sa, $pattern);
    $minWeekly = min_weekly_hours();
    $stretchGoal = $allowStretch ? $goal : min($minWeekly, $cap);

    // If standard 8:00 AM–5:00 PM (Mon–Fri) + 8:00 AM–12:00 PM (Sat) is STILL short of required minimum duty hours,
    // allow stretching earlier to 7:00 AM (420) and/or later to 6:00 PM (1080) ONLY to fill the shortfall.
    if ($currentCred < $stretchGoal) {
        $earlyBound = mins(OFFICE_EARLIEST); // 420 (7:00 AM)
        $lateBound = mins(OFFICE_LATEST);    // 1080 (6:00 PM)

        // Prioritize weekdays that currently have < 9.0 raw hours (due to classes), then other weekdays
        $dayRawMap = [];
        foreach (WEEK_DAYS as $d) {
            $dayRawMap[$d] = 0;
        }
        foreach ($pattern as [$pDay, $pS, $pE]) {
            if (isset($dayRawMap[$pDay])) {
                $dayRawMap[$pDay] += ($pE - $pS);
            }
        }
        $orderedWeekDays = WEEK_DAYS;
        usort($orderedWeekDays, function ($a, $b) use ($dayRawMap) {
            $aLess = ($dayRawMap[$a] < 540) ? 0 : 1;
            $bLess = ($dayRawMap[$b] < 540) ? 0 : 1;
            if ($aLess !== $bLess) return $aLess <=> $bLess;
            return array_search($a, WEEK_DAYS, true) <=> array_search($b, WEEK_DAYS, true);
        });

        // Pass 3A: Contiguously extend existing Mon–Fri blocks to 7:00 AM (420) or 6:00 PM (1080)
        foreach ($orderedWeekDays as $day) {
            if (credited_with($sa, $pattern) >= $stretchGoal) break;
            $busy = array_merge($sa['classes'][$day] ?? [], $sa['duty'][$day] ?? []);

            // Try extending a block starting at 8:00 AM (480) back to 7:00 AM (420)
            foreach ($pattern as $idx => $blk) {
                if ($blk[0] !== $day || $blk[1] !== 480) continue;
                $needMins = (int) round(($stretchGoal - credited_with($sa, $pattern)) * 60);
                if ($needMins <= 0) break;
                $addMins = min(480 - $earlyBound, max(30, (int) ceil($needMins / 30) * 30));
                $candStart = 480 - $addMins;
                $freeEarly = subtract_spans([[$candStart, 480]], $busy);
                if (count($freeEarly) === 1 && $freeEarly[0][0] === $candStart && $freeEarly[0][1] === 480) {
                    $pattern[$idx][1] = $candStart;
                }
                break;
            }

            if (credited_with($sa, $pattern) >= $stretchGoal) break;

            // Try extending a block ending at 5:00 PM (1020) out to 6:00 PM (1080)
            foreach ($pattern as $idx => $blk) {
                if ($blk[0] !== $day || $blk[2] !== 1020) continue;
                $needMins = (int) round(($stretchGoal - credited_with($sa, $pattern)) * 60);
                if ($needMins <= 0) break;
                $addMins = min($lateBound - 1020, max(30, (int) ceil($needMins / 30) * 30));
                $candEnd = 1020 + $addMins;
                $freeLate = subtract_spans([[1020, $candEnd]], $busy);
                if (count($freeLate) === 1 && $freeLate[0][0] === 1020 && $freeLate[0][1] === $candEnd) {
                    $pattern[$idx][2] = $candEnd;
                }
                break;
            }
        }

        // Pass 3B: If still short, try extending Saturday 8:00 AM (480) block back to 7:00 AM (420)
        if (credited_with($sa, $pattern) < $stretchGoal) {
            $busySat = array_merge($sa['classes']['SAT'] ?? [], $sa['duty']['SAT'] ?? []);
            foreach ($pattern as $idx => $blk) {
                if ($blk[0] !== 'SAT' || $blk[1] !== 480) continue;
                $needMins = (int) round(($stretchGoal - credited_with($sa, $pattern)) * 60);
                if ($needMins <= 0) break;
                $addMins = min(480 - $earlyBound, max(30, (int) ceil($needMins / 30) * 30));
                $candStart = 480 - $addMins;
                $freeEarly = subtract_spans([[$candStart, 480]], $busySat);
                if (count($freeEarly) === 1 && $freeEarly[0][0] === $candStart && $freeEarly[0][1] === 480) {
                    $pattern[$idx][1] = $candStart;
                }
                break;
            }
        }

        // Pass 3C: If still short, check standalone 1-hour blocks at 7:00–8:00 AM or 5:00–6:00 PM on Mon–Fri
        if (credited_with($sa, $pattern) < $stretchGoal) {
            foreach ($orderedWeekDays as $day) {
                if (credited_with($sa, $pattern) >= $stretchGoal) break;
                $existingDaySpans = [];
                foreach ($pattern as $blk) {
                    if ($blk[0] === $day) $existingDaySpans[] = [$blk[1], $blk[2]];
                }
                $busy = array_merge($sa['classes'][$day] ?? [], $sa['duty'][$day] ?? [], $existingDaySpans);

                foreach ([[420, 480], [1020, 1080]] as [$winS, $winE]) {
                    if (credited_with($sa, $pattern) >= $stretchGoal) break;
                    $freeWin = subtract_spans([[$winS, $winE]], $busy);
                    if (count($freeWin) === 1 && ($freeWin[0][1] - $freeWin[0][0]) >= $minBlock) {
                        $pattern[] = [$day, $freeWin[0][0], $freeWin[0][1]];
                        $busy[] = [$freeWin[0][0], $freeWin[0][1]];
                    }
                }
            }
        }

        // Merge any adjacent spans per day and keep DAY_ORDER
        $byDay = [];
        foreach ($pattern as [$d, $s, $e]) {
            $byDay[$d][] = [$s, $e];
        }
        $pattern = [];
        foreach (DAY_ORDER as $d) {
            if (empty($byDay[$d])) continue;
            foreach (merge_spans($byDay[$d]) as [$ms, $me]) {
                $pattern[] = [$d, $ms, $me];
            }
        }
    }

    $rawMinutes = 0;
    foreach ($pattern as [$_d, $s, $e]) {
        $rawMinutes += ($e - $s);
    }
    $hours = round($rawMinutes / 60.0, 1);
    $credited = credited_with($sa, $pattern);
    return [
        'pattern' => $pattern,
        'hours' => $hours,
        'credited' => $credited,
    ];
}

function ensure_assigned_office_schedules(int $semesterId): void
{
    global $pdo;
    try {
        $mStmt = $pdo->prepare('SELECT duty_schedule_mode FROM semesters WHERE id = ?');
        $mStmt->execute([$semesterId]);
        if ($mStmt->fetchColumn() === 'ENROLLMENT') return;
    } catch (Throwable $_) {}
    ensure_matching_board_tables();
    $isLocked = is_matching_batch_locked($semesterId);

    // 1. Respect the Coordinator's office_requirements.required_sa for each office (only when not batch-locked).
    if (!$isLocked) {
        $offStmt = $pdo->prepare(
            'SELECT o.id AS office_id, r.id AS req_id, COALESCE(r.required_sa, 0) AS required_sa
               FROM offices o
               LEFT JOIN office_requirements r ON r.office_id = o.id AND r.semester_id = ?'
        );
        $offStmt->execute([$semesterId]);

        $assignedByOff = [];
        $unassignedByOff = [];
        $allOffSaStmt = $pdo->query(
            'SELECT id, office_id, sa_category, assignment_status
               FROM sa_profiles
              WHERE office_id IS NOT NULL AND sa_status = "ACTIVE" AND archived_at IS NULL
              ORDER BY id ASC'
        );
        foreach ($allOffSaStmt as $sRow) {
            $oid = (int) $sRow['office_id'];
            $sid = (int) $sRow['id'];
            if ($sRow['assignment_status'] === 'ASSIGNED') {
                $assignedByOff[$oid][] = $sid;
            } elseif ($sRow['sa_category'] === 'OFFICE' && $sRow['assignment_status'] === 'UNASSIGNED') {
                $unassignedByOff[$oid][] = $sid;
            }
        }

        $unassignSaStmt = null;
        $delOffDutyStmt = null;
        $assignSaStmt = null;

        foreach ($offStmt->fetchAll() as $offRow) {
            // SAs are assigned manually by the Coordinator via SA Registration/Edit or Office Staffing
        }
    }

    // Check if the current semester's room slots are already approved; if so, default office schedules to MATCHING (approved)
    $allRoomsApproved = $isLocked;
    if (!$allRoomsApproved) {
        $latestRunStmt = $pdo->prepare('SELECT id FROM matching_runs WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
        $latestRunStmt->execute([$semesterId]);
        $latestRunId = (int) $latestRunStmt->fetchColumn();
        if ($latestRunId) {
            $pendStmt = $pdo->prepare('SELECT COUNT(*) FROM match_slots WHERE run_id = ? AND decision = "PENDING"');
            $pendStmt->execute([$latestRunId]);
            $allRoomsApproved = ((int) $pendStmt->fetchColumn() === 0);
        }
    }
    $defaultSource = $allRoomsApproved ? 'MATCHING' : 'CHANGE';

    // Batch-load all existing OFFICE schedule_assignments for this semester
    $allCurDutyStmt = $pdo->prepare(
        'SELECT sa_profile_id, day_of_week, start_time, end_time, source
           FROM schedule_assignments
          WHERE semester_id = ? AND requirement_type = "OFFICE"
          ORDER BY sa_profile_id, FIELD(day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), start_time'
    );
    $allCurDutyStmt->execute([$semesterId]);
    $existingBySa = [];
    $hasEmptySource = false;
    $hasChangeSource = false;
    foreach ($allCurDutyStmt as $dRow) {
        $src = (string) ($dRow['source'] ?? '');
        if ($src === '') {
            $hasEmptySource = true;
            $dRow['source'] = $defaultSource;
        } elseif ($src === 'CHANGE' && $allRoomsApproved) {
            $hasChangeSource = true;
            $dRow['source'] = 'MATCHING';
        }
        $existingBySa[(int) $dRow['sa_profile_id']][] = $dRow;
    }

    // Normalize any empty enum `source` values on OFFICE schedule_assignments only when needed
    if ($hasEmptySource) {
        $pdo->prepare(
            'UPDATE schedule_assignments SET source = ?
              WHERE semester_id = ? AND requirement_type = "OFFICE" AND (source = "" OR source IS NULL)'
        )->execute([$defaultSource, $semesterId]);
    }
    if ($hasChangeSource && $allRoomsApproved) {
        $pdo->prepare(
            'UPDATE schedule_assignments SET source = "MATCHING"
              WHERE semester_id = ? AND requirement_type = "OFFICE" AND source = "CHANGE"'
        )->execute([$semesterId]);
    }

    // 2. Ensure all valid ASSIGNED office SAs (up to required_sa) have conflict-free OFFICE schedule_assignments.
    $stmt = $pdo->prepare(
        'SELECT p.id AS sa_id, p.office_id, p.supervisor_id, p.weekly_target_hours,
                r.id AS req_id, r.operating_start, r.operating_end, r.weekly_target_hours AS req_target,
                o.name AS office_name
           FROM sa_profiles p
           JOIN offices o ON o.id = p.office_id
           JOIN office_requirements r ON r.office_id = p.office_id AND r.semester_id = ?
          WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL
            AND p.assignment_status = "ASSIGNED"
            AND r.required_sa > 0'
    );
    $stmt->execute([$semesterId]);
    $assignedRows = $stmt->fetchAll();
    if (!$assignedRows) return;

    // Batch-load all duty-vs-class clashes for OFFICE assignments in one query
    $clashSaStmt = $pdo->prepare(
        'SELECT DISTINCT a.sa_profile_id
           FROM schedule_assignments a
           JOIN class_schedules c ON c.sa_profile_id = a.sa_profile_id
                                 AND c.semester_id = a.semester_id
                                 AND c.day_of_week = a.day_of_week
                                 AND c.archived_at IS NULL
                                 AND a.start_time < c.end_time AND a.end_time > c.start_time
          WHERE a.semester_id = ? AND a.requirement_type = "OFFICE"'
    );
    $clashSaStmt->execute([$semesterId]);
    $clashesBySa = [];
    foreach ($clashSaStmt->fetchAll(PDO::FETCH_COLUMN) as $cSid) {
        $clashesBySa[(int) $cSid] = true;
    }

    $allPool = matching_pool($semesterId, false);
    $delOffDutyStmt2 = null;
    $ins = null;

    $minW = min_weekly_hours();
    $cap = hard_weekly_cap();

    foreach ($assignedRows as $row) {
        $saId = (int) $row['sa_id'];
        $sa = $allPool[$saId] ?? null;
        if (!$sa) continue;

        $existing = $existingBySa[$saId] ?? [];
        $hasClash = !empty($clashesBySa[$saId]);

        $prefSup = !empty($row['supervisor_id']) ? (int) $row['supervisor_id'] : null;

        // Ensure existing assignments keep their supervisor synced with designated supervisor
        if (!empty($existing) && $prefSup) {
            $pdo->prepare('UPDATE schedule_assignments SET supervisor_id = ? WHERE semester_id = ? AND sa_profile_id = ? AND requirement_type = "OFFICE" AND (supervisor_id IS NULL OR supervisor_id <> ?)')
                ->execute([$prefSup, $semesterId, $saId, $prefSup]);
        }

        // When batch is locked and existing schedule is present without class clashes, never overwrite it
        if ($isLocked && !empty($existing) && !$hasClash) {
            continue;
        }

        $needsRegen = empty($existing);
        $preserveSource = $defaultSource;
        $curCred = 0.0;
        if (!$needsRegen) {
            foreach ($existing as $exRow) {
                if (in_array($exRow['source'], ['MATCHING', 'MANUAL'], true)) {
                    $preserveSource = $exRow['source'];
                }
            }
            if ($hasClash) {
                $needsRegen = true;
            }
            $curPattern = [];
            $curSatDuty = [];
            foreach ($existing as $exRow) {
                $d = $exRow['day_of_week'];
                $s = mins($exRow['start_time']);
                $e = mins($exRow['end_time']);
                $curPattern[] = [$d, $s, $e];
                if ($d === 'SAT') {
                    $curSatDuty[] = [$s, $e];
                    if ($s < 420 || $e > 720) $needsRegen = true;
                } elseif (in_array($d, WEEK_DAYS, true)) {
                    if ($s < 420 || $e > 1080) $needsRegen = true;
                    if ($s < 780 && $e > 720 && !($s < 720 && $e > 780)) {
                        $needsRegen = true;
                    }
                } else {
                    $needsRegen = true;
                }
            }
            $missingSatDuty = false;
            if ($preserveSource !== 'MANUAL') {
                $satBusy = array_merge($sa['classes']['SAT'] ?? [], $curSatDuty);
                $satVacant = subtract_spans([[480, 720]], $satBusy);
                foreach ($satVacant as [$svS, $svE]) {
                    if ($svE - $svS >= 60) {
                        $missingSatDuty = true;
                        $needsRegen = true;
                        break;
                    }
                }
            }
            $saForCred = $sa;
            $saForCred['duty'] = [];
            $curCred = credited_with($saForCred, $curPattern);
            if ($curCred < $minW || $curCred > $cap) {
                $needsRegen = true;
            }
        }

        if (!$needsRegen) continue;

        $sa['duty'] = [];
        $from = max(mins(OFFICE_OPEN), mins($row['operating_start'] ?: OFFICE_OPEN));
        $to = min(mins(OFFICE_CLOSE), mins($row['operating_end'] ?: OFFICE_CLOSE));
        $target = max($minW, (float) ($row['req_target'] ?: $row['weekly_target_hours'] ?: $minW));
        ['pattern' => $pattern, 'credited' => $newCred] = office_pattern($sa, $from, $to, $target);
        if (!$pattern) continue;
        if (!empty($existing) && !$missingSatDuty && $curCred < $minW && $newCred <= $curCred && !$hasClash) {
            continue;
        }

        if (!$delOffDutyStmt2) {
            $delOffDutyStmt2 = $pdo->prepare(
                'DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? AND requirement_type = "OFFICE"'
            );
            $ins = $pdo->prepare(
                'INSERT IGNORE INTO schedule_assignments
                    (semester_id, sa_profile_id, requirement_type, office_requirement_id, department, location, supervisor_id, day_of_week, start_time, end_time, source)
                 VALUES (?, ?, "OFFICE", ?, "OFFICE", ?, ?, ?, ?, ?, ?)'
            );
        }

        $delOffDutyStmt2->execute([$semesterId, $saId]);
        $supId = supervisor_for('OFFICE', (int) $row['office_id'], $prefSup);
        foreach ($pattern as [$day, $start, $end]) {
            $ins->execute([
                $semesterId,
                $saId,
                (int) $row['req_id'],
                $row['office_name'],
                $supId,
                $day,
                hhmm($start),
                hhmm($end),
                $preserveSource,
            ]);
        }
    }
}

function pattern_preference_fit(array $sa, array $pattern): float
{
    if (empty($sa['prefers']) || !$pattern) return 0.0;
    $total = 0;
    $matched = 0;
    foreach ($pattern as [$day, $s, $e]) {
        $dur = max(0, $e - $s);
        $total += $dur;
        foreach ($sa['prefers'][$day] ?? [] as [$ps, $pe]) {
            $ov = min($e, $pe) - max($s, $ps);
            if ($ov > 0) $matched += $ov;
        }
    }
    return $total > 0 ? round($matched / $total, 2) : 0.0;
}

function preference_note(array $sa, float $fit): ?string
{
    if (empty($sa['prefers'])) return null;
    if ($fit >= 0.75) return 'Matches preferred duty hours (' . round($fit * 100) . '%)';
    if ($fit >= 0.4) return 'Partially fits preferred hours (' . round($fit * 100) . '%)';
    return null;
}

function candidate_score(array $sa, float $addedHours, string $departmentType, ?int $officeId = null, float $preferenceFit = 0.0): float
{
    $score = 60.0;
    if ($departmentType === 'ITO' && is_tech_course((string) ($sa['course'] ?? ''))) {
        $score += 15.0;
    }
    if ($departmentType === 'OFFICE' && $officeId !== null && (int) ($sa['officeId'] ?? 0) === $officeId) {
        $score += 15.0;
    }
    $minW = min_weekly_hours();
    $capW = hard_weekly_cap();
    if ($addedHours >= $minW && $addedHours <= $capW) {
        $score += 20.0;
    } else {
        $score += min(18.0, ($addedHours / max(1.0, $minW)) * 15.0);
    }
    $score += round($preferenceFit * 5.0, 1);
    return round(min(100.0, $score), 1);
}

// -----------------------------------------------------------------------------
// PAGE 5: SCHEDULE MATCHING (ITO & ACADS ROOMS/LABS ONLY)
// -----------------------------------------------------------------------------

function matching_inputs(int $semesterId): array
{
    global $pdo;
    ensure_matching_board_tables();
    ensure_assigned_office_schedules($semesterId);
    $roomPool = matching_pool($semesterId, true);

    $itoCount = 0;
    $acadsCount = 0;
    $unassignedCount = 0;
    $markedReassignCount = 0;
    $missingSchedule = [];
    foreach ($roomPool as $sa) {
        if (in_array($sa['category'], ['ITO', 'RELIEVER'], true)) $itoCount++;
        elseif ($sa['category'] === 'ACADS') $acadsCount++;
        if (!empty($sa['markedForReassignment'])) {
            $markedReassignCount++;
        } elseif (($sa['assignmentStatus'] ?? 'UNASSIGNED') !== 'ASSIGNED') {
            $unassignedCount++;
        }
        if (empty($sa['classes'])) {
            $missingSchedule[] = [
                'id' => $sa['id'],
                'studentId' => $sa['studentId'],
                'name' => $sa['name'],
                'category' => $sa['category'],
            ];
        }
    }

    $roomStmt = $pdo->prepare(
        'SELECT department_type, room, MAX(required_sa) AS req_sa, COUNT(*) AS periods
           FROM room_requirements
          WHERE semester_id = ? AND department_type IN ("ITO", "ACADS")
          GROUP BY department_type, room'
    );
    $roomStmt->execute([$semesterId]);
    $roomPosts = $roomStmt->fetchAll();

    $itoRooms = 0;
    $acadsRooms = 0;
    $totalSlots = 0;
    $totalPeriods = 0;
    foreach ($roomPosts as $rp) {
        $req = (int) $rp['req_sa'];
        $totalSlots += $req;
        $totalPeriods += (int) $rp['periods'];
        if ($rp['department_type'] === 'ITO') $itoRooms++;
        else $acadsRooms++;
    }

    $officeAssignedCount = (int) $pdo->query(
        'SELECT COUNT(*) FROM sa_profiles WHERE sa_status = "ACTIVE" AND archived_at IS NULL AND (sa_category = "OFFICE" OR office_id IS NOT NULL) AND assignment_status = "ASSIGNED"'
    )->fetchColumn();

    $lockInfo = get_matching_batch_lock_info($semesterId);

    return [
        'pool' => count($roomPool),
        'itoSas' => $itoCount,
        'acadsSas' => $acadsCount,
        'unassignedSas' => $unassignedCount,
        'markedForReassignmentSas' => $markedReassignCount,
        'eligiblePoolSas' => $unassignedCount + $markedReassignCount,
        'officeAssignedSas' => $officeAssignedCount,
        'roomPosts' => count($roomPosts),
        'itoRooms' => $itoRooms,
        'acadsRooms' => $acadsRooms,
        'rooms' => $totalPeriods,
        'slots' => $totalSlots,
        'missingSchedule' => $missingSchedule,
        'canRun' => count($roomPool) > 0 && count($roomPosts) > 0 && empty($missingSchedule),
        'lockInfo' => $lockInfo,
    ];
}

function sync_room_requirements_for_room(int $semesterId, int $roomId, ?int $userId = null): void
{
    global $pdo;
    if ($roomId <= 0) return;

    $roomStmt = $pdo->prepare('SELECT id, code FROM rooms WHERE id = ? LIMIT 1');
    $roomStmt->execute([$roomId]);
    $roomRow = $roomStmt->fetch();
    if (!$roomRow) return;

    // Check if this room is already configured in room_requirements for this semester
    $reqStmt = $pdo->prepare(
        'SELECT department_type, required_sa, room, room_ids, created_by
           FROM room_requirements
          WHERE semester_id = ? AND (room_id = ? OR room = ?)
          LIMIT 1'
    );
    $reqStmt->execute([$semesterId, $roomId, $roomRow['code']]);
    $existingReq = $reqStmt->fetch();
    if (!$existingReq) return;

    $dept = $existingReq['department_type'];
    $reqSa = (int) $existingReq['required_sa'];
    $label = $existingReq['room'] ?: $roomRow['code'];
    $roomIdsStr = $existingReq['room_ids'] ?: (string) $roomId;
    $creator = $userId ?: ($existingReq['created_by'] ? (int) $existingReq['created_by'] : null);

    $utilStmt = $pdo->prepare(
        'SELECT day_of_week, start_time, end_time, class_name
           FROM room_utilization
          WHERE semester_id = ? AND room_id = ?
          ORDER BY FIELD(day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), start_time'
    );
    $utilStmt->execute([$semesterId, $roomId]);
    $periods = $utilStmt->fetchAll();
    if (!$periods) return;

    $blocks = [];
    foreach ($periods as $row) {
        $day = $row['day_of_week'];
        $subject = trim((string) ($row['class_name'] ?? ''));
        $i = count($blocks[$day] ?? []) - 1;
        if ($i >= 0 && $blocks[$day][$i]['end'] >= $row['start_time']
            && time_span_hours($blocks[$day][$i]['start'], max($blocks[$day][$i]['end'], $row['end_time'])) <= MAX_DUTY_BLOCK_HOURS) {
            $blocks[$day][$i]['end'] = max($blocks[$day][$i]['end'], $row['end_time']);
            if ($subject && !in_array($subject, $blocks[$day][$i]['classes'], true)) {
                $blocks[$day][$i]['classes'][] = $subject;
            }
            continue;
        }
        $blocks[$day][] = [
            'day' => $day,
            'start' => $row['start_time'],
            'end' => $row['end_time'],
            'classes' => $subject ? [$subject] : [],
        ];
    }

    $pdo->prepare('DELETE FROM room_requirements WHERE semester_id = ? AND (room_id = ? OR room = ?)')
        ->execute([$semesterId, $roomId, $label]);

    $ins = $pdo->prepare(
        'INSERT IGNORE INTO room_requirements
            (semester_id, department_type, room, room_id, room_ids, day_of_week, start_time, end_time, class_name, required_sa, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "From Room Setup", ?)'
    );
    foreach ($blocks as $dayBlocks) {
        foreach ($dayBlocks as $b) {
            $className = $b['classes'] ? mb_substr(implode(' / ', $b['classes']), 0, 120) : null;
            $ins->execute([
                $semesterId, $dept, $label, $roomId, $roomIdsStr,
                $b['day'], $b['start'], $b['end'], $className, $reqSa, $creator,
            ]);
        }
    }
}

function build_room_posts(int $semesterId): array
{
    global $pdo;
    $stmt = $pdo->prepare(
        'SELECT q.*, r.building, r.room_type
           FROM room_requirements q
           LEFT JOIN rooms r ON r.id = q.room_id
          WHERE q.semester_id = ? AND q.department_type IN ("ITO", "ACADS")
          ORDER BY FIELD(q.department_type, "ITO", "ACADS"), q.room,
                   FIELD(q.day_of_week, "MON","TUE","WED","THU","FRI","SAT","SUN"), q.start_time'
    );
    $stmt->execute([$semesterId]);
    $rows = $stmt->fetchAll();

    $posts = [];
    foreach ($rows as $r) {
        $key = $r['department_type'] . '|' . $r['room'];
        if (!isset($posts[$key])) {
            $posts[$key] = [
                'key' => $key,
                'department' => $r['department_type'],
                'room' => $r['room'],
                'roomId' => $r['room_id'] ? (int) $r['room_id'] : null,
                'building' => $r['building'] ?: 'Main Building',
                'roomType' => $r['room_type'] ?: ($r['department_type'] === 'ITO' ? 'COMPUTER_LAB' : 'LECTURE'),
                'requiredSa' => (int) $r['required_sa'],
                'firstReqId' => (int) $r['id'],
                'rawSpans' => [],
                'open' => [],
            ];
        }
        $posts[$key]['requiredSa'] = max($posts[$key]['requiredSa'], (int) $r['required_sa']);
        $posts[$key]['rawSpans'][$r['day_of_week']][] = [mins($r['start_time']), mins($r['end_time'])];
    }

    $utilStmt = $pdo->prepare(
        'SELECT r.code, u.day_of_week, u.start_time, u.end_time
           FROM room_utilization u
           JOIN rooms r ON r.id = u.room_id
          WHERE u.semester_id = ?'
    );
    $utilStmt->execute([$semesterId]);
    $utilByRoom = [];
    foreach ($utilStmt as $u) {
        $utilByRoom[$u['code']][$u['day_of_week']][] = [mins($u['start_time']), mins($u['end_time'])];
    }

    foreach ($posts as &$post) {
        $hasLiveUtil = !empty($utilByRoom[$post['room']]);
        foreach (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as $day) {
            // If room_utilization has live rows for this room, use room_utilization as authoritative
            // so period edits/deletions on Room/Lab Schedules immediately adapt the active room hours.
            $spans = $hasLiveUtil
                ? ($utilByRoom[$post['room']][$day] ?? [])
                : ($post['rawSpans'][$day] ?? []);
            if ($spans) {
                $merged = merge_spans($spans);
                $earliest = min(array_column($merged, 0));
                $latest = max(array_column($merged, 1));
                $post['open'][$day] = [[$earliest, $latest]];
            }
        }
        unset($post['rawSpans']);
    }
    unset($post);

    return array_values($posts);
}

function sa_free_windows_for_room(array $sa, array $roomOpen): array
{
    $windows = [];
    foreach ($roomOpen as $day => $openSpans) {
        $busy = array_merge($sa['classes'][$day] ?? [], $sa['duty'][$day] ?? []);
        $free = subtract_spans($openSpans, $busy);
        foreach ($free as [$s, $e]) {
            if ($e - $s >= 60) {
                $windows[$day][] = [$s, $e];
            }
        }
    }
    return $windows;
}

function pattern_has_class_or_room_conflict(array $sa, array $pattern, array $roomOpen, bool $strictRoomEnvelope = true): bool
{
    if (!$pattern) return true;
    $insideRoomPat = [];
    foreach ($pattern as $sp) {
        if (!is_array($sp) || count($sp) < 3) return true;
        [$day, $s, $e] = [$sp[0], (int) $sp[1], (int) $sp[2]];
        if ($e <= $s) return true;
        // 1. Check against SA's live official Registrar class schedule
        foreach ($sa['classes'][$day] ?? [] as [$cs, $ce]) {
            if (overlaps($s, $e, $cs, $ce)) return true;
        }
        // Must always be within campus operating hours (7:00 AM – 10:00 PM, Mon–Sat)
        if ($s < 420 || $e > 1320) return true;

        $dayOpen = $roomOpen[$day] ?? [];
        foreach (intersect_spans($dayOpen, [[$s, $e]]) as [$is, $ie]) {
            if ($ie > $is) $insideRoomPat[] = [$day, $is, $ie];
        }
    }

    // 2. Check that duty block is within the room's live open schedule on that day (unless manually overridden
    // or extended within campus operating hours because roomOpen alone cannot reach min_weekly_hours())
    if ($strictRoomEnvelope) {
        $minW = min_weekly_hours();
        $maxInRoom = build_single_sa_room_pattern_in_open_only($sa, $roomOpen);
        if ($maxInRoom >= $minW) {
            foreach ($pattern as $sp) {
                [$day, $s, $e] = [$sp[0], (int) $sp[1], (int) $sp[2]];
                $dayOpen = $roomOpen[$day] ?? [];
                if (!$dayOpen) return true;
                $insideRoom = false;
                foreach ($dayOpen as [$os, $oe]) {
                    if ($s >= $os && $e <= $oe) {
                        $insideRoom = true;
                        break;
                    }
                }
                if (!$insideRoom) return true;
            }
        }
    }
    return false;
}

function build_single_sa_room_pattern_in_open_only(array $sa, array $roomOpen): float
{
    $free = sa_free_windows_for_room($sa, $roomOpen);
    $pat = [];
    foreach (DAY_ORDER as $day) {
        $f = $free[$day] ?? [];
        if (!$f) continue;
        $classes = merge_spans($sa['classes'][$day] ?? []);
        if (duty_day_has_zero_class_gap($f, $classes)) {
            foreach ($f as [$s, $e]) {
                if ($e - $s >= 60) $pat[] = [$day, $s, $e];
            }
        } else {
            $bestWin = null;
            foreach ($f as [$s, $e]) {
                if ($e - $s < 60) continue;
                if (duty_day_has_zero_class_gap([[$s, $e]], $classes)) {
                    if ($bestWin === null || ($e - $s) > ($bestWin[1] - $bestWin[0])) {
                        $bestWin = [$s, $e];
                    }
                }
            }
            if ($bestWin) {
                $pat[] = [$day, $bestWin[0], $bestWin[1]];
            }
        }
    }
    return credited_with($sa, $pat);
}

/**
 * Computes overlapping duty windows between primary partners assigned to the same room.
 * In ITO rooms, these overlapping duty windows indicate times when both partners are on duty
 * simultaneously so one partner can serve as a Permanent ITO Reliever for another ITO room.
 */
function compute_room_partner_overlaps(array $partners): array
{
    $n = count($partners);
    if ($n < 2) return ['windows' => [], 'totalHours' => 0.0, 'byDay' => []];

    $byPartnerDay = [];
    foreach ($partners as $idx => $p) {
        foreach ($p['pattern'] ?? [] as $sp) {
            if (!is_array($sp) || count($sp) < 3) continue;
            [$d, $s, $e] = [$sp[0], (int) $sp[1], (int) $sp[2]];
            if ($e > $s) {
                $byPartnerDay[$idx][$d][] = [$s, $e];
            }
        }
    }

    $windows = [];
    $byDay = [];
    $totalMins = 0;

    foreach (DAY_ORDER as $day) {
        $dayOverlaps = [];
        for ($i = 0; $i < $n; $i++) {
            for ($j = $i + 1; $j < $n; $j++) {
                $spansI = merge_spans($byPartnerDay[$i][$day] ?? []);
                $spansJ = merge_spans($byPartnerDay[$j][$day] ?? []);
                if (!$spansI || !$spansJ) continue;
                $inter = intersect_spans($spansI, $spansJ);
                foreach ($inter as [$os, $oe]) {
                    if ($oe - $os >= 30) {
                        $hrs = round(($oe - $os) / 60.0, 1);
                        $item = [
                            'day' => $day,
                            'start' => $os,
                            'end' => $oe,
                            'startTime' => hhmm($os),
                            'endTime' => hhmm($oe),
                            'startLabel' => format_time(hhmm($os)),
                            'endLabel' => format_time(hhmm($oe)),
                            'hours' => $hrs,
                            'partner1' => $partners[$i]['name'] ?? 'Partner 1',
                            'partner2' => $partners[$j]['name'] ?? 'Partner 2',
                        ];
                        $windows[] = $item;
                        $dayOverlaps[] = [$os, $oe];
                    }
                }
            }
        }
        if ($dayOverlaps) {
            $mergedDay = merge_spans($dayOverlaps);
            $byDay[$day] = $mergedDay;
            $totalMins += span_minutes($mergedDay);
        }
    }

    return [
        'windows' => $windows,
        'totalHours' => round($totalMins / 60.0, 1),
        'byDay' => $byDay,
    ];
}


/**
 * Builds continuous (tuloy-tuloy, gap-free) daily duty spans for a pair of SAs on a given day.
 * Guarantees that we never chop a shared free window in half to create an idle gap, and strongly
 * prefers assigning each SA a single unbroken duty block directly adjacent to their class (0 gaps).
 */
/**
 * Returns true if $dutySpans on a day have 0 gap with the SA's Registrar $classes on that day.
 * Specifically:
 *  - If $dutySpans is empty: true (no duty on that day).
 *  - If $classes is empty: true iff $dutySpans is a single continuous block.
 *  - If $classes is non-empty: every duty block must touch at least one class boundary ($ds === $ce or $de === $cs),
 *    and if there are 2+ duty blocks on that day, they must be connected across a class with 0 gap (Duty -> Class -> Duty).
 */
function duty_day_has_zero_class_gap(array $dutySpans, array $classes): bool
{
    $dutySpans = merge_spans($dutySpans);
    if (!$dutySpans) return true;
    $classes = merge_spans($classes);
    if (!$classes) return count($dutySpans) === 1;

    foreach ($dutySpans as [$ds, $de]) {
        $touches = false;
        foreach ($classes as [$cs, $ce]) {
            if ((int) $ds === (int) $ce || (int) $de === (int) $cs) {
                $touches = true;
                break;
            }
        }
        if (!$touches) return false;
    }

    if (count($dutySpans) === 1) {
        return true;
    }

    // Multiple duty blocks on the same day must be bridged by classes with 0 gap between min start and max end
    $minS = $dutySpans[0][0];
    $maxE = $dutySpans[count($dutySpans) - 1][1];
    $bridged = merge_spans(array_merge($dutySpans, $classes));
    foreach ($bridged as [$bs, $be]) {
        if ($bs <= $minS && $be >= $maxE) {
            return true;
        }
    }
    return false;
}

/**
 * Checks if an entire weekly pattern has 0 class-duty gaps across all days.
 */
function pattern_has_zero_class_gap(array $sa, array $pattern): bool
{
    $byDay = [];
    foreach ($pattern as $sp) {
        if (!is_array($sp) || count($sp) < 3) continue;
        $byDay[$sp[0]][] = [(int) $sp[1], (int) $sp[2]];
    }
    foreach ($byDay as $d => $spans) {
        if (!duty_day_has_zero_class_gap($spans, $sa['classes'][$d] ?? [])) {
            return false;
        }
    }
    return true;
}

/**
 * Builds continuous (tuloy-tuloy, 0 class-duty gap) daily duty spans for a pair of SAs on a given day.
 */
function build_continuous_day_pair_spans(
    array $sa1,
    array $sa2,
    string $day,
    array $openSpans,
    array $f1,
    array $f2,
    float $cumMins1,
    float $cumMins2
): array {
    if (!$openSpans || (!$f1 && !$f2)) {
        return ['d1' => [], 'd2' => [], 'zeroGapDays' => 2, 'singleBlockDays' => 2];
    }
    $union = merge_spans(array_merge($f1, $f2));
    $targetMins = span_minutes($union);
    if ($targetMins <= 0) {
        return ['d1' => [], 'd2' => [], 'zeroGapDays' => 2, 'singleBlockDays' => 2];
    }

    $c1 = merge_spans($sa1['classes'][$day] ?? []);
    $c2 = merge_spans($sa2['classes'][$day] ?? []);

    $genCandidates = function (array $f, array $classes): array {
        $n = count($f);
        $cands = [[]]; // Allow empty shift on $day if the partner covers 100% of $day with 0 gap
        for ($i = 0; $i < $n; $i++) {
            [$s, $e] = $f[$i];
            if ($e - $s >= 60) {
                $cands[] = [[$s, $e]];
            }
        }
        for ($i = 0; $i < $n; $i++) {
            for ($j = $i + 1; $j < $n; $j++) {
                $slice = array_slice($f, $i, $j - $i + 1);
                if (duty_day_has_zero_class_gap($slice, $classes)) {
                    $cands[] = $slice;
                }
            }
        }
        return $cands;
    };

    $cands1 = $genCandidates($f1, $c1);
    $cands2 = $genCandidates($f2, $c2);

    $best = null;
    foreach ($cands1 as $d1) {
        foreach ($cands2 as $d2) {
            if (!$d1 && !$d2) continue;
            $cov = span_minutes(merge_spans(array_merge($d1, $d2)));
            if ($cov < $targetMins) continue;

            $variants = [[$d1, $d2]];
            if (count($d1) === 1 && count($d2) === 1) {
                [$s1, $e1] = $d1[0];
                [$s2, $e2] = $d2[0];
                if ($s1 === $s2 && $e1 === $e2 && ($e1 - $s1) >= 240 && empty($c1) && empty($c2)) {
                    $mid = $s1 + (int) floor((($e1 - $s1) / 2) / 30) * 30;
                    if ($mid - $s1 >= 60 && $e2 - $mid >= 60) {
                        $variants[] = [[[$s1, $mid]], [[$mid, $e2]]];
                    }
                }
            }

            foreach ($variants as [$v1, $v2]) {
                $zg1 = duty_day_has_zero_class_gap($v1, $c1) ? 1 : 0;
                $zg2 = duty_day_has_zero_class_gap($v2, $c2) ? 1 : 0;
                $sb1 = (count($v1) <= 1) ? 1 : 0;
                $sb2 = (count($v2) <= 1) ? 1 : 0;
                $nonEmpty = (!empty($v1) && !empty($v2)) ? 1 : 0;

                $m1 = span_minutes($v1);
                $m2 = span_minutes($v2);
                $diff = abs(($cumMins1 + $m1) - ($cumMins2 + $m2));
                $tot = $m1 + $m2;

                // Priority #1: Zero gap between Class and Duty ($zg1 + $zg2)
                // Priority #2: Both partners work ($nonEmpty) when both have 0 gap
                // Priority #3: Single unbroken block ($sb1 + $sb2)
                $tuple = [
                    $zg1 + $zg2,
                    $nonEmpty,
                    $sb1 + $sb2,
                    -$tot,
                    -$diff,
                ];
                if ($best === null || ($tuple <=> $best['tuple']) > 0) {
                    $best = [
                        'tuple' => $tuple,
                        'd1' => $v1,
                        'd2' => $v2,
                        'zeroGapDays' => $zg1 + $zg2,
                        'singleBlockDays' => $sb1 + $sb2,
                    ];
                }
            }
        }
    }

    if ($best) {
        return $best;
    }

    $fb1 = [];
    foreach ($f1 as $w) {
        if (duty_day_has_zero_class_gap([$w], $c1) && ($w[1] - $w[0]) > span_minutes($fb1)) {
            $fb1 = [$w];
        }
    }
    if (!$fb1 && $f1) $fb1 = [[$f1[0][0], $f1[0][1]]];

    $fb2 = [];
    foreach ($f2 as $w) {
        if (duty_day_has_zero_class_gap([$w], $c2) && ($w[1] - $w[0]) > span_minutes($fb2)) {
            $fb2 = [$w];
        }
    }
    if (!$fb2 && $f2) $fb2 = [[$f2[0][0], $f2[0][1]]];

    return [
        'd1' => $fb1,
        'd2' => $fb2,
        'zeroGapDays' => (duty_day_has_zero_class_gap($fb1, $c1) ? 1 : 0) + (duty_day_has_zero_class_gap($fb2, $c2) ? 1 : 0),
        'singleBlockDays' => 2,
    ];
}

/**
 * Reduces an SA's pattern so credited hours do not exceed $cap (Coordinator maxWeeklyDutyHours)
 * while strictly preserving 0 gap between Class and Duty.
 *  - Pass 1: Trims 30-min outer slices (not touching class) that are ALREADY covered by $partnerPat (longest block first).
 *  - Pass 2: If still > $cap, trims 30-min outer slices (not touching class) from the longest block first,
 *    or drops a redundant block on a day with 2 blocks / shortest day block, keeping 0 class-duty gap.
 */
function trim_pair_outer_redundant_hours(array $sa, array $pat, array $partnerPat, float $cap): array
{
    if (credited_with($sa, $pat) <= $cap) return $pat;

    $partnerByDay = [];
    foreach ($partnerPat as [$d, $s, $e]) {
        $partnerByDay[$d][] = [(int) $s, (int) $e];
    }

    $touchesClass = function (string $day, int $timePoint) use ($sa): bool {
        foreach ($sa['classes'][$day] ?? [] as [$cs, $ce]) {
            if ((int) $cs === $timePoint || (int) $ce === $timePoint) return true;
        }
        return false;
    };

    $canTrimBlock = function (array $currentPat, int $idx, int $newS, int $newE) use ($sa): bool {
        if ($newE - $newS < 60) return false;
        $d = $currentPat[$idx][0];
        $daySpans = [];
        foreach ($currentPat as $k => [$pd, $ps, $pe]) {
            if ($pd !== $d) continue;
            $daySpans[] = ($k === $idx) ? [$newS, $newE] : [(int) $ps, (int) $pe];
        }
        return duty_day_has_zero_class_gap($daySpans, $sa['classes'][$d] ?? []);
    };

    // Pass 1: Trim outer non-class-touching 30-min slices that are covered by the partner
    $guard = 0;
    while ($pat && credited_with($sa, $pat) > $cap && $guard < 120) {
        $guard++;
        $bestIdx = -1;
        $bestNewSpan = null;
        $bestLen = -1;

        foreach ($pat as $i => [$d, $s, $e]) {
            $len = $e - $s;
            if ($len <= 60 || $len <= $bestLen) continue;
            $pSpans = merge_spans($partnerByDay[$d] ?? []);
            if (!$pSpans) continue;

            if (!$touchesClass($d, $e) && span_minutes(intersect_spans([[$e - 30, $e]], $pSpans)) >= 30 && $canTrimBlock($pat, $i, $s, $e - 30)) {
                $bestIdx = $i;
                $bestNewSpan = [$s, $e - 30];
                $bestLen = $len;
            } elseif (!$touchesClass($d, $s) && span_minutes(intersect_spans([[$s, $s + 30]], $pSpans)) >= 30 && $canTrimBlock($pat, $i, $s + 30, $e)) {
                $bestIdx = $i;
                $bestNewSpan = [$s + 30, $e];
                $bestLen = $len;
            }
        }

        if ($bestIdx >= 0 && $bestNewSpan !== null) {
            $pat[$bestIdx][1] = $bestNewSpan[0];
            $pat[$bestIdx][2] = $bestNewSpan[1];
            continue;
        }
        break;
    }

    // Pass 2: Enforce Coordinator maxWeeklyDutyHours ($cap) by trimming outer non-class-touching 30-min slices from longest block
    while ($pat && credited_with($sa, $pat) > $cap && $guard < 240) {
        $guard++;
        $bestIdx = -1;
        $bestNewSpan = null;
        $bestLen = -1;

        foreach ($pat as $i => [$d, $s, $e]) {
            $len = $e - $s;
            if ($len <= 60 || $len <= $bestLen) continue;

            if (!$touchesClass($d, $e) && $canTrimBlock($pat, $i, $s, $e - 30)) {
                $bestIdx = $i;
                $bestNewSpan = [$s, $e - 30];
                $bestLen = $len;
            } elseif (!$touchesClass($d, $s) && $canTrimBlock($pat, $i, $s + 30, $e)) {
                $bestIdx = $i;
                $bestNewSpan = [$s + 30, $e];
                $bestLen = $len;
            }
        }

        if ($bestIdx >= 0 && $bestNewSpan !== null) {
            $pat[$bestIdx][1] = $bestNewSpan[0];
            $pat[$bestIdx][2] = $bestNewSpan[1];
            continue;
        }

        // If all blocks are down to 60 mins and still > $cap, drop the shortest block whose removal keeps 0 class-duty gap
        $dropIdx = -1;
        $dropScore = null;
        foreach ($pat as $i => [$d, $s, $e]) {
            $testPat = $pat;
            array_splice($testPat, $i, 1);
            if (!$testPat || !pattern_has_zero_class_gap($sa, $testPat)) continue;
            $pSpans = merge_spans($partnerByDay[$d] ?? []);
            $partnerCov = span_minutes(intersect_spans([[$s, $e]], $pSpans)) >= ($e - $s) ? 1 : 0;
            $tuple = [$partnerCov, -($e - $s)];
            if ($dropScore === null || ($tuple <=> $dropScore) > 0) {
                $dropScore = $tuple;
                $dropIdx = $i;
            }
        }
        if ($dropIdx >= 0) {
            array_splice($pat, $dropIdx, 1);
            continue;
        }
        break;
    }

    return $pat;
}

/**
 * Adds valid class-free duty hours to $currentPattern when credited hours are below $targetCredited (Coordinator minWeeklyDutyHours),
 * without exceeding $cap (Coordinator maxWeeklyDutyHours) and while keeping 0 gap between Class and Duty.
 */
function top_up_room_pattern(array $sa, array $currentPattern, array $freeWindows, float $targetCredited, float $cap): array
{
    $goal = min($targetCredited, $cap);
    if (credited_with($sa, $currentPattern) >= $goal) {
        return $currentPattern;
    }

    $normalizePat = function (array $p): array {
        $byDay = [];
        foreach ($p as [$d, $s, $e]) {
            if ($e > $s) $byDay[$d][] = [(int) $s, (int) $e];
        }
        $out = [];
        foreach (DAY_ORDER as $d) {
            foreach (merge_spans($byDay[$d] ?? []) as [$s, $e]) {
                $out[] = [$d, $s, $e];
            }
        }
        return $out;
    };

    $runTopUpPass = function (array $pat, array $windows) use ($sa, $goal, $cap, $normalizePat): array {
        $pat = $normalizePat($pat);
        $guard = 0;

        while (credited_with($sa, $pat) < $goal && $guard < 160) {
            $guard++;
            $changed = false;

            // 1. Try extending an existing block by 30 mins within $windows[$d] (shortest block first) while keeping 0 class-duty gap
            $bestIdx = -1;
            $bestExt = null;
            $bestLen = PHP_INT_MAX;

            foreach ($pat as $i => [$d, $s, $e]) {
                $len = $e - $s;
                if ($len >= $bestLen) continue;
                $fList = $windows[$d] ?? [];
                foreach ($fList as [$fs, $fe]) {
                    if ($fs <= $s && $fe >= $e) {
                        // Try extending end $e -> $e + 30
                        if ($e + 30 <= $fe) {
                            $testPat = $pat;
                            $testPat[$i][2] = $e + 30;
                            $testPat = $normalizePat($testPat);
                            if (pattern_has_zero_class_gap($sa, $testPat) && credited_with($sa, $testPat) <= $cap) {
                                $bestIdx = $i;
                                $bestExt = [$s, $e + 30];
                                $bestLen = $len;
                                break;
                            }
                        }
                        // Try extending start $s -> $s - 30
                        if ($s - 30 >= $fs) {
                            $testPat = $pat;
                            $testPat[$i][1] = $s - 30;
                            $testPat = $normalizePat($testPat);
                            if (pattern_has_zero_class_gap($sa, $testPat) && credited_with($sa, $testPat) <= $cap) {
                                $bestIdx = $i;
                                $bestExt = [$s - 30, $e];
                                $bestLen = $len;
                                break;
                            }
                        }
                    }
                }
            }

            if ($bestIdx >= 0 && $bestExt !== null) {
                $pat[$bestIdx][1] = $bestExt[0];
                $pat[$bestIdx][2] = $bestExt[1];
                $pat = $normalizePat($pat);
                $changed = true;
                continue;
            }

            // 2. Try adding a new 60-min class-touching (or standard morning) block on a free window that keeps 0 class-duty gap
            foreach (DAY_ORDER as $d) {
                $fList = $windows[$d] ?? [];
                if (!$fList) continue;
                $existingOnDay = [];
                foreach ($pat as [$pd, $ps, $pe]) {
                    if ($pd === $d) $existingOnDay[] = [$ps, $pe];
                }
                $classes = merge_spans($sa['classes'][$d] ?? []);
                foreach ($fList as [$fs, $fe]) {
                    if ($fe - $fs < 60) continue;
                    $overlapsExisting = false;
                    foreach ($existingOnDay as [$es, $ee]) {
                        if (overlaps($fs, $fe, $es, $ee)) {
                            $overlapsExisting = true;
                            break;
                        }
                    }
                    if ($overlapsExisting) continue;

                    $candidates60 = [];
                    if (empty($classes) && empty($existingOnDay) && $fs <= 480 && $fe >= 540) {
                        $candidates60[] = [480, 540];
                    }
                    $candidates60[] = [$fs, $fs + 60];
                    $candidates60[] = [$fe - 60, $fe];

                    foreach ($candidates60 as [$ns, $ne]) {
                        $testDaySpans = array_merge($existingOnDay, [[$ns, $ne]]);
                        if (!duty_day_has_zero_class_gap($testDaySpans, $classes)) continue;
                        $testPat = add_spans_to_pattern($pat, $d, [[$ns, $ne]]);
                        if (credited_with($sa, $testPat) <= $cap) {
                            $pat = $testPat;
                            $changed = true;
                            break 3;
                        }
                    }
                }
            }

            if (!$changed) break;
        }

        return $pat;
    };

    // Pass 1: Top up within the room's scheduled open hours ($freeWindows)
    $pat = $runTopUpPass($currentPattern, $freeWindows);

    // Pass 2: If roomOpen alone is narrower than the Coordinator minimum ($goal), extend within standard campus operating hours (7:00 AM – 10:00 PM Mon–Sat)
    if (credited_with($sa, $pat) < $goal) {
        $campusOpen = [];
        foreach (DAY_ORDER as $d) {
            $campusOpen[$d] = [[420, 1320]];
        }
        $campusFree = sa_free_windows_for_room($sa, $campusOpen);
        $pat = $runTopUpPass($pat, $campusFree);
    }

    return $pat;
}

function trim_room_pattern_to_cap(array $sa, array $pattern, float $cap): array
{
    return trim_pair_outer_redundant_hours($sa, $pattern, [], $cap);
}

function build_complementary_pair_patterns(array $sa1, array $sa2, array $roomOpen, ?array $w1 = null, ?array $w2 = null): array
{
    $w1 = $w1 ?? sa_free_windows_for_room($sa1, $roomOpen);
    $w2 = $w2 ?? sa_free_windows_for_room($sa2, $roomOpen);
    $minW = min_weekly_hours();
    $cap = hard_weekly_cap();

    $pat1 = [];
    $pat2 = [];
    $totalOpenMins = 0;
    $cumMins1 = 0.0;
    $cumMins2 = 0.0;
    $continuityScore = 0;

    foreach ($roomOpen as $day => $openSpans) {
        $totalOpenMins += span_minutes($openSpans);
        $f1 = $w1[$day] ?? [];
        $f2 = $w2[$day] ?? [];

        $dayRes = build_continuous_day_pair_spans($sa1, $sa2, $day, $openSpans, $f1, $f2, $cumMins1, $cumMins2);
        $continuityScore += ($dayRes['zeroGapDays'] * 10) + ($dayRes['singleBlockDays'] * 5);

        foreach ($dayRes['d1'] as [$s, $e]) {
            if ($e - $s >= 60) {
                $pat1[] = [$day, $s, $e];
                $cumMins1 += ($e - $s);
            }
        }
        foreach ($dayRes['d2'] as [$s, $e]) {
            if ($e - $s >= 60) {
                $pat2[] = [$day, $s, $e];
                $cumMins2 += ($e - $s);
            }
        }
    }

    // 1. If either SA is below Coordinator minimum ($minW), top up using valid zero-gap class-free windows
    if (credited_with($sa1, $pat1) < $minW) {
        $pat1 = top_up_room_pattern($sa1, $pat1, $w1, $minW, $cap);
    }
    if (credited_with($sa2, $pat2) < $minW) {
        $pat2 = top_up_room_pattern($sa2, $pat2, $w2, $minW, $cap);
    }

    // 2. If either SA is above Coordinator maximum ($cap), trim outer non-class-touching hours to stay <= $cap
    if (credited_with($sa1, $pat1) > $cap) {
        $pat1 = trim_pair_outer_redundant_hours($sa1, $pat1, $pat2, $cap);
    }
    if (credited_with($sa2, $pat2) > $cap) {
        $pat2 = trim_pair_outer_redundant_hours($sa2, $pat2, $pat1, $cap);
    }

    // Recompute actual covered minutes and zero-gap status after min/max adjustments
    $actualCovMins = 0;
    $ByDay1 = [];
    $ByDay2 = [];
    foreach ($pat1 as [$d, $s, $e]) $ByDay1[$d][] = [$s, $e];
    foreach ($pat2 as [$d, $s, $e]) $ByDay2[$d][] = [$s, $e];
    foreach ($roomOpen as $day => $openSpans) {
        $u = merge_spans(array_merge($ByDay1[$day] ?? [], $ByDay2[$day] ?? []));
        $actualCovMins += span_minutes(intersect_spans($openSpans, $u));
    }

    $zeroGapBoth = pattern_has_zero_class_gap($sa1, $pat1) && pattern_has_zero_class_gap($sa2, $pat2);
    $cred1 = credited_with($sa1, $pat1);
    $cred2 = credited_with($sa2, $pat2);
    $coverageRatio = $totalOpenMins > 0 ? round($actualCovMins / $totalOpenMins, 3) : 1.0;

    return [
        'pat1' => $pat1,
        'cred1' => $cred1,
        'raw1' => round(array_sum(array_map(fn($b) => ($b[2] - $b[1]) / 60.0, $pat1)), 1),
        'pat2' => $pat2,
        'cred2' => $cred2,
        'raw2' => round(array_sum(array_map(fn($b) => ($b[2] - $b[1]) / 60.0, $pat2)), 1),
        'coverageRatio' => $coverageRatio,
        'continuityScore' => $continuityScore,
        'zeroGapBoth' => $zeroGapBoth,
        'coveredMins' => $actualCovMins,
        'totalOpenMins' => $totalOpenMins,
    ];
}

function build_single_sa_room_pattern(array $sa, array $roomOpen): array
{
    $free = sa_free_windows_for_room($sa, $roomOpen);
    $minW = min_weekly_hours();
    $cap = hard_weekly_cap();
    $pat = [];
    foreach (DAY_ORDER as $day) {
        $f = $free[$day] ?? [];
        if (!$f) continue;
        $classes = merge_spans($sa['classes'][$day] ?? []);
        if (duty_day_has_zero_class_gap($f, $classes)) {
            foreach ($f as [$s, $e]) {
                if ($e - $s >= 60) $pat[] = [$day, $s, $e];
            }
        } else {
            $bestWin = null;
            foreach ($f as [$s, $e]) {
                if ($e - $s < 60) continue;
                if (duty_day_has_zero_class_gap([[$s, $e]], $classes)) {
                    if ($bestWin === null || ($e - $s) > ($bestWin[1] - $bestWin[0])) {
                        $bestWin = [$s, $e];
                    }
                }
            }
            if ($bestWin) {
                $pat[] = [$day, $bestWin[0], $bestWin[1]];
            }
        }
    }
    $cred = credited_with($sa, $pat);
    if ($cred < $minW) {
        $pat = top_up_room_pattern($sa, $pat, $free, $minW, $cap);
        $cred = credited_with($sa, $pat);
    }
    if ($cred > $cap) {
        $pat = trim_room_pattern_to_cap($sa, $pat, $cap);
        $cred = credited_with($sa, $pat);
    }
    $raw = round(array_sum(array_map(fn($b) => ($b[2] - $b[1]) / 60.0, $pat)), 1);
    return [
        'pattern' => $pat,
        'credited' => $cred,
        'raw' => $raw,
        'zeroGap' => pattern_has_zero_class_gap($sa, $pat),
    ];
}

function remove_span_from_pattern(array $pattern, string $targetDay, int $remStart, int $remEnd): array
{
    $out = [];
    foreach ($pattern as $sp) {
        if (!is_array($sp) || count($sp) < 3) continue;
        [$d, $s, $e] = [$sp[0], (int) $sp[1], (int) $sp[2]];
        if ($d !== $targetDay) {
            $out[] = [$d, $s, $e];
            continue;
        }
        $remained = subtract_spans([[$s, $e]], [[$remStart, $remEnd]]);
        foreach ($remained as [$rs, $re]) {
            if ($re - $rs >= 30) {
                $out[] = [$d, $rs, $re];
            }
        }
    }
    return $out;
}

function add_spans_to_pattern(array $pattern, string $targetDay, array $addSpans): array
{
    if (!$addSpans) return $pattern;
    $byDay = [];
    foreach ($pattern as $sp) {
        if (!is_array($sp) || count($sp) < 3) continue;
        $byDay[$sp[0]][] = [(int) $sp[1], (int) $sp[2]];
    }
    foreach ($addSpans as [$as, $ae]) {
        if ($ae > $as) {
            $byDay[$targetDay][] = [(int) $as, (int) $ae];
        }
    }
    $out = [];
    foreach (DAY_ORDER as $d) {
        foreach (merge_spans($byDay[$d] ?? []) as [$s, $e]) {
            if ($e - $s >= 30) {
                $out[] = [$d, $s, $e];
            }
        }
    }
    return $out;
}

function trim_overlapping_from_donor_pattern(array $sa, array $donorPat, array $partnerDonorPat, array $extraBlocks, float $cap): array
{
    $partnerByDay = [];
    foreach ($partnerDonorPat as [$d, $s, $e]) {
        $partnerByDay[$d][] = [$s, $e];
    }

    // Trim 30-min chunks from donor blocks that overlap with partner's coverage first
    $guard = 0;
    while ($donorPat && credited_with($sa, array_merge($donorPat, $extraBlocks)) > $cap && $guard < 40) {
        $guard++;
        $trimmed = false;
        for ($i = count($donorPat) - 1; $i >= 0; $i--) {
            [$d, $s, $e] = $donorPat[$i];
            if ($e - $s <= 60) continue;
            $pSpans = $partnerByDay[$d] ?? [];
            $ovEnd = intersect_spans([[$e - 30, $e]], $pSpans);
            if ($ovEnd) {
                $donorPat[$i][2] = $e - 30;
                $trimmed = true;
                break;
            }
            $ovStart = intersect_spans([[$s, $s + 30]], $pSpans);
            if ($ovStart) {
                $donorPat[$i][1] = $s + 30;
                $trimmed = true;
                break;
            }
        }
        if (!$trimmed) break;
    }
    return $donorPat;
}

/**
 * Assigns Relievers for ITO rooms where primary S.A.s have uncovered class gaps:
 * 1) When primary S.A.s have simultaneous class hours during lab sessions, or
 * 2) When there is a class in the laboratory but no duty was assigned or the S.A. has an early out.
 * Searches other ITO rooms where the two assigned partners have overlapping schedules/duty hours
 * during the uncovered window so one partner can relieve the uncovered ITO room
 * while the other partner continues covering their home ITO room.
 */
function assign_ito_permanent_relievers(array &$slotEntries, array $posts, array $pool, array &$adaptedChanges): int
{
    $capW = hard_weekly_cap();
    $postsByRoom = [];
    foreach ($posts as $p) {
        if ($p['department'] === 'ITO') {
            $postsByRoom[$p['room']] = $p;
        }
    }

    $itoPrimaryIndicesByRoom = [];
    foreach ($slotEntries as $idx => $entry) {
        if (($entry['post']['department'] ?? '') === 'ITO'
            && ($entry['slotNo'] ?? 0) < 10
            && ($entry['status'] ?? '') === 'RECOMMENDED'
            && !empty($entry['candidates'][0])) {
            $itoPrimaryIndicesByRoom[$entry['post']['room']][] = $idx;
        }
    }

    $relieverBlocksBySa = []; // saId => [[day, s, e], ...]
    $relieverAssignedRooms = []; // saId => targetRoom
    $newRelieverEntries = [];
    $relieversAssigned = 0;

    // Collect dedicated floating Relievers who are NOT already assigned as a primary room S.A.
    $primaryAssignedSaIds = [];
    foreach ($slotEntries as $se) {
        $c0 = $se['candidates'][0] ?? null;
        if (!empty($c0['sa']['id'])) {
            $primaryAssignedSaIds[(int) $c0['sa']['id']] = true;
        }
    }

    $dedicatedRelievers = [];
    foreach ($pool as $pSa) {
        $pId = (int) ($pSa['id'] ?? 0);
        if ((($pSa['category'] ?? '') === 'RELIEVER' || !empty($pSa['is_reliever'])) && !isset($primaryAssignedSaIds[$pId])) {
            $dedicatedRelievers[] = $pSa;
        }
    }

    foreach ($itoPrimaryIndicesByRoom as $targetRoom => $targetIndices) {
        $targetPost = $postsByRoom[$targetRoom] ?? null;
        if (!$targetPost) continue;

        // Relievers are strictly for ITO laboratories only:
        // 1) When all assigned S.A.(s) have simultaneous classes during a lab session; OR
        // 2) When there is an ongoing class in the laboratory, but the schedule did not assign duty
        //    or the assigned S.A. has an early out (unattended lab session).
        $primarySas = [];
        foreach ($targetIndices as $tIdx) {
            $saObj = $slotEntries[$tIdx]['candidates'][0]['sa'] ?? null;
            if ($saObj) {
                $primarySas[] = $saObj;
            }
        }
        if (empty($primarySas)) continue;

        // Find uncovered windows in $targetRoom
        $coveredByDay = [];
        foreach ($targetIndices as $tIdx) {
            $pat = $slotEntries[$tIdx]['candidates'][0]['pattern'] ?? [];
            foreach ($pat as [$d, $s, $e]) {
                $coveredByDay[$d][] = [(int) $s, (int) $e];
            }
        }

        $roomGaps = [];
        foreach ($targetPost['open'] as $day => $openSpans) {
            $cov = merge_spans($coveredByDay[$day] ?? []);
            $uncov = subtract_spans($openSpans, $cov);
            if (!$uncov) continue;

            // Any uncovered period where the laboratory has class sessions ($openSpans)
            // but no assigned S.A. is on duty qualifies for an ITO Reliever.
            foreach ($uncov as [$gs, $ge]) {
                if ($ge - $gs >= 30) {
                    $roomGaps[] = [$day, (int) $gs, (int) $ge];
                }
            }
        }

        if (!$roomGaps) continue;

        // Track relievers assigned to $targetRoom so the same donor SA is reused across multiple gaps if possible
        $assignedForTarget = []; // saId => ['sa' => ..., 'donorRoom' => ..., 'partnerName' => ..., 'blocks' => [], 'overlapNotes' => [], 'donorSlotIdx' => ...]

        $findAndApplyReliever = function (string $day, int $gs, int $ge, bool $onlyDirectDutyOverlap) use (
            $targetRoom,
            $dedicatedRelievers,
            $itoPrimaryIndicesByRoom,
            $postsByRoom,
            &$slotEntries,
            &$relieverBlocksBySa,
            &$relieverAssignedRooms,
            &$assignedForTarget,
            $capW
        ): bool {
            // STEP 1: ONLY ASSIGN DEDICATED FLOATING RELIEVER S.A.s
            // "sa ito kase tlaga may dalawang tao talaga lagi ang walang lab or room reliver lang talaga sila"
            // S.A.s assigned to primary room slots must NEVER be borrowed or duplicated into other rooms!
            // Sort dedicated relievers to balance load and prioritize room continuity
            $sortedRelievers = $dedicatedRelievers;
            usort($sortedRelievers, function ($a, $b) use ($relieverBlocksBySa, $assignedForTarget) {
                $aInRoom = isset($assignedForTarget[$a['id']]) ? 1 : 0;
                $bInRoom = isset($assignedForTarget[$b['id']]) ? 1 : 0;
                if ($aInRoom !== $bInRoom) return $bInRoom - $aInRoom;

                $hoursA = array_sum(array_map(fn($blk) => ($blk[2] - $blk[1]) / 60.0, $relieverBlocksBySa[$a['id']] ?? []));
                $hoursB = array_sum(array_map(fn($blk) => ($blk[2] - $blk[1]) / 60.0, $relieverBlocksBySa[$b['id']] ?? []));
                return $hoursA <=> $hoursB;
            });

            foreach ($sortedRelievers as $relSa) {
                // Strictly 1 room per Reliever S.A. — never duplicate an S.A. across multiple rooms!
                // "dapat isa isang ano lang sila naka assign. bawal mag double kase di nmn nila kayang hatiin sarili nila."
                // "dapat pag nakuha na sya as reliver sa ibang room dapat di na sya mag papakita pa."
                if (isset($relieverAssignedRooms[$relSa['id']]) && $relieverAssignedRooms[$relSa['id']] !== $targetRoom) {
                    continue;
                }

                // Class conflict check
                $relHasClass = false;
                foreach ($relSa['classes'][$day] ?? [] as [$cs, $ce]) {
                    if (overlaps($gs, $ge, $cs, $ce)) { $relHasClass = true; break; }
                }
                if ($relHasClass) continue;

                // Already relieving another room check
                $relBusy = false;
                foreach ($relieverBlocksBySa[$relSa['id']] ?? [] as [$rd, $rs, $re]) {
                    if ($rd === $day && overlaps($gs, $ge, $rs, $re)) { $relBusy = true; break; }
                }
                if ($relBusy) continue;

                // Capacity check
                $currentBlocks = $relieverBlocksBySa[$relSa['id']] ?? [];
                $addedHours = ($ge - $gs) / 60.0;
                $currentHours = array_sum(array_map(fn($b) => ($b[2] - $b[1]) / 60.0, $currentBlocks));
                if ($currentHours + $addedHours > $capW) continue;

                // Assign dedicated Reliever
                $relieverBlocksBySa[$relSa['id']][] = [$day, $gs, $ge];
                $relieverAssignedRooms[$relSa['id']] = $targetRoom;
                $gapText = format_time(hhmm($gs)) . '–' . format_time(hhmm($ge));
                if (!isset($assignedForTarget[$relSa['id']])) {
                    $assignedForTarget[$relSa['id']] = [
                        'sa' => $relSa,
                        'donorRoom' => 'Dedicated Reliever',
                        'donorPartnerName' => 'Dedicated Lab Reliever',
                        'blocks' => [],
                        'overlapNotes' => [],
                    ];
                }
                $assignedForTarget[$relSa['id']]['blocks'][] = [$day, $gs, $ge];
                $assignedForTarget[$relSa['id']]['overlapNotes'][] = "Dedicated ITO Reliever ({$relSa['name']}) -> covers {$targetRoom} ({$day} {$gapText})";
                return true;
            }

            // Room primary S.A.s must never be borrowed or duplicated into other rooms.
            // Relievers must ONLY be sourced from the dedicated floating relievers.
            return false;
        };

        $uncoveredRelieverGaps = [];
        foreach ($roomGaps as [$day, $gs, $ge]) {
            // 1. Try covering the entire gap with a dedicated reliever
            if ($findAndApplyReliever($day, $gs, $ge, true)) {
                continue;
            }
            // 2. If the gap is longer than 60 mins (e.g., 2 hours), split into hourly slices so dedicated relievers can cover slices
            if ($ge - $gs > 60) {
                $cursor = $gs;
                while ($cursor < $ge) {
                    $sliceEnd = min($ge, $cursor + 60);
                    if ($sliceEnd - $cursor >= 30) {
                        $coveredSlice = $findAndApplyReliever($day, $cursor, $sliceEnd, true);
                        if (!$coveredSlice) {
                            $uncoveredRelieverGaps[] = "{$day} " . format_time(hhmm($cursor)) . '–' . format_time(hhmm($sliceEnd));
                        }
                    }
                    $cursor = $sliceEnd;
                }
            } else {
                $uncoveredRelieverGaps[] = "{$day} " . format_time(hhmm($gs)) . '–' . format_time(hhmm($ge));
            }
        }

        if (!empty($uncoveredRelieverGaps)) {
            $gapWarn = 'Reliever Needed: Uncovered lab class window (' . implode(', ', $uncoveredRelieverGaps) . ') — no qualified conflict-free Reliever S.A. available';
            foreach ($targetIndices as $tIdx) {
                $slotEntries[$tIdx]['candidates'][0]['relieverNotes'][] = $gapWarn;
                if (empty($slotEntries[$tIdx]['conflictReason'])) {
                    $slotEntries[$tIdx]['conflictReason'] = $gapWarn;
                }
            }
            $adaptedChanges[] = "ITO Room {$targetRoom}: {$gapWarn}";
        }

        // Create Permanent ITO Reliever slot entries for $targetRoom
        $rCounter = 0;
        $targetDecision = 'PENDING';
        foreach ($targetIndices as $tIdx) {
            if (in_array($slotEntries[$tIdx]['decision'] ?? 'PENDING', ['ACCEPTED', 'OVERRIDDEN'], true)) {
                $targetDecision = 'ACCEPTED';
                break;
            }
        }

        foreach ($assignedForTarget as $relSaId => $rInfo) {
            $relSa = $rInfo['sa'];
            $donorRoom = $rInfo['donorRoom'];
            $relPattern = [];
            $byDayRel = [];
            foreach ($rInfo['blocks'] as [$d, $s, $e]) {
                $byDayRel[$d][] = [$s, $e];
            }
            foreach (DAY_ORDER as $d) {
                foreach (merge_spans($byDayRel[$d] ?? []) as [$s, $e]) {
                    $relPattern[] = [$d, $s, $e];
                }
            }
            $relRaw = round(array_sum(array_map(fn($b) => ($b[2] - $b[1]) / 60.0, $relPattern)), 1);
            $relCred = credited_with($relSa, $relPattern);

            $isDedicatedReliever = ($donorRoom === 'Dedicated Reliever' || $donorRoom === 'Floating Reliever Pool');
            $relLabel = $isDedicatedReliever ? "{$targetRoom} — ITO Reliever ({$relSa['name']})" : "{$targetRoom} — ITO Reliever (from {$donorRoom})";
            $newRelieverEntries[] = [
                'post' => $targetPost,
                'slotNo' => 10 + $rCounter,
                'labelOverride' => $relLabel,
                'status' => 'RECOMMENDED',
                'decision' => $targetDecision,
                'assignedSaId' => $targetDecision === 'ACCEPTED' ? $relSa['id'] : null,
                'conflictReason' => null,
                'isReliever' => true,
                'donorRoom' => $donorRoom,
                'candidates' => [[
                    'sa' => $relSa,
                    'pattern' => $relPattern,
                    'raw' => $relRaw,
                    'credited' => $relCred,
                    'score' => candidate_score($relSa, $relCred, 'ITO'),
                    'partnerName' => null,
                    'isReliever' => true,
                    'donorRoom' => $donorRoom,
                    'donorPartnerName' => $rInfo['donorPartnerName'],
                    'overlapNotes' => array_values(array_unique($rInfo['overlapNotes'])),
                ]],
            ];
            $rCounter++;
            $relieversAssigned++;
            $adaptedChanges[] = $isDedicatedReliever
                ? "ITO Room {$targetRoom}: Assigned Dedicated Reliever {$relSa['name']}"
                : "ITO Room {$targetRoom}: Assigned Permanent Reliever {$relSa['name']} (from Room {$donorRoom} overlapping schedule)";
        }
    }

    foreach ($newRelieverEntries as $re) {
        $slotEntries[] = $re;
    }

    return $relieversAssigned;
}

function run_matching(int $semesterId, int $userId, string $mode = 'standard', bool $preserveValidAccepted = false, bool $crossShuffle = false, ?string $runLabel = null): array
{
    global $pdo;
    if ($mode === 'cross_shuffle') {
        $crossShuffle = true;
    }
    ensure_matching_board_tables();
    $lockInfo = get_matching_batch_lock_info($semesterId);
    if (!empty($lockInfo['isLocked'])) {
        if ($mode === 'incremental') {
            $preserveValidAccepted = true;
        } elseif (!$preserveValidAccepted) {
            fail(
                'This semester matching batch is already approved and locked. Valid existing assignments cannot be replaced automatically. Use Match Unassigned / Reassignment Pool for uncovered rooms, or use Authorized Reassignment for specific room changes.',
                409
            );
        }
    }

    ensure_assigned_office_schedules($semesterId);

    // 1. Re-sync & double-check all active S.A. Registrar class schedules and Room/Lab posts + required_sa
    $pool = matching_pool($semesterId, true);
    $posts = build_room_posts($semesterId);
    $minW = min_weekly_hours();
    $capW = hard_weekly_cap();

    // Inspect previous run (if any) to detect changes in SA class schedules or Room required_sa / schedules,
    // and in 'alternative' mode to explore different valid partner combinations from the previous run.
    $prevByRoom = [];
    $adaptedChanges = [];
    $prevRunStmt = $pdo->prepare('SELECT * FROM matching_runs WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
    $prevRunStmt->execute([$semesterId]);
    $prevRunRow = $prevRunStmt->fetch();
    $prevRunId = $prevRunRow ? (int) $prevRunRow['id'] : 0;

    if ($prevRunId) {
        $prevSlotStmt = $pdo->prepare(
            'SELECT ms.id, ms.slot_no, ms.department, ms.label, ms.decision, ms.assigned_sa_profile_id,
                    rq.room, mc.sa_profile_id AS top_sa_id, mc.duty_pattern
               FROM match_slots ms
               LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
               LEFT JOIN match_candidates mc ON mc.slot_id = ms.id
                     AND mc.sa_profile_id = COALESCE(ms.assigned_sa_profile_id, (
                         SELECT mc2.sa_profile_id FROM match_candidates mc2 WHERE mc2.slot_id = ms.id ORDER BY mc2.rank_no ASC LIMIT 1
                     ))
              WHERE ms.run_id = ? AND ms.requirement_type = "ROOM" AND ms.slot_no < 10
              ORDER BY ms.id ASC'
        );
        $prevSlotStmt->execute([$prevRunId]);
        foreach ($prevSlotStmt as $ps) {
            $rName = $ps['room'] ?: preg_replace('/\s*—\s*(Partner\s+\d+|ITO\s+Reliever.*)$/i', '', $ps['label']);
            $saId = (int) ($ps['assigned_sa_profile_id'] ?: $ps['top_sa_id'] ?: 0);
            $pat = json_decode($ps['duty_pattern'] ?? '[]', true) ?: [];
            if (!isset($prevByRoom[$rName])) {
                $prevByRoom[$rName] = [
                    'department' => $ps['department'],
                    'slotCount' => 0,
                    'saIds' => [],
                    'slots' => [],
                ];
            }
            $prevByRoom[$rName]['slotCount']++;
            if ($saId > 0) $prevByRoom[$rName]['saIds'][] = $saId;
            $prevByRoom[$rName]['slots'][] = [
                'slotNo' => (int) $ps['slot_no'],
                'saId' => $saId,
                'decision' => $ps['decision'],
                'pattern' => $pat,
            ];
        }
    }

    // Compare live room requirements & SA class schedules against previous run
    foreach ($posts as $post) {
        $rName = $post['room'];
        $liveReq = (int) $post['requiredSa'];
        $liveDept = $post['department'];
        if (isset($prevByRoom[$rName])) {
            $oldCnt = (int) $prevByRoom[$rName]['slotCount'];
            $oldDept = $prevByRoom[$rName]['department'];
            if ($oldCnt !== $liveReq) {
                $adaptedChanges[] = "Room {$rName}: Required S.A. updated ({$oldCnt} → {$liveReq}) — adapted slot count";
            }
            if ($oldDept !== $liveDept) {
                $adaptedChanges[] = "Room {$rName}: Department updated ({$oldDept} → {$liveDept})";
            }
            foreach ($prevByRoom[$rName]['slots'] as $oldSlot) {
                $oldSaId = (int) $oldSlot['saId'];
                if ($oldSaId > 0 && isset($pool[$oldSaId]) && !empty($oldSlot['pattern'])) {
                    if (pattern_has_class_or_room_conflict($pool[$oldSaId], $oldSlot['pattern'], $post['open'])) {
                        $adaptedChanges[] = "{$pool[$oldSaId]['name']} ({$rName}): Class/room schedule change detected — duty adjusted (0 conflicts)";
                    }
                }
            }
        } else if ($prevRunId) {
            $adaptedChanges[] = "Room {$rName}: New room post added ({$liveReq} S.A. required)";
        }
    }

    $byDept = ['ITO' => [], 'ACADS' => []];
    foreach ($pool as $sa) {
        if (empty($sa['classes'])) continue;
        // Relievers are optional: if a room needs an S.A. to fill primary coverage,
        // relievers can be assigned as primary room partners.
        if (eligible_for($sa, 'ITO', null, false)) $byDept['ITO'][$sa['id']] = $sa;
        if (eligible_for($sa, 'ACADS', null, false)) $byDept['ACADS'][$sa['id']] = $sa;
    }

    foreach (['ITO', 'ACADS'] as $dept) {
        $list = array_values($byDept[$dept]);
        usort($list, function ($a, $b) use ($dept, $mode) {
            $isRelA = (($a['category'] ?? '') === 'RELIEVER' || !empty($a['is_reliever'])) ? 1 : 0;
            $isRelB = (($b['category'] ?? '') === 'RELIEVER' || !empty($b['is_reliever'])) ? 1 : 0;
            $isNativeA = ($a['category'] === $dept) ? 2 : ($isRelA ? 1 : 0);
            $isNativeB = ($b['category'] === $dept) ? 2 : ($isRelB ? 1 : 0);
            if ($isNativeA !== $isNativeB) return $isNativeB <=> $isNativeA;
            if ($dept === 'ITO') {
                $ta = is_tech_course((string) $a['course']) ? 1 : 0;
                $tb = is_tech_course((string) $b['course']) ? 1 : 0;
                if ($ta !== $tb) return $tb <=> $ta;
            }
            return $mode === 'alternative'
                ? ($b['id'] <=> $a['id'])
                : ($a['id'] <=> $b['id']);
        });
        if ($mode === 'alternative' && count($list) > 2) {
            $first = array_shift($list);
            $list[] = $first;
        }
        $byDept[$dept] = [];
        foreach ($list as $sa) $byDept[$dept][$sa['id']] = $sa;
    }

    $usedSaIds = [];
    $slotEntries = [];
    $recommendedCount = 0;
    $unfilledCount = 0;

    // If preserveValidAccepted is true (or incremental pool matching), lock in rooms whose ACCEPTED SAs
    // are not marked for reassignment and still match the room's live requiredSa, department, and have 0 conflicts.
    $preservedRooms = [];
    if ($preserveValidAccepted && $prevByRoom) {
        foreach ($posts as $post) {
            $rName = $post['room'];
            $prev = $prevByRoom[$rName] ?? null;
            if (!$prev) continue;
            if ($prev['slotCount'] !== (int) $post['requiredSa'] || $prev['department'] !== $post['department']) {
                continue;
            }
            $allAcceptedAndValid = count($prev['slots']) === (int) $post['requiredSa'];
            foreach ($prev['slots'] as $ps) {
                $sid = (int) $ps['saId'];
                $psCred = ($sid && isset($pool[$sid])) ? credited_with($pool[$sid], $ps['pattern']) : 0.0;
                if (!in_array($ps['decision'], ['ACCEPTED', 'OVERRIDDEN'], true)
                    || !$sid || !isset($pool[$sid]) || isset($usedSaIds[$sid])
                    || !empty($pool[$sid]['markedForReassignment'])
                    || !eligible_for($pool[$sid], $post['department'], null, $crossShuffle)
                    || $psCred < $minW || $psCred > $capW
                    || pattern_has_class_or_room_conflict($pool[$sid], $ps['pattern'], $post['open'])) {
                    $allAcceptedAndValid = false;
                    break;
                }
            }
            if ($allAcceptedAndValid) {
                $preservedRooms[$rName] = $prev['slots'];
                foreach ($prev['slots'] as $ps) {
                    $usedSaIds[(int) $ps['saId']] = true;
                }
            }
        }
    }

    // Order rooms by restrictiveness (smallest total open minutes first) during matching so rooms
    // with narrower schedules get the SAs whose classes connect directly (0 gap) to their open hours.
    $orderedPosts = $posts;
    usort($orderedPosts, function ($a, $b) {
        if ($a['department'] !== $b['department']) {
            return $a['department'] === 'ITO' ? -1 : 1;
        }
        $minsA = 0;
        foreach ($a['open'] as $sp) $minsA += span_minutes($sp);
        $minsB = 0;
        foreach ($b['open'] as $sp) $minsB += span_minutes($sp);
        return ($minsA <=> $minsB) ?: strcmp($a['room'], $b['room']);
    });

    foreach ($orderedPosts as $post) {
        $dept = $post['department'];
        $reqSa = (int) $post['requiredSa'];
        $roomOpen = $post['open'];
        $rName = $post['room'];
        $prevSaIdsForRoom = $prevByRoom[$rName]['saIds'] ?? [];

        if (isset($preservedRooms[$rName])) {
            $pSlots = $preservedRooms[$rName];
            foreach ($pSlots as $idx => $ps) {
                $sa = $pool[(int) $ps['saId']];
                $pat = $ps['pattern'];
                $cred = credited_with($sa, $pat);
                $raw = round(array_sum(array_map(fn($b) => ($b[2] - $b[1]) / 60.0, $pat)), 1);
                $partnerName = null;
                if (count($pSlots) === 2) {
                    $otherSaId = (int) $pSlots[$idx === 0 ? 1 : 0]['saId'];
                    $partnerName = $pool[$otherSaId]['name'] ?? null;
                }
                $slotEntries[] = [
                    'post' => $post,
                    'slotNo' => (int) $ps['slotNo'],
                    'status' => 'RECOMMENDED',
                    'decision' => $ps['decision'],
                    'assignedSaId' => $sa['id'],
                    'conflictReason' => null,
                    'candidates' => [[
                        'sa' => $sa,
                        'pattern' => $pat,
                        'raw' => $raw,
                        'credited' => $cred,
                        'score' => candidate_score($sa, $cred, $dept, null, pattern_preference_fit($sa, $pat)),
                        'partnerName' => $partnerName,
                    ]],
                ];
                $recommendedCount++;
            }
            continue;
        }

        $availableSas = array_values(array_filter(
            $byDept[$dept] ?? [],
            fn($sa) => !isset($usedSaIds[$sa['id']])
        ));

        $startSlotNo = 1;

        if ($reqSa >= 2) {
            $freeBySa = [];
            foreach ($availableSas as $candSa) {
                $freeBySa[$candSa['id']] = sa_free_windows_for_room($candSa, $roomOpen);
            }

            $pairs = [];
            $n = count($availableSas);

            for ($i = 0; $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $sa1 = $availableSas[$i];
                    $sa2 = $availableSas[$j];
                    $pairRes = build_complementary_pair_patterns(
                        $sa1, $sa2, $roomOpen,
                        $freeBySa[$sa1['id']], $freeBySa[$sa2['id']]
                    );
                    if (!$pairRes['pat1'] || !$pairRes['pat2']) continue;

                    $within1 = ($pairRes['cred1'] >= $minW && $pairRes['cred1'] <= $capW) ? 1 : 0;
                    $within2 = ($pairRes['cred2'] >= $minW && $pairRes['cred2'] <= $capW) ? 1 : 0;
                    $zeroGapBoth = !empty($pairRes['zeroGapBoth']) ? 1 : 0;
                    $fullCoverage = (($pairRes['coverageRatio'] ?? 0.0) >= 0.999) ? 1 : 0;
                    $contScore = (int) ($pairRes['continuityScore'] ?? 0);

                    $pairScore = ($pairRes['coverageRatio'] * 50.0)
                        + (($within1 + $within2) * 20.0)
                        + ($zeroGapBoth * 15.0)
                        + ($contScore / 100.0)
                        + min(10.0, ($pairRes['cred1'] + $pairRes['cred2']) / max(1.0, $minW * 2) * 10.0);
                    if ($dept === 'ITO') {
                        if (is_tech_course((string) $sa1['course'])) $pairScore += 2.5;
                        if (is_tech_course((string) $sa2['course'])) $pairScore += 2.5;
                    }

                    $sameAsPrev = (in_array($sa1['id'], $prevSaIdsForRoom, true) && in_array($sa2['id'], $prevSaIdsForRoom, true));
                    $diffCount = (!in_array($sa1['id'], $prevSaIdsForRoom, true) ? 1 : 0)
                               + (!in_array($sa2['id'], $prevSaIdsForRoom, true) ? 1 : 0);
                    $altFreshPair = ($mode === 'alternative' && !$sameAsPrev) ? (1 + $diffCount) : 0;
                    $isRel1 = (($sa1['category'] ?? '') === 'RELIEVER' || !empty($sa1['is_reliever'])) ? 1 : 0;
                    $isRel2 = (($sa2['category'] ?? '') === 'RELIEVER' || !empty($sa2['is_reliever'])) ? 1 : 0;
                    $relCount = $isRel1 + $isRel2;

                    $pairs[] = [
                        'sa1' => $sa1,
                        'sa2' => $sa2,
                        'res' => $pairRes,
                        'zeroGapBoth' => $zeroGapBoth,
                        'fullCoverage' => $fullCoverage,
                        'bothWithinLimits' => ($within1 && $within2) ? 1 : 0,
                        'withinLimitsCount' => $within1 + $within2,
                        'relCount' => $relCount,
                        'altFreshPair' => $altFreshPair,
                        'continuityScore' => $contScore,
                        'score' => round($pairScore, 2),
                    ];
                }
            }

            usort($pairs, fn($a, $b) => ($mode === 'alternative'
                ? [
                    $b['bothWithinLimits'],
                    $b['altFreshPair'],
                    $b['zeroGapBoth'],
                    $b['fullCoverage'],
                    $a['relCount'],
                    $b['withinLimitsCount'],
                    $b['score'],
                    $b['continuityScore'],
                ] <=> [
                    $a['bothWithinLimits'],
                    $a['altFreshPair'],
                    $a['zeroGapBoth'],
                    $a['fullCoverage'],
                    $b['relCount'],
                    $a['withinLimitsCount'],
                    $a['score'],
                    $a['continuityScore'],
                ]
                : [
                    $b['zeroGapBoth'],
                    $b['bothWithinLimits'],
                    $b['fullCoverage'],
                    $a['relCount'],
                    $b['withinLimitsCount'],
                    $b['score'],
                    $b['continuityScore'],
                ] <=> [
                    $a['zeroGapBoth'],
                    $a['bothWithinLimits'],
                    $a['fullCoverage'],
                    $b['relCount'],
                    $a['withinLimitsCount'],
                    $a['score'],
                    $a['continuityScore'],
                ]
            ));

            if ($pairs) {
                $chosen = $pairs[0];
                $sa1 = $chosen['sa1'];
                $sa2 = $chosen['sa2'];
                $res = $chosen['res'];

                $usedSaIds[$sa1['id']] = true;
                $usedSaIds[$sa2['id']] = true;

                $slot1Candidates = [[
                    'sa' => $sa1,
                    'pattern' => $res['pat1'],
                    'raw' => $res['raw1'],
                    'credited' => $res['cred1'],
                    'score' => candidate_score($sa1, $res['cred1'], $dept, null, pattern_preference_fit($sa1, $res['pat1'])),
                    'partnerName' => $sa2['name'],
                ]];
                $slot2Candidates = [[
                    'sa' => $sa2,
                    'pattern' => $res['pat2'],
                    'raw' => $res['raw2'],
                    'credited' => $res['cred2'],
                    'score' => candidate_score($sa2, $res['cred2'], $dept, null, pattern_preference_fit($sa2, $res['pat2'])),
                    'partnerName' => $sa1['name'],
                ]];

                foreach ($availableSas as $altSa) {
                    if ($altSa['id'] === $sa1['id'] || $altSa['id'] === $sa2['id']) continue;
                    $single = build_single_sa_room_pattern($altSa, $roomOpen);
                    if ($single['pattern'] && count($slot1Candidates) < 4) {
                        $slot1Candidates[] = [
                            'sa' => $altSa,
                            'pattern' => $single['pattern'],
                            'raw' => $single['raw'],
                            'credited' => $single['credited'],
                            'score' => candidate_score($altSa, $single['credited'], $dept),
                            'partnerName' => null,
                        ];
                    }
                    if ($single['pattern'] && count($slot2Candidates) < 4) {
                        $slot2Candidates[] = [
                            'sa' => $altSa,
                            'pattern' => $single['pattern'],
                            'raw' => $single['raw'],
                            'credited' => $single['credited'],
                            'score' => candidate_score($altSa, $single['credited'], $dept),
                            'partnerName' => null,
                        ];
                    }
                }

                $slotEntries[] = [
                    'post' => $post,
                    'slotNo' => 1,
                    'status' => 'RECOMMENDED',
                    'decision' => 'PENDING',
                    'assignedSaId' => null,
                    'conflictReason' => null,
                    'candidates' => $slot1Candidates,
                ];
                $slotEntries[] = [
                    'post' => $post,
                    'slotNo' => 2,
                    'status' => 'RECOMMENDED',
                    'decision' => 'PENDING',
                    'assignedSaId' => null,
                    'conflictReason' => null,
                    'candidates' => $slot2Candidates,
                ];
                $recommendedCount += 2;
                $startSlotNo = 3;
            }
        }

        // Fill remaining slots strictly up to $reqSa (e.g., Slot 1 when required_sa = 1, or Slots 3..N when required_sa >= 3)
        for ($slotNo = $startSlotNo; $slotNo <= $reqSa; $slotNo++) {
            $remainingSas = array_values(array_filter(
                $byDept[$dept] ?? [],
                fn($sa) => !isset($usedSaIds[$sa['id']])
            ));
            $ranked = [];
            foreach ($remainingSas as $sa) {
                $single = build_single_sa_room_pattern($sa, $roomOpen);
                if (!$single['pattern']) continue;
                $altFreshSa = ($mode === 'alternative' && !in_array($sa['id'], $prevSaIdsForRoom, true)) ? 1 : 0;
                $withinLimits = ($single['credited'] >= $minW && $single['credited'] <= $capW) ? 1 : 0;
                $zeroGap = !empty($single['zeroGap']) ? 1 : 0;
                $isRel = (($sa['category'] ?? '') === 'RELIEVER' || !empty($sa['is_reliever'])) ? 1 : 0;
                $ranked[] = [
                    'sa' => $sa,
                    'pattern' => $single['pattern'],
                    'raw' => $single['raw'],
                    'credited' => $single['credited'],
                    'zeroGap' => $zeroGap,
                    'withinLimits' => $withinLimits,
                    'isRel' => $isRel,
                    'altFreshSa' => $altFreshSa,
                    'score' => candidate_score($sa, $single['credited'], $dept, null, pattern_preference_fit($sa, $single['pattern'])),
                    'partnerName' => null,
                ];
            }
            usort($ranked, fn($a, $b) => [
                $b['withinLimits'],
                $b['altFreshSa'],
                $a['isRel'],
                $b['zeroGap'],
                $b['score'],
                $b['credited'],
            ] <=> [
                $a['withinLimits'],
                $a['altFreshSa'],
                $b['isRel'],
                $a['zeroGap'],
                $a['score'],
                $a['credited'],
            ]);

            if ($ranked) {
                $top = $ranked[0];
                $ordered = array_slice($ranked, 0, 4);
                $usedSaIds[$top['sa']['id']] = true;

                $slotEntries[] = [
                    'post' => $post,
                    'slotNo' => $slotNo,
                    'status' => 'RECOMMENDED',
                    'decision' => 'PENDING',
                    'assignedSaId' => null,
                    'conflictReason' => null,
                    'candidates' => $ordered,
                ];
                $recommendedCount++;
            } else {
                $slotEntries[] = [
                    'post' => $post,
                    'slotNo' => $slotNo,
                    'status' => 'COVERAGE_GAP',
                    'decision' => 'PENDING',
                    'assignedSaId' => null,
                    'conflictReason' => "Uncovered Slot: No qualified {$dept} S.A. available without class schedule conflict for {$post['room']} (Slot {$slotNo} of {$reqSa}).",
                    'candidates' => [],
                ];
                $unfilledCount++;
            }
        }
    }

    // 1A-2. AUTOMATED COVERAGE ACCOMMODATION PASS:
    // If any room slots could not be filled by department-native SAs (COVERAGE_GAP),
    // automatically accommodate remaining unassigned qualified SAs in the pool (e.g. Relievers, or cross-department SAs with compatible free hours)
    // so no room is left uncovered when available SAs exist!
    if ($unfilledCount > 0) {
        $remainingPoolSas = array_values(array_filter(
            $pool,
            fn($sa) => !isset($usedSaIds[$sa['id']]) && !empty($sa['classes'])
        ));

        if ($remainingPoolSas) {
            foreach ($slotEntries as &$slotEntry) {
                if ($slotEntry['status'] !== 'COVERAGE_GAP') continue;
                if (!$remainingPoolSas) break;

                $post = $slotEntry['post'];
                $roomOpen = $post['open'];
                $dept = $post['department'];

                $gapRanked = [];
                foreach ($remainingPoolSas as $candSa) {
                    $evalDecision = $candSa['evalDecision'] ?? null;
                    $banned = $candSa['evalBanned'] ?? null;
                    if (!empty($banned) && in_array($dept, $banned, true)) continue;

                    $single = build_single_sa_room_pattern($candSa, $roomOpen);
                    if (empty($single['pattern'])) continue;

                    $withinLimits = ($single['credited'] >= $minW && $single['credited'] <= $capW) ? 1 : 0;
                    $zeroGap = !empty($single['zeroGap']) ? 1 : 0;
                    $deptPref = eligible_for($candSa, $dept, null, true) ? 1 : 0;
                    $isTech = ($dept === 'ITO' && is_tech_course((string) ($candSa['course'] ?? ''))) ? 1 : 0;

                    $gapRanked[] = [
                        'sa' => $candSa,
                        'pattern' => $single['pattern'],
                        'raw' => $single['raw'],
                        'credited' => $single['credited'],
                        'zeroGap' => $zeroGap,
                        'withinLimits' => $withinLimits,
                        'deptPref' => $deptPref,
                        'isTech' => $isTech,
                        'score' => candidate_score($candSa, $single['credited'], $dept, null, pattern_preference_fit($candSa, $single['pattern'])),
                        'partnerName' => null,
                    ];
                }

                if ($gapRanked) {
                    usort($gapRanked, fn($a, $b) => [
                        $b['withinLimits'],
                        $b['deptPref'],
                        $b['isTech'],
                        $b['zeroGap'],
                        $b['score'],
                        $b['credited'],
                    ] <=> [
                        $a['withinLimits'],
                        $a['deptPref'],
                        $a['isTech'],
                        $a['zeroGap'],
                        $a['score'],
                        $a['credited'],
                    ]);

                    $top = $gapRanked[0];
                    $usedSaIds[$top['sa']['id']] = true;
                    $remainingPoolSas = array_values(array_filter($remainingPoolSas, fn($s) => (int)$s['id'] !== (int)$top['sa']['id']));

                    $slotEntry['status'] = 'RECOMMENDED';
                    $slotEntry['decision'] = 'PENDING';
                    $slotEntry['assignedSaId'] = null;
                    $slotEntry['conflictReason'] = null;
                    $slotEntry['candidates'] = array_slice($gapRanked, 0, 4);

                    $recommendedCount++;
                    $unfilledCount--;
                }
            }
            unset($slotEntry);
        }
    }

    // 1B. Strictly respect each room's configured required_sa!
    foreach (['ITO', 'ACADS'] as $dept) {
        $leftoverSas = array_values(array_filter(
            $byDept[$dept] ?? [],
            fn($sa) => !isset($usedSaIds[$sa['id']])
        ));
        if (!$leftoverSas) continue;

        foreach ($leftoverSas as $sa) {
            foreach ($slotEntries as &$se) {
                if (($se['post']['department'] ?? '') !== $dept || !empty($se['isReliever'])) continue;
                $alreadyInSlot = false;
                foreach ($se['candidates'] as $c) {
                    if ((int) ($c['sa']['id'] ?? 0) === (int) $sa['id']) {
                        $alreadyInSlot = true;
                        break;
                    }
                }
                if ($alreadyInSlot) continue;
                $single = build_single_sa_room_pattern($sa, $se['post']['open']);
                if (empty($single['pattern'])) continue;
                $se['candidates'][] = [
                    'sa' => $sa,
                    'pattern' => $single['pattern'],
                    'raw' => $single['raw'],
                    'credited' => $single['credited'],
                    'score' => candidate_score($sa, $single['credited'], $dept, null, pattern_preference_fit($sa, $single['pattern'])),
                    'partnerName' => null,
                ];
            }
            unset($se);
        }
    }

    // Restore standard room ordering on $slotEntries (ITO then ACADS, by room code, then slotNo)
    usort($slotEntries, function ($a, $b) {
        $da = $a['post']['department'] ?? '';
        $db = $b['post']['department'] ?? '';
        if ($da !== $db) return $da === 'ITO' ? -1 : 1;
        $ra = $a['post']['room'] ?? '';
        $rb = $b['post']['room'] ?? '';
        if ($ra !== $rb) return strcmp($ra, $rb);
        return ((int) $a['slotNo']) <=> ((int) $b['slotNo']);
    });

    // 2. Assign Permanent ITO Relievers ONLY for ITO rooms where both primary partners have simultaneous classes
    $primarySlotsCount = count($slotEntries);
    $relieversAssigned = assign_ito_permanent_relievers($slotEntries, $posts, $pool, $adaptedChanges);

    $needsReviewCount = 0;
    foreach ($slotEntries as $se) {
        if (!empty($se['isReliever'])) continue;
        $topCand = $se['candidates'][0] ?? null;
        if (!$topCand || $topCand['credited'] < $minW || $topCand['credited'] > $capW) {
            $needsReviewCount++;
        }
    }

    $keepBatchStatus = (!empty($lockInfo['isLocked']) && $preserveValidAccepted) ? 'APPROVED_LOCKED' : 'DRAFT';
    $keepApprovedBy = ($keepBatchStatus === 'APPROVED_LOCKED') ? ($lockInfo['approvedBy'] ?? $userId) : null;
    $keepApprovedAt = ($keepBatchStatus === 'APPROVED_LOCKED') ? ($lockInfo['approvedAt'] ?? date('Y-m-d H:i:s')) : null;
    $keepLockNotes = ($keepBatchStatus === 'APPROVED_LOCKED') ? ($lockInfo['lockNotes'] ?? null) : null;

    $pdo->beginTransaction();
    try {
        // Preserve previous matching runs so coordinator can switch between Match 1, Match 2, etc.
        $pdo->prepare('UPDATE matching_runs SET is_active = 0 WHERE semester_id = ?')->execute([$semesterId]);

        $existingCountStmt = $pdo->prepare('SELECT COUNT(*) FROM matching_runs WHERE semester_id = ?');
        $existingCountStmt->execute([$semesterId]);
        $runNumber = (int) $existingCountStmt->fetchColumn() + 1;
        $runName = !empty($runLabel) ? $runLabel : "Match {$runNumber}";

        $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND requirement_type = "ROOM" AND source = "MATCHING"')
            ->execute([$semesterId]);
        if (!$preserveValidAccepted) {
            $pdo->prepare('UPDATE schedule_assignments SET source = "CHANGE" WHERE semester_id = ? AND requirement_type = "OFFICE"')
                ->execute([$semesterId]);
        }

        $insRun = $pdo->prepare(
            'INSERT INTO matching_runs
                (semester_id, run_name, pool_count, room_slots, office_slots, recommended, needs_review, coverage_gaps, preserved_count, batch_status, is_active, approved_by, approved_at, lock_notes, run_by)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)'
        );
        $insRun->execute([
            $semesterId,
            $runName,
            count($pool),
            $primarySlotsCount,
            $recommendedCount,
            $needsReviewCount,
            $unfilledCount,
            count($preservedRooms),
            $keepBatchStatus,
            $keepApprovedBy,
            $keepApprovedAt,
            $keepLockNotes,
            $userId,
        ]);
        $runId = (int) $pdo->lastInsertId();

        $insSlot = $pdo->prepare(
            'INSERT INTO match_slots
                (run_id, requirement_type, room_requirement_id, slot_no, label, department, day_of_week, start_time, end_time, status, override_reason, decision, assigned_sa_profile_id)
             VALUES (?, "ROOM", ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)'
        );
        $insCand = $pdo->prepare(
            'INSERT INTO match_candidates
                (slot_id, sa_profile_id, rank_no, score, duty_hours, projected_hours, status, checks, duty_pattern)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        foreach ($slotEntries as $entry) {
            $post = $entry['post'];
            $slotNo = (int) $entry['slotNo'];
            $label = $entry['labelOverride'] ?? ($post['room'] . ($post['requiredSa'] > 1 ? ' — Partner ' . $slotNo : ''));
            $insSlot->execute([
                $runId,
                $post['firstReqId'],
                $slotNo,
                $label,
                $post['department'],
                $entry['status'],
                $entry['conflictReason'],
                $entry['decision'] ?? 'PENDING',
                $entry['assignedSaId'] ?? null,
            ]);
            $slotId = (int) $pdo->lastInsertId();

            foreach ($entry['candidates'] as $idx => $cand) {
                $sa = $cand['sa'];
                $rank = $idx + 1;
                if (!empty($cand['isReliever'])) {
                    $checks = [
                        'Official Registrar class schedule verified (0 conflicts)',
                        "Permanent ITO Reliever from Room {$cand['donorRoom']} (ITO only)",
                        "{$cand['credited']} reliever hrs/wk covering {$post['room']} while primary partners are in class",
                    ];
                    foreach ($cand['overlapNotes'] ?? [] as $ovNote) {
                        $checks[] = $ovNote;
                    }
                } else {
                    $checks = [
                        'Official Registrar class schedule verified (0 conflicts)',
                        ($sa['category'] !== $post['department'])
                            ? "Official Department Transfer: Reassigned from {$sa['category']} to {$post['department']} to fulfill room coverage"
                            : "Category matched: {$sa['category']} -> {$post['department']}",
                        "{$cand['credited']} credited hrs/wk ({$cand['raw']} raw hrs with 1h lunch rule)",
                    ];
                    if ($post['department'] === 'ITO') {
                        $checks[] = is_tech_course((string) $sa['course'])
                            ? "Relevant technical course: {$sa['course']}"
                            : "Needs Coordinator review: Non-IT course ({$sa['course']}) in ITO Laboratory";
                    }
                    if (!empty($cand['partnerName'])) {
                        $checks[] = "Complementary partner with {$cand['partnerName']}";
                    }
                    foreach ($cand['relieverNotes'] ?? [] as $rNote) {
                        $checks[] = $rNote;
                    }
                    if ($cand['credited'] >= $minW && $cand['credited'] <= $capW) {
                        $checks[] = "Within Coordinator weekly duty limits ({$minW}–{$capW} hrs/wk) · 0 class-duty gap";
                    } elseif ($cand['credited'] < $minW) {
                        $checks[] = "Needs Coordinator review: {$cand['credited']} credited hrs/wk is below minimum ({$minW} hrs/wk)";
                    } else {
                        $checks[] = "Needs Coordinator review: {$cand['credited']} credited hrs/wk exceeds maximum ({$capW} hrs/wk)";
                    }
                }
                $insCand->execute([
                    $slotId,
                    $sa['id'],
                    $rank,
                    $cand['score'],
                    $cand['raw'],
                    $cand['credited'],
                    $rank === 1 ? 'RECOMMENDED' : 'REVIEW',
                    json_encode($checks),
                    json_encode($cand['pattern']),
                ]);
            }
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    if ($preserveValidAccepted && !empty($preservedRooms)) {
        sync_approved_to_assignments($semesterId);
    }

    $result = matching_result($semesterId, false) ?? [];
    $result['recheck'] = [
        'mode' => $mode,
        'verifiedSas' => count($pool),
        'verifiedRooms' => count($posts),
        'totalSlots' => $primarySlotsCount,
        'relieversAssigned' => $relieversAssigned,
        'adaptedChanges' => array_values(array_unique($adaptedChanges)),
    ];
    return $result;
}

function reconcile_matching_with_live_data(int $semesterId): ?array
{
    global $pdo;
    ensure_matching_board_tables();
    if (is_matching_batch_locked($semesterId)) {
        // Never automatically re-run matching when the batch is already approved & locked
        return null;
    }

    $runStmt = $pdo->prepare('SELECT id, run_by FROM matching_runs WHERE semester_id = ? ORDER BY (is_active = 1) DESC, id DESC LIMIT 1');
    $runStmt->execute([$semesterId]);
    $run = $runStmt->fetch();
    if (!$run) return null;

    $runId = (int) $run['id'];
    $userId = (int) ($run['run_by'] ?: 1);

    $pool = matching_pool($semesterId, true);
    $posts = build_room_posts($semesterId);
    $postsByRoom = [];
    foreach ($posts as $p) {
        $postsByRoom[$p['room']] = $p;
    }

    $slotStmt = $pdo->prepare(
        'SELECT ms.id, ms.slot_no, ms.department, ms.label, ms.status, ms.decision, ms.assigned_sa_profile_id,
                rq.room, mc.sa_profile_id AS top_sa_id, mc.duty_pattern, mc.checks
           FROM match_slots ms
           LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
           LEFT JOIN match_candidates mc ON mc.slot_id = ms.id
                 AND mc.sa_profile_id = COALESCE(ms.assigned_sa_profile_id, (
                     SELECT mc2.sa_profile_id FROM match_candidates mc2 WHERE mc2.slot_id = ms.id ORDER BY mc2.rank_no ASC LIMIT 1
                 ))
          WHERE ms.run_id = ? AND ms.requirement_type = "ROOM" AND ms.slot_no < 10'
    );
    $slotStmt->execute([$runId]);
    $slotRows = $slotStmt->fetchAll();

    $slotsByRoom = [];
    foreach ($slotRows as $sr) {
        $rName = $sr['room'] ?: preg_replace('/\s*—\s*(Partner\s+\d+|ITO\s+Reliever.*)$/i', '', $sr['label']);
        $slotsByRoom[$rName][] = $sr;
    }

    $minW = min_weekly_hours();
    $capW = hard_weekly_cap();
    $needsAdapt = false;
    if (count($slotsByRoom) !== count($postsByRoom)) {
        $needsAdapt = true;
    } else {
        foreach ($postsByRoom as $rName => $post) {
            $rSlots = $slotsByRoom[$rName] ?? [];
            if (count($rSlots) !== (int) $post['requiredSa']) {
                $needsAdapt = true;
                break;
            }
            foreach ($rSlots as $rs) {
                if ($rs['department'] !== $post['department']) {
                    $needsAdapt = true;
                    break 2;
                }
                $saId = (int) ($rs['assigned_sa_profile_id'] ?: $rs['top_sa_id'] ?: 0);
                if ($saId > 0) {
                    if (!isset($pool[$saId]) || !eligible_for($pool[$saId], $post['department'])) {
                        $needsAdapt = true;
                        break 2;
                    }
                    $pat = json_decode($rs['duty_pattern'] ?? '[]', true) ?: [];
                    $cred = credited_with($pool[$saId], $pat);
                    if ($cred < $minW || $cred > $capW) {
                        $needsAdapt = true;
                        break 2;
                    }
                    $isCustomAdjusted = ($rs['decision'] === 'OVERRIDDEN')
                        || str_contains((string) ($rs['checks'] ?? ''), 'Adjusted by Coordinator');
                    if (pattern_has_class_or_room_conflict($pool[$saId], $pat, $post['open'], !$isCustomAdjusted)) {
                        $needsAdapt = true;
                        break 2;
                    }
                }
            }
        }
    }

    if ($needsAdapt) {
        return run_matching($semesterId, $userId, 'standard', true);
    }
    return null;
}

function matching_result(int $semesterId, bool $autoReconcile = false): ?array
{
    global $pdo;
    ensure_matching_board_tables();
    $reconciled = null;
    if ($autoReconcile && !is_matching_batch_locked($semesterId)) {
        $reconciled = reconcile_matching_with_live_data($semesterId);
        if ($reconciled) return $reconciled;
    }

    $runStmt = $pdo->prepare(
        'SELECT r.*, u.full_name AS run_by_name, u2.full_name AS approved_by_name
           FROM matching_runs r
           LEFT JOIN users u ON u.id = r.run_by
           LEFT JOIN users u2 ON u2.id = r.approved_by
          WHERE r.semester_id = ?
          ORDER BY (r.is_active = 1) DESC, r.id DESC LIMIT 1'
    );
    $runStmt->execute([$semesterId]);
    $run = $runStmt->fetch();
    if (!$run) return null;

    $slotsStmt = $pdo->prepare(
        'SELECT ms.*, rq.room, rq.required_sa
           FROM match_slots ms
           LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
          WHERE ms.run_id = ? AND ms.requirement_type = "ROOM"
          ORDER BY FIELD(ms.department, "ITO", "ACADS"), COALESCE(rq.room, ms.label), ms.slot_no'
    );
    $slotsStmt->execute([(int) $run['id']]);
    $slotRows = $slotsStmt->fetchAll();

    $candStmt = $pdo->prepare(
        'SELECT mc.*, p.student_id, p.first_name, p.last_name, p.course, p.year_level, p.sa_category, ms.department AS slot_dept, ms.slot_no, ms.label AS slot_label
           FROM match_candidates mc
           JOIN sa_profiles p ON p.id = mc.sa_profile_id
           JOIN match_slots ms ON ms.id = mc.slot_id
          WHERE ms.run_id = ?
          ORDER BY mc.slot_id, mc.rank_no'
    );
    $candStmt->execute([(int) $run['id']]);
    $candsBySlot = [];
    foreach ($candStmt as $c) {
        $pattern = json_decode($c['duty_pattern'] ?? '[]', true) ?: [];
        $dBlocks = [];
        foreach ($pattern as $sp) {
            if (!is_array($sp) || count($sp) < 3) continue;
            [$d, $s, $e] = [$sp[0], (int) $sp[1], (int) $sp[2]];
            $dBlocks[] = duty_block($d, $s, $e, false);
        }
        $dBlocks = credit_once_per_day($dBlocks, false);
        $checksArr = json_decode($c['checks'] ?? '[]', true) ?: [];
        $isRelCand = ((int) $c['slot_no'] >= 10 || str_contains((string) $c['slot_label'], 'Reliever'));
        $donorCand = null;
        if ($isRelCand && preg_match('/from\s+([^)]+)\)/i', (string) $c['slot_label'], $mD)) {
            $donorCand = trim($mD[1]);
        }
        $suitability = compute_candidate_suitability(
            [
                'category' => $c['sa_category'],
                'course' => $c['course'],
            ],
            (string) $c['slot_dept'],
            (float) $c['projected_hours'],
            (float) $c['duty_hours'],
            $isRelCand,
            $checksArr,
            $donorCand
        );

        $candsBySlot[(int) $c['slot_id']][] = [
            'saId' => (int) $c['sa_profile_id'],
            'studentId' => $c['student_id'],
            'name' => $c['first_name'] . ' ' . $c['last_name'],
            'course' => $c['course'],
            'yearLevel' => (int) $c['year_level'],
            'category' => $c['sa_category'],
            'roleBadge' => $isRelCand ? 'RELIEVER' : 'PRIMARY',
            'roleDescription' => $isRelCand ? 'Backup or reliever coverage only' : 'Official room assignment',
            'rank' => (int) $c['rank_no'],
            'score' => (float) $c['score'],
            'rawHours' => (float) $c['duty_hours'],
            'creditedHours' => (float) $c['projected_hours'],
            'status' => $c['status'],
            'checks' => $checksArr,
            'suitability' => $suitability,
            'pattern' => $pattern,
            'dutyBlocks' => $dBlocks,
        ];
    }

    $slots = [];
    $decidedCount = 0;
    $acceptedCount = 0;
    $pendingCount = 0;
    $relieverSlotsCount = 0;
    $primaryPartnersByRoomKey = [];

    // Track assigned SAs to strictly enforce 1 primary room per S.A. (no doubling!)
    $claimedPrimarySaIds = [];
    foreach ($slotRows as $s) {
        $slotNo = (int) $s['slot_no'];
        $isRel = ($slotNo >= 10 || str_contains((string) $s['label'], 'Reliever'));
        if (!$isRel && !empty($s['assigned_sa_profile_id'])) {
            $saIdVal = (int) $s['assigned_sa_profile_id'];
            if (!isset($claimedPrimarySaIds[$saIdVal])) {
                $claimedPrimarySaIds[$saIdVal] = (int) $s['id'];
            }
        }
    }

    foreach ($slotRows as $s) {
        $sid = (int) $s['id'];
        $slotNo = (int) $s['slot_no'];
        $isReliever = ($slotNo >= 10 || str_contains((string) $s['label'], 'Reliever'));
        $donorRoom = null;
        if ($isReliever && preg_match('/from\s+([^)]+)\)/i', (string) $s['label'], $m)) {
            $donorRoom = trim($m[1]);
        }

        $assignedSaId = !empty($s['assigned_sa_profile_id']) ? (int) $s['assigned_sa_profile_id'] : null;
        if ($assignedSaId && !$isReliever && isset($claimedPrimarySaIds[$assignedSaId]) && $claimedPrimarySaIds[$assignedSaId] !== $sid) {
            // Already claimed by another primary slot! Prevent duplicate!
            $assignedSaId = null;
        }
        $cands = $candsBySlot[$sid] ?? [];
        $top = null;

        if ($assignedSaId) {
            foreach ($cands as $c) {
                if ((int) $c['saId'] === $assignedSaId) {
                    $top = $c;
                    break;
                }
            }
            if (!$top && isset($pool[$assignedSaId])) {
                $pSa = $pool[$assignedSaId];
                $top = [
                    'saId' => $assignedSaId,
                    'studentId' => $pSa['student_id'] ?? '',
                    'name' => $pSa['name'] ?? '',
                    'course' => $pSa['course'] ?? '',
                    'yearLevel' => (int) ($pSa['yearLevel'] ?? 1),
                    'category' => $pSa['category'] ?? '',
                    'roleBadge' => $isReliever ? 'RELIEVER' : 'PRIMARY',
                    'roleDescription' => $isReliever ? 'Backup or reliever coverage only' : 'Official room assignment',
                    'rank' => 1,
                    'score' => 80.0,
                    'rawHours' => 0.0,
                    'creditedHours' => 0.0,
                    'status' => 'RECOMMENDED',
                    'checks' => [],
                    'pattern' => [],
                    'dutyBlocks' => [],
                ];
            }
        } elseif ($s['status'] !== 'COVERAGE_GAP') {
            foreach ($cands as $c) {
                $cSaId = (int) $c['saId'];
                // A primary S.A. cannot be assigned to more than 1 primary room!
                if (!$isReliever && isset($claimedPrimarySaIds[$cSaId]) && $claimedPrimarySaIds[$cSaId] !== $sid) {
                    continue; // Skip: this S.A. is already assigned/recommended to another primary room!
                }
                $top = $c;
                if (!$isReliever) {
                    $claimedPrimarySaIds[$cSaId] = $sid;
                }
                break;
            }
        }

        $slotStatus = $s['status'];
        $slotConflict = $s['override_reason'];
        if (!$top && !$isReliever) {
            $slotStatus = 'COVERAGE_GAP';
            if (empty($slotConflict)) {
                $slotConflict = "Uncovered Slot: No unassigned primary S.A. available without room conflict; Reliever coverage recommended.";
            }
        }

        if ($isReliever) {
            $relieverSlotsCount++;
        } else {
            if (in_array($s['decision'], ['ACCEPTED', 'OVERRIDDEN'], true) && $top) {
                $decidedCount++;
                $acceptedCount++;
            } else {
                $pendingCount++;
            }
        }

        $rName = $s['room'] ?: preg_replace('/\s*—\s*(Partner\s+\d+|ITO\s+Reliever.*)$/i', '', $s['label']);
        $rKey = $s['department'] . '|' . $rName;
        if (!$isReliever && $top) {
            $primaryPartnersByRoomKey[$rKey][] = [
                'name' => $top['name'],
                'pattern' => $top['pattern'],
            ];
        }

        $filteredAlternates = [];
        foreach ($cands as $c) {
            if ($top && (int) $c['saId'] === (int) $top['saId']) continue;
            $filteredAlternates[] = $c;
        }

        $slots[] = [
            'id' => $sid,
            'room' => $rName,
            'label' => $s['label'],
            'department' => $s['department'],
            'slotNo' => $slotNo,
            'isReliever' => $isReliever,
            'roleBadge' => $isReliever ? 'RELIEVER' : 'PRIMARY',
            'roleDescription' => $isReliever ? 'Backup or reliever coverage only' : 'Official room assignment',
            'donorRoom' => $donorRoom,
            'requiredSa' => (int) ($s['required_sa'] ?: 1),
            'status' => $slotStatus,
            'decision' => $top ? $s['decision'] : 'PENDING',
            'assignedSaId' => $assignedSaId ?: ($top['saId'] ?? null),
            'conflictReason' => $slotConflict,
            'recommended' => $top,
            'alternates' => $filteredAlternates,
        ];
    }

    // Attach room-level overlapping partner duty windows to each slot & dutyBlock
    $overlapsByRoomKey = [];
    foreach ($primaryPartnersByRoomKey as $rKey => $pList) {
        $overlapsByRoomKey[$rKey] = compute_room_partner_overlaps($pList);
    }
    foreach ($slots as &$sl) {
        $rKey = $sl['department'] . '|' . $sl['room'];
        $ov = $overlapsByRoomKey[$rKey] ?? ['windows' => [], 'totalHours' => 0.0, 'byDay' => []];
        $sl['overlaps'] = $ov['windows'];
        $sl['overlapHours'] = $ov['totalHours'];
        if (!$sl['isReliever'] && !empty($sl['recommended']['dutyBlocks'])) {
            foreach ($sl['recommended']['dutyBlocks'] as &$db) {
                $d = $db['day'];
                $dayOvSpans = $ov['byDay'][$d] ?? [];
                $inter = $dayOvSpans ? intersect_spans([[$db['start'], $db['end']]], $dayOvSpans) : [];
                $ovMins = span_minutes($inter);
                $db['hasOverlap'] = $ovMins >= 30;
                $db['overlapHours'] = round($ovMins / 60.0, 1);
                $db['overlapLabels'] = array_map(
                    fn($sp) => format_time(hhmm($sp[0])) . '–' . format_time(hhmm($sp[1])),
                    $inter
                );
            }
            unset($db);
        }
    }
    unset($sl);

    $totalSlots = (int) ($run['room_slots'] ?: (count($slots) - $relieverSlotsCount));
    $unfilled = (int) ($run['coverage_gaps'] ?? 0);
    $batchStatus = strtoupper((string) ($run['batch_status'] ?? 'DRAFT'));
    $isLocked = ($batchStatus === 'APPROVED_LOCKED');

    return [
        'id' => (int) $run['id'],
        'name' => $run['run_name'] ?: ('Match #' . $run['id']),
        'runName' => $run['run_name'] ?: ('Match #' . $run['id']),
        'isActive' => (bool) ($run['is_active'] ?? true),
        'semesterId' => (int) $run['semester_id'],
        'runBy' => $run['run_by_name'] ?: 'Coordinator',
        'createdAt' => $run['created_at'],
        'batchStatus' => $batchStatus,
        'isLocked' => $isLocked,
        'approvedBy' => $run['approved_by_name'] ?: ($run['approved_by'] ? 'Coordinator' : null),
        'approvedAt' => $run['approved_at'] ?? null,
        'lockNotes' => $run['lock_notes'] ?? null,
        'poolCount' => (int) $run['pool_count'],
        'totalSlots' => $totalSlots,
        'relieverSlots' => $relieverSlotsCount,
        'recommended' => (int) $run['recommended'],
        'unfilled' => $unfilled,
        'decided' => $decidedCount,
        'accepted' => $acceptedCount,
        'pending' => $pendingCount,
        'slots' => $slots,
    ];
}

/**
 * Returns all saved matching runs for the given semester so coordinator can switch between Match 1, Match 2, etc.
 */
function get_matching_runs_list(int $semesterId): array
{
    global $pdo;
    $stmt = $pdo->prepare(
        'SELECT id, semester_id, run_name, pool_count, room_slots, recommended, needs_review, coverage_gaps, batch_status, is_active, created_at
           FROM matching_runs
          WHERE semester_id = ?
          ORDER BY id ASC'
    );
    $stmt->execute([$semesterId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    return array_map(function($r, $idx) {
        return [
            'id' => (int) $r['id'],
            'name' => $r['run_name'] ?: ('Match ' . ($idx + 1)),
            'poolCount' => (int) $r['pool_count'],
            'roomSlots' => (int) $r['room_slots'],
            'recommended' => (int) $r['recommended'],
            'needsReview' => (int) $r['needs_review'],
            'coverageGaps' => (int) $r['coverage_gaps'],
            'batchStatus' => $r['batch_status'],
            'isActive' => (bool) $r['is_active'],
            'createdAt' => $r['created_at'],
        ];
    }, $rows, array_keys($rows));
}

/**
 * Clones the active matching run into a new saved snapshot (e.g. Match 2, Match 3).
 */
function clone_matching_run(int $semesterId, ?string $newName, int $userId): array
{
    global $pdo;
    $stmt = $pdo->prepare('SELECT * FROM matching_runs WHERE semester_id = ? ORDER BY (is_active = 1) DESC, id DESC LIMIT 1');
    $stmt->execute([$semesterId]);
    $src = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$src) {
        fail('No active matching run found to save.', 422);
    }
    $srcRunId = (int) $src['id'];

    if (empty($newName)) {
        $countStmt = $pdo->prepare('SELECT COUNT(*) FROM matching_runs WHERE semester_id = ?');
        $countStmt->execute([$semesterId]);
        $nextNum = (int) $countStmt->fetchColumn() + 1;
        $newName = "Match {$nextNum}";
    }

    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE matching_runs SET is_active = 0 WHERE semester_id = ?')->execute([$semesterId]);

        $insRun = $pdo->prepare('
            INSERT INTO matching_runs
                (semester_id, run_name, pool_count, room_slots, office_slots, recommended, needs_review, coverage_gaps, preserved_count, batch_status, is_active, approved_by, approved_at, lock_notes, run_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        ');
        $insRun->execute([
            $semesterId,
            $newName,
            $src['pool_count'],
            $src['room_slots'],
            $src['office_slots'],
            $src['recommended'],
            $src['needs_review'],
            $src['coverage_gaps'],
            $src['preserved_count'],
            $src['batch_status'],
            $src['approved_by'],
            $src['approved_at'],
            $src['lock_notes'],
            $userId
        ]);
        $newRunId = (int) $pdo->lastInsertId();

        $slotsStmt = $pdo->prepare('SELECT * FROM match_slots WHERE run_id = ?');
        $slotsStmt->execute([$srcRunId]);
        $slots = $slotsStmt->fetchAll(PDO::FETCH_ASSOC);

        $insSlot = $pdo->prepare('
            INSERT INTO match_slots
                (run_id, requirement_type, room_requirement_id, office_requirement_id, slot_no, label, department, day_of_week, start_time, end_time, status, override_reason, decision, assigned_sa_profile_id, decided_by, decided_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');

        $insCand = $pdo->prepare('
            INSERT INTO match_candidates
                (slot_id, sa_profile_id, rank_no, score, duty_hours, projected_hours, status, checks, duty_pattern)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');

        foreach ($slots as $sl) {
            $oldSlotId = (int) $sl['id'];
            $insSlot->execute([
                $newRunId,
                $sl['requirement_type'],
                $sl['room_requirement_id'],
                $sl['office_requirement_id'],
                $sl['slot_no'],
                $sl['label'],
                $sl['department'],
                $sl['day_of_week'],
                $sl['start_time'],
                $sl['end_time'],
                $sl['status'],
                $sl['override_reason'],
                $sl['decision'],
                $sl['assigned_sa_profile_id'],
                $sl['decided_by'],
                $sl['decided_at']
            ]);
            $newSlotId = (int) $pdo->lastInsertId();

            $candStmt = $pdo->prepare('SELECT * FROM match_candidates WHERE slot_id = ?');
            $candStmt->execute([$oldSlotId]);
            foreach ($candStmt->fetchAll(PDO::FETCH_ASSOC) as $cd) {
                $insCand->execute([
                    $newSlotId,
                    $cd['sa_profile_id'],
                    $cd['rank_no'],
                    $cd['score'],
                    $cd['duty_hours'],
                    $cd['projected_hours'],
                    $cd['status'],
                    $cd['checks'],
                    $cd['duty_pattern']
                ]);
            }
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Failed to save matching snapshot: ' . $e->getMessage(), 500);
    }

    sync_approved_to_assignments($semesterId);
    return [
        'newRunId' => $newRunId,
        'name' => $newName
    ];
}

/**
 * Deletes a matching run and its associated slots and candidate rankings.
 */
function delete_matching_run_record(int $semesterId, int $runId): array
{
    global $pdo;
    $chk = $pdo->prepare('SELECT is_active, run_name FROM matching_runs WHERE id = ? AND semester_id = ?');
    $chk->execute([$runId, $semesterId]);
    $row = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$row) fail('Matching run not found.', 404);

    $wasActive = (bool) $row['is_active'];
    $deletedName = $row['run_name'] ?: ("Match #" . $runId);

    $pdo->beginTransaction();
    try {
        $pdo->exec("DELETE FROM match_candidates WHERE slot_id IN (SELECT id FROM match_slots WHERE run_id = {$runId})");
        $pdo->exec("DELETE FROM match_slots WHERE run_id = {$runId}");
        $pdo->exec("DELETE FROM matching_runs WHERE id = {$runId}");

        if ($wasActive) {
            $latestStmt = $pdo->prepare('SELECT id FROM matching_runs WHERE semester_id = ? ORDER BY id DESC LIMIT 1');
            $latestStmt->execute([$semesterId]);
            $nextActiveId = (int) $latestStmt->fetchColumn();
            if ($nextActiveId) {
                $pdo->prepare('UPDATE matching_runs SET is_active = 1 WHERE id = ?')->execute([$nextActiveId]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Failed to delete matching run: ' . $e->getMessage(), 500);
    }

    sync_approved_to_assignments($semesterId);
    return ['deletedRunId' => $runId, 'name' => $deletedName];
}

// -----------------------------------------------------------------------------
// PAGE 6: RECOMMENDATIONS & WEEKLY DUTY GRID (7:00 AM–10:00 PM)
// -----------------------------------------------------------------------------

function sync_approved_to_assignments(int $semesterId): int
{
    global $pdo;
    try {
        $mStmt = $pdo->prepare('SELECT duty_schedule_mode FROM semesters WHERE id = ?');
        $mStmt->execute([$semesterId]);
        if ($mStmt->fetchColumn() === 'ENROLLMENT') return 0;
    } catch (Throwable $_) {}
    $runStmt = $pdo->prepare('SELECT id FROM matching_runs WHERE semester_id = ? ORDER BY (is_active = 1) DESC, id DESC LIMIT 1');
    $runStmt->execute([$semesterId]);
    $runId = (int) $runStmt->fetchColumn();

    if (!$runId) {
        $cntStmt = $pdo->prepare('SELECT COUNT(*) FROM schedule_assignments WHERE semester_id = ? AND requirement_type = "ROOM" AND source = "MATCHING"');
        $cntStmt->execute([$semesterId]);
        if ((int) $cntStmt->fetchColumn() > 0) {
            $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND requirement_type = "ROOM" AND source = "MATCHING"')
                ->execute([$semesterId]);
        }
        return 0;
    }

    $manualStmt = $pdo->prepare('SELECT DISTINCT sa_profile_id FROM schedule_assignments WHERE semester_id = ? AND requirement_type = "ROOM" AND source IN ("MANUAL", "CHANGE")');
    $manualStmt->execute([$semesterId]);
    $manualRoomSaIds = array_map('intval', $manualStmt->fetchAll(PDO::FETCH_COLUMN));

    $stmt = $pdo->prepare(
        'SELECT ms.id AS slot_id, ms.slot_no, ms.room_requirement_id, ms.department, ms.label, ms.assigned_sa_profile_id,
                rq.room, mc.sa_profile_id AS cand_sa_id, mc.duty_pattern
           FROM match_slots ms
           LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
           LEFT JOIN match_candidates mc ON mc.slot_id = ms.id
                 AND mc.sa_profile_id = COALESCE(ms.assigned_sa_profile_id, (
                     SELECT mc2.sa_profile_id FROM match_candidates mc2 WHERE mc2.slot_id = ms.id ORDER BY mc2.rank_no ASC LIMIT 1
                 ))
           JOIN sa_profiles p ON p.id = COALESCE(ms.assigned_sa_profile_id, mc.sa_profile_id)
          WHERE ms.run_id = ? AND ms.requirement_type = "ROOM"
            AND ms.status = "RECOMMENDED"
            AND ms.decision IN ("ACCEPTED", "OVERRIDDEN")
            AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL
          ORDER BY ms.slot_no ASC'
    );
    $stmt->execute([$runId]);
    $rows = $stmt->fetchAll();

    $desiredRows = [];
    $desiredKeys = [];
    $approvedSaIds = [];
    $assignedPrimaryRooms = [];
    foreach ($rows as $r) {
        $saId = (int) ($r['assigned_sa_profile_id'] ?: $r['cand_sa_id'] ?: 0);
        if (!$saId || in_array($saId, $manualRoomSaIds, true)) continue;
        $pattern = json_decode($r['duty_pattern'] ?? '[]', true) ?: [];
        if (!$pattern) continue;

        $isReliever = ((int) $r['slot_no'] >= 10 || str_contains((string) $r['label'], 'Reliever'));
        $baseRoom = $r['room'] ?: preg_replace('/\s*—\s*(Partner\s+\d+|ITO\s+Reliever.*)$/i', '', $r['label']);
        $roomName = $isReliever ? "{$baseRoom} (ITO Reliever)" : $baseRoom;
        $dept = $r['department'];
        $supId = supervisor_for($dept, null);
        $roomReqId = $r['room_requirement_id'] ? (int) $r['room_requirement_id'] : null;

        // Strictly enforce 1 primary room per S.A.
        if (!$isReliever) {
            if (isset($assignedPrimaryRooms[$saId]) && $assignedPrimaryRooms[$saId] !== $roomName) {
                continue;
            }
            $assignedPrimaryRooms[$saId] = $roomName;
        }

        foreach ($pattern as $span) {
            if (!is_array($span) || count($span) < 3) continue;
            [$day, $s, $e] = [$span[0], (int) $span[1], (int) $span[2]];
            if ($e <= $s) continue;
            $sTime = hhmm($s);
            $eTime = hhmm($e);
            $sig = "{$saId}|" . ($roomReqId ?? 0) . "|{$dept}|{$roomName}|" . ($supId ?? 0) . "|{$day}|{$sTime}|{$eTime}";
            if (!isset($desiredKeys[$sig])) {
                $desiredKeys[$sig] = true;
                $desiredRows[] = [
                    $semesterId,
                    $saId,
                    $roomReqId,
                    $dept,
                    $roomName,
                    $supId,
                    $day,
                    $sTime,
                    $eTime,
                ];
            }
        }
        $approvedSaIds[$saId] = [
            'department' => $dept,
            'location' => $roomName,
            'roomReqId' => $roomReqId,
        ];
    }

    // Compare against existing ROOM MATCHING schedule_assignments to avoid unnecessary DELETE + INSERT storms
    $exStmt = $pdo->prepare(
        'SELECT sa_profile_id, room_requirement_id, department, location, supervisor_id, day_of_week, start_time, end_time
           FROM schedule_assignments
          WHERE semester_id = ? AND requirement_type = "ROOM" AND source = "MATCHING"'
    );
    $exStmt->execute([$semesterId]);
    $existingRows = $exStmt->fetchAll();
    $existingKeys = [];
    foreach ($existingRows as $ex) {
        $sig = (int) $ex['sa_profile_id'] . '|'
            . ($ex['room_requirement_id'] ? (int) $ex['room_requirement_id'] : 0) . '|'
            . $ex['department'] . '|'
            . $ex['location'] . '|'
            . ($ex['supervisor_id'] ? (int) $ex['supervisor_id'] : 0) . '|'
            . $ex['day_of_week'] . '|'
            . $ex['start_time'] . '|'
            . $ex['end_time'];
        $existingKeys[$sig] = true;
    }

    $needsAssignmentWrite = (count($existingRows) !== count($desiredRows)) || (count(array_diff_key($desiredKeys, $existingKeys)) > 0);
    $inserted = 0;

    if ($needsAssignmentWrite) {
        $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND requirement_type = "ROOM" AND source = "MATCHING"')
            ->execute([$semesterId]);
        if ($desiredRows) {
            $ins = $pdo->prepare(
                'INSERT IGNORE INTO schedule_assignments
                    (semester_id, sa_profile_id, requirement_type, room_requirement_id, department, location, supervisor_id, day_of_week, start_time, end_time, source)
                 VALUES (?, ?, "ROOM", ?, ?, ?, ?, ?, ?, ?, "MATCHING")'
            );
            foreach ($desiredRows as $dParams) {
                $ins->execute($dParams);
                $inserted += $ins->rowCount();
            }
        }
    } else {
        $inserted = count($desiredRows);
    }

    // Update sa_profiles and handle official cross-department pull-out transfers
    if ($approvedSaIds) {
        $idList = implode(',', array_map('intval', array_keys($approvedSaIds)));
        $profStmt = $pdo->query("SELECT id, user_id, first_name, last_name, student_id, sa_category, assignment_status, department_type, supervisor_id FROM sa_profiles WHERE id IN ($idList)");
        $profById = [];
        foreach ($profStmt as $pr) {
            $profById[(int) $pr['id']] = $pr;
        }
        $updSaStmt = null;
        $updSaCategoryStmt = null;
        $actorUserId = isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : 2;

        foreach ($approvedSaIds as $saId => $meta) {
            $dept = is_array($meta) ? $meta['department'] : $meta;
            $loc = is_array($meta) ? ($meta['location'] ?? '') : '';
            $supId = supervisor_for($dept, null);
            $curProf = $profById[$saId] ?? null;
            if (!$curProf) continue;

            $currentCat = (string) ($curProf['sa_category'] ?? '');
            $isRelieverInIto = ($currentCat === 'RELIEVER' && $dept === 'ITO');
            $isCategoryMismatch = ($currentCat !== $dept && !$isRelieverInIto);

            if ($isCategoryMismatch) {
                // Official Department Reassignment / Category Transfer (e.g. ITO -> ACADS)
                $oldCat = $currentCat;
                $oldSupId = supervisor_for($oldCat, null) ?: ($curProf['supervisor_id'] ?? null);
                $saName = trim($curProf['first_name'] . ' ' . $curProf['last_name']);
                $studentId = $curProf['student_id'] ?? '';

                // 1. Pull out from previous department: clear conflicting matching slots in other departments
                if ($runId) {
                    $pdo->prepare('UPDATE match_slots SET assigned_sa_profile_id = NULL, decision = "PENDING" WHERE run_id = ? AND assigned_sa_profile_id = ? AND department != ?')
                        ->execute([$runId, $saId, $dept]);
                }

                // 2. Remove conflicting schedule assignments in old department
                $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? AND department != ?')
                    ->execute([$semesterId, $saId, $dept]);

                // 3. Update sa_profiles: officially update category, department_type, supervisor, and status
                if (!$updSaCategoryStmt) {
                    $updSaCategoryStmt = $pdo->prepare('UPDATE sa_profiles SET sa_category = ?, department_type = ?, supervisor_id = COALESCE(?, supervisor_id), assignment_status = "ASSIGNED" WHERE id = ?');
                }
                $updSaCategoryStmt->execute([$dept, $dept, $supId, $saId]);

                // Update local memory so subsequent checks recognize new category
                $profById[$saId]['sa_category'] = $dept;
                $profById[$saId]['department_type'] = $dept;
                $profById[$saId]['supervisor_id'] = $supId;
                $profById[$saId]['assignment_status'] = 'ASSIGNED';

                // 4. Send targeted in-app notifications
                if (function_exists('create_notification')) {
                    if ($oldSupId) {
                        create_notification(
                            (int) $oldSupId,
                            "Student Assistant Reassigned: {$saName}",
                            "{$saName} ({$studentId}) has been pulled out from {$oldCat} and officially transferred to {$dept} ({$loc}) to fulfill room coverage requirements.",
                            'SA_PULLOUT_TRANSFER',
                            '/supervisor/team',
                            $actorUserId
                        );
                    }
                    if ($supId && (int)$supId !== (int)$oldSupId) {
                        create_notification(
                            (int) $supId,
                            "New Student Assistant Assigned: {$saName}",
                            "{$saName} ({$studentId}) has been officially transferred to {$dept} and assigned to {$loc} under your supervision.",
                            'SA_PULLOUT_TRANSFER',
                            '/supervisor/team',
                            $actorUserId
                        );
                    }
                    if (!empty($curProf['user_id'])) {
                        create_notification(
                            (int) $curProf['user_id'],
                            'Department Assignment Updated',
                            "You have been officially reassigned to {$dept} for {$loc} under Supervisor " . ($dept === 'ACADS' ? 'Kirk Manalo' : 'Paul Vincent Espiritu') . ".",
                            'SA_PULLOUT_TRANSFER',
                            '/sa/schedule',
                            $actorUserId
                        );
                    }
                }

                // 5. Audit log & room assignment history
                try {
                    $pdo->prepare('
                        INSERT INTO room_assignment_history
                            (semester_id, room, department, slot_no, role_type, action_type, previous_sa_id, new_sa_id, summary, reason, actor_user_id, created_at)
                        VALUES
                            (?, ?, ?, 1, "PRIMARY", "TRANSFER", NULL, ?, ?, ?, ?, NOW())
                    ')->execute([
                        $semesterId,
                        $loc ?: $dept,
                        $dept,
                        $saId,
                        "Official Department Transfer: {$saName} ({$oldCat} -> {$dept})",
                        "Automated coverage accommodation: pulled out from {$oldCat} and transferred to {$dept} for {$loc}.",
                        $actorUserId,
                    ]);
                } catch (Throwable $_) {}
                audit('SA_CATEGORY_TRANSFER', "Transferred {$saName} (ID {$saId}) from {$oldCat} to {$dept} for {$loc}", $actorUserId);
            } else {
                $needsUpdate = $curProf['assignment_status'] !== 'ASSIGNED'
                    || $curProf['department_type'] !== $dept
                    || ($supId !== null && (int) ($curProf['supervisor_id'] ?? 0) !== $supId);
                if ($needsUpdate) {
                    if (!$updSaStmt) {
                        $updSaStmt = $pdo->prepare('UPDATE sa_profiles SET assignment_status = "ASSIGNED", department_type = ?, supervisor_id = COALESCE(?, supervisor_id) WHERE id = ?');
                    }
                    $updSaStmt->execute([$dept, $supId, $saId]);
                }
            }
        }
    }

    // Keep sa_profiles.assignment_status in sync for active unassigned room SAs
    $pdo->prepare('
        UPDATE sa_profiles
           SET assignment_status = "UNASSIGNED"
         WHERE sa_status = "ACTIVE"
           AND archived_at IS NULL
           AND sa_category IN ("ITO", "ACADS", "RELIEVER")
           AND assignment_status = "ASSIGNED"
           AND id NOT IN (SELECT DISTINCT sa_profile_id FROM schedule_assignments WHERE semester_id = ?)
    ')->execute([$semesterId]);

    return $inserted;
}

function find_office_post(int $semesterId, string $roomOrName): ?array
{
    global $pdo;
    $clean = trim($roomOrName);
    if ($clean === '') return null;
    if (str_starts_with(strtoupper($clean), 'OFFICE|')) {
        $clean = trim(substr($clean, 7));
    }
    $stmt = $pdo->prepare(
        'SELECT r.*, o.name AS office_name, o.code AS office_code
           FROM office_requirements r
           JOIN offices o ON o.id = r.office_id
          WHERE r.semester_id = ? AND o.is_active = 1 AND r.required_sa > 0
            AND (o.name = ? OR o.code = ?)
          LIMIT 1'
    );
    $stmt->execute([$semesterId, $clean, $clean]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function build_office_grid_posts(int $semesterId): array
{
    global $pdo;
    ensure_assigned_office_schedules($semesterId);

    $isLocked = is_matching_batch_locked($semesterId);
    $minW = min_weekly_hours();
    $capW = hard_weekly_cap();
    $allPool = matching_pool($semesterId, false);
    $unassignedOfficePool = office_pool($semesterId);

    $reqStmt = $pdo->prepare(
        'SELECT r.id AS req_id, r.office_id, r.required_sa, r.operating_start, r.operating_end,
                r.weekly_target_hours, o.code AS office_code, o.name AS office_name
           FROM office_requirements r
           JOIN offices o ON o.id = r.office_id
          WHERE r.semester_id = ? AND o.is_active = 1 AND r.required_sa > 0
          ORDER BY o.name ASC'
    );
    $reqStmt->execute([$semesterId]);
    $officeReqs = $reqStmt->fetchAll();
    if (!$officeReqs) return [];

    // Batch-load all assigned OFFICE SAs grouped by office_id
    $allSaStmt = $pdo->query(
        'SELECT p.id, p.office_id, p.student_id, p.first_name, p.last_name, p.course, p.year_level, p.sa_category
           FROM sa_profiles p
          WHERE p.office_id IS NOT NULL AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL
            AND p.assignment_status = "ASSIGNED"
          ORDER BY p.last_name, p.first_name'
    );
    $sasByOffice = [];
    $allOfficeSaIds = [];
    foreach ($allSaStmt as $sr) {
        $oid = (int) $sr['office_id'];
        $sid = (int) $sr['id'];
        $sasByOffice[$oid][] = $sr;
        $allOfficeSaIds[$sid] = $sid;
    }

    // Batch-load OFFICE duty rows and class schedules for all assigned OFFICE SAs
    $dutyBySa = [];
    $classesBySa = [];
    if ($allOfficeSaIds) {
        $inIds = implode(',', $allOfficeSaIds);
        $dutyStmt = $pdo->prepare(
            "SELECT id, sa_profile_id, day_of_week, start_time, end_time, source
               FROM schedule_assignments
              WHERE semester_id = ? AND sa_profile_id IN ($inIds) AND requirement_type = 'OFFICE'
              ORDER BY FIELD(day_of_week,'MON','TUE','WED','THU','FRI','SAT','SUN'), start_time"
        );
        $dutyStmt->execute([$semesterId]);
        foreach ($dutyStmt as $dr) {
            $dutyBySa[(int) $dr['sa_profile_id']][] = $dr;
        }

        $classStmt = $pdo->prepare(
            "SELECT sa_profile_id, day_of_week, start_time, end_time, subject, section
               FROM class_schedules
              WHERE semester_id = ? AND sa_profile_id IN ($inIds) AND archived_at IS NULL
              ORDER BY FIELD(day_of_week,'MON','TUE','WED','THU','FRI','SAT','SUN'), start_time"
        );
        $classStmt->execute([$semesterId]);
        foreach ($classStmt as $cr) {
            $classesBySa[(int) $cr['sa_profile_id']][] = $cr;
        }
    }

    $postsOut = [];

    foreach ($officeReqs as $req) {
        $reqId = (int) $req['req_id'];
        $officeId = (int) $req['office_id'];
        $officeName = $req['office_name'];
        $officeCode = $req['office_code'];
        $requiredSa = max(1, (int) $req['required_sa']);
        $openFrom = max(mins(OFFICE_OPEN), mins($req['operating_start'] ?: OFFICE_OPEN));
        $openTo = min(mins(OFFICE_CLOSE), mins($req['operating_end'] ?: OFFICE_CLOSE));
        $target = max($minW, (float) ($req['weekly_target_hours'] ?: $minW));

        $openFormatted = [];
        foreach (WEEK_DAYS as $d) {
            $openFormatted[$d][] = [
                'start' => $openFrom,
                'end' => $openTo,
                'startTime' => hhmm($openFrom),
                'endTime' => hhmm($openTo),
                'startLabel' => format_time(hhmm($openFrom)),
                'endLabel' => format_time(hhmm($openTo)),
            ];
        }
        $openFormatted['SAT'][] = [
            'start' => 480,
            'end' => 720,
            'startTime' => '08:00:00',
            'endTime' => '12:00:00',
            'startLabel' => '8:00 AM',
            'endLabel' => '12:00 PM',
        ];

        $assignedSas = array_slice($sasByOffice[$officeId] ?? [], 0, $requiredSa);

        $staff = [];
        $acceptedPrimarySlots = 0;
        $dutySpansByDay = [];
        $conflictReasons = [];

        foreach ($assignedSas as $idx => $saRow) {
            $saId = (int) $saRow['id'];
            $slotId = 100000 + $saId;
            $saFull = $allPool[$saId] ?? null;

            $classBlocks = [];
            foreach ($classesBySa[$saId] ?? [] as $cr) {
                $cs = mins($cr['start_time']);
                $ce = mins($cr['end_time']);
                $classBlocks[] = [
                    'day' => $cr['day_of_week'],
                    'start' => $cs,
                    'end' => $ce,
                    'startTime' => substr((string) $cr['start_time'], 0, 5),
                    'endTime' => substr((string) $cr['end_time'], 0, 5),
                    'startLabel' => format_time($cr['start_time']),
                    'endLabel' => format_time($cr['end_time']),
                    'subject' => $cr['subject'],
                    'section' => $cr['section'],
                    'hours' => round(($ce - $cs) / 60.0, 1),
                ];
            }

            $dutyRows = $dutyBySa[$saId] ?? [];

            $dutyBlocks = [];
            $pattern = [];
            $isApproved = false;
            $hasExtendedHours = false;
            foreach ($dutyRows as $bIdx => $dr) {
                $d = $dr['day_of_week'];
                $s = mins($dr['start_time']);
                $e = mins($dr['end_time']);
                $pattern[] = [$d, $s, $e];
                if ($isLocked || in_array($dr['source'], ['MATCHING', 'MANUAL', 'CHANGE'], true)) {
                    $isApproved = true;
                }
                $isExt = ($s < 480 || $e > 1020);
                if ($isExt) {
                    $hasExtendedHours = true;
                }
                $dutyBlocks[] = duty_block($d, $s, $e, true) + [
                    'id' => (int) $dr['id'] ?: (($slotId * 100) + $bIdx + 1),
                    'slotId' => $slotId,
                    'startTime' => hhmm($s),
                    'endTime' => hhmm($e),
                    'isReliever' => false,
                    'isOffice' => true,
                    'isExtended' => $isExt,
                    'donorRoom' => null,
                    'hasOverlap' => false,
                    'overlapHours' => 0.0,
                    'overlapWindows' => [],
                ];
                $dutySpansByDay[$d][] = [$s, $e];
            }

            $dutyBlocks = credit_once_per_day($dutyBlocks, true);
            $rawHours = round(array_sum(array_column($dutyBlocks, 'hours')), 1);
            $credHours = round(array_sum(array_column($dutyBlocks, 'credited')), 1);

            if ($isApproved) {
                $acceptedPrimarySlots++;
            }

            $belowMin = $credHours < $minW;
            $overMax = $credHours > $capW;
            $needsReview = $belowMin || $overMax;
            if ($belowMin) {
                $conflictReasons[] = "{$saRow['first_name']} {$saRow['last_name']} has {$credHours} credited hrs/wk (below {$minW}h Coordinator minimum due to official Registrar classes).";
            } elseif ($overMax) {
                $conflictReasons[] = "{$saRow['first_name']} {$saRow['last_name']} has {$credHours} credited hrs/wk (above {$capW}h Coordinator maximum).";
            }

            $prefFit = $saFull ? pattern_preference_fit($saFull, $pattern) : 0.0;
            $score = $saFull ? candidate_score($saFull, $credHours, 'OFFICE', $officeId, $prefFit) : 90.0;

            $checks = [
                'Official Registrar class schedule verified (0 conflicts)',
                $hasExtendedHours
                    ? 'Standard 8:00 AM–5:00 PM + Extended 7:00 AM / 6:00 PM applied to fill required duty hours (auto 12:00–1:00 PM lunch, -1h)'
                    : 'Standard Office window verified: Mon–Fri 8:00 AM–5:00 PM (auto 12:00–1:00 PM lunch break, -1h)',
                'Saturday half-day rule verified: 8:00 AM–12:00 PM (adjustable from 7:00 AM, no lunch deduction)',
                "{$credHours} credited hrs/wk ({$rawHours} raw hrs)",
                $needsReview
                    ? ($belowMin
                        ? "Below {$minW}h minimum ({$credHours}h max conflict-free) — for Coordinator review"
                        : "Exceeds {$capW}h maximum ({$credHours}h) — for Coordinator review")
                    : "Within Coordinator weekly limit ({$minW}–{$capW} hrs/wk)",
            ];

            $staff[] = [
                'slotId' => $slotId,
                'slotNo' => $idx + 1,
                'isReliever' => false,
                'isOffice' => true,
                'hasExtendedHours' => $hasExtendedHours,
                'donorRoom' => null,
                'saId' => $saId,
                'studentId' => $saRow['student_id'],
                'name' => $saRow['first_name'] . ' ' . $saRow['last_name'],
                'course' => $saRow['course'],
                'yearLevel' => (int) $saRow['year_level'],
                'category' => $saRow['sa_category'],
                'decision' => $isApproved ? 'ACCEPTED' : 'PENDING',
                'approved' => $isApproved,
                'score' => $score,
                'rawHours' => $rawHours,
                'creditedHours' => $credHours,
                'belowMinimum' => $belowMin,
                'overMaximum' => $overMax,
                'needsCoordinatorReview' => $needsReview,
                'lunchRule' => 'Standard 8:00 AM–5:00 PM (adjustable 7:00 AM–6:00 PM to fill required hours; auto 12:00–1:00 PM lunch, -1h); Sat half-day (0h deduction)',
                'checks' => $checks,
                'classes' => $classBlocks,
                'duty' => $dutyBlocks,
            ];
        }

        // Build alternates from unassigned OFFICE SAs
        $alternates = [];
        foreach ($unassignedOfficePool as $candId => $candSa) {
            $candCopy = $candSa;
            $candCopy['duty'] = [];
            $candPat = office_pattern($candCopy, $openFrom, $openTo, $target);
            if ($candPat['hours'] < MIN_OFFICE_BLOCK) continue;
            $pFit = pattern_preference_fit($candCopy, $candPat['pattern']);
            $alternates[] = [
                'slotId' => 100000 + $candId,
                'saId' => $candId,
                'studentId' => $candSa['studentId'],
                'name' => $candSa['name'],
                'course' => $candSa['course'],
                'yearLevel' => $candSa['yearLevel'],
                'category' => $candSa['category'],
                'creditedHours' => $candPat['credited'],
                'rawHours' => $candPat['hours'],
                'score' => candidate_score($candCopy, $candPat['credited'], 'OFFICE', $officeId, $pFit),
            ];
        }
        usort($alternates, fn($a, $b) => [$b['score'], $b['creditedHours']] <=> [$a['score'], $a['creditedHours']]);

        $assignedCount = count($staff);
        $missingSaCount = max(0, $requiredSa - $assignedCount);
        if ($missingSaCount > 0) {
            $conflictReasons[] = "Missing {$missingSaCount} Office S.A. slot(s) for {$officeName}.";
        }
        $allAccepted = $assignedCount > 0 && $acceptedPrimarySlots === $assignedCount && $missingSaCount === 0;

        $postsOut[] = [
            'key' => 'OFFICE|' . $officeName,
            'room' => $officeName,
            'roomId' => $officeId,
            'officeReqId' => $reqId,
            'officeCode' => $officeCode,
            'building' => 'Office (' . $officeCode . ') · 8:00 AM–5:00 PM',
            'roomType' => 'OFFICE',
            'department' => 'OFFICE',
            'requiredSa' => $requiredSa,
            'assignedCount' => $assignedCount,
            'relieverCount' => 0,
            'missingSaCount' => $missingSaCount,
            'accepted' => $allAccepted,
            'acceptedSlots' => $acceptedPrimarySlots,
            'totalSlots' => $requiredSa,
            'status' => $missingSaCount > 0 ? 'GAP' : 'COVERED',
            'conflictReasons' => array_values(array_unique($conflictReasons)),
            'lunchWindow' => [
                'start' => 720,
                'end' => 780,
                'startLabel' => '12:00 PM',
                'endLabel' => '1:00 PM',
                'label' => 'Automatic Lunch Break (12:00 PM – 1:00 PM · -1h deduction)',
            ],
            'satWindow' => [
                'start' => 480,
                'end' => 720,
                'startLabel' => '8:00 AM',
                'endLabel' => '12:00 PM',
                'label' => 'Saturday Half-Day (8:00 AM – 12:00 PM · No lunch deduction)',
            ],
            'open' => $openFormatted,
            'staff' => $staff,
            'overlaps' => [],
            'overlapHours' => 0.0,
            'gaps' => [],
            'alternates' => $alternates,
            'slotIds' => array_column($staff, 'slotId'),
        ];
    }

    return $postsOut;
}

/**
 * Builds dedicated Weekly Duty Grid posts for Floating ITO Relievers (e.g. Ramos, Santos)
 * who do not own a permanent laboratory and cover multiple computer laboratories.
 */
function build_reliever_grid_posts(int $semesterId, ?array $run, array $pool, array $roomClassesBySa): array
{
    global $pdo;
    if (!$run || empty($run['slots'])) return [];

    // Identify dedicated floating relievers (e.g. Ramos #87, Santos #88, or any SA with RELIEVER category/flag)
    $relieverSaIds = [];
    foreach ($pool as $sa) {
        if ($sa['category'] === 'RELIEVER' || !empty($sa['isReliever'])) {
            $relieverSaIds[(int) $sa['id']] = true;
        }
    }

    $relieverDutiesBySa = [];
    $relieverSlotIdsBySa = [];
    $coveredRoomsBySa = [];
    $relieverAcceptedBySa = [];

    // Identify SAs who are already assigned as Primary Room SAs — they own their room post and must not have duplicate reliever cards!
    $primaryAssignedSaIds = [];
    foreach ($run['slots'] as $s) {
        $rec = $s['recommended'] ?? null;
        if (!$rec) continue;
        $isRelSlot = !empty($s['isReliever']) || ((int) ($s['slotNo'] ?? 1) >= 10);
        if (!$isRelSlot) {
            $primaryAssignedSaIds[(int) $rec['saId']] = $s['room'] ?: $s['label'];
        }
    }

    foreach ($run['slots'] as $s) {
        $rec = $s['recommended'] ?? null;
        if (!$rec) continue;
        $saId = (int) $rec['saId'];
        if (isset($primaryAssignedSaIds[$saId])) continue;

        $roomName = $s['room'] ?: $s['label'];
        $isRelieverSlot = !empty($s['isReliever']) || ((int) ($s['slotNo'] ?? 1) >= 10);
        $isAccepted = in_array($s['decision'] ?? '', ['ACCEPTED', 'OVERRIDDEN'], true);

        if ($isRelieverSlot) {
            $relieverSlotIdsBySa[$saId][] = (int) $s['id'];
            $coveredRoomsBySa[$saId][] = $roomName;
            $relieverAcceptedBySa[$saId][] = $isAccepted;

            foreach ($rec['pattern'] as $idx => $sp) {
                if (!is_array($sp) || count($sp) < 3) continue;
                [$d, $sMin, $eMin] = [$sp[0], (int) $sp[1], (int) $sp[2]];
                $relieverDutiesBySa[$saId][] = duty_block($d, $sMin, $eMin, false) + [
                    'id' => ($s['id'] * 100) + $idx + 1,
                    'slotId' => $s['id'],
                    'room' => $roomName,
                    'roomLabel' => "Coverage for Room {$roomName}",
                    'startTime' => sprintf('%02d:%02d', intdiv($sMin, 60), $sMin % 60),
                    'endTime' => sprintf('%02d:%02d', intdiv($eMin, 60), $eMin % 60),
                    'isReliever' => true,
                    'donorRoom' => $s['donorRoom'] ?? null,
                ];
            }
        }
    }

    // 7:00 AM to 10:00 PM Mon-Sat open window for ITO lab relievers
    $openFormatted = [];
    foreach (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as $day) {
        $openFormatted[$day] = [[
            'start' => 420,
            'end' => 1320,
            'startTime' => '07:00',
            'endTime' => '22:00',
            'startLabel' => '7:00 AM',
            'endLabel' => '10:00 PM',
            'hours' => 15.0,
        ]];
    }

    $postsOut = [];
    foreach ($pool as $sa) {
        $saId = (int) $sa['id'];
        if (isset($primaryAssignedSaIds[$saId])) continue;
        $isRel = isset($relieverSaIds[$saId]) || (!empty($relieverDutiesBySa[$saId]) && empty($sa['office_id']));
        if (!$isRel) continue;

        $duties = $relieverDutiesBySa[$saId] ?? [];

        // If not in match_slots, fallback to schedule_assignments
        if (empty($duties)) {
            $asgStmt = $pdo->prepare(
                'SELECT * FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? ORDER BY FIELD(day_of_week,"MON","TUE","WED","THU","FRI","SAT"), start_time'
            );
            $asgStmt->execute([$semesterId, $saId]);
            $asgRows = $asgStmt->fetchAll();
            foreach ($asgRows as $idx => $ar) {
                $d = $ar['day_of_week'];
                $sMin = mins($ar['start_time']);
                $eMin = mins($ar['end_time']);
                $roomName = $ar['location'];
                $coveredRoomsBySa[$saId][] = $roomName;
                $relieverAcceptedBySa[$saId][] = true;
                $duties[] = duty_block($d, $sMin, $eMin, false) + [
                    'id' => ($ar['id'] * 100) + $idx + 1,
                    'slotId' => (int) $ar['id'],
                    'room' => $roomName,
                    'roomLabel' => "Coverage for Room {$roomName}",
                    'startTime' => sprintf('%02d:%02d', intdiv($sMin, 60), $sMin % 60),
                    'endTime' => sprintf('%02d:%02d', intdiv($eMin, 60), $eMin % 60),
                    'isReliever' => true,
                    'donorRoom' => null,
                ];
            }
        }

        $rawHours = round(array_sum(array_column($duties, 'hours')), 1);
        $credHours = round(array_sum(array_column($duties, 'credited')), 1);
        $coveredRooms = array_values(array_unique($coveredRoomsBySa[$saId] ?? []));
        $allAccepted = !empty($duties) && !in_array(false, $relieverAcceptedBySa[$saId] ?? [false], true);

        $staffItem = [
            'slotId' => 90000 + $saId,
            'slotNo' => 1,
            'isReliever' => false,
            'isRelieverStaff' => true,
            'saId' => $saId,
            'studentId' => $sa['studentId'],
            'name' => $sa['name'],
            'course' => $sa['course'],
            'yearLevel' => $sa['yearLevel'],
            'category' => 'RELIEVER',
            'department_type' => 'ITO',
            'decision' => $allAccepted ? 'ACCEPTED' : 'PENDING',
            'approved' => $allAccepted,
            'score' => 95.0,
            'rawHours' => $rawHours,
            'creditedHours' => $credHours,
            'belowMinimum' => false,
            'overMaximum' => false,
            'needsCoordinatorReview' => false,
            'checks' => [
                'Official Registrar class schedule verified (0 clashes)',
                'Dedicated Floating ITO Reliever (Multi-Room Lab Coverage)',
                "{$credHours}h total credited weekly duty (" . count($duties) . " duty window" . (count($duties) === 1 ? '' : 's') . ")",
            ],
            'classes' => $roomClassesBySa[$saId] ?? [],
            'duty' => $duties,
            'coveredRooms' => $coveredRooms,
        ];

        $postsOut[] = [
            'key' => 'ITO|RELIEVER-' . $saId,
            'room' => 'RELIEVER — ' . $sa['name'],
            'shortRoom' => 'RELIEVER: ' . explode(' ', $sa['name'])[0],
            'roomId' => null,
            'building' => 'Floating Lab Coverage (' . (empty($coveredRooms) ? 'Pool' : implode(', ', $coveredRooms)) . ')',
            'roomType' => 'RELIEVER',
            'department' => 'ITO',
            'roleBadge' => 'RELIEVER',
            'isRelieverPost' => true,
            'requiredSa' => 1,
            'assignedCount' => 1,
            'relieverCount' => 0,
            'missingSaCount' => 0,
            'accepted' => $allAccepted,
            'acceptedSlots' => $allAccepted ? 1 : 0,
            'totalSlots' => 1,
            'status' => 'COVERED',
            'conflictReasons' => [],
            'open' => $openFormatted,
            'staff' => [$staffItem],
            'overlaps' => [],
            'overlapHours' => 0.0,
            'gaps' => [],
            'alternates' => [],
            'slotIds' => $relieverSlotIdsBySa[$saId] ?? [90000 + $saId],
            'coveredRooms' => $coveredRooms,
        ];
    }

    return $postsOut;
}

function room_grid(int $semesterId): ?array
{
    global $pdo;
    $run = matching_result($semesterId);
    if (!$run) return null;
    $officePosts = build_office_grid_posts($semesterId);

    $postsOut = [];
    if ($run) {
        $pool = matching_pool($semesterId, true);
        $postsByRoom = [];
        foreach (build_room_posts($semesterId) as $p) {
            $postsByRoom[$p['department'] . '|' . $p['room']] = $p;
        }

        // Batch-load class_schedules for all pool SAs in one query
        $roomClassesBySa = [];
        if ($pool) {
            $poolIds = implode(',', array_map('intval', array_keys($pool)));
            $cStmt = $pdo->prepare(
                "SELECT sa_profile_id, day_of_week, start_time, end_time, subject, section
                   FROM class_schedules
                  WHERE semester_id = ? AND sa_profile_id IN ($poolIds) AND archived_at IS NULL
                  ORDER BY FIELD(day_of_week,'MON','TUE','WED','THU','FRI','SAT','SUN'), start_time"
            );
            $cStmt->execute([$semesterId]);
            foreach ($cStmt as $cr) {
                $cs = mins($cr['start_time']);
                $ce = mins($cr['end_time']);
                $roomClassesBySa[(int) $cr['sa_profile_id']][] = [
                    'day' => $cr['day_of_week'],
                    'start' => $cs,
                    'end' => $ce,
                    'startTime' => substr((string) $cr['start_time'], 0, 5),
                    'endTime' => substr((string) $cr['end_time'], 0, 5),
                    'startLabel' => format_time($cr['start_time']),
                    'endLabel' => format_time($cr['end_time']),
                    'subject' => $cr['subject'],
                    'section' => $cr['section'],
                    'hours' => round(($ce - $cs) / 60.0, 1),
                ];
            }
        }

        $groupedSlots = [];
        $claimedPrimaryInRun = [];
        foreach ($run['slots'] as $slot) {
            $key = $slot['department'] . '|' . $slot['room'];
            $groupedSlots[$key][] = $slot;
            $slotSaId = (int) ($slot['assigned_sa_profile_id'] ?? 0);
            if (!$slotSaId && !empty($slot['recommended']['saId'])) {
                $slotSaId = (int) $slot['recommended']['saId'];
            }
            if ($slotSaId > 0) {
                $claimedPrimaryInRun[$slotSaId] = true;
            }
        }

        // Also include all S.A.s with active assignments in schedule_assignments
        $asgClaimStmt = $pdo->prepare(
            'SELECT DISTINCT sa_profile_id FROM schedule_assignments WHERE semester_id = ? AND source IN ("MATCHING", "MANUAL", "CHANGE")'
        );
        $asgClaimStmt->execute([$semesterId]);
        foreach ($asgClaimStmt->fetchAll(PDO::FETCH_COLUMN) as $asgSaId) {
            $claimedPrimaryInRun[(int) $asgSaId] = true;
        }

        foreach ($postsByRoom as $key => $meta) {
            $roomSlots = $groupedSlots[$key] ?? [];
            $openFormatted = [];
            foreach ($meta['open'] as $day => $spans) {
                foreach ($spans as [$s, $e]) {
                    $openFormatted[$day][] = [
                        'start' => $s,
                        'end' => $e,
                        'startTime' => hhmm($s),
                        'endTime' => hhmm($e),
                        'startLabel' => format_time(hhmm($s)),
                        'endLabel' => format_time(hhmm($e)),
                    ];
                }
            }

            $staff = [];
            $primaryPartnersForRoom = [];
            $alternates = [];
            $seenAlt = [];
            $acceptedPrimarySlots = 0;
            $primarySlotsTotal = 0;
            $dutySpansByDay = [];
            $conflictReasons = [];

            foreach ($roomSlots as $slot) {
                $isRelieverSlot = !empty($slot['isReliever']);
                if (!$isRelieverSlot) {
                    $primarySlotsTotal++;
                    if (in_array($slot['decision'], ['ACCEPTED', 'OVERRIDDEN'], true) && $slot['recommended']) {
                        $acceptedPrimarySlots++;
                    }
                }
                if (!empty($slot['conflictReason'])) $conflictReasons[] = $slot['conflictReason'];

                $rec = $slot['recommended'];
                if ($rec && $slot['status'] !== 'COVERAGE_GAP') {
                    $saId = (int) $rec['saId'];
                    $saFull = $pool[$saId] ?? null;

                    if (!$isRelieverSlot) {
                        $primaryPartnersForRoom[] = [
                            'name' => $rec['name'],
                            'pattern' => $rec['pattern'],
                        ];
                    }

                    $classBlocks = ($saFull && !$isRelieverSlot) ? ($roomClassesBySa[$saId] ?? []) : [];

                    $dutyBlocks = [];
                    foreach ($rec['pattern'] as $idx => $sp) {
                        if (!is_array($sp) || count($sp) < 3) continue;
                        [$d, $s, $e] = [$sp[0], (int) $sp[1], (int) $sp[2]];
                        $dutyBlocks[] = duty_block($d, $s, $e, false) + [
                            'id' => ($slot['id'] * 100) + $idx + 1,
                            'slotId' => $slot['id'],
                            'startTime' => sprintf('%02d:%02d', intdiv($s, 60), $s % 60),
                            'endTime' => sprintf('%02d:%02d', intdiv($e, 60), $e % 60),
                            'isReliever' => $isRelieverSlot,
                            'donorRoom' => $slot['donorRoom'] ?? null,
                        ];
                        $dutySpansByDay[$d][] = [$s, $e];
                    }
                    $dutyBlocks = credit_once_per_day($dutyBlocks, false);
                    $rawHours = round(array_sum(array_column($dutyBlocks, 'hours')), 1);
                    $credHours = round(array_sum(array_column($dutyBlocks, 'credited')), 1);

                    $staff[] = [
                        'slotId' => $slot['id'],
                        'slotNo' => $slot['slotNo'],
                        'isReliever' => $isRelieverSlot,
                        'donorRoom' => $slot['donorRoom'] ?? null,
                        'saId' => $saId,
                        'studentId' => $rec['studentId'],
                        'name' => $rec['name'],
                        'course' => $rec['course'],
                        'yearLevel' => $rec['yearLevel'],
                        'category' => $rec['category'],
                        'decision' => $slot['decision'],
                        'approved' => in_array($slot['decision'], ['ACCEPTED', 'OVERRIDDEN'], true),
                        'score' => $rec['score'],
                        'rawHours' => $rawHours,
                        'creditedHours' => $credHours,
                        'belowMinimum' => !$isRelieverSlot && ($credHours < min_weekly_hours()),
                        'overMaximum' => !$isRelieverSlot && ($credHours > hard_weekly_cap()),
                        'needsCoordinatorReview' => !$isRelieverSlot && ($credHours < min_weekly_hours() || $credHours > hard_weekly_cap()),
                        'checks' => $rec['checks'],
                        'classes' => $classBlocks,
                        'duty' => $dutyBlocks,
                    ];
                }

                foreach ($slot['alternates'] as $alt) {
                    $altSaId = (int) $alt['saId'];
                    if (isset($seenAlt[$altSaId])) continue;
                    if (isset($claimedPrimaryInRun[$altSaId])) continue;
                    $seenAlt[$altSaId] = true;
                    $alternates[] = [
                        'slotId' => $slot['id'],
                        'saId' => $altSaId,
                        'studentId' => $alt['studentId'],
                        'name' => $alt['name'],
                        'course' => $alt['course'],
                        'yearLevel' => $alt['yearLevel'],
                        'category' => $alt['category'],
                        'creditedHours' => $alt['creditedHours'],
                        'rawHours' => $alt['rawHours'],
                        'score' => $alt['score'],
                    ];
                }
            }

            // Append any unassigned pool SAs of matching department
            foreach ($pool as $pSaId => $pSa) {
                if (isset($seenAlt[$pSaId]) || isset($claimedPrimaryInRun[$pSaId])) continue;
                if ($pSa['category'] !== $meta['department'] && $meta['department'] !== 'OFFICE') continue;
                $seenAlt[$pSaId] = true;
                $alternates[] = [
                    'slotId' => $roomSlots[0]['id'] ?? 0,
                    'saId' => $pSaId,
                    'studentId' => $pSa['student_id'] ?? '',
                    'name' => $pSa['name'] ?? '',
                    'course' => $pSa['course'] ?? '',
                    'yearLevel' => (int) ($pSa['yearLevel'] ?? 1),
                    'category' => $pSa['category'] ?? '',
                    'creditedHours' => 0.0,
                    'rawHours' => 0.0,
                    'score' => 70.0,
                ];
            }

            // Compute overlapping partner duty hours for this room and annotate each primary staff duty block
            $partnerOverlaps = compute_room_partner_overlaps($primaryPartnersForRoom);
            foreach ($staff as &$stItem) {
                if (!empty($stItem['isReliever'])) continue;
                foreach ($stItem['duty'] as &$db) {
                    $d = $db['day'];
                    $dayOvSpans = $partnerOverlaps['byDay'][$d] ?? [];
                    $inter = $dayOvSpans ? intersect_spans([[$db['start'], $db['end']]], $dayOvSpans) : [];
                    $ovMins = span_minutes($inter);
                    $db['hasOverlap'] = $ovMins >= 30;
                    $db['overlapHours'] = round($ovMins / 60.0, 1);
                    $db['overlapWindows'] = array_map(fn($sp) => [
                        'start' => $sp[0],
                        'end' => $sp[1],
                        'startTime' => hhmm($sp[0]),
                        'endTime' => hhmm($sp[1]),
                        'startLabel' => format_time(hhmm($sp[0])),
                        'endLabel' => format_time(hhmm($sp[1])),
                        'hours' => round(($sp[1] - $sp[0]) / 60.0, 1),
                    ], $inter);
                }
                unset($db);
            }
            unset($stItem);

            $gaps = [];
            foreach ($meta['open'] as $day => $openSpans) {
                $covered = merge_spans($dutySpansByDay[$day] ?? []);
                $uncovered = subtract_spans($openSpans, $covered);
                foreach ($uncovered as [$gs, $ge]) {
                    if ($ge - $gs >= 30) {
                        $gaps[] = [
                            'day' => $day,
                            'start' => $gs,
                            'end' => $ge,
                            'startLabel' => format_time(hhmm($gs)),
                            'endLabel' => format_time(hhmm($ge)),
                            'hours' => round(($ge - $gs) / 60.0, 1),
                        ];
                    }
                }
            }

            $primaryStaffCount = count(array_filter($staff, fn($st) => empty($st['isReliever'])));
            $relieverStaffCount = count(array_filter($staff, fn($st) => !empty($st['isReliever'])));
            $missingSaCount = max(0, (int) $meta['requiredSa'] - $primaryStaffCount);
            $allAccepted = $primarySlotsTotal > 0 && $acceptedPrimarySlots === $primarySlotsTotal && $missingSaCount === 0;
            $status = 'COVERED';
            if ($missingSaCount > 0) {
                $status = 'GAP';
            } elseif (!empty($gaps)) {
                $status = ($meta['department'] === 'ITO') ? 'NEEDS_RELIEVER' : 'COVERED';
            }

            $postsOut[] = [
                'key' => $key,
                'room' => $meta['room'],
                'roomId' => $meta['roomId'],
                'building' => $meta['building'],
                'roomType' => $meta['roomType'],
                'department' => $meta['department'],
                'requiredSa' => (int) $meta['requiredSa'],
                'assignedCount' => $primaryStaffCount,
                'relieverCount' => $relieverStaffCount,
                'missingSaCount' => $missingSaCount,
                'accepted' => $allAccepted,
                'acceptedSlots' => $acceptedPrimarySlots,
                'totalSlots' => $primarySlotsTotal,
                'status' => $status,
                'conflictReasons' => array_values(array_unique($conflictReasons)),
                'open' => $openFormatted,
                'staff' => $staff,
                'overlaps' => $partnerOverlaps['windows'],
                'overlapHours' => $partnerOverlaps['totalHours'],
                'gaps' => $gaps,
                'alternates' => $alternates,
                'slotIds' => array_column($roomSlots, 'id'),
            ];
        }
    }

    // Append OFFICE recommendations so the Coordinator can review, edit, and approve OFFICE SAs on Recommendations too
    foreach ($officePosts as $op) {
        $postsOut[] = $op;
    }

    // Append Dedicated Floating ITO Reliever posts so they have their own Weekly Duty Grid
    $relieverPosts = build_reliever_grid_posts($semesterId, $run, $pool, $roomClassesBySa);
    foreach ($relieverPosts as $rp) {
        $postsOut[] = $rp;
    }

    ensure_matching_board_tables();
    $lockInfo = get_matching_batch_lock_info($semesterId);
    $isLocked = !empty($lockInfo['isLocked']);

    // Load temporary relief coverages for this semester
    $reliefByRoom = [];
    try {
        $relStmt = $pdo->prepare(
            'SELECT rrc.*,
                    p1.student_id AS primary_student_id, p1.first_name AS primary_first, p1.last_name AS primary_last,
                    p2.student_id AS reliever_student_id, p2.first_name AS reliever_first, p2.last_name AS reliever_last,
                    p2.course AS reliever_course, p2.year_level AS reliever_year, p2.sa_category AS reliever_category,
                    u.full_name AS confirmed_by_name
               FROM room_relief_coverages rrc
               LEFT JOIN sa_profiles p1 ON p1.id = rrc.primary_sa_id
               JOIN sa_profiles p2 ON p2.id = rrc.reliever_sa_id
               LEFT JOIN users u ON u.id = rrc.confirmed_by
              WHERE rrc.semester_id = ?
              ORDER BY rrc.coverage_date DESC, rrc.start_time ASC, rrc.id DESC'
        );
        $relStmt->execute([$semesterId]);
        foreach ($relStmt->fetchAll() as $rr) {
            $sMin = mins($rr['start_time']);
            $eMin = mins($rr['end_time']);
            $reliefByRoom[$rr['room']][] = [
                'id' => (int) $rr['id'],
                'room' => $rr['room'],
                'department' => $rr['department'],
                'primarySaId' => $rr['primary_sa_id'] ? (int) $rr['primary_sa_id'] : null,
                'primaryName' => $rr['primary_first'] ? ($rr['primary_first'] . ' ' . $rr['primary_last']) : 'Primary S.A.',
                'primaryStudentId' => $rr['primary_student_id'] ?? null,
                'relieverSaId' => (int) $rr['reliever_sa_id'],
                'relieverName' => $rr['reliever_first'] . ' ' . $rr['reliever_last'],
                'relieverStudentId' => $rr['reliever_student_id'],
                'relieverCourse' => $rr['reliever_course'],
                'relieverYearLevel' => (int) $rr['reliever_year'],
                'relieverCategory' => $rr['reliever_category'],
                'coverageDate' => $rr['coverage_date'],
                'dayOfWeek' => $rr['day_of_week'],
                'startTime' => substr((string) $rr['start_time'], 0, 5),
                'endTime' => substr((string) $rr['end_time'], 0, 5),
                'startLabel' => format_time($rr['start_time']),
                'endLabel' => format_time($rr['end_time']),
                'hours' => round(max(0, $eMin - $sMin) / 60.0, 1),
                'reason' => $rr['reason'],
                'status' => $rr['status'],
                'outcome' => $rr['outcome'],
                'confirmedBy' => $rr['confirmed_by_name'] ?: 'Coordinator',
                'createdAt' => $rr['created_at'],
                'completedAt' => $rr['completed_at'],
                'roleBadge' => 'RELIEVER',
                'roleType' => 'TEMPORARY_RELIEF',
            ];
        }
    } catch (Throwable $_) {}

    // Load room assignment history for this semester
    $historyByRoom = [];
    try {
        $histStmt = $pdo->prepare(
            'SELECT h.*,
                    p1.student_id AS prev_student_id, p1.first_name AS prev_first, p1.last_name AS prev_last,
                    p2.student_id AS new_student_id, p2.first_name AS new_first, p2.last_name AS new_last,
                    u.full_name AS acted_by_name
               FROM room_assignment_history h
               LEFT JOIN sa_profiles p1 ON p1.id = h.previous_sa_id
               LEFT JOIN sa_profiles p2 ON p2.id = h.new_sa_id
               LEFT JOIN users u ON u.id = h.actor_user_id
              WHERE h.semester_id = ?
              ORDER BY h.id DESC
              LIMIT 250'
        );
        $histStmt->execute([$semesterId]);
        foreach ($histStmt->fetchAll() as $hr) {
            $entry = [
                'id' => (int) $hr['id'],
                'room' => $hr['room'],
                'department' => $hr['department'],
                'actionType' => $hr['action_type'],
                'roleType' => $hr['role_type'],
                'previousSaName' => $hr['prev_first'] ? ($hr['prev_first'] . ' ' . $hr['prev_last'] . ' (' . $hr['prev_student_id'] . ')') : null,
                'newSaName' => $hr['new_first'] ? ($hr['new_first'] . ' ' . $hr['new_last'] . ' (' . $hr['new_student_id'] . ')') : null,
                'summary' => $hr['summary'],
                'reason' => $hr['reason'],
                'actedBy' => $hr['acted_by_name'] ?: 'Coordinator',
                'createdAt' => $hr['created_at'],
            ];
            $historyByRoom[$hr['room']][] = $entry;
        }
    } catch (Throwable $_) {}

    $dayShortLabels = ['MON' => 'Mon', 'TUE' => 'Tue', 'WED' => 'Wed', 'THU' => 'Thu', 'FRI' => 'Fri', 'SAT' => 'Sat', 'SUN' => 'Sun'];
    $minW = min_weekly_hours();
    $capW = hard_weekly_cap();

    $awaitingApprovalCount = 0;
    $approvedAssignmentsCount = 0;
    $uncoveredRoomsCount = 0;
    $relieverNeededCount = 0;
    $primaryAssignedTotal = 0;
    $relieverAssignedTotal = 0;

    foreach ($postsOut as &$post) {
        $roomName = $post['room'];
        $dept = $post['department'];
        $primarySas = [];
        $relieverSas = [];
        $allPassedChecks = [];
        $allWarnings = [];
        $scores = [];

        foreach ($post['staff'] as &$st) {
            $isRel = !empty($st['isReliever']);
            $suit = compute_candidate_suitability(
                $st,
                $dept,
                (float) ($st['creditedHours'] ?? 0),
                (float) ($st['rawHours'] ?? 0),
                $isRel,
                $st['checks'] ?? [],
                $st['donorRoom'] ?? null
            );
            $suit['passedChecks'] = $suit['reasons'] ?? [];
            $st['roleBadge'] = $isRel ? 'RELIEVER' : 'PRIMARY';
            $st['roleLabel'] = $isRel
                ? 'RELIEVER — Backup / Reliever Coverage Only'
                : 'PRIMARY — Official Room Assignment';
            $st['suitability'] = $suit;

            if ($isRel) {
                $relieverSas[] = $st;
            } else {
                $primarySas[] = $st;
                $scores[] = (float) ($st['score'] ?? 90.0);
                foreach ($suit['reasons'] ?? [] as $pc) $allPassedChecks[] = $pc;
                foreach ($suit['failedRequirements'] ?? [] as $wn) $allWarnings[] = $st['name'] . ': ' . $wn;
            }
        }
        unset($st);

        foreach ($post['conflictReasons'] ?? [] as $cr) {
            $allWarnings[] = $cr;
        }
        if (($post['missingSaCount'] ?? 0) > 0) {
            $allWarnings[] = "Missing {$post['missingSaCount']} Primary S.A. assignment(s) (requires {$post['requiredSa']}).";
        }
        if ($dept === 'ITO' && !empty($post['gaps']) && count($relieverSas) === 0) {
            $gapHours = round(array_sum(array_column($post['gaps'], 'hours')), 1);
            $allWarnings[] = "Reliever Needed: {$gapHours} hrs/wk of uncovered ITO laboratory window(s) during Primary S.A. classes.";
        }

        $roomReliefAll = $reliefByRoom[$roomName] ?? [];
        $activeReliefs = array_values(array_filter($roomReliefAll, fn($r) => $r['status'] === 'ACTIVE'));

        // Build schedule summary (assigned days & periods)
        $openDays = [];
        $earliestMin = 1440;
        $latestMin = 0;
        $periodSummaries = [];
        foreach (DAY_ORDER as $d) {
            if (!empty($post['open'][$d])) {
                $openDays[] = $d;
                $dayLabels = [];
                foreach ($post['open'][$d] as $sp) {
                    if ($sp['start'] < $earliestMin) $earliestMin = $sp['start'];
                    if ($sp['end'] > $latestMin) $latestMin = $sp['end'];
                    $dayLabels[] = $sp['startLabel'] . '–' . $sp['endLabel'];
                }
                $periodSummaries[] = ($dayShortLabels[$d] ?? $d) . ': ' . implode(', ', $dayLabels);
            }
        }
        $daysReadable = array_map(fn($d) => $dayShortLabels[$d] ?? $d, $openDays);
        $daysLabel = count($daysReadable) === 6 && $openDays[0] === 'MON' && $openDays[5] === 'SAT'
            ? 'Mon – Sat'
            : (count($daysReadable) === 5 && $openDays[0] === 'MON' && $openDays[4] === 'FRI'
                ? 'Mon – Fri'
                : implode(', ', $daysReadable));
        $hoursLabel = ($earliestMin < $latestMin)
            ? (format_time(hhmm($earliestMin)) . ' – ' . format_time(hhmm($latestMin)))
            : '8:00 AM – 5:00 PM';

        // Coverage status
        $hasMissingPrimary = ($post['missingSaCount'] ?? 0) > 0 || empty($primarySas);
        $needsItoReliever = ($dept === 'ITO' && !empty($post['gaps']) && empty($relieverSas) && empty($activeReliefs));
        if ($hasMissingPrimary) {
            $coverageStatus = 'UNCOVERED';
            $coverageLabel = 'Uncovered';
            $uncoveredRoomsCount++;
        } elseif ($needsItoReliever || ($post['status'] ?? '') === 'NEEDS_RELIEVER') {
            $coverageStatus = 'RELIEVER_NEEDED';
            $coverageLabel = 'Reliever Needed';
            $uncoveredRoomsCount++;
            $relieverNeededCount++;
        } elseif (!empty($relieverSas) || !empty($activeReliefs)) {
            $coverageStatus = 'RELIEVER_COVERED';
            $coverageLabel = 'Covered (Primary + Reliever)';
        } else {
            $coverageStatus = 'FULLY_COVERED';
            $coverageLabel = 'Fully Covered';
        }

        // Approval status
        if ($isLocked && !empty($post['accepted'])) {
            $approvalStatus = 'APPROVED_LOCKED';
            $approvalLabel = 'Approved & Locked';
            $approvedAssignmentsCount++;
        } elseif (!empty($post['accepted'])) {
            $approvalStatus = 'APPROVED';
            $approvalLabel = 'Approved';
            $approvedAssignmentsCount++;
        } else {
            $approvalStatus = 'AWAITING_APPROVAL';
            $approvalLabel = 'Awaiting Approval';
            $awaitingApprovalCount++;
        }

        // Suitability summary
        $avgScore = $scores ? round(array_sum($scores) / count($scores), 1) : 0.0;
        $uniqueWarnings = array_values(array_unique($allWarnings));
        if ($hasMissingPrimary) {
            $suitabilityStatus = 'UNCOVERED';
            $suitabilityLabel = 'Uncovered Slot';
        } elseif (!empty($uniqueWarnings)) {
            $suitabilityStatus = 'PARTIAL';
            $suitabilityLabel = 'Review Warnings (' . count($uniqueWarnings) . ')';
        } else {
            $suitabilityStatus = 'SUITABLE';
            $suitabilityLabel = 'Suitable Match (100% Verified)';
        }

        $primaryAssignedTotal += count($primarySas);
        $relieverAssignedTotal += count($relieverSas) + count($activeReliefs);

        $roomHistory = array_merge(
            $historyByRoom[$roomName] ?? [],
            $historyByRoom['ALL_ROOMS'] ?? []
        );
        usort($roomHistory, fn($a, $b) => ($b['id'] ?? 0) <=> ($a['id'] ?? 0));

        $post['primarySas'] = $primarySas;
        $post['relieverSas'] = $relieverSas;
        $post['tempReliefCoverages'] = $roomReliefAll;
        $post['activeReliefCoverages'] = $activeReliefs;
        $post['scheduleSummary'] = [
            'days' => $openDays,
            'daysLabel' => $daysLabel ?: 'Mon – Sat',
            'operatingHoursLabel' => $hoursLabel,
            'periods' => $periodSummaries,
        ];
        $post['matchingCriteria'] = [
            'department' => $dept,
            'roomType' => $post['roomType'] ?? 'LAB',
            'requiredPrimarySa' => (int) $post['requiredSa'],
            'eligibleCategories' => $dept === 'OFFICE' ? ['OFFICE'] : [$dept],
            'minWeeklyHours' => $minW,
            'maxWeeklyHours' => $capW,
            'conflictRule' => 'Zero overlap with official Registrar class schedule & existing room/office duties',
            'relieverPolicy' => $dept === 'ITO'
                ? 'ITO Laboratory requires a qualified Reliever S.A. for simultaneous Primary class windows or uncovered lab hours; Reliever is backup coverage only.'
                : 'Primary S.A. owns the official assignment; Reliever coverage is recorded separately by date & period.',
        ];
        $post['suitability'] = [
            'status' => $suitabilityStatus,
            'label' => $suitabilityLabel,
            'score' => $avgScore,
            'passedChecks' => array_values(array_unique($allPassedChecks)),
            'warnings' => $uniqueWarnings,
        ];
        $post['approvalStatus'] = $approvalStatus;
        $post['approvalLabel'] = $approvalLabel;
        $post['coverageStatus'] = $coverageStatus;
        $post['coverageLabel'] = $coverageLabel;
        $post['isLocked'] = $isLocked;
        $post['assignmentHistory'] = array_slice($roomHistory, 0, 25);
    }
    unset($post);

    $totalPosts = count($postsOut);
    $acceptedPosts = count(array_filter($postsOut, fn($p) => $p['accepted']));
    $gapPosts = count(array_filter($postsOut, fn($p) => $p['missingSaCount'] > 0 || ($p['department'] === 'ITO' && !empty($p['gaps']))));
    $overlapPosts = count(array_filter($postsOut, fn($p) => ($p['overlapHours'] ?? 0) > 0));
    $officeSlotsTotal = array_sum(array_map(fn($p) => (int) $p['totalSlots'], $officePosts));
    $officeSlotsAccepted = array_sum(array_map(fn($p) => (int) $p['acceptedSlots'], $officePosts));

    return [
        'runId' => $run['id'] ?? 0,
        'createdAt' => $run['createdAt'] ?? date('Y-m-d H:i:s'),
        'runBy' => $run['runBy'] ?? 'System',
        'batchStatus' => $lockInfo['batchStatus'] ?? 'PENDING_APPROVAL',
        'isLocked' => $isLocked,
        'lockInfo' => $lockInfo,
        'minWeekly' => $minW,
        'maxWeekly' => $capW,
        'posts' => $postsOut,
        'boardSummary' => [
            'totalAssignments' => $totalPosts,
            'awaitingApproval' => $awaitingApprovalCount,
            'approvedAssignments' => $approvedAssignmentsCount,
            'uncoveredRooms' => $uncoveredRoomsCount,
            'relieverNeededRooms' => $relieverNeededCount,
            'primaryAssignedCount' => $primaryAssignedTotal,
            'relieverAssignedCount' => $relieverAssignedTotal,
        ],
        'progress' => [
            'total' => $totalPosts,
            'decided' => $acceptedPosts,
            'pending' => max(0, $totalPosts - $acceptedPosts),
            'gaps' => $gapPosts,
            'overlaps' => $overlapPosts,
            'slotsTotal' => ($run['totalSlots'] ?? 0) + $officeSlotsTotal,
            'relieverSlots' => $run['relieverSlots'] ?? 0,
            'slotsAccepted' => ($run['accepted'] ?? 0) + $officeSlotsAccepted,
            'slotsPending' => ($run['pending'] ?? 0) + max(0, $officeSlotsTotal - $officeSlotsAccepted),
            'officePostsTotal' => count($officePosts),
            'officeSlotsTotal' => $officeSlotsTotal,
            'officeSlotsAccepted' => $officeSlotsAccepted,
        ],
    ];
}

function post_accept(int $semesterId, string $room, int $userId): array
{
    global $pdo;
    require_batch_unlocked_or_fail($semesterId, 'approving individual room assignments');

    $off = find_office_post($semesterId, $room);
    if ($off) {
        ensure_assigned_office_schedules($semesterId);
        $pdo->prepare(
            'UPDATE schedule_assignments
                SET source = "MATCHING"
              WHERE semester_id = ? AND requirement_type = "OFFICE"
                AND (office_requirement_id = ? OR location = ?)'
        )->execute([$semesterId, (int) $off['id'], $off['office_name']]);
        log_room_assignment_history($semesterId, $off['office_name'], 'OFFICE', 'ROOM_ACCEPT', 'PRIMARY', null, null, "Approved office assignment for {$off['office_name']}.", null, $userId);
        return room_grid($semesterId) ?? [];
    }

    $run = matching_result($semesterId);
    if (!$run) fail('Run Schedule Matching first.', 409);

    if (str_starts_with($room, 'RELIEVER — ')) {
        $relName = trim(substr($room, strlen('RELIEVER — ')));
        $upd = $pdo->prepare(
            'UPDATE match_slots ms
               JOIN match_candidates mc ON mc.slot_id = ms.id
               JOIN sa_profiles p ON p.id = mc.sa_profile_id
                SET ms.decision = "ACCEPTED",
                    ms.assigned_sa_profile_id = COALESCE(ms.assigned_sa_profile_id, mc.sa_profile_id),
                    ms.decided_by = ?,
                    ms.decided_at = NOW()
              WHERE ms.run_id = ?
                AND CONCAT(p.first_name, " ", p.last_name) = ?
                AND (mc.rank_no = 1 OR ms.assigned_sa_profile_id = p.id)'
        );
        $upd->execute([$userId, $run['id'], $relName]);
        sync_approved_to_assignments($semesterId);
        log_room_assignment_history($semesterId, $room, 'ITO', 'ROOM_ACCEPT', 'RELIEVER', null, null, "Approved reliever schedule for {$room}.", null, $userId);
        return room_grid($semesterId) ?? [];
    }

    $claimedPrimary = [];
    $chk = $pdo->prepare('SELECT assigned_sa_profile_id FROM match_slots WHERE run_id = ? AND requirement_type = "ROOM" AND slot_no < 10 AND assigned_sa_profile_id IS NOT NULL');
    $chk->execute([$run['id']]);
    foreach ($chk->fetchAll(PDO::FETCH_COLUMN) as $cSaId) {
        $claimedPrimary[(int) $cSaId] = true;
    }

    $updSlot = $pdo->prepare('UPDATE match_slots SET decision = "ACCEPTED", assigned_sa_profile_id = ?, decided_by = ?, decided_at = NOW() WHERE id = ?');
    $gapSlot = $pdo->prepare('UPDATE match_slots SET status = "COVERAGE_GAP", decision = "PENDING", override_reason = "Uncovered Slot: S.A. reassigned; all candidates currently assigned to other rooms." WHERE id = ?');

    foreach ($run['slots'] as $sl) {
        if (($sl['room'] === $room || str_starts_with((string) $sl['label'], $room)) && $sl['status'] === 'RECOMMENDED') {
            $sid = (int) $sl['id'];
            $isRel = !empty($sl['isReliever']);
            $saId = !empty($sl['recommended']['saId']) ? (int) $sl['recommended']['saId'] : null;
            if (!$saId) {
                $gapSlot->execute([$sid]);
                continue;
            }
            if (!$isRel && isset($claimedPrimary[$saId]) && empty($sl['assigned_sa_profile_id'])) {
                // S.A. is already assigned as primary in another room! Do not double-assign!
                $gapSlot->execute([$sid]);
                continue;
            }
            if (!$isRel) {
                $claimedPrimary[$saId] = true;
            }
            $updSlot->execute([$saId, $userId, $sid]);
        }
    }
    sync_approved_to_assignments($semesterId);
    log_room_assignment_history($semesterId, $room, 'ROOM', 'ROOM_ACCEPT', 'PRIMARY', null, null, "Reviewed and accepted proposed assignments for {$room}.", null, $userId);
    return room_grid($semesterId) ?? [];
}

function post_accept_all(int $semesterId, int $userId, bool $bypassLockGuard = false): array
{
    global $pdo;
    if (!$bypassLockGuard) {
        require_batch_unlocked_or_fail($semesterId, 'accepting all room recommendations');
    }
    ensure_assigned_office_schedules($semesterId);
    $run = matching_result($semesterId);
    if ($run) {
        // 1. Accept all slots that already have a specifically assigned S.A.
        $pdo->prepare('
            UPDATE match_slots
               SET decision = "ACCEPTED",
                   decided_by = ?,
                   decided_at = NOW()
             WHERE run_id = ? AND requirement_type = "ROOM" AND status = "RECOMMENDED" AND assigned_sa_profile_id IS NOT NULL
        ')->execute([$userId, $run['id']]);

        // 2. Collect claimed primary S.A.s
        $claimedPrimary = [];
        $chk = $pdo->prepare('SELECT assigned_sa_profile_id FROM match_slots WHERE run_id = ? AND requirement_type = "ROOM" AND slot_no < 10 AND assigned_sa_profile_id IS NOT NULL');
        $chk->execute([$run['id']]);
        foreach ($chk->fetchAll(PDO::FETCH_COLUMN) as $cSaId) {
            $claimedPrimary[(int) $cSaId] = true;
        }

        // 3. For unassigned recommended slots, assign the resolved recommended S.A. ONLY if NOT already claimed by another primary slot
        $updSlot = $pdo->prepare('UPDATE match_slots SET decision = "ACCEPTED", assigned_sa_profile_id = ?, decided_by = ?, decided_at = NOW() WHERE id = ?');
        $gapSlot = $pdo->prepare('UPDATE match_slots SET status = "COVERAGE_GAP", decision = "PENDING", override_reason = "Uncovered Slot: S.A. reassigned; all candidates currently assigned to other rooms." WHERE id = ?');

        foreach ($run['slots'] as $slot) {
            $sid = (int) $slot['id'];
            $isRel = !empty($slot['isReliever']);
            if ($slot['decision'] === 'ACCEPTED') {
                continue;
            }
            if ($slot['status'] === 'COVERAGE_GAP' || empty($slot['recommended']['saId'])) {
                $gapSlot->execute([$sid]);
                continue;
            }
            $candSaId = (int) $slot['recommended']['saId'];

            if (!$isRel && isset($claimedPrimary[$candSaId]) && empty($slot['assigned_sa_profile_id'])) {
                // Cannot double-assign this primary S.A.! Mark as gap instead!
                $gapSlot->execute([$sid]);
                continue;
            }

            if ($candSaId > 0) {
                if (!$isRel) {
                    $claimedPrimary[$candSaId] = true;
                }
                $updSlot->execute([$candSaId, $userId, $sid]);
            }
        }
        sync_approved_to_assignments($semesterId);
    }

    // Also approve all recommended OFFICE schedules
    $pdo->prepare(
        'UPDATE schedule_assignments
            SET source = "MATCHING"
          WHERE semester_id = ? AND requirement_type = "OFFICE"'
    )->execute([$semesterId]);

    if (!$bypassLockGuard) {
        log_room_assignment_history($semesterId, 'ALL_ROOMS', 'ALL', 'BATCH_REVIEW_ACCEPT', 'PRIMARY', null, null, 'Accepted all valid proposed room and office assignments.', null, $userId);
    }

    return room_grid($semesterId) ?? [];
}

function post_staff_approve(int $semesterId, string $room, int $saId, int $userId, ?string $targetRoom = null): array
{
    global $pdo;
    require_batch_unlocked_or_fail($semesterId, 'approving or moving individual S.A. slots');

    $effectiveRoom = $targetRoom && trim($targetRoom) !== '' ? trim($targetRoom) : $room;
    $off = find_office_post($semesterId, $effectiveRoom);
    if ($off) {
        ensure_assigned_office_schedules($semesterId);
        $pdo->prepare(
            'UPDATE schedule_assignments
                SET source = "MATCHING"
              WHERE semester_id = ? AND sa_profile_id = ? AND requirement_type = "OFFICE"'
        )->execute([$semesterId, $saId]);
        log_room_assignment_history($semesterId, $effectiveRoom, 'OFFICE', 'STAFF_APPROVE', 'PRIMARY', null, $saId, "Approved S.A. assignment in {$effectiveRoom}.", null, $userId);
        return room_grid($semesterId) ?? [];
    }

    $run = matching_result($semesterId);
    if (!$run) fail('Run Schedule Matching first.', 409);

    if ($effectiveRoom !== $room) {
        post_swap($semesterId, $effectiveRoom, 0, $saId, $userId);
    }

    $stmt = $pdo->prepare(
        'SELECT ms.id, ms.slot_no
           FROM match_slots ms
           LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
           LEFT JOIN match_candidates mc ON mc.slot_id = ms.id AND mc.rank_no = 1
          WHERE ms.run_id = ?
            AND (rq.room = ? OR ms.label LIKE ?)
            AND (ms.assigned_sa_profile_id = ? OR mc.sa_profile_id = ?)
          LIMIT 1'
    );
    $stmt->execute([$run['id'], $effectiveRoom, $effectiveRoom . '%', $saId, $saId]);
    $slotRow = $stmt->fetch();
    $slotId = $slotRow ? (int) $slotRow['id'] : 0;
    if (!$slotId) fail('Matching slot for that S.A. was not found.', 404);
    $roleType = ((int) ($slotRow['slot_no'] ?? 1) >= 10) ? 'RELIEVER' : 'PRIMARY';

    $pdo->prepare(
        'UPDATE match_slots
            SET decision = "ACCEPTED",
                assigned_sa_profile_id = ?,
                status = "RECOMMENDED",
                decided_by = ?,
                decided_at = NOW()
          WHERE id = ?'
    )->execute([$saId, $userId, $slotId]);

    sync_approved_to_assignments($semesterId);
    log_room_assignment_history($semesterId, $effectiveRoom, 'ROOM', 'STAFF_APPROVE', $roleType, null, $saId, "Approved {$roleType} S.A. slot in {$effectiveRoom}.", null, $userId);
    return room_grid($semesterId) ?? [];
}

function post_staff_reject(int $semesterId, string $room, int $saId, int $userId): array
{
    global $pdo;
    require_batch_unlocked_or_fail($semesterId, 'unassigning S.A. slots');

    $off = find_office_post($semesterId, $room);
    if ($off) {
        $pdo->beginTransaction();
        try {
            $pdo->prepare(
                'DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? AND requirement_type = "OFFICE"'
            )->execute([$semesterId, $saId]);
            $pdo->prepare('UPDATE sa_profiles SET assignment_status = "UNASSIGNED" WHERE id = ?')->execute([$saId]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        log_room_assignment_history($semesterId, $room, 'OFFICE', 'STAFF_UNASSIGN', 'PRIMARY', $saId, null, "Unassigned S.A. from {$room} before batch approval.", null, $userId);
        return room_grid($semesterId) ?? [];
    }

    $run = matching_result($semesterId);
    if (!$run) fail('Run Schedule Matching first.', 409);

    $stmt = $pdo->prepare(
        'SELECT ms.id, ms.slot_no
           FROM match_slots ms
           LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
           LEFT JOIN match_candidates mc ON mc.slot_id = ms.id AND mc.rank_no = 1
          WHERE ms.run_id = ?
            AND (rq.room = ? OR ms.label LIKE ?)
            AND (ms.assigned_sa_profile_id = ? OR mc.sa_profile_id = ?)
          LIMIT 1'
    );
    $stmt->execute([$run['id'], $room, $room . '%', $saId, $saId]);
    $slotRow = $stmt->fetch();
    $slotId = $slotRow ? (int) $slotRow['id'] : 0;
    if (!$slotId) fail('Matching slot for that S.A. was not found.', 404);
    $roleType = ((int) ($slotRow['slot_no'] ?? 1) >= 10) ? 'RELIEVER' : 'PRIMARY';

    $pdo->prepare(
        'UPDATE match_slots
            SET decision = "PENDING",
                assigned_sa_profile_id = NULL,
                status = "COVERAGE_GAP",
                override_reason = "Unassigned by Coordinator; select a replacement S.A. or re-run matching.",
                decided_by = ?,
                decided_at = NOW()
          WHERE id = ?'
    )->execute([$userId, $slotId]);

    sync_approved_to_assignments($semesterId);
    log_room_assignment_history($semesterId, $room, 'ROOM', 'STAFF_UNASSIGN', $roleType, $saId, null, "Unassigned {$roleType} S.A. from {$room} during pre-approval review.", null, $userId);
    return room_grid($semesterId) ?? [];
}

function post_swap(
    int $semesterId,
    string $room,
    int $dropSaId,
    int $pickSaId,
    int $userId,
    bool $allowLockedOverride = false,
    ?string $overrideReason = null
): array {
    global $pdo;
    if (!$allowLockedOverride) {
        require_batch_unlocked_or_fail($semesterId, 'replacing S.A. assignments');
    }

    $off = find_office_post($semesterId, $room);
    if ($off) {
        $allPool = matching_pool($semesterId, false);
        $pickSa = $allPool[$pickSaId] ?? fail('Selected S.A. was not found.', 404);
        if (($pickSa['category'] ?? '') !== 'OFFICE') {
            fail("{$pickSa['name']} ({$pickSa['category']}) cannot be assigned to an Office.", 422);
        }

        $officeId = (int) $off['office_id'];
        $reqId = (int) $off['id'];
        $reqSa = max(1, (int) $off['required_sa']);
        $openFrom = max(mins(OFFICE_OPEN), mins($off['operating_start'] ?: OFFICE_OPEN));
        $openTo = min(mins(OFFICE_CLOSE), mins($off['operating_end'] ?: OFFICE_CLOSE));
        $target = max(min_weekly_hours(), (float) ($off['weekly_target_hours'] ?: min_weekly_hours()));

        $pickCopy = $pickSa;
        $pickCopy['duty'] = [];
        ['pattern' => $pattern, 'hours' => $raw, 'credited' => $cred] = office_pattern($pickCopy, $openFrom, $openTo, $target);
        if (!$pattern || $raw < MIN_OFFICE_BLOCK) {
            fail("{$pickSa['name']} has no conflict-free duty hours within {$off['office_name']} office hours.", 422);
        }
        if ($cred > hard_weekly_cap()) {
            fail("Assigning {$pickSa['name']} would exceed the " . hard_weekly_cap() . "-hour weekly maximum.", 422);
        }

        $supId = supervisor_for('OFFICE', $officeId);
        $pdo->beginTransaction();
        try {
            if ($dropSaId > 0 && $dropSaId !== $pickSaId) {
                $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? AND requirement_type = "OFFICE"')
                    ->execute([$semesterId, $dropSaId]);
                $pdo->prepare('UPDATE sa_profiles SET assignment_status = "UNASSIGNED" WHERE id = ?')
                    ->execute([$dropSaId]);
            }

            $cntStmt = $pdo->prepare(
                'SELECT COUNT(*) FROM sa_profiles WHERE office_id = ? AND sa_status = "ACTIVE" AND archived_at IS NULL AND assignment_status = "ASSIGNED" AND id <> ?'
            );
            $cntStmt->execute([$officeId, $pickSaId]);
            if ((int) $cntStmt->fetchColumn() >= $reqSa) {
                $pdo->rollBack();
                fail("{$off['office_name']} already has the required {$reqSa} S.A.(s). Over-staffing is not allowed.", 409);
            }

            $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ?')
                ->execute([$semesterId, $pickSaId]);
            $ins = $pdo->prepare(
                'INSERT INTO schedule_assignments
                    (semester_id, sa_profile_id, requirement_type, office_requirement_id, department, location, supervisor_id, day_of_week, start_time, end_time, source)
                 VALUES (?, ?, "OFFICE", ?, "OFFICE", ?, ?, ?, ?, ?, "MATCHING")'
            );
            foreach ($pattern as [$day, $s, $e]) {
                $ins->execute([$semesterId, $pickSaId, $reqId, $off['office_name'], $supId, $day, hhmm($s), hhmm($e)]);
            }
            $pdo->prepare(
                'UPDATE sa_profiles SET office_id = ?, department_type = "OFFICE", assignment_status = "ASSIGNED", marked_for_reassignment = 0, supervisor_id = COALESCE(?, supervisor_id) WHERE id = ?'
            )->execute([$officeId, $supId, $pickSaId]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }

        log_room_assignment_history(
            $semesterId,
            $off['office_name'],
            'OFFICE',
            $allowLockedOverride ? 'AUTHORIZED_REASSIGN' : 'PRE_APPROVAL_SWAP',
            'PRIMARY',
            $dropSaId ?: null,
            $pickSaId,
            "Assigned {$pickSa['name']} ({$cred} credited hrs/wk) to {$off['office_name']}.",
            $overrideReason,
            $userId
        );

        return room_grid($semesterId) ?? [];
    }

    $run = matching_result($semesterId);
    if (!$run) fail('Run Schedule Matching first.', 409);

    $pool = matching_pool($semesterId, true);
    $pickSa = $pool[$pickSaId] ?? fail('Selected S.A. is not in the ITO/ACADS matching pool.', 422);

    $postsByRoom = [];
    foreach (build_room_posts($semesterId) as $p) {
        $postsByRoom[$p['room']] = $p;
    }
    $post = $postsByRoom[$room] ?? fail('Room not found.', 404);

    if (!eligible_for($pickSa, $post['department'], null, true)) {
        fail("{$pickSa['name']} ({$pickSa['category']}) cannot be assigned to a {$post['department']} room.", 422);
    }

    $slotStmt = $pdo->prepare(
        'SELECT ms.id, ms.slot_no
           FROM match_slots ms
           LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
           LEFT JOIN match_candidates mc ON mc.slot_id = ms.id AND mc.rank_no = 1
          WHERE ms.run_id = ? AND (rq.room = ? OR ms.label LIKE ?)
          ORDER BY (ms.assigned_sa_profile_id = ? OR mc.sa_profile_id = ?) DESC,
                   (ms.status = "COVERAGE_GAP") DESC,
                   ms.slot_no ASC
          LIMIT 1'
    );
    $slotStmt->execute([$run['id'], $room, $room . '%', $dropSaId, $dropSaId]);
    $slotRow = $slotStmt->fetch() ?: fail('Room slot not found.', 404);
    $slotId = (int) $slotRow['id'];
    $roleType = ((int) ($slotRow['slot_no'] ?? 1) >= 10) ? 'RELIEVER' : 'PRIMARY';

    // Prevent assigning an S.A. who is already matched or assigned to another room
    $asgCheck = $pdo->prepare(
        'SELECT COALESCE(rq.room, ms.label) as assigned_room
           FROM match_slots ms
           LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
           LEFT JOIN match_candidates mc ON mc.slot_id = ms.id AND mc.rank_no = 1
          WHERE ms.run_id = ?
            AND (ms.assigned_sa_profile_id = ? OR mc.sa_profile_id = ?)
            AND ms.id <> ?
          LIMIT 1'
    );
    $asgCheck->execute([$run['id'], $pickSaId, $pickSaId, $slotId]);
    $alreadyRoom = (string) $asgCheck->fetchColumn();
    if ($alreadyRoom !== '' && strcasecmp($alreadyRoom, $room) !== 0) {
        fail("{$pickSa['name']} is already assigned to {$alreadyRoom}. S.A.s cannot be assigned to multiple rooms.", 422);
    }

    $otherStmt = $pdo->prepare(
        'SELECT COALESCE(ms.assigned_sa_profile_id, mc.sa_profile_id) AS other_sa_id
           FROM match_slots ms
           LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
           LEFT JOIN match_candidates mc ON mc.slot_id = ms.id AND mc.rank_no = 1
          WHERE ms.run_id = ? AND (rq.room = ? OR ms.label LIKE ?) AND ms.id <> ?
          LIMIT 1'
    );
    $otherStmt->execute([$run['id'], $room, $room . '%', $slotId]);
    $otherSaId = (int) $otherStmt->fetchColumn();

    if ($otherSaId && isset($pool[$otherSaId]) && $otherSaId !== $pickSaId) {
        $pairRes = build_complementary_pair_patterns($pickSa, $pool[$otherSaId], $post['open']);
        $pattern = $pairRes['pat1'];
        $raw = $pairRes['raw1'];
        $cred = $pairRes['cred1'];
    } else {
        $single = build_single_sa_room_pattern($pickSa, $post['open']);
        $pattern = $single['pattern'];
        $raw = $single['raw'];
        $cred = $single['credited'];
    }

    if (!$pattern) {
        fail("{$pickSa['name']} has no conflict-free duty hours for {$room}.", 422);
    }

    $checks = [
        'Official Registrar class schedule verified (0 conflicts)',
        "Category matched: {$pickSa['category']} -> {$post['department']}",
        "{$cred} credited hrs/wk ({$raw} raw hrs with 1h lunch rule)",
        $allowLockedOverride ? 'Authorized post-approval reassignment by Coordinator' : 'Selected by Coordinator override',
    ];

    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE match_candidates SET rank_no = rank_no + 1, status = "REVIEW" WHERE slot_id = ?')
            ->execute([$slotId]);
        $pdo->prepare('DELETE FROM match_candidates WHERE slot_id = ? AND sa_profile_id = ?')
            ->execute([$slotId, $pickSaId]);
        $pdo->prepare(
            'INSERT INTO match_candidates (slot_id, sa_profile_id, rank_no, score, duty_hours, projected_hours, status, checks, duty_pattern)
             VALUES (?, ?, 1, ?, ?, ?, "RECOMMENDED", ?, ?)'
        )->execute([
            $slotId,
            $pickSaId,
            candidate_score($pickSa, $cred, $post['department']),
            $raw,
            $cred,
            json_encode($checks),
            json_encode($pattern),
        ]);

        $pdo->prepare(
            'UPDATE match_slots
                SET status = "RECOMMENDED",
                    decision = "OVERRIDDEN",
                    assigned_sa_profile_id = ?,
                    override_reason = ?,
                    decided_by = ?,
                    decided_at = NOW()
              WHERE id = ?'
        )->execute([$pickSaId, $overrideReason, $userId, $slotId]);

        $pdo->prepare('UPDATE sa_profiles SET marked_for_reassignment = 0 WHERE id = ?')->execute([$pickSaId]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    sync_approved_to_assignments($semesterId);
    log_room_assignment_history(
        $semesterId,
        $room,
        $post['department'],
        $allowLockedOverride ? 'AUTHORIZED_REASSIGN' : 'PRE_APPROVAL_SWAP',
        $roleType,
        $dropSaId ?: null,
        $pickSaId,
        "Assigned {$pickSa['name']} ({$cred} credited hrs/wk) to {$room} ({$roleType}).",
        $overrideReason,
        $userId
    );
    return room_grid($semesterId) ?? [];
}

/**
 * Allows the S.A. Coordinator to edit/adjust the recommended duty hours of an S.A. in Recommendations (Page 6),
 * or reset them to the auto-matched schedule, while strictly enforcing 0 Registrar class conflicts,
 * 0 cross-room duty overlaps, and weekly/daily hour & lunch rules (including Office 8:00 AM–5:00 PM / 12–1 lunch / Sat half-day rules).
 */
function post_duty_save(
    int $semesterId,
    string $room,
    int $slotId,
    int $saId,
    array $blocksInput,
    int $userId,
    bool $resetToAuto = false,
    bool $allowLockedOverride = false,
    ?string $overrideReason = null
): array {
    global $pdo;
    if (!$allowLockedOverride) {
        require_batch_unlocked_or_fail($semesterId, 'editing room or office duty hours');
    }

    $off = find_office_post($semesterId, $room);
    if ($off) {
        $allPool = matching_pool($semesterId, false);
        $sa = $allPool[$saId] ?? fail('Selected Office S.A. was not found.', 404);
        $sa['duty'] = [];

        $officeId = (int) $off['office_id'];
        $reqId = (int) $off['id'];
        $openFrom = max(mins(OFFICE_OPEN), mins($off['operating_start'] ?: OFFICE_OPEN));
        $openTo = min(mins(OFFICE_CLOSE), mins($off['operating_end'] ?: OFFICE_CLOSE));
        $target = max(min_weekly_hours(), (float) ($off['weekly_target_hours'] ?: min_weekly_hours()));

        if ($resetToAuto) {
            ['pattern' => $pattern] = office_pattern($sa, $openFrom, $openTo, $target);
            if (!$pattern) {
                fail("Could not generate conflict-free automatic office schedule for {$sa['name']}.", 422);
            }
            $newSource = 'CHANGE';
        } else {
            if (empty($blocksInput)) {
                // If coordinator cleared all duty blocks, cleanly unassign the S.A.
                return post_staff_reject($semesterId, $room, $saId, $userId);
            }

            $cStmt = $pdo->prepare(
                'SELECT day_of_week, start_time, end_time, subject
                   FROM class_schedules
                  WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NULL'
            );
            $cStmt->execute([$semesterId, $saId]);
            $classesDetailed = [];
            foreach ($cStmt as $cr) {
                $classesDetailed[$cr['day_of_week']][] = [
                    'start' => mins($cr['start_time']),
                    'end' => mins($cr['end_time']),
                    'subject' => $cr['subject'],
                    'label' => format_time($cr['start_time']) . ' – ' . format_time($cr['end_time']),
                ];
            }

            $byDaySpans = [];
            foreach ($blocksInput as $b) {
                if (!is_array($b)) continue;
                $day = strtoupper(trim((string) ($b['day'] ?? '')));
                if (!in_array($day, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
                    fail('Please select a valid day (Monday to Saturday).', 422);
                }
                $startStr = parse_time((string) ($b['startTime'] ?? ''));
                $endStr = parse_time((string) ($b['endTime'] ?? ''));
                if (!$startStr || !$endStr) {
                    fail("Invalid time format on {$day}. Please use HH:MM format.", 422);
                }
                $s = mins($startStr);
                $e = mins($endStr);
                if ($e <= $s) {
                    fail("On {$day}, End Time must be later than Start Time.", 422);
                }
                if ($e - $s < 60) {
                    fail("On {$day}, office duty blocks cannot be shorter than 1.0 hour.", 422);
                }

                // Enforce Office Duty Window: Standard 8:00 AM - 5:00 PM Mon-Fri (adjustable 7:00 AM - 6:00 PM to fill required hours, with 12:00-1:00 PM lunch break),
                // Sat half-day 8:00 AM - 12:00 PM (adjustable from 7:00 AM)
                if ($day === 'SAT') {
                    if ($s < 420 || $e > 720) {
                        fail('On Saturday, only half-day schedules are permitted for Office S.A.s (standard 8:00 AM – 12:00 PM, adjustable from 7:00 AM – 12:00 PM) with no lunch deduction.', 422);
                    }
                } else {
                    if ($s < 420 || $e > 1080) {
                        fail("On {$day}, standard office duty hours are 8:00 AM – 5:00 PM (adjustable only between 7:00 AM and 6:00 PM).", 422);
                    }
                    if ($s >= 720 && $e <= 780) {
                        fail("On {$day}, 12:00 PM – 1:00 PM is an automatic lunch break and is not counted as duty time.", 422);
                    }
                    if ($s < 780 && $e > 720 && !($s <= 720 && $e >= 780)) {
                        fail("On {$day}, 12:00 PM – 1:00 PM is an automatic lunch break. End morning duty at 12:00 PM or start afternoon duty at 1:00 PM.", 422);
                    }
                }

                // Check against official Registrar class schedule
                foreach ($classesDetailed[$day] ?? [] as $cls) {
                    if (overlaps($s, $e, $cls['start'], $cls['end'])) {
                        fail(
                            "Registrar Class Conflict: Duty on {$day} (" .
                            format_time($startStr) . ' – ' . format_time($endStr) .
                            ") clashes with {$sa['name']}'s official class {$cls['subject']} ({$cls['label']}).",
                            422
                        );
                    }
                }

                $byDaySpans[$day][] = [$s, $e];
            }

            $pattern = [];
            foreach (DAY_ORDER as $d) {
                if (empty($byDaySpans[$d])) continue;
                $merged = merge_spans($byDaySpans[$d]);
                $dayMins = span_minutes($merged);
                // 7:00 AM - 6:00 PM is 11.0 raw hours (10.0 credited hours after 12:00-1:00 PM lunch break)
                if ($dayMins / 60.0 > 11.0) {
                    fail("On {$d}, daily office duty exceeds the 11.0 raw hours maximum (7:00 AM – 6:00 PM).", 422);
                }
                foreach ($merged as [$ms, $me]) {
                    $pattern[] = [$d, $ms, $me];
                }
            }

            if (!$pattern) {
                fail('No valid office duty blocks were saved.', 422);
            }

            $cred = credited_with($sa, $pattern);
            if ($cred > hard_weekly_cap()) {
                fail(
                    "Exceeds the maximum " . hard_weekly_cap() . " credited hrs/wk cap for {$sa['name']} ({$cred} credited hrs).",
                    422
                );
            }
            $newSource = 'MANUAL';
        }

        $supId = supervisor_for('OFFICE', $officeId);
        $pdo->beginTransaction();
        try {
            $pdo->prepare(
                'DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? AND requirement_type = "OFFICE"'
            )->execute([$semesterId, $saId]);

            $ins = $pdo->prepare(
                'INSERT INTO schedule_assignments
                    (semester_id, sa_profile_id, requirement_type, office_requirement_id, department, location, supervisor_id, day_of_week, start_time, end_time, source)
                 VALUES (?, ?, "OFFICE", ?, "OFFICE", ?, ?, ?, ?, ?, ?)'
            );
            foreach ($pattern as [$day, $s, $e]) {
                $ins->execute([
                    $semesterId,
                    $saId,
                    $reqId,
                    $off['office_name'],
                    $supId,
                    $day,
                    hhmm($s),
                    hhmm($e),
                    $newSource,
                ]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }

        log_room_assignment_history($semesterId, $off['office_name'], 'OFFICE', 'DUTY_HOURS_EDIT', 'PRIMARY', $saId, $saId, "Updated office duty hours for {$sa['name']}.", $overrideReason, $userId);
        return room_grid($semesterId) ?? [];
    }

    $run = matching_result($semesterId, false);
    if (!$run) fail('Run Schedule Matching first.', 409);

    $pool = matching_pool($semesterId, true);
    $sa = $pool[$saId] ?? fail('Selected S.A. was not found in the active matching pool.', 404);

    $isRelieverPost = str_starts_with($room, 'RELIEVER — ');
    if ($isRelieverPost) {
        $post = [
            'room' => $room,
            'department' => 'ITO',
            'roomType' => 'RELIEVER',
            'open' => [
                'MON' => [[420, 1320]], 'TUE' => [[420, 1320]], 'WED' => [[420, 1320]],
                'THU' => [[420, 1320]], 'FRI' => [[420, 1320]], 'SAT' => [[420, 1320]],
            ],
            'requiredSa' => 1,
        ];
    } else {
        $postsByRoom = [];
        foreach (build_room_posts($semesterId) as $p) {
            $postsByRoom[$p['room']] = $p;
        }
        $post = $postsByRoom[$room] ?? fail('Room not found.', 404);
    }

    // Locate target slot in latest run
    if ($slotId > 0) {
        $slotStmt = $pdo->prepare('SELECT * FROM match_slots WHERE id = ? AND run_id = ? LIMIT 1');
        $slotStmt->execute([$slotId, $run['id']]);
        $slotRow = $slotStmt->fetch();
    } else {
        $slotStmt = $pdo->prepare(
            'SELECT ms.*
               FROM match_slots ms
               LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
               LEFT JOIN match_candidates mc ON mc.slot_id = ms.id AND mc.rank_no = 1
              WHERE ms.run_id = ?
                AND (rq.room = ? OR ms.label LIKE ?)
                AND (ms.assigned_sa_profile_id = ? OR mc.sa_profile_id = ?)
              LIMIT 1'
        );
        $slotStmt->execute([$run['id'], $room, $room . '%', $saId, $saId]);
        $slotRow = $slotStmt->fetch();
    }
    if ($isRelieverPost && !$slotRow) {
        $slotStmt = $pdo->prepare(
            'SELECT ms.* FROM match_slots ms WHERE ms.run_id = ? AND ms.assigned_sa_profile_id = ? LIMIT 1'
        );
        $slotStmt->execute([$run['id'], $saId]);
        $slotRow = $slotStmt->fetch();
    }
    if (!$slotRow) fail('Matching slot for that S.A. was not found.', 404);
    $slotId = (int) $slotRow['id'];
    $isReliever = ((int) $slotRow['slot_no'] >= 10 || str_contains((string) $slotRow['label'], 'Reliever'));

    if ($resetToAuto) {
        if ($isReliever) {
            fail('Use Restore Initial Match or Explore Alternatives to regenerate ITO Reliever slots.', 422);
        }
        $otherStmt = $pdo->prepare(
            'SELECT COALESCE(ms.assigned_sa_profile_id, mc.sa_profile_id) AS other_sa_id
               FROM match_slots ms
               LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
               LEFT JOIN match_candidates mc ON mc.slot_id = ms.id AND mc.rank_no = 1
              WHERE ms.run_id = ? AND (rq.room = ? OR ms.label LIKE ?) AND ms.id <> ? AND ms.slot_no < 10
              LIMIT 1'
        );
        $otherStmt->execute([$run['id'], $room, $room . '%', $slotId]);
        $otherSaId = (int) $otherStmt->fetchColumn();

        if ($otherSaId && isset($pool[$otherSaId]) && $otherSaId !== $saId) {
            $pairRes = build_complementary_pair_patterns($sa, $pool[$otherSaId], $post['open']);
            $pattern = $pairRes['pat1'];
            $raw = $pairRes['raw1'];
            $cred = $pairRes['cred1'];
        } else {
            $single = build_single_sa_room_pattern($sa, $post['open']);
            $pattern = $single['pattern'];
            $raw = $single['raw'];
            $cred = $single['credited'];
        }
        if (!$pattern) {
            fail("Could not generate conflict-free automatic schedule for {$sa['name']}.", 422);
        }
        $checks = [
            'Official Registrar class schedule verified (0 conflicts)',
            "Category matched: {$sa['category']} -> {$post['department']}",
            "{$cred} credited hrs/wk ({$raw} raw hrs with 1h lunch rule)",
            'Restored to auto-matched schedule',
        ];
    } else {
        if (empty($blocksInput)) {
            // If coordinator cleared all duty blocks, cleanly unassign the S.A.
            return post_staff_reject($semesterId, $room, $saId, $userId);
        }

        // Load detailed class schedules with subject names for clear error messages
        $cStmt = $pdo->prepare(
            'SELECT day_of_week, start_time, end_time, subject
               FROM class_schedules
              WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NULL'
        );
        $cStmt->execute([$semesterId, $saId]);
        $classesDetailed = [];
        foreach ($cStmt as $cr) {
            $classesDetailed[$cr['day_of_week']][] = [
                'start' => mins($cr['start_time']),
                'end' => mins($cr['end_time']),
                'subject' => $cr['subject'],
                'label' => format_time($cr['start_time']) . ' – ' . format_time($cr['end_time']),
            ];
        }

        // Load any other room slots in this run where this same SA is assigned (e.g. primary room vs reliever room)
        $otherSlotsStmt = $pdo->prepare(
            'SELECT ms.id, ms.label, rq.room, mc.duty_pattern
               FROM match_slots ms
               LEFT JOIN room_requirements rq ON rq.id = ms.room_requirement_id
               JOIN match_candidates mc ON mc.slot_id = ms.id AND mc.rank_no = 1
              WHERE ms.run_id = ? AND ms.id <> ? AND ms.status = "RECOMMENDED"
                AND COALESCE(ms.assigned_sa_profile_id, mc.sa_profile_id) = ?'
        );
        $otherSlotsStmt->execute([$run['id'], $slotId, $saId]);
        $otherDutyByDay = [];
        foreach ($otherSlotsStmt as $osRow) {
            $oRoom = $osRow['room'] ?: $osRow['label'];
            $oPat = json_decode($osRow['duty_pattern'] ?? '[]', true) ?: [];
            foreach ($oPat as $osp) {
                if (!is_array($osp) || count($osp) < 3) continue;
                $otherDutyByDay[$osp[0]][] = [
                    'start' => (int) $osp[1],
                    'end' => (int) $osp[2],
                    'room' => $oRoom,
                ];
            }
        }

        $byDaySpans = [];
        foreach ($blocksInput as $idx => $b) {
            if (!is_array($b)) continue;
            $day = strtoupper(trim((string) ($b['day'] ?? '')));
            if (!in_array($day, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
                fail('Please select a valid day (Monday to Saturday).', 422);
            }
            $startStr = parse_time((string) ($b['startTime'] ?? ''));
            $endStr = parse_time((string) ($b['endTime'] ?? ''));
            if (!$startStr || !$endStr) {
                fail("Invalid time format on {$day}. Please use HH:MM format (e.g. 07:00 to 12:00).", 422);
            }
            $s = mins($startStr);
            $e = mins($endStr);
            if ($e <= $s) {
                fail("On {$day}, End Time must be later than Start Time.", 422);
            }
            if ($e - $s < 30) {
                fail("On {$day} (" . format_time($startStr) . ' – ' . format_time($endStr) . "), duty blocks cannot be shorter than 30 minutes.", 422);
            }
            if ($s < 420 || $e > 1320) {
                fail("On {$day}, room duty must be within operating hours of 7:00 AM to 10:00 PM.", 422);
            }

            // 1. Check against official Registrar class schedule
            foreach ($classesDetailed[$day] ?? [] as $cls) {
                if (overlaps($s, $e, $cls['start'], $cls['end'])) {
                    fail(
                        "Registrar Class Conflict: Duty on {$day} (" .
                        format_time($startStr) . ' – ' . format_time($endStr) .
                        ") clashes with {$sa['name']}'s official class {$cls['subject']} ({$cls['label']}).",
                        422
                    );
                }
            }

            // 2. Check against this SA's duty in any other room (e.g. donor room vs reliever room)
            foreach ($otherDutyByDay[$day] ?? [] as $od) {
                if (overlaps($s, $e, $od['start'], $od['end'])) {
                    fail(
                        "Duty Conflict: {$sa['name']} is already scheduled for duty in {$od['room']} on {$day} (" .
                        format_time(hhmm($od['start'])) . ' – ' . format_time(hhmm($od['end'])) . ').',
                        422
                    );
                }
            }

            $byDaySpans[$day][] = [$s, $e];
        }

        $pattern = [];
        foreach (DAY_ORDER as $d) {
            if (empty($byDaySpans[$d])) continue;
            $merged = merge_spans($byDaySpans[$d]);
            foreach ($merged as [$ms, $me]) {
                $pattern[] = [$d, $ms, $me];
            }
        }

        if (!$pattern) {
            fail('No valid duty blocks were saved.', 422);
        }

        $raw = round(array_sum(array_map(fn($sp) => ($sp[2] - $sp[1]) / 60.0, $pattern)), 1);
        $cred = credited_with($sa, $pattern);

        // Also check combined weekly hours if SA has another slot (e.g. primary + reliever)
        $combinedPattern = $pattern;
        foreach ($otherDutyByDay as $odDay => $odList) {
            foreach ($odList as $od) {
                $combinedPattern[] = [$odDay, $od['start'], $od['end']];
            }
        }
        $combinedCred = credited_with($sa, $combinedPattern);
        if ($combinedCred > hard_weekly_cap()) {
            fail(
                "Exceeds the maximum " . hard_weekly_cap() . " credited hrs/wk weekly cap for {$sa['name']} ({$combinedCred} credited hrs).",
                422
            );
        }

        $checks = [
            'Official Registrar class schedule verified (0 conflicts)',
            "Category matched: {$sa['category']} -> {$post['department']}",
            "{$cred} credited hrs/wk ({$raw} raw hrs with 1h lunch rule)",
            'Adjusted by Coordinator',
        ];
    }

    $newDecision = in_array($slotRow['decision'], ['ACCEPTED', 'OVERRIDDEN'], true)
        ? $slotRow['decision']
        : 'OVERRIDDEN';

    $pdo->beginTransaction();
    try {
        $updCand = $pdo->prepare(
            'UPDATE match_candidates
                SET duty_hours = ?,
                    projected_hours = ?,
                    checks = ?,
                    duty_pattern = ?,
                    status = "RECOMMENDED"
              WHERE slot_id = ? AND sa_profile_id = ? AND rank_no = 1'
        );
        $updCand->execute([
            $raw,
            $cred,
            json_encode($checks),
            json_encode($pattern),
            $slotId,
            $saId,
        ]);

        if ($updCand->rowCount() === 0) {
            $pdo->prepare('UPDATE match_candidates SET rank_no = rank_no + 1 WHERE slot_id = ?')->execute([$slotId]);
            $pdo->prepare(
                'INSERT INTO match_candidates (slot_id, sa_profile_id, rank_no, score, duty_hours, projected_hours, status, checks, duty_pattern)
                 VALUES (?, ?, 1, ?, ?, ?, "RECOMMENDED", ?, ?)'
            )->execute([
                $slotId,
                $saId,
                candidate_score($sa, $cred, $post['department']),
                $raw,
                $cred,
                json_encode($checks),
                json_encode($pattern),
            ]);
        }

        $pdo->prepare(
            'UPDATE match_slots
                SET status = "RECOMMENDED",
                    decision = ?,
                    assigned_sa_profile_id = ?,
                    override_reason = COALESCE(?, override_reason),
                    decided_by = ?,
                    decided_at = NOW()
              WHERE id = ?'
        )->execute([$newDecision, $saId, $overrideReason, $userId, $slotId]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    sync_approved_to_assignments($semesterId);
    log_room_assignment_history(
        $semesterId,
        $room,
        $post['department'],
        'DUTY_HOURS_EDIT',
        $isReliever ? 'RELIEVER' : 'PRIMARY',
        $saId,
        $saId,
        "Adjusted {$room} duty schedule for {$sa['name']} ({$cred} credited hrs/wk).",
        $overrideReason,
        $userId
    );
    return room_grid($semesterId) ?? [];
}

function sa_fitting_rooms(int $semesterId, int $saId): array
{
    $pool = matching_pool($semesterId, true);
    $sa = $pool[$saId] ?? fail('S.A. not found in room matching pool.', 404);
    $posts = build_room_posts($semesterId);

    $out = [];
    foreach ($posts as $post) {
        if (!eligible_for($sa, $post['department'])) continue;
        $single = build_single_sa_room_pattern($sa, $post['open']);
        if (!$single['pattern']) continue;
        $out[] = [
            'room' => $post['room'],
            'department' => $post['department'],
            'requiredSa' => $post['requiredSa'],
            'creditedHours' => $single['credited'],
            'rawHours' => $single['raw'],
            'fitsMinimum' => $single['credited'] >= min_weekly_hours(),
        ];
    }
    usort($out, fn($a, $b) => [$b['fitsMinimum'], $b['creditedHours']] <=> [$a['fitsMinimum'], $a['creditedHours']]);
    return $out;
}

// -----------------------------------------------------------------------------
// PAGE 7: FINALIZE SCHEDULE (COMBINES APPROVED ITO/ACADS + APPROVED OFFICE)
// -----------------------------------------------------------------------------

function duty_class_clashes(int $semesterId, ?int $saProfileId = null): array
{
    global $pdo;
    $sql =
        'SELECT a.id, a.sa_profile_id, a.day_of_week, a.start_time, a.end_time, a.location,
                c.subject, c.start_time AS class_start, c.end_time AS class_end,
                p.first_name, p.last_name, p.student_id
           FROM schedule_assignments a
           JOIN class_schedules c ON c.sa_profile_id = a.sa_profile_id
                                 AND c.semester_id = a.semester_id
                                 AND c.day_of_week = a.day_of_week
                                 AND c.archived_at IS NULL
                                 AND a.start_time < c.end_time AND a.end_time > c.start_time
           JOIN sa_profiles p ON p.id = a.sa_profile_id
          WHERE a.semester_id = ?' . ($saProfileId ? ' AND a.sa_profile_id = ?' : ' AND a.source IN ("MATCHING", "MANUAL", "CHANGE")') . '
          ORDER BY p.last_name, FIELD(a.day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), a.start_time';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($saProfileId ? [$semesterId, $saProfileId] : [$semesterId]);

    return array_map(fn($r) => [
        'assignmentId' => (int) $r['id'],
        'saId' => (int) $r['sa_profile_id'],
        'studentId' => $r['student_id'],
        'name' => $r['first_name'] . ' ' . $r['last_name'],
        'day' => $r['day_of_week'],
        'duty' => format_time($r['start_time']) . ' – ' . format_time($r['end_time']),
        'location' => $r['location'],
        'subject' => $r['subject'],
        'class' => format_time($r['class_start']) . ' – ' . format_time($r['class_end']),
    ], $stmt->fetchAll());
}

function publication(int $semesterId): array
{
    global $pdo;
    $stmt = $pdo->prepare(
        'SELECT sp.*, u1.full_name AS finalized_by_name, u2.full_name AS published_by_name
           FROM schedule_publications sp
           LEFT JOIN users u1 ON u1.id = sp.finalized_by
           LEFT JOIN users u2 ON u2.id = sp.published_by
          WHERE sp.semester_id = ? LIMIT 1'
    );
    $stmt->execute([$semesterId]);
    $row = $stmt->fetch();
    if ($row) return $row;

    return [
        'semester_id' => $semesterId,
        'status' => 'DRAFT',
        'finalized_at' => null,
        'published_at' => null,
        'finalized_by_name' => null,
        'published_by_name' => null,
    ];
}

function supervisor_for(string $department, ?int $officeId, ?int $preferredSupId = null): ?int
{
    global $pdo;

    // If an S.A. already has a designated supervisor, verify they oversee this office/department and prioritize them
    if ($preferredSupId && $preferredSupId > 0) {
        if ($department === 'OFFICE' && $officeId) {
            $chk = $pdo->prepare('
                SELECT u.id
                FROM users u
                LEFT JOIN supervisor_offices so ON so.supervisor_id = u.id
                WHERE u.id = ? AND u.role = "SUPERVISOR"
                  AND (u.office_id = ? OR so.office_id = ?)
                LIMIT 1
            ');
            $chk->execute([$preferredSupId, $officeId, $officeId]);
            if ($chk->fetchColumn()) {
                return (int) $preferredSupId;
            }
        } else {
            $chk = $pdo->prepare('SELECT id FROM users WHERE id = ? AND role = "SUPERVISOR" AND supervisor_category = ? LIMIT 1');
            $chk->execute([$preferredSupId, $department]);
            if ($chk->fetchColumn()) {
                return (int) $preferredSupId;
            }
        }
    }

    static $cache = [];
    $key = $department . '|' . ($officeId ?? 0);
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    if ($department === 'OFFICE') {
        $stmt = $pdo->prepare('
            SELECT u.id
            FROM users u
            LEFT JOIN supervisor_offices so ON so.supervisor_id = u.id
            WHERE u.role = "SUPERVISOR"
              AND (u.office_id = ? OR so.office_id = ?)
            ORDER BY (u.office_id = ?) DESC, u.id ASC
            LIMIT 1
        ');
        $stmt->execute([$officeId, $officeId, $officeId]);
    } else {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE role = "SUPERVISOR" AND supervisor_category = ? LIMIT 1');
        $stmt->execute([$department]);
    }
    $id = $stmt->fetchColumn();
    $cache[$key] = $id ? (int) $id : null;
    return $cache[$key];
}

function validate_schedule_assignments(int $semesterId): array
{
    global $pdo;
    $clashes = duty_class_clashes($semesterId);

    $stmt = $pdo->prepare(
        'SELECT a.*, p.student_id, p.first_name, p.last_name, p.sa_category
           FROM schedule_assignments a
           JOIN sa_profiles p ON p.id = a.sa_profile_id
          WHERE a.semester_id = ? AND a.source IN ("MATCHING", "MANUAL", "CHANGE")
          ORDER BY a.sa_profile_id, FIELD(a.day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), a.start_time'
    );
    $stmt->execute([$semesterId]);
    $rows = $stmt->fetchAll();

    $categoryErrors = [];
    $overlapErrors = [];
    $bySaDay = [];

    foreach ($rows as $r) {
        $saCat = $r['sa_category'];
        $dept = $r['department'];
        $name = $r['first_name'] . ' ' . $r['last_name'];
        if ($saCat === 'RELIEVER' && $dept === 'ITO') {
            // Relievers are dedicated to ITO laboratories
        } elseif (!eligible_for(['category' => $saCat], $dept)) {
            $categoryErrors[] = "{$name} ({$saCat}) is assigned to {$dept} ({$r['location']}).";
        }
        $key = $r['sa_profile_id'] . '|' . $r['day_of_week'];
        $s = mins($r['start_time']);
        $e = mins($r['end_time']);
        foreach ($bySaDay[$key] ?? [] as [$prevS, $prevE, $prevLoc]) {
            if (overlaps($s, $e, $prevS, $prevE)) {
                $overlapErrors[] = "{$name} has overlapping duty on {$r['day_of_week']} ({$r['location']} vs {$prevLoc}).";
            }
        }
        $bySaDay[$key][] = [$s, $e, $r['location']];
    }

    return [
        'clashes' => $clashes,
        'categoryErrors' => array_values(array_unique($categoryErrors)),
        'overlapErrors' => array_values(array_unique($overlapErrors)),
        'valid' => empty($clashes) && empty($categoryErrors) && empty($overlapErrors),
    ];
}

function schedule_view(int $semesterId): array
{
    global $pdo;
    $currMode = 'SEMESTER';
    try {
        $mStmt = $pdo->prepare('SELECT duty_schedule_mode FROM semesters WHERE id = ?');
        $mStmt->execute([$semesterId]);
        $currMode = $mStmt->fetchColumn() ?: 'SEMESTER';
    } catch (Throwable $_) {}

    if ($currMode !== 'ENROLLMENT') {
        ensure_assigned_office_schedules($semesterId);
        sync_approved_to_assignments($semesterId);
    }

    $pub = publication($semesterId);
    $minW = min_weekly_hours();
    $capW = hard_weekly_cap();

    $stmt = $pdo->prepare(
        'SELECT a.*, p.student_id, p.sa_number, p.first_name, p.last_name, p.course, p.year_level,
                p.sa_category, p.weekly_target_hours, u.full_name AS supervisor_name
           FROM schedule_assignments a
           JOIN sa_profiles p ON p.id = a.sa_profile_id
           LEFT JOIN users u ON u.id = a.supervisor_id
          WHERE a.semester_id = ? AND a.source IN ("MATCHING", "MANUAL", "ENROLLMENT", "CHANGE", "OFFICE")
            AND p.sa_status = "ACTIVE" AND p.archived_at IS NULL
          ORDER BY FIELD(a.department, "ITO", "ACADS", "OFFICE"), a.location,
                   p.last_name, p.first_name,
                   FIELD(a.day_of_week, "MON","TUE","WED","THU","FRI","SAT","SUN"), a.start_time'
    );
    $stmt->execute([$semesterId]);
    $rows = $stmt->fetchAll();

    $saIds = array_values(array_unique(array_map(fn($r) => (int) $r['sa_profile_id'], $rows)));
    $classesBySa = [];
    if ($saIds) {
        $inIds = implode(',', $saIds);
        $cStmt = $pdo->prepare(
            "SELECT sa_profile_id, day_of_week, start_time, end_time, subject, section
               FROM class_schedules
              WHERE semester_id = ? AND sa_profile_id IN ($inIds) AND archived_at IS NULL
              ORDER BY FIELD(day_of_week,'MON','TUE','WED','THU','FRI','SAT','SUN'), start_time"
        );
        $cStmt->execute([$semesterId]);
        foreach ($cStmt as $cr) {
            $sid = (int) $cr['sa_profile_id'];
            $cs = mins($cr['start_time']);
            $ce = mins($cr['end_time']);
            $classesBySa[$sid][] = [
                'day' => $cr['day_of_week'],
                'start' => $cs,
                'end' => $ce,
                'startLabel' => format_time($cr['start_time']),
                'endLabel' => format_time($cr['end_time']),
                'subject' => $cr['subject'],
                'section' => $cr['section'],
                'hours' => round(($ce - $cs) / 60.0, 1),
            ];
        }
    }

    $bySaRaw = [];
    foreach ($rows as $r) {
        $sid = (int) $r['sa_profile_id'];
        $s = mins($r['start_time']);
        $e = mins($r['end_time']);
        $hours = round(($e - $s) / 60.0, 1);
        $isOffice = ($r['sa_category'] === 'OFFICE' || $r['department'] === 'OFFICE' || $r['requirement_type'] === 'OFFICE');

        if (!isset($bySaRaw[$sid]['meta'])) {
            $bySaRaw[$sid]['meta'] = [
                'saId' => $sid,
                'studentId' => $r['student_id'],
                'saNumber' => $r['sa_number'] ?? null,
                'name' => $r['first_name'] . ' ' . $r['last_name'],
                'course' => $r['course'],
                'yearLevel' => (int) $r['year_level'],
                'category' => $r['sa_category'],
                'department' => $r['department'],
                'requirementType' => $r['requirement_type'],
                'location' => $r['location'],
                'supervisor' => $r['supervisor_name'] ?: 'Coordinator',
                'targetHours' => (float) $r['weekly_target_hours'],
                'isOffice' => $isOffice,
            ];
            $bySaRaw[$sid]['locations'] = [];
        }
        $bySaRaw[$sid]['locations'][$r['location']] = $r['location'];
        $bySaRaw[$sid]['blocks'][] = [
            'id' => (int) $r['id'],
            'saId' => $sid,
            'studentId' => $r['student_id'],
            'saNumber' => $r['sa_number'] ?? null,
            'name' => $r['first_name'] . ' ' . $r['last_name'],
            'course' => $r['course'],
            'yearLevel' => (int) $r['year_level'],
            'category' => $r['sa_category'],
            'department' => $r['department'],
            'requirementType' => $r['requirement_type'],
            'location' => $r['location'],
            'supervisor' => $r['supervisor_name'] ?: 'Coordinator',
            'day' => $r['day_of_week'],
            'start' => $s,
            'end' => $e,
            'startTime' => $r['start_time'],
            'endTime' => $r['end_time'],
            'startLabel' => format_time($r['start_time']),
            'endLabel' => format_time($r['end_time']),
            'rawHours' => $hours,
            'hours' => $hours,
            'credited' => $hours,
            'creditedHours' => $hours,
            'hasBreak' => false,
            'source' => $r['source'],
        ];
    }

    $assignments = [];
    $staff = [];
    $belowMinCount = 0;
    $overCapCount = 0;
    $itoStaffCount = 0;
    $acadsStaffCount = 0;
    $officeStaffCount = 0;

    foreach ($bySaRaw as $sid => $entry) {
        $meta = $entry['meta'];
        $locs = array_values($entry['locations'] ?? [$meta['location']]);
        usort($locs, function ($a, $b) {
            $aRel = stripos($a, 'Reliever') !== false ? 1 : 0;
            $bRel = stripos($b, 'Reliever') !== false ? 1 : 0;
            if ($aRel !== $bRel) return $aRel <=> $bRel;
            return strnatcasecmp($a, $b);
        });
        $meta['location'] = implode(' + ', $locs);
        $creditedBlocks = credit_once_per_day($entry['blocks'], $meta['isOffice']);
        $rawTotal = round(array_sum(array_column($creditedBlocks, 'hours')), 1);
        $credTotal = round(array_sum(array_column($creditedBlocks, 'credited')), 1);

        foreach ($creditedBlocks as $cb) {
            $assignments[] = $cb;
        }

        if ($credTotal < $minW) $belowMinCount++;
        if ($credTotal > $capW) $overCapCount++;

        if ($meta['department'] === 'ITO') $itoStaffCount++;
        elseif ($meta['department'] === 'ACADS') $acadsStaffCount++;
        elseif ($meta['department'] === 'OFFICE') $officeStaffCount++;

        $staff[] = [
            'saId' => $sid,
            'studentId' => $meta['studentId'],
            'saNumber' => $meta['saNumber'] ?? null,
            'name' => $meta['name'],
            'course' => $meta['course'],
            'yearLevel' => $meta['yearLevel'],
            'category' => $meta['category'],
            'department' => $meta['department'],
            'requirementType' => $meta['requirementType'],
            'location' => $meta['location'],
            'supervisor' => $meta['supervisor'],
            'targetHours' => $meta['targetHours'],
            'rawHours' => $rawTotal,
            'creditedHours' => $credTotal,
            'belowMinimum' => $credTotal < $minW,
            'overCap' => $credTotal > $capW,
            'lunchRule' => $meta['isOffice']
                ? 'Mon–Fri 12:00–1:00 PM (-1h); Sat half-day (no deduction)'
                : 'Mon–Sat >= 5.0 daily raw hrs (-1h once/day)',
            'blocks' => $creditedBlocks,
            'classes' => $classesBySa[$sid] ?? [],
        ];
    }

    $validation = validate_schedule_assignments($semesterId);
    $run = matching_result($semesterId);
    $totalRoomSlots = $run ? $run['totalSlots'] : 0;
    $acceptedRoomSlots = $run ? $run['accepted'] : 0;
    $pendingRoomSlots = $run ? $run['pending'] : 0;

    $changesStmt = $pdo->prepare(
        'SELECT sc.*, p.student_id, p.first_name, p.last_name, u.full_name AS changed_by_name
           FROM schedule_changes sc
           JOIN sa_profiles p ON p.id = sc.sa_profile_id
           LEFT JOIN users u ON u.id = sc.changed_by
          WHERE sc.semester_id = ?
          ORDER BY sc.id DESC LIMIT 30'
    );
    $changesStmt->execute([$semesterId]);
    $changes = array_map(fn($c) => [
        'id' => (int) $c['id'],
        'studentId' => $c['student_id'],
        'name' => $c['first_name'] . ' ' . $c['last_name'],
        'changeType' => $c['change_type'],
        'summary' => $c['summary'],
        'reason' => $c['reason'],
        'changedBy' => $c['changed_by_name'] ?: 'Coordinator',
        'createdAt' => $c['created_at'],
    ], $changesStmt->fetchAll());

    $totalCreditedHours = round(array_sum(array_column($staff, 'creditedHours')), 1);

    return [
        'status' => $pub['status'] ?? 'DRAFT',
        'finalizedAt' => $pub['finalized_at'] ?? null,
        'finalizedBy' => $pub['finalized_by_name'] ?? null,
        'publishedAt' => $pub['published_at'] ?? null,
        'publishedBy' => $pub['published_by_name'] ?? null,
        'assignments' => $assignments,
        'staff' => $staff,
        'clashes' => $validation['clashes'],
        'categoryErrors' => $validation['categoryErrors'],
        'overlapErrors' => $validation['overlapErrors'],
        'summary' => [
            'sas' => count($staff),
            'itoSas' => $itoStaffCount,
            'acadsSas' => $acadsStaffCount,
            'officeSas' => $officeStaffCount,
            'blocks' => count($assignments),
            'hours' => $totalCreditedHours,
            'slotsFilled' => count($staff),
            'slotsRequired' => $totalRoomSlots + $officeStaffCount,
            'roomSlotsAccepted' => $acceptedRoomSlots,
            'roomSlotsPending' => $pendingRoomSlots,
            'coverage' => ($totalRoomSlots + $officeStaffCount) > 0
                ? (int) round((count($staff) / ($totalRoomSlots + $officeStaffCount)) * 100)
                : 100,
            'unfilled' => max(0, $totalRoomSlots - $acceptedRoomSlots),
            'provisional' => $belowMinCount,
            'belowMinimum' => $belowMinCount,
            'overCap' => $overCapCount,
            'minWeekly' => $minW,
            'maxWeekly' => $capW,
        ],
        'dutyScheduleMode' => $currMode,
        'changes' => $changes,
    ];
}

function reconcile_cross_department_assignments(int $semesterId, int $actorUserId = 2): void
{
    global $pdo;
    $stmt = $pdo->prepare('
        SELECT a.sa_profile_id, a.department, a.location, p.first_name, p.last_name, p.student_id, p.user_id, p.sa_category, p.supervisor_id
          FROM schedule_assignments a
          JOIN sa_profiles p ON p.id = a.sa_profile_id
         WHERE a.semester_id = ?
           AND a.department COLLATE utf8mb4_unicode_ci != p.sa_category COLLATE utf8mb4_unicode_ci
           AND NOT (p.sa_category = "RELIEVER" AND a.department = "ITO")
    ');
    $stmt->execute([$semesterId]);
    $crossRows = $stmt->fetchAll();
    if (!$crossRows) return;

    $runStmt = $pdo->prepare('SELECT id FROM matching_runs WHERE semester_id = ? ORDER BY (is_active = 1) DESC, id DESC LIMIT 1');
    $runStmt->execute([$semesterId]);
    $runId = (int) $runStmt->fetchColumn();

    foreach ($crossRows as $cx) {
        $saId = (int) $cx['sa_profile_id'];
        $newDept = $cx['department'];
        $oldCat = $cx['sa_category'];
        $saName = trim($cx['first_name'] . ' ' . $cx['last_name']);
        $studentId = $cx['student_id'] ?? '';
        $loc = $cx['location'];
        $newSupId = supervisor_for($newDept, null);
        $oldSupId = supervisor_for($oldCat, null) ?: ($cx['supervisor_id'] ?? null);

        // Pull out conflicting match slots and assignments in old department
        if ($runId) {
            $pdo->prepare('UPDATE match_slots SET assigned_sa_profile_id = NULL, decision = "PENDING" WHERE run_id = ? AND assigned_sa_profile_id = ? AND department != ?')
                ->execute([$runId, $saId, $newDept]);
        }
        $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? AND department != ?')
            ->execute([$semesterId, $saId, $newDept]);

        // Official category transfer
        $pdo->prepare('UPDATE sa_profiles SET sa_category = ?, department_type = ?, supervisor_id = COALESCE(?, supervisor_id), assignment_status = "ASSIGNED" WHERE id = ?')
            ->execute([$newDept, $newDept, $newSupId, $saId]);

        // Send notifications in English
        if (function_exists('create_notification')) {
            if ($oldSupId) {
                create_notification(
                    (int) $oldSupId,
                    "Student Assistant Reassigned: {$saName}",
                    "{$saName} ({$studentId}) has been pulled out from {$oldCat} and officially transferred to {$newDept} ({$loc}) to fulfill room coverage requirements.",
                    'SA_PULLOUT_TRANSFER',
                    '/supervisor/team',
                    $actorUserId
                );
            }
            if ($newSupId && (int)$newSupId !== (int)$oldSupId) {
                create_notification(
                    (int) $newSupId,
                    "New Student Assistant Assigned: {$saName}",
                    "{$saName} ({$studentId}) has been officially transferred to {$newDept} and assigned to {$loc} under your supervision.",
                    'SA_PULLOUT_TRANSFER',
                    '/supervisor/team',
                    $actorUserId
                );
            }
            if (!empty($cx['user_id'])) {
                create_notification(
                    (int) $cx['user_id'],
                    'Department Assignment Updated',
                    "You have been officially reassigned to {$newDept} for {$loc} under Supervisor " . ($newDept === 'ACADS' ? 'Kirk Manalo' : 'Paul Vincent Espiritu') . ".",
                    'SA_PULLOUT_TRANSFER',
                    '/sa/schedule',
                    $actorUserId
                );
            }
        }

        try {
            $pdo->prepare('
                INSERT INTO room_assignment_history
                    (semester_id, room, department, slot_no, role_type, action_type, previous_sa_id, new_sa_id, summary, reason, actor_user_id, created_at)
                VALUES
                    (?, ?, ?, 1, "PRIMARY", "TRANSFER", NULL, ?, ?, ?, ?, NOW())
            ')->execute([
                $semesterId,
                $loc ?: $newDept,
                $newDept,
                $saId,
                "Official Department Transfer: {$saName} ({$oldCat} -> {$newDept})",
                "Automated coverage accommodation: pulled out from {$oldCat} and transferred to {$newDept} for {$loc}.",
                $actorUserId,
            ]);
        } catch (Throwable $_) {}
        audit('SA_CATEGORY_TRANSFER', "Transferred {$saName} (ID {$saId}) from {$oldCat} to {$newDept} for {$loc}", $actorUserId);
    }
}

function finalize_schedule(int $semesterId, int $userId): array
{
    global $pdo;
    ensure_assigned_office_schedules($semesterId);
    sync_approved_to_assignments($semesterId);
    reconcile_cross_department_assignments($semesterId, $userId);

    $validation = validate_schedule_assignments($semesterId);
    if (!empty($validation['clashes'])) {
        fail('Cannot finalize: ' . count($validation['clashes']) . ' duty period(s) overlap with official Registrar class schedules.', 422,
             ['clashes' => $validation['clashes']]);
    }
    if (!empty($validation['categoryErrors'])) {
        fail('Cannot finalize: category mismatch found (' . $validation['categoryErrors'][0] . ').', 422);
    }
    if (!empty($validation['overlapErrors'])) {
        fail('Cannot finalize: overlapping duty blocks found (' . $validation['overlapErrors'][0] . ').', 422);
    }

    $countStmt = $pdo->prepare('SELECT COUNT(*) FROM schedule_assignments WHERE semester_id = ? AND source IN ("MATCHING", "MANUAL", "CHANGE")');
    $countStmt->execute([$semesterId]);
    if ((int) $countStmt->fetchColumn() === 0) {
        fail('No approved room or office duty schedules to finalize yet.', 422);
    }

    $pdo->prepare(
        'INSERT INTO schedule_publications (semester_id, status, finalized_by, finalized_at)
         VALUES (?, "FINALIZED", ?, NOW())
         ON DUPLICATE KEY UPDATE status = "FINALIZED", finalized_by = VALUES(finalized_by), finalized_at = NOW()'
    )->execute([$semesterId, $userId]);

    return schedule_view($semesterId);
}

function publish_schedule(int $semesterId, int $userId): array
{
    global $pdo;
    $pub = publication($semesterId);
    if (($pub['status'] ?? 'DRAFT') === 'DRAFT') {
        finalize_schedule($semesterId, $userId);
    } else {
        ensure_assigned_office_schedules($semesterId);
        sync_approved_to_assignments($semesterId);
    }

    $pdo->prepare(
        'UPDATE schedule_publications
            SET status = "PUBLISHED", published_by = ?, published_at = NOW()
          WHERE semester_id = ?'
    )->execute([$userId, $semesterId]);

    $sched = schedule_view($semesterId);

    // Fetch semester label for notification messages
    $semStmt = $pdo->prepare('SELECT * FROM semesters WHERE id = ? LIMIT 1');
    $semStmt->execute([$semesterId]);
    $semRow = $semStmt->fetch();
    $semLabel = $semRow ? semester_label($semRow) : 'Current Semester';

    $notifiedSas = 0;
    $notifiedSupervisors = 0;

    if (function_exists('create_notification')) {
        // 1. Notify every assigned Student Assistant
        $saUserStmt = $pdo->prepare('SELECT id, user_id, office_id, supervisor_id FROM sa_profiles WHERE id = ? LIMIT 1');
        $saOfficeMap = [];
        $saSupMap = [];

        foreach ($sched['staff'] ?? [] as $st) {
            $sid = (int) ($st['saId'] ?? 0);
            if (!$sid) continue;
            $saUserStmt->execute([$sid]);
            $pRow = $saUserStmt->fetch();
            if (!$pRow) continue;

            $saOfficeMap[$sid] = $pRow['office_id'] ? (int) $pRow['office_id'] : null;
            $saSupMap[$sid] = $pRow['supervisor_id'] ? (int) $pRow['supervisor_id'] : null;

            $saUserId = $pRow['user_id'] ? (int) $pRow['user_id'] : 0;
            if ($saUserId > 0) {
                $pdo->prepare('DELETE FROM notifications WHERE user_id = ? AND type = "SCHEDULE_PUBLISHED" AND is_read = 0')
                    ->execute([$saUserId]);
                create_notification(
                    $saUserId,
                    'Official Duty Schedule Published',
                    "Your official duty schedule for {$semLabel} has been published: {$st['location']} ({$st['creditedHours']} credited hrs/wk). Click to view your schedule.",
                    'SCHEDULE_PUBLISHED',
                    '/sa/schedule',
                    $userId
                );
                $notifiedSas++;
            }
        }

        // 2. Notify every active Supervisor
        $supStmt = $pdo->query(
            'SELECT id, full_name, supervisor_category, office_id
               FROM users
              WHERE role = "SUPERVISOR" AND status IN ("ACTIVE", "PENDING_ACTIVATION")'
        );
        $supervisors = $supStmt->fetchAll();

        $soMap = [];
        $soStmt = $pdo->query('SELECT supervisor_id, office_id FROM supervisor_offices');
        foreach ($soStmt as $soRow) {
            $soMap[(int) $soRow['supervisor_id']][] = (int) $soRow['office_id'];
        }

        foreach ($supervisors as $sup) {
            $supUserId = (int) $sup['id'];
            $supCat = strtoupper((string) ($sup['supervisor_category'] ?? 'OFFICE'));
            $supOffices = $soMap[$supUserId] ?? [];
            if (!empty($sup['office_id'])) {
                $supOffices[] = (int) $sup['office_id'];
            }
            $supOffices = array_values(array_unique($supOffices));

            $teamCount = 0;
            foreach ($sched['staff'] ?? [] as $st) {
                $sid = (int) ($st['saId'] ?? 0);
                $dept = strtoupper((string) ($st['department'] ?? ''));
                $saOfficeId = $saOfficeMap[$sid] ?? null;
                $saSupId = $saSupMap[$sid] ?? null;

                $isMatch = ($saSupId === $supUserId)
                    || ($supCat === 'ITO' && $dept === 'ITO')
                    || ($supCat === 'ACADS' && $dept === 'ACADS')
                    || ($saOfficeId && in_array($saOfficeId, $supOffices, true));
                if ($isMatch) {
                    $teamCount++;
                }
            }

            $pdo->prepare('DELETE FROM notifications WHERE user_id = ? AND type = "SCHEDULE_PUBLISHED" AND is_read = 0')
                ->execute([$supUserId]);
            create_notification(
                $supUserId,
                'Official S.A. Duty Schedule Published',
                "Official S.A. duty schedules for {$semLabel} have been published ({$teamCount} S.A.(s) in your department/office). Click to view your team's schedule.",
                'SCHEDULE_PUBLISHED',
                '/supervisor/team',
                $userId
            );
            $notifiedSupervisors++;
        }
    }

    $sched['notifiedSas'] = $notifiedSas;
    $sched['notifiedSupervisors'] = $notifiedSupervisors;
    return $sched;
}

/**
 * Step 8 (Final Schedule): Allows the S.A. Coordinator to edit a specific Student Assistant's
 * official duty schedule and sends a notification ONLY to that specific Student Assistant
 * and their assigned Supervisor(s).
 */
function final_schedule_save_sa(
    int $semesterId,
    int $saId,
    array $blocksInput,
    string $reason,
    int $userId
): array {
    global $pdo;
    $reason = trim($reason);
    if ($reason === '') {
        fail('Please enter a reason for modifying this Student Assistant schedule.', 422);
    }
    if (empty($blocksInput)) {
        fail('Please provide at least one duty block for this Student Assistant.', 422);
    }

    // Load SA profile
    $saStmt = $pdo->prepare(
        'SELECT p.*, o.name AS office_name
           FROM sa_profiles p
           LEFT JOIN offices o ON o.id = p.office_id
          WHERE p.id = ? AND p.archived_at IS NULL LIMIT 1'
    );
    $saStmt->execute([$saId]);
    $saRow = $saStmt->fetch() ?: fail('Student Assistant not found.', 404);

    $saName = trim($saRow['first_name'] . ' ' . $saRow['last_name']);
    $studentId = $saRow['student_id'];
    $saCat = strtoupper((string) ($saRow['sa_category'] ?? 'OFFICE'));
    $isOffice = ($saCat === 'OFFICE' || $saRow['department_type'] === 'OFFICE');

    // Load existing assignment metadata for this SA to preserve department, location, supervisor_id, etc.
    ensure_assigned_office_schedules($semesterId);
    sync_approved_to_assignments($semesterId);

    $existStmt = $pdo->prepare(
        'SELECT * FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id ASC LIMIT 1'
    );
    $existStmt->execute([$semesterId, $saId]);
    $firstAsg = $existStmt->fetch();

    $defaultDept = $firstAsg['department'] ?? ($isOffice ? 'OFFICE' : $saCat);
    $defaultReqType = $firstAsg['requirement_type'] ?? ($isOffice ? 'OFFICE' : 'ROOM');
    $defaultRoomReqId = $firstAsg && $firstAsg['room_requirement_id'] ? (int) $firstAsg['room_requirement_id'] : null;
    $defaultOfficeReqId = $firstAsg && $firstAsg['office_requirement_id'] ? (int) $firstAsg['office_requirement_id'] : null;
    $defaultLocation = $firstAsg['location'] ?? ($saRow['office_name'] ?: ($defaultDept . ' Duty'));
    $defaultSupId = $firstAsg && $firstAsg['supervisor_id']
        ? (int) $firstAsg['supervisor_id']
        : ($saRow['supervisor_id'] ? (int) $saRow['supervisor_id'] : supervisor_for($defaultDept, $saRow['office_id'] ? (int) $saRow['office_id'] : null));

    // Load official Registrar class schedules for conflict checking
    $cStmt = $pdo->prepare(
        'SELECT day_of_week, start_time, end_time, subject
           FROM class_schedules
          WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NULL'
    );
    $cStmt->execute([$semesterId, $saId]);
    $classesDetailed = [];
    foreach ($cStmt as $cr) {
        $classesDetailed[$cr['day_of_week']][] = [
            'start' => mins($cr['start_time']),
            'end' => mins($cr['end_time']),
            'subject' => $cr['subject'],
            'label' => format_time($cr['start_time']) . ' – ' . format_time($cr['end_time']),
        ];
    }

    $normalizedBlocks = [];
    $byDaySpans = [];

    foreach ($blocksInput as $idx => $b) {
        if (!is_array($b)) continue;
        $day = strtoupper(trim((string) ($b['day'] ?? '')));
        if (!in_array($day, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
            fail('Choose a valid day from Monday to Saturday.', 422);
        }
        $startStr = parse_time((string) ($b['startTime'] ?? ''));
        $endStr = parse_time((string) ($b['endTime'] ?? ''));
        if (!$startStr || !$endStr) {
            fail("Invalid time format on {$day}. Use HH:MM.", 422);
        }
        $s = mins($startStr);
        $e = mins($endStr);
        if ($e <= $s) {
            fail("On {$day}, End Time must be later than Start Time.", 422);
        }
        if ($e - $s < 30) {
            fail("On {$day}, each duty block must be at least 30 minutes.", 422);
        }
        if ($s < 420 || $e > 1320) {
            fail("On {$day}, duty hours must be within 7:00 AM to 10:00 PM.", 422);
        }

        // Check against official Registrar class schedule
        foreach ($classesDetailed[$day] ?? [] as $cls) {
            if (overlaps($s, $e, $cls['start'], $cls['end'])) {
                fail(
                    "Conflict with Official Registrar Class Schedule: Duty on {$day} (" .
                    format_time($startStr) . ' – ' . format_time($endStr) .
                    ") overlaps with {$saName}'s class {$cls['subject']} ({$cls['label']}).",
                    422
                );
            }
        }

        // Check self-overlap on the same day
        foreach ($byDaySpans[$day] ?? [] as [$prevS, $prevE]) {
            if (overlaps($s, $e, $prevS, $prevE)) {
                fail("Overlapping duty blocks on {$day} (" . format_time($startStr) . ' – ' . format_time($endStr) . ').', 422);
            }
        }

        $loc = trim((string) ($b['location'] ?? '')) ?: $defaultLocation;
        $byDaySpans[$day][] = [$s, $e];
        $normalizedBlocks[] = [
            'day' => $day,
            'start' => $s,
            'end' => $e,
            'startTime' => hhmm($s),
            'endTime' => hhmm($e),
            'hours' => round(($e - $s) / 60.0, 1),
            'credited' => round(($e - $s) / 60.0, 1),
            'hasBreak' => false,
            'location' => $loc,
        ];
    }

    if (!$normalizedBlocks) {
        fail('No valid duty blocks provided.', 422);
    }

    $creditedBlocks = credit_once_per_day($normalizedBlocks, $isOffice);
    $credTotal = round(array_sum(array_column($creditedBlocks, 'credited')), 1);
    if ($credTotal > hard_weekly_cap()) {
        fail("{$saName} exceeds the " . hard_weekly_cap() . " credited hrs/wk maximum ({$credTotal} credited hrs).", 422);
    }

    $locationsSet = [];
    foreach ($normalizedBlocks as $nb) {
        $locationsSet[$nb['location']] = $nb['location'];
    }
    $locationSummary = implode(' + ', array_values($locationsSet));

    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND sa_profile_id = ?')
            ->execute([$semesterId, $saId]);

        $ins = $pdo->prepare(
            'INSERT INTO schedule_assignments
                (semester_id, sa_profile_id, requirement_type, room_requirement_id, office_requirement_id,
                 department, location, supervisor_id, day_of_week, start_time, end_time, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "CHANGE")'
        );

        foreach ($normalizedBlocks as $nb) {
            $ins->execute([
                $semesterId,
                $saId,
                $defaultReqType,
                $defaultRoomReqId,
                $defaultOfficeReqId,
                $defaultDept,
                $nb['location'],
                $defaultSupId,
                $nb['day'],
                $nb['startTime'],
                $nb['endTime'],
            ]);
        }

        // Record in schedule_changes if table exists
        try {
            $pdo->prepare(
                'INSERT INTO schedule_changes (semester_id, sa_profile_id, change_type, summary, reason, changed_by)
                 VALUES (?, ?, "ADJUST_HOURS", ?, ?, ?)'
            )->execute([
                $semesterId,
                $saId,
                "Updated final schedule in {$locationSummary} ({$credTotal} credited hrs/wk)",
                $reason,
                $userId,
            ]);
        } catch (Throwable $_) {}

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    // Send targeted notifications ONLY to this specific S.A. and their assigned Supervisor(s)
    $notifiedSupervisorNames = [];
    if (function_exists('create_notification')) {
        $saUserId = $saRow['user_id'] ? (int) $saRow['user_id'] : 0;
        if ($saUserId > 0) {
            create_notification(
                $saUserId,
                'Your Official Duty Schedule Was Updated',
                "In-update ng S.A. Coordinator ang iyong official duty schedule sa {$locationSummary} ({$credTotal} credited hrs/wk). Reason: {$reason}",
                'SCHEDULE_UPDATED',
                '/sa/schedule',
                $userId
            );
        }

        // Find ONLY the Supervisor(s) assigned to this S.A.'s department / office
        $saOfficeId = $saRow['office_id'] ? (int) $saRow['office_id'] : null;
        $saSupId = $defaultSupId ?: ($saRow['supervisor_id'] ? (int) $saRow['supervisor_id'] : null);
        $deptUpper = strtoupper((string) $defaultDept);

        $supStmt = $pdo->query(
            'SELECT id, full_name, supervisor_category, office_id
               FROM users
              WHERE role = "SUPERVISOR" AND status IN ("ACTIVE", "PENDING_ACTIVATION")'
        );
        $allSups = $supStmt->fetchAll();

        $soMap = [];
        $soStmt = $pdo->query('SELECT supervisor_id, office_id FROM supervisor_offices');
        foreach ($soStmt as $soRow) {
            $soMap[(int) $soRow['supervisor_id']][] = (int) $soRow['office_id'];
        }

        foreach ($allSups as $sup) {
            $supUserId = (int) $sup['id'];
            $supCat = strtoupper((string) ($sup['supervisor_category'] ?? 'OFFICE'));
            $supOffices = $soMap[$supUserId] ?? [];
            if (!empty($sup['office_id'])) {
                $supOffices[] = (int) $sup['office_id'];
            }

            $isMatch = ($saSupId === $supUserId)
                || ($supCat === 'ITO' && $deptUpper === 'ITO')
                || ($supCat === 'ACADS' && $deptUpper === 'ACADS')
                || ($saOfficeId && in_array($saOfficeId, $supOffices, true));

            if ($isMatch) {
                create_notification(
                    $supUserId,
                    "S.A. Schedule Updated: {$saName}",
                    "In-update ng S.A. Coordinator ang duty schedule ni {$saName} ({$studentId}) sa {$locationSummary} ({$credTotal} credited hrs/wk). Reason: {$reason}",
                    'SCHEDULE_UPDATED',
                    '/supervisor/team',
                    $userId
                );
                $notifiedSupervisorNames[] = $sup['full_name'];
            }
        }
    }

    $sched = schedule_view($semesterId);
    $sched['notifiedSaName'] = $saName;
    $sched['notifiedSupervisorNames'] = $notifiedSupervisorNames;
    return $sched;
}

// -----------------------------------------------------------------------------
// ROOM ASSIGNMENT BOARD: SINGLE-BATCH APPROVAL, AUTHORIZED REASSIGNMENT & RELIEVERS
// -----------------------------------------------------------------------------

function batch_approve_lock(int $semesterId, int $userId, string $notes = ''): array
{
    global $pdo;
    ensure_matching_board_tables();

    $lockInfo = get_matching_batch_lock_info($semesterId);
    if (!empty($lockInfo['isLocked'])) {
        fail('This matching batch has already been approved and locked. Duplicate batch approvals are prevented.', 409);
    }

    $run = matching_result($semesterId, false);
    if (!$run) {
        fail('Run Initial Matching first before approving the room assignment batch.', 409);
    }

    // Accept all valid recommended room and office slots in the current batch
    post_accept_all($semesterId, $userId, true);
    sync_approved_to_assignments($semesterId);
    reconcile_cross_department_assignments($semesterId, $userId);

    // Validate 0 Registrar class clashes, 0 category mismatches, and 0 duty overlaps before locking
    $validation = validate_schedule_assignments($semesterId);
    if (!empty($validation['clashes'])) {
        fail(
            'Cannot approve batch: ' . count($validation['clashes']) . ' duty period(s) conflict with official Registrar class schedules.',
            422,
            ['clashes' => $validation['clashes']]
        );
    }
    if (!empty($validation['categoryErrors'])) {
        fail('Cannot approve batch: category mismatch found (' . $validation['categoryErrors'][0] . ').', 422);
    }
    if (!empty($validation['overlapErrors'])) {
        fail('Cannot approve batch: overlapping duty blocks found (' . $validation['overlapErrors'][0] . ').', 422);
    }

    $cleanNotes = trim($notes) ?: 'Approved and locked reviewed matching batch for the assignment cycle.';

    $pdo->prepare(
        'UPDATE matching_runs
            SET batch_status = "APPROVED_LOCKED",
                approved_by = ?,
                approved_at = NOW(),
                lock_notes = ?
          WHERE id = ?'
    )->execute([$userId, $cleanNotes, (int) $run['id']]);

    // Clear marked_for_reassignment flags for assigned SAs in the approved batch
    $pdo->exec('UPDATE sa_profiles SET marked_for_reassignment = 0 WHERE assignment_status = "ASSIGNED"');

    // Matching batch is approved and locked. Official publication remains the exclusive responsibility of Step 7 (Finalize Schedule).

    log_room_assignment_history(
        $semesterId,
        'ALL_ROOMS',
        'ALL',
        'BATCH_APPROVE_LOCK',
        'PRIMARY',
        null,
        null,
        'Coordinator approved, published, and locked the Room Assignment Batch (Run #' . $run['id'] . ').',
        $cleanNotes,
        $userId
    );

    return [
        'grid' => room_grid($semesterId),
        'lockInfo' => get_matching_batch_lock_info($semesterId),
        'currentRun' => matching_result($semesterId, false),
        'inputs' => matching_inputs($semesterId),
    ];
}

function authorized_reassign_room_sa(int $semesterId, array $in, int $userId): array
{
    global $pdo;
    ensure_matching_board_tables();

    $room = trim((string) ($in['room'] ?? ''));
    $dropSaId = (int) ($in['dropSaId'] ?? 0);
    $pickSaId = (int) ($in['pickSaId'] ?? 0);
    $slotId = (int) ($in['slotId'] ?? 0);
    $blocks = isset($in['blocks']) && is_array($in['blocks']) ? $in['blocks'] : [];
    $resetToAuto = !empty($in['resetToAuto']);
    $reason = trim((string) ($in['reason'] ?? ''));

    if ($room === '') {
        fail('Room or office name is required.', 422);
    }
    if (mb_strlen($reason) < 5) {
        fail('An official reassignment/exception reason (at least 5 characters) is required to modify assignments.', 422);
    }

    if (!empty($blocks) || $resetToAuto) {
        $targetSaId = $pickSaId ?: $dropSaId;
        if ($targetSaId <= 0) {
            fail('Student Assistant ID is required for duty adjustment.', 422);
        }
        $grid = post_duty_save($semesterId, $room, $slotId, $targetSaId, $blocks, $userId, $resetToAuto, true, $reason);
        try {
            $pdo->prepare(
                'INSERT INTO schedule_changes (semester_id, sa_profile_id, change_type, summary, reason, changed_by)
                 VALUES (?, ?, "ADJUST_HOURS", ?, ?, ?)'
            )->execute([
                $semesterId,
                $targetSaId,
                "Authorized duty schedule exception in {$room}",
                $reason,
                $userId,
            ]);
        } catch (Throwable $_) {}
    } else {
        if ($pickSaId <= 0) {
            fail('Please select a replacement Student Assistant.', 422);
        }
        $grid = post_swap($semesterId, $room, $dropSaId, $pickSaId, $userId, true, $reason);
        try {
            $pdo->prepare(
                'INSERT INTO schedule_changes (semester_id, sa_profile_id, change_type, summary, reason, changed_by)
                 VALUES (?, ?, "REASSIGN", ?, ?, ?)'
            )->execute([
                $semesterId,
                $pickSaId,
                "Authorized room reassignment to {$room}" . ($dropSaId > 0 ? " (replacing SA #{$dropSaId})" : ''),
                $reason,
                $userId,
            ]);
        } catch (Throwable $_) {}
    }

    return [
        'grid' => $grid,
        'lockInfo' => get_matching_batch_lock_info($semesterId),
        'currentRun' => matching_result($semesterId, false),
        'inputs' => matching_inputs($semesterId),
    ];
}

function mark_sa_for_reassignment(int $semesterId, int $saId, bool $marked, string $reason, int $userId): array
{
    global $pdo;
    ensure_matching_board_tables();

    if ($saId <= 0) {
        fail('Student Assistant ID is required.', 422);
    }
    $cleanReason = trim($reason);
    if ($marked && $cleanReason === '') {
        fail('Please provide a reason for marking this S.A. for the reassignment pool.', 422);
    }

    $saStmt = $pdo->prepare('SELECT id, first_name, last_name, student_id, sa_category FROM sa_profiles WHERE id = ? AND archived_at IS NULL LIMIT 1');
    $saStmt->execute([$saId]);
    $saRow = $saStmt->fetch() ?: fail('Student Assistant not found.', 404);
    $saName = $saRow['first_name'] . ' ' . $saRow['last_name'];

    $pdo->prepare(
        'UPDATE sa_profiles
            SET marked_for_reassignment = ?,
                reassignment_reason = ?,
                reassignment_marked_at = ?
          WHERE id = ?'
    )->execute([
        $marked ? 1 : 0,
        $marked ? $cleanReason : null,
        $marked ? date('Y-m-d H:i:s') : null,
        $saId,
    ]);

    log_room_assignment_history(
        $semesterId,
        'REASSIGNMENT_POOL',
        (string) ($saRow['sa_category'] ?? 'ALL'),
        $marked ? 'MARK_FOR_REASSIGNMENT' : 'CLEAR_REASSIGNMENT_FLAG',
        'PRIMARY',
        $saId,
        $saId,
        $marked
            ? "Marked {$saName} ({$saRow['student_id']}) for reassignment pool."
            : "Cleared reassignment pool flag for {$saName} ({$saRow['student_id']}).",
        $cleanReason ?: null,
        $userId
    );

    return [
        'inputs' => matching_inputs($semesterId),
        'grid' => room_grid($semesterId),
        'lockInfo' => get_matching_batch_lock_info($semesterId),
    ];
}

function relief_coverage_candidates(
    int $semesterId,
    string $room,
    string $coverageDate,
    string $startTime,
    string $endTime,
    ?int $primarySaId = null
): array {
    global $pdo;
    ensure_matching_board_tables();

    $room = trim($room);
    if ($room === '') fail('Room is required.', 422);

    $ts = strtotime($coverageDate);
    if (!$ts) fail('Valid coverage date (YYYY-MM-DD) is required.', 422);
    $coverageDateNorm = date('Y-m-d', $ts);
    $dayOfWeek = strtoupper(date('D', $ts));
    if (!in_array($dayOfWeek, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
        fail('Reliever coverage is only applicable from Monday to Saturday.', 422);
    }

    $startStr = parse_time($startTime);
    $endStr = parse_time($endTime);
    if (!$startStr || !$endStr) {
        fail('Valid start and end times (HH:MM) are required.', 422);
    }
    $s = mins($startStr);
    $e = mins($endStr);
    if ($e <= $s || ($e - $s) < 30) {
        fail('Coverage period must be at least 30 minutes and End Time must be after Start Time.', 422);
    }

    // Determine room department
    $dept = 'ITO';
    $off = find_office_post($semesterId, $room);
    if ($off) {
        $dept = 'OFFICE';
    } else {
        foreach (build_room_posts($semesterId) as $rp) {
            if (strcasecmp($rp['room'], $room) === 0) {
                $dept = $rp['department'];
                break;
            }
        }
    }

    // Check if an active reliever coverage already exists for this room, date, and overlapping window
    $dupStmt = $pdo->prepare(
        'SELECT id, start_time, end_time, reliever_sa_id
           FROM room_relief_coverages
          WHERE semester_id = ? AND room = ? AND coverage_date = ? AND status = "ACTIVE"'
    );
    $dupStmt->execute([$semesterId, $room, $coverageDateNorm]);
    $conflictingCoverages = [];
    foreach ($dupStmt->fetchAll() as $dup) {
        if (overlaps($s, $e, mins($dup['start_time']), mins($dup['end_time']))) {
            $conflictingCoverages[] = format_time($dup['start_time']) . ' – ' . format_time($dup['end_time']);
        }
    }
    if (!empty($conflictingCoverages)) {
        return [
            'room' => $room,
            'department' => $dept,
            'coverageDate' => $coverageDateNorm,
            'dayOfWeek' => $dayOfWeek,
            'startTime' => substr($startStr, 0, 5),
            'endTime' => substr($endStr, 0, 5),
            'startLabel' => format_time($startStr),
            'endLabel' => format_time($endStr),
            'hours' => round(($e - $s) / 60.0, 1),
            'qualified' => [],
            'unavailable' => [],
            'hasQualifiedReliever' => false,
            'existingActiveCoverage' => true,
            'warning' => "An active Reliever coverage already exists for {$room} on {$coverageDateNorm} during that time window (" . implode(', ', $conflictingCoverages) . ').',
        ];
    }

    $pool = matching_pool($semesterId, false);

    // Find SAs already assigned as Primary to this room so they aren't suggested as their own Reliever
    $roomPrimaryIds = [];
    if ($primarySaId) $roomPrimaryIds[$primarySaId] = true;
    $grid = room_grid($semesterId);
    $allPrimarySaRooms = []; // saId => roomName
    if ($grid && !empty($grid['posts'])) {
        foreach ($grid['posts'] as $gp) {
            if (strcasecmp($gp['room'], $room) === 0) {
                foreach ($gp['primarySas'] ?? [] as $ps) {
                    $roomPrimaryIds[(int) $ps['saId']] = true;
                }
            }
            // S.A.s already assigned as Primary in ANY room cannot be relievers
            // "bawal mag double kase di nmn nila kayang hatiin sarili nila"
            foreach ($gp['primarySas'] ?? [] as $ps) {
                $allPrimarySaRooms[(int) $ps['saId']] = $gp['room'];
            }
        }
    }

    // Load all regular duty assignments on $dayOfWeek (both schedule_assignments and current run match_slots)
    $regularDutiesBySa = [];
    $asgStmt = $pdo->prepare(
        'SELECT sa_profile_id, location, start_time, end_time
           FROM schedule_assignments
          WHERE semester_id = ? AND day_of_week = ? AND source IN ("MATCHING", "MANUAL", "CHANGE")'
    );
    $asgStmt->execute([$semesterId, $dayOfWeek]);
    foreach ($asgStmt->fetchAll() as $ar) {
        $regularDutiesBySa[(int) $ar['sa_profile_id']][] = [
            'start' => mins($ar['start_time']),
            'end' => mins($ar['end_time']),
            'location' => $ar['location'],
        ];
    }

    $run = matching_result($semesterId, false);
    $relieverInOtherRooms = []; // saId => roomName
    if ($run && !empty($run['slots'])) {
        foreach ($run['slots'] as $sl) {
            if (($sl['status'] ?? '') !== 'RECOMMENDED' || empty($sl['recommended'])) continue;
            $sid = (int) $sl['recommended']['saId'];
            foreach ($sl['recommended']['pattern'] ?? [] as $sp) {
                if (!is_array($sp) || count($sp) < 3 || $sp[0] !== $dayOfWeek) continue;
                $regularDutiesBySa[$sid][] = [
                    'start' => (int) $sp[1],
                    'end' => (int) $sp[2],
                    'location' => $sl['room'],
                ];
            }

            // Relievers already assigned/claimed in ANOTHER room cannot be assigned here
            // "dapat pag nakuha na sya as reliver sa ibang room dapat di na sya mag papakita pa."
            $isRelSlot = !empty($sl['isReliever']) || (int)($sl['slotNo'] ?? 0) >= 10 || str_contains((string)($sl['label'] ?? ''), 'Reliever');
            if ($isRelSlot) {
                $slRoom = (string)($sl['room'] ?: $sl['label']);
                if (strcasecmp($slRoom, $room) !== 0) {
                    $relieverInOtherRooms[$sid] = $slRoom;
                }
            }
        }
    }

    // Also check active temporary relief coverages in other rooms
    $activeReliefStmt = $pdo->prepare(
        'SELECT reliever_sa_id, room
           FROM room_relief_coverages
          WHERE semester_id = ? AND status = "ACTIVE" AND room <> ?'
    );
    $activeReliefStmt->execute([$semesterId, $room]);
    foreach ($activeReliefStmt->fetchAll() as $arr) {
        $relieverInOtherRooms[(int) $arr['reliever_sa_id']] = $arr['room'];
    }

    // Also check schedule_assignments for reliever assignments
    $relAsgStmt = $pdo->prepare(
        'SELECT sa_profile_id, location
           FROM schedule_assignments
          WHERE semester_id = ? AND source IN ("RELIEVER", "RELIEF") AND location <> ?'
    );
    $relAsgStmt->execute([$semesterId, $room]);
    foreach ($relAsgStmt->fetchAll() as $rar) {
        $relieverInOtherRooms[(int) $rar['sa_profile_id']] = $rar['location'];
    }

    // Load active temporary relief coverages on the same date
    $reliefDutiesBySa = [];
    $relStmt = $pdo->prepare(
        'SELECT reliever_sa_id, room, start_time, end_time
           FROM room_relief_coverages
          WHERE semester_id = ? AND coverage_date = ? AND status = "ACTIVE"'
    );
    $relStmt->execute([$semesterId, $coverageDateNorm]);
    foreach ($relStmt->fetchAll() as $rr) {
        $reliefDutiesBySa[(int) $rr['reliever_sa_id']][] = [
            'start' => mins($rr['start_time']),
            'end' => mins($rr['end_time']),
            'location' => $rr['room'] . ' (Relief)',
        ];
    }

    // Load detailed class schedules on $dayOfWeek for conflict messages
    $cStmt = $pdo->prepare(
        'SELECT sa_profile_id, start_time, end_time, subject
           FROM class_schedules
          WHERE semester_id = ? AND day_of_week = ? AND archived_at IS NULL'
    );
    $cStmt->execute([$semesterId, $dayOfWeek]);
    $classesBySa = [];
    foreach ($cStmt->fetchAll() as $cr) {
        $classesBySa[(int) $cr['sa_profile_id']][] = [
            'start' => mins($cr['start_time']),
            'end' => mins($cr['end_time']),
            'subject' => $cr['subject'],
            'label' => format_time($cr['start_time']) . ' – ' . format_time($cr['end_time']),
        ];
    }

    $qualified = [];
    $unavailable = [];

    foreach ($pool as $sid => $sa) {
        if (isset($roomPrimaryIds[$sid])) continue;

        $passed = [];
        $failed = [];

        // Check if S.A. is already taken as a Primary in any room
        if (isset($allPrimarySaRooms[$sid])) {
            $failed[] = "Already assigned as Primary S.A. for Room {$allPrimarySaRooms[$sid]}";
        }

        // Check if S.A. is already taken as a Reliever in another room
        // "dapat pag nakuha na sya as reliver sa ibang room dapat di na sya mag papakita pa."
        if (isset($relieverInOtherRooms[$sid])) {
            $failed[] = "Already assigned as Reliever for Room {$relieverInOtherRooms[$sid]}";
        }

        // 1. Category / Department Eligibility
        if (eligible_for($sa, $dept)) {
            $passed[] = "Department eligible ({$sa['category']} -> {$dept})";
        } else {
            $failed[] = "Ineligible category ({$sa['category']} cannot cover {$dept})";
        }

        // 2. Official Registrar Class Schedule Conflict Check
        $classConflicts = [];
        foreach ($classesBySa[$sid] ?? [] as $cls) {
            if (overlaps($s, $e, $cls['start'], $cls['end'])) {
                $classConflicts[] = "{$cls['subject']} ({$cls['label']})";
            }
        }
        if (empty($classConflicts)) {
            $passed[] = "No Registrar class conflict on {$dayOfWeek}";
        } else {
            $failed[] = 'Class conflict: ' . implode(', ', $classConflicts);
        }

        // 3. Availability Check
        $freeSpans = subtract_spans([[mins('08:00'), mins('21:00')]], $sa['classes'][$dayOfWeek] ?? []);
        $isAvailWindow = false;
        foreach ($freeSpans as [$fs, $fe]) {
            if ($fs <= $s && $fe >= $e) {
                $isAvailWindow = true;
                break;
            }
        }
        if ($isAvailWindow) {
            $passed[] = "Available on {$dayOfWeek} (" . format_time($startStr) . ' – ' . format_time($endStr) . ')';
        } else {
            $failed[] = "Outside submitted/conflict-free availability window on {$dayOfWeek}";
        }

        // 4. Overlapping Regular Duty Check
        $dutyConflicts = [];
        foreach ($regularDutiesBySa[$sid] ?? [] as $rd) {
            if (overlaps($s, $e, $rd['start'], $rd['end'])) {
                $dutyConflicts[] = "{$rd['location']} (" . format_time(hhmm($rd['start'])) . '–' . format_time(hhmm($rd['end'])) . ')';
            }
        }
        foreach ($reliefDutiesBySa[$sid] ?? [] as $rld) {
            if (overlaps($s, $e, $rld['start'], $rld['end'])) {
                $dutyConflicts[] = "{$rld['location']} (" . format_time(hhmm($rld['start'])) . '–' . format_time(hhmm($rld['end'])) . ')';
            }
        }
        $dutyConflicts = array_values(array_unique($dutyConflicts));
        if (empty($dutyConflicts)) {
            $passed[] = 'Zero overlapping room/office/relief duties';
        } else {
            $failed[] = 'Overlapping duty: ' . implode(', ', $dutyConflicts);
        }

        $item = [
            'saId' => $sid,
            'studentId' => $sa['studentId'],
            'name' => $sa['name'],
            'course' => $sa['course'],
            'yearLevel' => $sa['yearLevel'],
            'category' => $sa['category'],
            'skills' => $sa['skills'] ?? [],
            'passedChecks' => $passed,
            'failedChecks' => $failed,
            'isQualified' => empty($failed),
            'roleBadge' => 'RELIEVER',
        ];

        if (empty($failed)) {
            $qualified[] = $item;
        } else {
            $unavailable[] = $item;
        }
    }

    return [
        'room' => $room,
        'department' => $dept,
        'coverageDate' => $coverageDateNorm,
        'dayOfWeek' => $dayOfWeek,
        'startTime' => substr($startStr, 0, 5),
        'endTime' => substr($endStr, 0, 5),
        'startLabel' => format_time($startStr),
        'endLabel' => format_time($endStr),
        'hours' => round(($e - $s) / 60.0, 1),
        'qualified' => $qualified,
        'unavailable' => array_slice($unavailable, 0, 20),
        'hasQualifiedReliever' => !empty($qualified),
        'warning' => empty($qualified)
            ? "Reliever Needed / Uncovered Warning: No qualified {$dept} S.A. is available and conflict-free on {$dayOfWeek} ({$coverageDateNorm}, " . format_time($startStr) . ' – ' . format_time($endStr) . '). Do not assign an unsuitable S.A.'
            : null,
    ];
}

function relief_coverage_save(int $semesterId, array $in, int $userId): array
{
    global $pdo;
    ensure_matching_board_tables();

    $room = trim((string) ($in['room'] ?? ''));
    $relieverSaId = (int) ($in['relieverSaId'] ?? 0);
    $primarySaId = !empty($in['primarySaId']) ? (int) $in['primarySaId'] : null;
    $coverageDate = trim((string) ($in['coverageDate'] ?? ''));
    $startTime = trim((string) ($in['startTime'] ?? ''));
    $endTime = trim((string) ($in['endTime'] ?? ''));
    $reason = trim((string) ($in['reason'] ?? ''));
    $outcome = trim((string) ($in['outcome'] ?? '')) ?: 'Reliever coverage confirmed by S.A. Coordinator; Primary S.A. permanent assignment preserved.';

    if ($room === '' || $relieverSaId <= 0 || $coverageDate === '' || $startTime === '' || $endTime === '') {
        fail('Room, Reliever S.A., coverage date, start time, and end time are required.', 422);
    }
    if (mb_strlen($reason) < 3) {
        fail('Please provide a reason for the Reliever coverage (e.g., Primary S.A. exam, sick leave, official business).', 422);
    }

    // Re-verify candidate eligibility, availability, class conflicts, and duty overlaps on backend
    $candCheck = relief_coverage_candidates($semesterId, $room, $coverageDate, $startTime, $endTime, $primarySaId);
    if (!empty($candCheck['existingActiveCoverage'])) {
        fail($candCheck['warning'] ?? "An active Reliever coverage already exists for {$room} on {$coverageDate} during that time window.", 409);
    }
    $matchedQual = null;
    foreach ($candCheck['qualified'] as $q) {
        if ((int) $q['saId'] === $relieverSaId) {
            $matchedQual = $q;
            break;
        }
    }
    if (!$matchedQual) {
        $failReasons = 'Candidate is not qualified or has a conflict.';
        foreach ($candCheck['unavailable'] as $u) {
            if ((int) $u['saId'] === $relieverSaId) {
                $failReasons = implode('; ', $u['failedChecks']);
                break;
            }
        }
        fail("Cannot confirm Reliever S.A.: {$failReasons}", 422);
    }

    $startNorm = parse_time($startTime);
    $endNorm = parse_time($endTime);
    $sMin = mins($startNorm);
    $eMin = mins($endNorm);

    // Prevent duplicate active relief coverage on the same room, date, and overlapping window
    $dupStmt = $pdo->prepare(
        'SELECT id, start_time, end_time FROM room_relief_coverages
          WHERE semester_id = ? AND room = ? AND coverage_date = ? AND status = "ACTIVE"'
    );
    $dupStmt->execute([$semesterId, $room, $candCheck['coverageDate']]);
    foreach ($dupStmt->fetchAll() as $dup) {
        if (overlaps($sMin, $eMin, mins($dup['start_time']), mins($dup['end_time']))) {
            fail("An active Reliever coverage already exists for {$room} on {$candCheck['coverageDate']} during that time window.", 409);
        }
    }

    $pdo->prepare(
        'INSERT INTO room_relief_coverages
            (semester_id, room, department, primary_sa_id, reliever_sa_id,
             coverage_date, day_of_week, start_time, end_time, reason, status, outcome, confirmed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "ACTIVE", ?, ?)'
    )->execute([
        $semesterId,
        $room,
        $candCheck['department'],
        $primarySaId ?: null,
        $relieverSaId,
        $candCheck['coverageDate'],
        $candCheck['dayOfWeek'],
        $startNorm,
        $endNorm,
        $reason,
        $outcome,
        $userId,
    ]);

    log_room_assignment_history(
        $semesterId,
        $room,
        $candCheck['department'],
        'RELIEF_ASSIGN',
        'RELIEVER',
        $primarySaId ?: null,
        $relieverSaId,
        "Assigned Reliever {$matchedQual['name']} ({$matchedQual['studentId']}) for {$room} on {$candCheck['coverageDate']} ({$candCheck['startLabel']} – {$candCheck['endLabel']}). Primary assignment remains unchanged.",
        $reason,
        $userId
    );

    return [
        'grid' => room_grid($semesterId),
        'details' => room_board_details($semesterId, $room),
    ];
}

function relief_coverage_update_status(
    int $semesterId,
    int $coverageId,
    string $status,
    string $outcome,
    int $userId
): array {
    global $pdo;
    ensure_matching_board_tables();

    $status = strtoupper(trim($status));
    if (!in_array($status, ['COMPLETED', 'CANCELLED', 'ACTIVE'], true)) {
        fail('Invalid relief coverage status.', 422);
    }

    $stmt = $pdo->prepare('SELECT * FROM room_relief_coverages WHERE id = ? AND semester_id = ? LIMIT 1');
    $stmt->execute([$coverageId, $semesterId]);
    $row = $stmt->fetch() ?: fail('Reliever coverage record not found.', 404);

    $cleanOutcome = trim($outcome) ?: (
        $status === 'COMPLETED'
            ? 'Reliever coverage completed; original Primary S.A. room assignment remains unchanged.'
            : ($status === 'CANCELLED' ? 'Reliever coverage cancelled by Coordinator.' : $row['outcome'])
    );

    $pdo->prepare(
        'UPDATE room_relief_coverages
            SET status = ?,
                outcome = ?,
                completed_at = ?
          WHERE id = ?'
    )->execute([
        $status,
        $cleanOutcome,
        in_array($status, ['COMPLETED', 'CANCELLED'], true) ? date('Y-m-d H:i:s') : null,
        $coverageId,
    ]);

    log_room_assignment_history(
        $semesterId,
        $row['room'],
        $row['department'],
        'RELIEF_' . $status,
        'RELIEVER',
        $row['primary_sa_id'] ? (int) $row['primary_sa_id'] : null,
        (int) $row['reliever_sa_id'],
        "Reliever coverage #{$coverageId} marked {$status} for {$row['room']} ({$row['coverage_date']}). Original Primary S.A. assignment unchanged.",
        $cleanOutcome,
        $userId
    );

    return [
        'grid' => room_grid($semesterId),
        'details' => room_board_details($semesterId, $row['room']),
    ];
}

function room_board_details(int $semesterId, string $room): array
{
    ensure_matching_board_tables();
    $room = trim($room);
    $grid = room_grid($semesterId);
    if ($grid && !empty($grid['posts'])) {
        foreach ($grid['posts'] as $post) {
            if (strcasecmp($post['room'], $room) === 0 || strcasecmp($post['key'], $room) === 0) {
                return $post;
            }
        }
    }

    // Fallback when initial matching has not yet been run for this semester
    foreach (build_room_posts($semesterId) as $meta) {
        if (strcasecmp($meta['room'], $room) === 0) {
            return [
                'key' => $meta['department'] . '|' . $meta['room'],
                'room' => $meta['room'],
                'roomId' => $meta['roomId'],
                'building' => $meta['building'],
                'roomType' => $meta['roomType'],
                'department' => $meta['department'],
                'requiredSa' => (int) $meta['requiredSa'],
                'assignedCount' => 0,
                'relieverCount' => 0,
                'missingSaCount' => (int) $meta['requiredSa'],
                'accepted' => false,
                'status' => 'GAP',
                'approvalStatus' => 'AWAITING_APPROVAL',
                'approvalLabel' => 'Awaiting Initial Match',
                'coverageStatus' => 'UNCOVERED',
                'coverageLabel' => 'Uncovered',
                'primarySas' => [],
                'relieverSas' => [],
                'tempReliefCoverages' => [],
                'activeReliefCoverages' => [],
                'assignmentHistory' => [],
                'suitability' => [
                    'status' => 'UNCOVERED',
                    'label' => 'Awaiting Initial Matching',
                    'score' => 0,
                    'passedChecks' => [],
                    'warnings' => ['Run Initial Matching to generate Primary and Reliever S.A. assignments.'],
                ],
                'matchingCriteria' => [
                    'department' => $meta['department'],
                    'roomType' => $meta['roomType'],
                    'requiredPrimarySa' => (int) $meta['requiredSa'],
                    'eligibleCategories' => [$meta['department']],
                    'minWeeklyHours' => min_weekly_hours(),
                    'maxWeeklyHours' => hard_weekly_cap(),
                    'conflictRule' => 'Zero overlap with official Registrar class schedule & existing room/office duties',
                    'relieverPolicy' => 'Primary S.A. owns the official assignment; Reliever S.A. is backup coverage only.',
                ],
            ];
        }
    }

    fail('Room or office not found.', 404);
}

/**
 * Applies fixed 8:00 AM - 5:00 PM duty schedule for all active S.A.s during Enrollment Period.
 * Backs up current schedule_assignments into schedule_assignments_backup before applying.
 */
function apply_enrollment_schedule(int $semesterId, int $userId): array
{
    global $pdo;

    try {
        $pdo->exec("ALTER TABLE semesters ADD COLUMN duty_schedule_mode VARCHAR(20) NOT NULL DEFAULT 'SEMESTER'");
    } catch (Throwable $_) {}
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS schedule_assignments_backup LIKE schedule_assignments");
    } catch (Throwable $_) {}

    $pdo->beginTransaction();
    try {
        $currMode = $pdo->prepare('SELECT duty_schedule_mode FROM semesters WHERE id = ?');
        $currMode->execute([$semesterId]);
        $modeVal = $currMode->fetchColumn() ?: 'SEMESTER';

        if ($modeVal !== 'ENROLLMENT') {
            $pdo->prepare('DELETE FROM schedule_assignments_backup WHERE semester_id = ?')->execute([$semesterId]);
            $pdo->prepare('INSERT INTO schedule_assignments_backup SELECT * FROM schedule_assignments WHERE semester_id = ?')->execute([$semesterId]);
        }

        $pdo->prepare("UPDATE semesters SET duty_schedule_mode = 'ENROLLMENT' WHERE id = ?")->execute([$semesterId]);
        $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ?')->execute([$semesterId]);

        $saStmt = $pdo->prepare('
            SELECT p.id, p.student_id, p.first_name, p.last_name, p.sa_category, p.department_type,
                   p.office_id, p.supervisor_id, o.name AS office_name
              FROM sa_profiles p
              LEFT JOIN offices o ON o.id = p.office_id
             WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL
             ORDER BY p.last_name, p.first_name
        ');
        $saStmt->execute();
        $sas = $saStmt->fetchAll(PDO::FETCH_ASSOC);

        $ins = $pdo->prepare('
            INSERT INTO schedule_assignments
                (semester_id, sa_profile_id, requirement_type, department, location, supervisor_id, day_of_week, start_time, end_time, source)
            VALUES
                (?, ?, "ENROLLMENT", ?, ?, ?, ?, ?, ?, "ENROLLMENT")
        ');

        $days = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
        $countAssigned = 0;

        foreach ($sas as $sa) {
            $saId = (int) $sa['id'];
            $cat = strtoupper($sa['sa_category'] ?: ($sa['department_type'] ?: 'OFFICE'));
            if ($cat === 'OFFICE' && !empty($sa['office_id'])) {
                // Office S.A. stays in their office
                $dept = 'OFFICE';
                $loc = $sa['office_name'] ?: 'Office Department';
            } else {
                // ITO or ACADS: no room or lab during enrollment!
                $dept = in_array($cat, ['ITO', 'ACADS'], true) ? $cat : 'OFFICE';
                $loc = 'Enrollment Support (No Room/Lab Assignment)';
            }
            $supId = $sa['supervisor_id'] ? (int) $sa['supervisor_id'] : null;

            if (!$supId) {
                $supFallback = $pdo->prepare('SELECT id FROM users WHERE role = "SUPERVISOR" AND status = "ACTIVE" LIMIT 1');
                $supFallback->execute();
                $supId = (int) $supFallback->fetchColumn() ?: null;
            }

            foreach ($days as $day) {
                // Morning shift: 08:00 AM - 12:00 PM (4 hrs)
                $ins->execute([$semesterId, $saId, $dept, $loc, $supId, $day, '08:00:00', '12:00:00']);
                // Afternoon shift: 01:00 PM - 05:00 PM (4 hrs) -> 8-5 with 1 hr lunch break
                $ins->execute([$semesterId, $saId, $dept, $loc, $supId, $day, '13:00:00', '17:00:00']);
            }
            // Saturday half day: 08:00 AM - 12:00 PM (4 hrs)
            $ins->execute([$semesterId, $saId, $dept, $loc, $supId, 'SAT', '08:00:00', '12:00:00']);
            $countAssigned++;
        }

        // Send targeted notifications to all Active S.A.s
        $saUsersStmt = $pdo->prepare('
            SELECT p.id, p.user_id, p.first_name, p.sa_category, o.name AS office_name
              FROM sa_profiles p
              LEFT JOIN offices o ON o.id = p.office_id
             WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL AND p.user_id IS NOT NULL
        ');
        $saUsersStmt->execute();
        foreach ($saUsersStmt->fetchAll(PDO::FETCH_ASSOC) as $su) {
            $uId = (int) $su['user_id'];
            $cat = strtoupper($su['sa_category'] ?: 'OFFICE');
            if ($cat === 'OFFICE' && !empty($su['office_name'])) {
                $msg = "Enrollment Schedule (8:00 AM – 5:00 PM) has been activated. You will remain assigned to your office ({$su['office_name']}) and observe the 8:00 AM – 5:00 PM duty schedule during the enrollment period.";
            } else {
                $msg = "Enrollment Schedule (8:00 AM – 5:00 PM) has been activated. As academic classes have concluded, {$cat} S.A.s will transition to 8:00 AM – 5:00 PM enrollment duty assistance.";
            }
            create_notification(
                $uId,
                'Enrollment Schedule Activated (8:00 AM – 5:00 PM)',
                $msg,
                'SCHEDULE_CHANGE',
                '#/sa/schedule',
                $userId
            );
        }

        // Send targeted notifications to all Active Supervisors
        $supStmt = $pdo->query('SELECT id, full_name FROM users WHERE role = "SUPERVISOR" AND status = "ACTIVE"');
        foreach ($supStmt->fetchAll(PDO::FETCH_ASSOC) as $sup) {
            create_notification(
                (int) $sup['id'],
                'System Mode: Enrollment Schedule (8:00 AM – 5:00 PM)',
                'The system has transitioned to Enrollment Schedule (8:00 AM – 5:00 PM duty). Office S.A.s remain at their designated offices, while ITO and ACADS S.A.s assist with enrollment operations as regular classes have concluded.',
                'SCHEDULE_CHANGE',
                '#/supervisor/team',
                $userId
            );
        }

        $pdo->commit();
        audit('ENROLLMENT_SCHEDULE_APPLIED', "Applied 8:00 AM - 5:00 PM Enrollment duty schedule for {$countAssigned} S.A.s.");
        return [
            'success' => true,
            'dutyScheduleMode' => 'ENROLLMENT',
            'assignedCount' => $countAssigned,
            'message' => "Enrollment duty schedule (8:00 AM – 5:00 PM) successfully applied for {$countAssigned} Student Assistant(s)."
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log("apply_enrollment_schedule failed: " . $e->getMessage());
        fail('Could not apply Enrollment schedule: ' . $e->getMessage(), 500);
    }
}

/**
 * Resets duty schedule from Enrollment back to the regular class-matched semester schedule.
 */
function reset_semester_schedule(int $semesterId, int $userId): array
{
    global $pdo;

    try {
        $pdo->exec("ALTER TABLE semesters ADD COLUMN duty_schedule_mode VARCHAR(20) NOT NULL DEFAULT 'SEMESTER'");
    } catch (Throwable $_) {}

    $pdo->beginTransaction();
    try {
        $pdo->prepare("UPDATE semesters SET duty_schedule_mode = 'SEMESTER' WHERE id = ?")->execute([$semesterId]);

        $hasBackup = false;
        try {
            $cnt = $pdo->prepare('SELECT COUNT(*) FROM schedule_assignments_backup WHERE semester_id = ?');
            $cnt->execute([$semesterId]);
            $hasBackup = ((int) $cnt->fetchColumn()) > 0;
        } catch (Throwable $_) {}

        if ($hasBackup) {
            $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ?')->execute([$semesterId]);
            $pdo->prepare('INSERT INTO schedule_assignments SELECT * FROM schedule_assignments_backup WHERE semester_id = ?')->execute([$semesterId]);
            $pdo->prepare('DELETE FROM schedule_assignments_backup WHERE semester_id = ?')->execute([$semesterId]);
        } else {
            $pdo->prepare('DELETE FROM schedule_assignments WHERE semester_id = ? AND (source = "ENROLLMENT" OR requirement_type = "ENROLLMENT")')->execute([$semesterId]);
            ensure_assigned_office_schedules($semesterId);
            sync_approved_to_assignments($semesterId);
        }

        // Send targeted notifications to all Active S.A.s
        $saUsersStmt = $pdo->query('
            SELECT p.id, p.user_id
              FROM sa_profiles p
             WHERE p.sa_status = "ACTIVE" AND p.archived_at IS NULL AND p.user_id IS NOT NULL
        ');
        foreach ($saUsersStmt->fetchAll(PDO::FETCH_ASSOC) as $su) {
            create_notification(
                (int) $su['user_id'],
                'Regular Semester Schedule Restored',
                'The system has returned to the Regular Semester Schedule. Please follow your original class-matched room, lab, or office duty schedule.',
                'SCHEDULE_CHANGE',
                '#/sa/schedule',
                $userId
            );
        }

        // Send targeted notifications to all Active Supervisors
        $supStmt = $pdo->query('SELECT id FROM users WHERE role = "SUPERVISOR" AND status = "ACTIVE"');
        foreach ($supStmt->fetchAll(PDO::FETCH_ASSOC) as $sup) {
            create_notification(
                (int) $sup['id'],
                'Regular Semester Schedule Restored',
                'The system has returned to the Regular Semester Schedule for all S.A.s with their original class-matched duties.',
                'SCHEDULE_CHANGE',
                '#/supervisor/team',
                $userId
            );
        }

        $pdo->commit();
        audit('SEMESTER_SCHEDULE_RESET', "Reset duty schedule to regular class-matched semester schedule.");

        $cntAfter = $pdo->prepare('SELECT COUNT(DISTINCT sa_profile_id) FROM schedule_assignments WHERE semester_id = ?');
        $cntAfter->execute([$semesterId]);
        $restoredCount = (int) $cntAfter->fetchColumn();

        return [
            'success' => true,
            'dutyScheduleMode' => 'SEMESTER',
            'restoredCount' => $restoredCount,
            'message' => "Schedule successfully reset to the Regular Semester class-matched schedule ({$restoredCount} S.A.s)."
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log("reset_semester_schedule failed: " . $e->getMessage());
        fail('Could not reset to Regular Semester schedule: ' . $e->getMessage(), 500);
    }
}

