<?php
// S.A. Management API (all requests: POST + CSRF token)
//   options         ADMIN  dropdown data for the form
//   list            ADMIN  all S.A.s (table columns only)
//   get {id}        ADMIN  one S.A., full profile
//   create {...}    ADMIN  register S.A. + create login account (temporary password)
//   update {id,...} ADMIN  edit S.A. (keeps the account in sync)
//   reset_password  ADMIN  issue a new temporary password
//   archive {id,reason} / restore {id}  ADMIN  take an S.A. off the roster, or bring them back
//   me              SA     the signed-in S.A.'s own profile (never anyone else's)
require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_sa.php';
require_once __DIR__ . '/_scheduling.php';
require_once __DIR__ . '/_matching.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
$action = input()['action'] ?? '';

function find_sa(int $id): array
{
    global $pdo;
    $stmt = $pdo->prepare(SA_SELECT . ' WHERE p.id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch() ?: fail('This S.A. record was not found.', 404);
}

switch ($action) {

    case 'me':
        require_role($user, 'SA');
        // Scope comes from the session, never from a request parameter
        $stmt = $pdo->prepare(SA_SELECT . ' WHERE p.user_id = ?');
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch();
        if (!$row) fail('Your S.A. record hasn\'t been set up yet. Contact the S.A. Coordinator.', 404);
        sync_sa_from_registrar((int) $row['id']);
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch();
        respond(['success' => true, 'sa' => format_sa($row)]);

    case 'my_allowance_cutoff':
        require_role($user, 'SA');
        $stmt = $pdo->prepare('SELECT p.*, o.name AS office_name, sup.full_name AS supervisor_name
                                 FROM sa_profiles p
                            LEFT JOIN offices o ON o.id = p.office_id
                            LEFT JOIN users sup ON sup.id = p.supervisor_id
                                WHERE p.user_id = ?');
        $stmt->execute([$user['id']]);
        $sa = $stmt->fetch();
        if (!$sa) fail('Your S.A. record was not found.', 404);

        $saId = (int) $sa['id'];
        $sem = target_semester(null);
        $semId = (int) $sem['id'];

        // Get authoritative base rate for this semester
        $rateStmt = $pdo->prepare('SELECT hourly_rate FROM allowance_rates WHERE semester_id = ?');
        $rateStmt->execute([$semId]);
        $semRate = (float) ($rateStmt->fetchColumn() ?: DEFAULT_HOURLY_RATE);
        $effectiveRate = ($sa['hourly_rate'] !== null && (float)$sa['hourly_rate'] > 0)
            ? (float) $sa['hourly_rate']
            : $semRate;
        if ($effectiveRate <= 0) $effectiveRate = (float) DEFAULT_HOURLY_RATE;

        // Fetch all cutoffs for this semester
        $cStmt = $pdo->prepare('SELECT * FROM allowance_cutoffs WHERE semester_id = ? ORDER BY start_date ASC, id ASC');
        $cStmt->execute([$semId]);
        $allCutoffs = $cStmt->fetchAll(PDO::FETCH_ASSOC);

        $today = date('Y-m-d');
        $activeCutoff = null;
        $in = input();
        $targetCutoffId = isset($in['cutoffId']) ? (int) $in['cutoffId'] : 0;

        if ($targetCutoffId > 0) {
            foreach ($allCutoffs as $c) {
                if ((int)$c['id'] === $targetCutoffId) {
                    $activeCutoff = $c;
                    break;
                }
            }
        }

        if (!$activeCutoff && !empty($allCutoffs)) {
            // Find current cutoff
            foreach ($allCutoffs as $c) {
                if ($today >= $c['start_date'] && $today <= $c['end_date']) {
                    $activeCutoff = $c;
                    break;
                }
            }
            // Or latest previous cutoff
            if (!$activeCutoff) {
                foreach (array_reverse($allCutoffs) as $c) {
                    if ($c['start_date'] <= $today) {
                        $activeCutoff = $c;
                        break;
                    }
                }
            }
            if (!$activeCutoff) {
                $activeCutoff = $allCutoffs[0];
            }
        }

        $cutoffId = $activeCutoff ? (int) $activeCutoff['id'] : 0;
        $cutoffStartDate = $activeCutoff ? $activeCutoff['start_date'] : date('Y-m-01');
        $cutoffEndDate = $activeCutoff ? $activeCutoff['end_date'] : date('Y-m-15');

        // Look up computation snapshot
        $compStmt = $pdo->prepare('SELECT * FROM allowance_cutoff_computations WHERE cutoff_id = ? AND sa_profile_id = ?');
        $compStmt->execute([$cutoffId, $saId]);
        $comp = $compStmt->fetch(PDO::FETCH_ASSOC);

        // Look up attendance logs within cutoff
        $attStmt = $pdo->prepare('
            SELECT duty_date,
                   actual_time_in AS time_in,
                   actual_time_out AS time_out,
                   IF(scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL,
                      ROUND(TIME_TO_SEC(TIMEDIFF(scheduled_end, scheduled_start))/3600, 2),
                      0.00) AS scheduled_hours,
                   recorded_hours, break_deduction, credited_hours, overtime_hours, status, reconciliation_status
              FROM sa_attendance_reconciliations
             WHERE semester_id = ? AND sa_profile_id = ? AND duty_date BETWEEN ? AND ?
             ORDER BY duty_date ASC
        ');
        $attStmt->execute([$semId, $saId, $cutoffStartDate, $cutoffEndDate]);
        $attLogs = $attStmt->fetchAll(PDO::FETCH_ASSOC);

        $totalRecorded = 0.0;
        $totalBreak = 0.0;
        $totalCredited = 0.0;
        $totalOvertime = 0.0;

        foreach ($attLogs as $al) {
            $totalRecorded += (float) $al['recorded_hours'];
            $totalBreak += (float) $al['break_deduction'];
            $totalCredited += (float) $al['credited_hours'];
            $totalOvertime += (float) $al['overtime_hours'];
        }

        if ($comp && (float)$comp['hourly_rate'] > 0) {
            $hourlyRate = (float) $comp['hourly_rate'];
            $netCreditedHours = (float) $comp['credited_hours'] + (float) $comp['overtime_hours'];
            $breakDeduction = (float) $comp['break_deduction'];
            $recordedHours = (float) $comp['recorded_hours'];
            $computedAllowance = (float) $comp['gross_allowance'];
            $compStatus = $comp['computation_status'];
        } else {
            $hourlyRate = $effectiveRate;
            $netCreditedHours = $totalCredited + $totalOvertime;
            $breakDeduction = $totalBreak;
            $recordedHours = $totalRecorded;
            $computedAllowance = round($netCreditedHours * $hourlyRate, 2);
            $compStatus = 'FOR_REVIEW';
        }

        // Format Cutoff Label nicely (e.g. Cutoff 4: October 1 – 15, 2026)
        $startDt = new DateTime($cutoffStartDate);
        $endDt = new DateTime($cutoffEndDate);
        $cutoffNumber = 4;
        if (preg_match('/Cutoff\s*(\d+)/i', $activeCutoff['cutoff_name'] ?? '', $m)) {
            $cutoffNumber = (int) $m[1];
        } elseif (preg_match('/C(\d+)/i', $activeCutoff['cutoff_code'] ?? '', $m)) {
            $cutoffNumber = (int) $m[1];
        }

        if (!empty($activeCutoff['cutoff_name'])) {
            $formattedCutoffLabel = $activeCutoff['cutoff_name'];
        } elseif ($startDt->format('F Y') === $endDt->format('F Y')) {
            $formattedCutoffLabel = sprintf(
                'Cutoff %d: %s %d – %d, %s',
                $cutoffNumber,
                $startDt->format('F'),
                (int) $startDt->format('j'),
                (int) $endDt->format('j'),
                $endDt->format('Y')
            );
        } else {
            $formattedCutoffLabel = sprintf(
                'Cutoff %d: %s %d – %s %d, %s',
                $cutoffNumber,
                $startDt->format('M'),
                (int) $startDt->format('j'),
                $endDt->format('M'),
                (int) $endDt->format('j'),
                $endDt->format('Y')
            );
        }

        // Status badge label and style
        $statusMap = [
            'FOR_REVIEW' => ['label' => 'For Verification', 'class' => 'bg-amber-100 text-amber-800'],
            'AWAITING_ATTENDANCE' => ['label' => 'For Verification', 'class' => 'bg-amber-100 text-amber-800'],
            'READY_FOR_ENDORSEMENT' => ['label' => 'Verified', 'class' => 'bg-emerald-100 text-emerald-800'],
            'ENDORSED_TO_ACCOUNTING' => ['label' => 'Endorsed to Accounting', 'class' => 'bg-blue-100 text-blue-800'],
            'PROCESSING_CONFIRMED' => ['label' => 'Processing', 'class' => 'bg-purple-100 text-purple-800'],
            'SETTLED' => ['label' => 'Settled', 'class' => 'bg-emerald-100 text-emerald-800'],
            'CLOSED' => ['label' => 'Closed', 'class' => 'bg-slate-100 text-slate-700']
        ];
        $statusInfo = $statusMap[$compStatus] ?? ['label' => 'For Verification', 'class' => 'bg-amber-100 text-amber-800'];

        respond([
            'success' => true,
            'sa' => [
                'id' => $saId,
                'name' => $sa['first_name'] . ' ' . $sa['last_name'],
                'studentId' => $sa['student_id'],
                'department' => $sa['department_type'] ?: $sa['office_name'],
                'hourlyRate' => $hourlyRate,
                'effectiveRate' => $effectiveRate,
                'isCustomRate' => ($sa['hourly_rate'] !== null && (float)$sa['hourly_rate'] > 0),
                'semesterRate' => $semRate,
            ],
            'semester' => $sem,
            'cutoffs' => array_map(fn($c) => [
                'id' => (int) $c['id'],
                'code' => $c['cutoff_code'],
                'name' => $c['cutoff_name'],
                'startDate' => $c['start_date'],
                'endDate' => $c['end_date'],
                'status' => $c['status'],
                'isCurrent' => ($today >= $c['start_date'] && $today <= $c['end_date']),
            ], $allCutoffs),
            'activeCutoff' => [
                'id' => $cutoffId,
                'label' => $formattedCutoffLabel,
                'startDate' => $cutoffStartDate,
                'endDate' => $cutoffEndDate,
                'status' => $compStatus,
                'statusLabel' => $statusInfo['label'],
                'statusClass' => $statusInfo['class'],
            ],
            'breakdown' => [
                'netCreditedHours' => $netCreditedHours,
                'hourlyRate' => $hourlyRate,
                'breakDeduction' => $breakDeduction,
                'computedAllowance' => $computedAllowance,
                'recordedHours' => $recordedHours,
            ],
            'attendanceLogs' => $attLogs,
            'computation' => $comp
        ]);

    case 'my_schedule':
        require_role($user, 'SA');
        $stmt = $pdo->prepare('SELECT p.*, o.name AS office_name, o.code AS office_code, sup.full_name AS supervisor_name
                                 FROM sa_profiles p
                            LEFT JOIN offices o ON o.id = p.office_id
                            LEFT JOIN users sup ON sup.id = p.supervisor_id
                                WHERE p.user_id = ?');
        $stmt->execute([$user['id']]);
        $sa = $stmt->fetch();
        if (!$sa) fail('Your S.A. record was not found.', 404);

        $saId = (int) $sa['id'];
        sync_sa_from_registrar($saId);
        $sem = target_semester(null);
        ensure_assigned_office_schedules($sem['id']);
        sync_approved_to_assignments($sem['id']);
        $pub = publication($sem['id']);
        $isPublished = (($pub['status'] ?? 'DRAFT') === 'PUBLISHED');

        // 1. Class schedules
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

        $isOffice = ($sa['sa_category'] === 'OFFICE' || $sa['department_type'] === 'OFFICE' || !empty($sa['office_name']));

        // 2. Official assigned duty (visible to S.A. once PUBLISHED)
        $dutyRows = [];
        $blocks = [];
        $assignedLocation = 'Not assigned yet';
        $assignedSupervisor = 'Pending assignment';
        $roomGroup = null;

        if ($isPublished) {
            $assignedLocation = $sa['office_name'] ?: 'Not assigned yet';
            $assignedSupervisor = $sa['supervisor_name'] ?: 'Pending assignment';
            $duty = $pdo->prepare('SELECT a.id, a.day_of_week, a.start_time, a.end_time, a.location, a.department,
                                          a.requirement_type, u.full_name AS supervisor_name
                                     FROM schedule_assignments a
                                LEFT JOIN users u ON u.id = a.supervisor_id
                                    WHERE a.semester_id = ? AND a.sa_profile_id = ?
                                    ORDER BY FIELD(a.day_of_week,"MON","TUE","WED","THU","FRI","SAT","SUN"), a.start_time');
            $duty->execute([$sem['id'], $saId]);

            $locs = [];
            $primaryRoom = null;
            $primaryDept = $sa['sa_category'];
            $primaryReqType = $isOffice ? 'OFFICE' : 'ROOM';

            $firstDutySup = null;
            foreach ($duty as $d) {
                $s = mins($d['start_time']);
                $e = mins($d['end_time']);
                $hours = round(($e - $s) / 60, 1);
                $credited = credited_hours($hours, $d['day_of_week'], $isOffice, $s, $e);
                $loc = $d['location'];
                $locs[$loc] = $loc;
                if (!$primaryRoom && stripos((string) $loc, 'Reliever') === false) {
                    $primaryRoom = $loc;
                    $primaryDept = $d['department'] ?: $primaryDept;
                    $primaryReqType = $d['requirement_type'] ?: $primaryReqType;
                }
                if (!empty($d['supervisor_name']) && !$firstDutySup) {
                    $firstDutySup = $d['supervisor_name'];
                }
                $dutyRows[] = [
                    'id' => (int) $d['id'],
                    'day' => $d['day_of_week'],
                    'start' => $s,
                    'end' => $e,
                    'startLabel' => format_time($d['start_time']),
                    'endLabel' => format_time($d['end_time']),
                    'location' => $loc,
                    'department' => $d['department'],
                    'requirementType' => $d['requirement_type'],
                    'supervisor' => $d['supervisor_name'],
                    'hours' => $hours,
                    'credited' => $credited,
                    'hasBreak' => $credited < $hours,
                ];
            }
            $dutyRows = credit_once_per_day($dutyRows, $isOffice);
            if ($firstDutySup) {
                $assignedSupervisor = $firstDutySup;
            }

            // Merged duty blocks
            $byDay = [];
            foreach ($dutyRows as $d) $byDay[$d['day'] . '|' . $d['location']][] = [$d['start'], $d['end']];
            foreach ($byDay as $key => $spans) {
                [$day, $where] = explode('|', $key, 2);
                foreach (merge_spans($spans) as $sp) $blocks[] = duty_block($day, $sp[0], $sp[1], $isOffice) + ['location' => $where];
            }
            $blocks = credit_once_per_day($blocks, $isOffice);

            if ($locs) {
                $locList = array_values($locs);
                usort($locList, function ($a, $b) {
                    $aRel = stripos($a, 'Reliever') !== false ? 1 : 0;
                    $bRel = stripos($b, 'Reliever') !== false ? 1 : 0;
                    if ($aRel !== $bRel) return $aRel <=> $bRel;
                    return strnatcasecmp($a, $b);
                });
                $assignedLocation = implode(' + ', $locList);
                if (!$primaryRoom) {
                    $primaryRoom = preg_replace('/\s*\(ITO Reliever\)/i', '', $locList[0]);
                }
            }

            // Build partner / room schedule group for this S.A.'s Room / Lab / Office with genuine partners (>= 2 S.A.s)
            $myRooms = [];
            foreach ($dutyRows as $d) {
                $loc = trim(preg_replace('/\s*\(ITO Reliever\)/i', '', (string)$d['location']));
                if ($loc && !in_array($loc, $myRooms, true)) $myRooms[] = $loc;
            }
            if ($locs) {
                foreach ($locs as $loc) {
                    $cleanLoc = trim(preg_replace('/\s*\(ITO Reliever\)/i', '', $loc));
                    if ($cleanLoc && !in_array($cleanLoc, $myRooms, true)) $myRooms[] = $cleanLoc;
                }
            }

            if (!empty($myRooms)) {
                $fullSched = schedule_view($sem['id']);
                $bestGroup = null;

                foreach ($myRooms as $candidateRoom) {
                    $partners = [];
                    $relievers = [];
                    $slotNo = 1;

                    foreach ($fullSched['staff'] ?? [] as $st) {
                        $stBlocks = $st['blocks'] ?? [];

                        // Check if staff member works in $candidateRoom (has duty block or assigned location component)
                        $hasBlock = false;
                        foreach ($stBlocks as $b) {
                            $bLoc = trim(preg_replace('/\s*\(ITO Reliever\)/i', '', (string)($b['location'] ?? '')));
                            if (strcasecmp($bLoc, $candidateRoom) === 0) {
                                $hasBlock = true;
                                break;
                            }
                        }

                        $matchesLoc = false;
                        $stLocParts = array_map('trim', explode('+', (string)($st['location'] ?? '')));
                        foreach ($stLocParts as $slp) {
                            $cleanSlp = trim(preg_replace('/\s*\(ITO Reliever\)/i', '', $slp));
                            if (strcasecmp($cleanSlp, $candidateRoom) === 0) {
                                $matchesLoc = true;
                                break;
                            }
                        }

                        if ($hasBlock || $matchesLoc) {
                            $nameParts = preg_split('/\s+/', trim((string) $st['name']));
                            $partners[] = [
                                'saId' => $st['saId'],
                                'slotNo' => $slotNo++,
                                'name' => $st['name'],
                                'firstName' => $nameParts[0] ?? $st['name'],
                                'studentId' => $st['studentId'],
                                'course' => $st['course'],
                                'yearLevel' => $st['yearLevel'],
                                'category' => $st['category'],
                                'department' => $st['department'],
                                'creditedHours' => $st['creditedHours'],
                                'rawHours' => $st['rawHours'],
                                'isMe' => ((int) $st['saId'] === $saId),
                                'blocks' => $stBlocks,
                                'classes' => $st['classes'] ?? [],
                            ];
                        }

                        // Check if this staff member has ITO Reliever blocks in $candidateRoom
                        foreach ($stBlocks as $rb) {
                            $rbLoc = (string) ($rb['location'] ?? '');
                            if (stripos($rbLoc, 'Reliever') !== false) {
                                $targetRoom = trim(preg_replace('/\s*\(ITO Reliever\)/i', '', $rbLoc));
                                if (strcasecmp($targetRoom, $candidateRoom) === 0) {
                                    $nameParts = preg_split('/\s+/', trim((string) $st['name']));
                                    $firstUpper = strtoupper($nameParts[0] ?? $st['name']);
                                    $sFormatted = preg_replace('/:00\s*/', '', str_replace(' ', '', $rb['startLabel']));
                                    $eFormatted = preg_replace('/:00\s*/', '', str_replace(' ', '', $rb['endLabel']));
                                    $relievers[] = [
                                        'key' => $st['saId'] . '-' . $rb['day'] . '-' . $rb['start'] . '-' . $rb['end'],
                                        'day' => $rb['day'],
                                        'start' => $rb['start'],
                                        'end' => $rb['end'],
                                        'lineText' => "{$rb['day']}- {$sFormatted}-{$eFormatted}- {$firstUpper}",
                                        'saName' => $st['name'],
                                        'credited' => $rb['credited'],
                                    ];
                                }
                            }
                        }
                    }

                    // A partner view is only valid if there are 2 or more assigned S.A.s (filter out solo rooms)
                    if (count($partners) >= 2) {
                        $bestGroup = [
                            'room' => $candidateRoom,
                            'department' => (strcasecmp($candidateRoom, 'HR') === 0 || stripos($candidateRoom, 'OFFICE') !== false) ? 'HR' : $primaryDept,
                            'requirementType' => (strcasecmp($candidateRoom, 'HR') === 0 || stripos($candidateRoom, 'OFFICE') !== false) ? 'OFFICE' : $primaryReqType,
                            'partners' => $partners,
                            'relievers' => $relievers,
                        ];
                        break;
                    }
                }

                $roomGroup = $bestGroup;
            }
        }

        // 3. Plotted duty preferences (S.A. wishes / recommendations / schedule revision requests)
        $prefs = $pdo->prepare('SELECT id, day_of_week, start_time, end_time, review_status, reviewed_at, review_notes, reason_category, reason_details, proposed_classes_json, created_at
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
                'reasonCategory' => $p['reason_category'] ?? null,
                'reasonDetails' => $p['reason_details'] ?? null,
                'proposedClasses' => !empty($p['proposed_classes_json']) ? json_decode($p['proposed_classes_json'], true) : null,
                'createdAt' => $p['created_at'],
            ];
        }, $prefs->fetchAll());
        $prefRows = credit_once_per_day($prefRows, $isOffice);
        foreach ($prefRows as &$pr) {
            $pr['hours'] = $pr['credited'];
        }
        unset($pr);

        $totalClassHours = round(array_sum(array_column($classRows, 'hours')), 1);
        $totalDutyHours = round(array_sum(array_column($blocks, 'hours')), 1);
        $totalCreditedHours = round(array_sum(array_column($blocks, 'credited')), 1);
        $totalPrefHours = round(array_sum(array_column($prefRows, 'credited')), 1);

        $fullSa = format_sa(find_sa($saId));

        respond([
            'success' => true,
            'semester' => $sem,
            'publication' => [
                'status' => $pub['status'] ?? 'DRAFT',
                'publishedAt' => $pub['published_at'] ?? null,
                'publishedBy' => $pub['published_by_name'] ?? null,
            ],
            'profile' => [
                'id' => $saId,
                'studentId' => $sa['student_id'],
                'name' => $sa['first_name'] . ' ' . $sa['last_name'],
                'course' => $sa['course'],
                'yearLevel' => (int) $sa['year_level'],
                'category' => $sa['sa_category'],
                'departmentType' => $sa['department_type'],
                'assignmentStatus' => $sa['assignment_status'],
                'officeName' => $assignedLocation,
                'officeCode' => $sa['office_code'],
                'supervisorName' => $assignedSupervisor,
                'weeklyTargetHours' => (float) ($sa['weekly_target_hours'] ?? 35),
            ],
            'benefits' => $fullSa['benefits'] ?? null,
            'sa' => $fullSa,
            'classes' => $classRows,
            'classHours' => $totalClassHours,
            'duty' => $dutyRows,
            'blocks' => $blocks,
            'dutyHours' => $totalDutyHours,
            'creditedHours' => $totalCreditedHours,
            'roomGroup' => $roomGroup,
            'preferences' => $prefRows,
            'preferenceHours' => $totalPrefHours,
        ]);

    case 'my_history':
        require_role($user, 'SA');
        $stmt = $pdo->prepare('SELECT p.*, o.name AS office_name, sup.full_name AS supervisor_name
                                 FROM sa_profiles p
                            LEFT JOIN offices o ON o.id = p.office_id
                            LEFT JOIN users sup ON sup.id = p.supervisor_id
                                WHERE p.user_id = ?');
        $stmt->execute([$user['id']]);
        $sa = $stmt->fetch();
        if (!$sa) fail('Your S.A. record was not found.', 404);
        $saId = (int) $sa['id'];

        $in = input();
        $type = $in['type'] ?? 'summary';
        $category = $in['category'] ?? '';
        $semesterId = !empty($in['semesterId']) ? (int) $in['semesterId'] : null;
        $search = trim((string) ($in['search'] ?? ''));
        $status = trim((string) ($in['status'] ?? ''));
        $dateFrom = trim((string) ($in['dateFrom'] ?? ''));
        $dateTo = trim((string) ($in['dateTo'] ?? ''));
        $page = max(1, (int) ($in['page'] ?? 1));
        $limit = max(5, min(50, (int) ($in['limit'] ?? 10)));
        $offset = ($page - 1) * $limit;

        // Semesters list
        $semestersStmt = $pdo->query('SELECT id, academic_year, term, status, start_date, end_date FROM semesters ORDER BY start_date DESC');
        $allSemesters = $semestersStmt->fetchAll(PDO::FETCH_ASSOC);
        $currentSem = target_semester(null);

        // Helper for semester filter in WHERE
        $semWhere = $semesterId ? "AND semester_id = {$semesterId}" : "";

        // Counts
        $attCount = (int) $pdo->query("SELECT COUNT(*) FROM sa_attendance_reconciliations WHERE sa_profile_id = {$saId} {$semWhere}")->fetchColumn();
        $allowanceCount = (int) $pdo->query("SELECT COUNT(*) FROM allowance_cutoff_computations WHERE sa_profile_id = {$saId} {$semWhere}")->fetchColumn();
        $memosCount = (int) $pdo->query("SELECT COUNT(*) FROM sa_warning_memos WHERE sa_profile_id = {$saId} AND status IN ('APPROVED','ISSUED','ACKNOWLEDGED') {$semWhere}")->fetchColumn();
        $requestsCount = (int) $pdo->query("SELECT COUNT(*) FROM sa_requests WHERE sa_profile_id = {$saId} {$semWhere}")->fetchColumn();
        $incidentsCount = (int) $pdo->query("SELECT COUNT(*) FROM sa_attendance_incidents WHERE sa_profile_id = {$saId} {$semWhere}")->fetchColumn();
        $schedulesCount = (int) $pdo->query("SELECT COUNT(*) FROM schedule_assignments WHERE sa_profile_id = {$saId} {$semWhere}")->fetchColumn();

        if ($type === 'summary' && empty($in['category']) && empty($in['recordId'])) {
            respond([
                'success' => true,
                'counts' => [
                    'attendance' => $attCount,
                    'allowance' => $allowanceCount,
                    'memos' => $memosCount,
                    'requests' => $requestsCount,
                    'incidents' => $incidentsCount,
                    'schedules' => $schedulesCount,
                ],
                'semesters' => $allSemesters,
                'currentSemester' => $currentSem,
                'sa' => [
                    'id' => $saId,
                    'name' => $sa['first_name'] . ' ' . $sa['last_name'],
                    'studentId' => $sa['student_id'],
                    'course' => $sa['course'],
                    'yearLevel' => $sa['year_level'],
                    'officeName' => $sa['office_name'],
                    'departmentType' => $sa['department_type'],
                    'hourlyRate' => (float) ($sa['hourly_rate'] ?? 0),
                ]
            ]);
        }

        // Handle specific record detail if requested
        $recordId = (int) ($in['recordId'] ?? 0);
        if ($recordId > 0 && !empty($in['getDetail'])) {
            // Fetch detailed record based on category
            if ($category === 'attendance') {
                $detailStmt = $pdo->prepare("SELECT r.*, u.full_name AS reviewed_by_name, rec.full_name AS reconciled_by_name
                                               FROM sa_attendance_reconciliations r
                                          LEFT JOIN users u ON u.id = r.reviewed_by
                                          LEFT JOIN users rec ON rec.id = r.reconciled_by
                                              WHERE r.id = ? AND r.sa_profile_id = ?");
                $detailStmt->execute([$recordId, $saId]);
                $rec = $detailStmt->fetch(PDO::FETCH_ASSOC);
                if (!$rec) fail('Attendance record not found.', 404);

                // Fetch raw punches for this date
                $punchesStmt = $pdo->prepare("SELECT id, log_type, logged_at, location_name, verification_status, confidence_score, photo_path, notes
                                               FROM sa_attendance_logs
                                              WHERE sa_profile_id = ? AND DATE(logged_at) = ?
                                              ORDER BY logged_at ASC");
                $punchesStmt->execute([$saId, $rec['duty_date']]);
                $punches = $punchesStmt->fetchAll(PDO::FETCH_ASSOC);

                // Fetch any requests for this date
                $relReqStmt = $pdo->prepare("SELECT id, request_ref_no, request_type, status, supervisor_decision, explanation, supervisor_remarks, submitted_at
                                               FROM sa_requests
                                              WHERE sa_profile_id = ? AND (? = request_date OR (request_end_date IS NOT NULL AND ? BETWEEN request_date AND request_end_date))
                                              ORDER BY id DESC");
                $relReqStmt->execute([$saId, $rec['duty_date'], $rec['duty_date']]);
                $relatedRequests = $relReqStmt->fetchAll(PDO::FETCH_ASSOC);

                respond([
                    'success' => true,
                    'record' => $rec,
                    'punches' => $punches,
                    'relatedRequests' => $relatedRequests
                ]);
            } elseif ($category === 'allowance') {
                $compStmt = $pdo->prepare("SELECT c.*, cut.cutoff_name, cut.cutoff_code, cut.start_date, cut.end_date, cut.status AS cutoff_status, cut.settled_at, cut.settled_notes, sem.academic_year, sem.term
                                             FROM allowance_cutoff_computations c
                                             JOIN allowance_cutoffs cut ON cut.id = c.cutoff_id
                                             JOIN semesters sem ON sem.id = c.semester_id
                                            WHERE c.id = ? AND c.sa_profile_id = ?");
                $compStmt->execute([$recordId, $saId]);
                $comp = $compStmt->fetch(PDO::FETCH_ASSOC);
                if (!$comp) fail('Allowance record not found.', 404);

                // Fetch attendance logs within that cutoff range
                $attStmt = $pdo->prepare("SELECT duty_date, actual_time_in, actual_time_out, scheduled_start, scheduled_end, recorded_hours, break_deduction, credited_hours, overtime_hours, status, reconciliation_status
                                            FROM sa_attendance_reconciliations
                                           WHERE sa_profile_id = ? AND duty_date BETWEEN ? AND ?
                                           ORDER BY duty_date ASC");
                $attStmt->execute([$saId, $comp['start_date'], $comp['end_date']]);
                $attLogs = $attStmt->fetchAll(PDO::FETCH_ASSOC);

                respond([
                    'success' => true,
                    'record' => $comp,
                    'attendanceLogs' => $attLogs
                ]);
            } elseif ($category === 'memos') {
                $memoStmt = $pdo->prepare("SELECT m.*, sem.academic_year, sem.term
                                             FROM sa_warning_memos m
                                             JOIN semesters sem ON sem.id = m.semester_id
                                            WHERE m.id = ? AND m.sa_profile_id = ? AND m.status IN ('APPROVED','ISSUED','ACKNOWLEDGED')");
                $memoStmt->execute([$recordId, $saId]);
                $memo = $memoStmt->fetch(PDO::FETCH_ASSOC);
                if (!$memo) fail('Memo record not found.', 404);
                respond(['success' => true, 'record' => $memo]);
            } elseif ($category === 'requests') {
                $reqStmt = $pdo->prepare("SELECT r.*, sem.academic_year, sem.term
                                            FROM sa_requests r
                                            JOIN semesters sem ON sem.id = r.semester_id
                                           WHERE r.id = ? AND r.sa_profile_id = ?");
                $reqStmt->execute([$recordId, $saId]);
                $requestRecord = $reqStmt->fetch(PDO::FETCH_ASSOC);
                if (!$requestRecord) fail('Request record not found.', 404);
                respond(['success' => true, 'record' => $requestRecord]);
            } elseif ($category === 'incidents') {
                $incStmt = $pdo->prepare("SELECT i.*, sem.academic_year, sem.term, u.full_name AS recorded_by_name
                                            FROM sa_attendance_incidents i
                                            JOIN semesters sem ON sem.id = i.semester_id
                                       LEFT JOIN users u ON u.id = i.recorded_by
                                           WHERE i.id = ? AND i.sa_profile_id = ?");
                $incStmt->execute([$recordId, $saId]);
                $inc = $incStmt->fetch(PDO::FETCH_ASSOC);
                if (!$inc) fail('Incident record not found.', 404);
                respond(['success' => true, 'record' => $inc]);
            } elseif ($category === 'schedules') {
                $schedStmt = $pdo->prepare("SELECT s.*, sem.academic_year, sem.term, u.full_name AS supervisor_name
                                              FROM schedule_assignments s
                                              JOIN semesters sem ON sem.id = s.semester_id
                                         LEFT JOIN users u ON u.id = s.supervisor_id
                                             WHERE s.id = ? AND s.sa_profile_id = ?");
                $schedStmt->execute([$recordId, $saId]);
                $sched = $schedStmt->fetch(PDO::FETCH_ASSOC);
                if (!$sched) fail('Schedule record not found.', 404);

                // Fetch changes
                $changeStmt = $pdo->prepare("SELECT c.*, u.full_name AS changed_by_name
                                               FROM schedule_changes c
                                          LEFT JOIN users u ON u.id = c.changed_by
                                              WHERE c.sa_profile_id = ? AND c.assignment_id = ?
                                              ORDER BY c.created_at DESC");
                $changeStmt->execute([$saId, $sched['id']]);
                $changes = $changeStmt->fetchAll(PDO::FETCH_ASSOC);

                respond([
                    'success' => true,
                    'record' => $sched,
                    'changes' => $changes
                ]);
            }
        }

        // List / Records query for category
        $records = [];
        $totalRecords = 0;

        if ($category === 'attendance') {
            $where = ["r.sa_profile_id = ?"];
            $params = [$saId];
            if ($semesterId) {
                $where[] = "r.semester_id = ?";
                $params[] = $semesterId;
            }
            if ($dateFrom) {
                $where[] = "r.duty_date >= ?";
                $params[] = $dateFrom;
            }
            if ($dateTo) {
                $where[] = "r.duty_date <= ?";
                $params[] = $dateTo;
            }
            if ($status) {
                $where[] = "(r.status = ? OR r.reconciliation_status = ? OR r.review_status = ?)";
                $params[] = $status;
                $params[] = $status;
                $params[] = $status;
            }
            if ($search) {
                $where[] = "(r.duty_date LIKE ? OR r.verification_notes LIKE ? OR r.review_notes LIKE ? OR r.status LIKE ?)";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
            }
            $whereSql = implode(' AND ', $where);

            $cStmt = $pdo->prepare("SELECT COUNT(*) FROM sa_attendance_reconciliations r WHERE {$whereSql}");
            $cStmt->execute($params);
            $totalRecords = (int) $cStmt->fetchColumn();

            $qStmt = $pdo->prepare("SELECT r.*, u.full_name AS reviewed_by_name, rec.full_name AS reconciled_by_name
                                      FROM sa_attendance_reconciliations r
                                 LEFT JOIN users u ON u.id = r.reviewed_by
                                 LEFT JOIN users rec ON rec.id = r.reconciled_by
                                     WHERE {$whereSql}
                                     ORDER BY r.duty_date DESC, r.id DESC
                                     LIMIT {$limit} OFFSET {$offset}");
            $qStmt->execute($params);
            $records = $qStmt->fetchAll(PDO::FETCH_ASSOC);

        } elseif ($category === 'allowance') {
            $where = ["c.sa_profile_id = ?"];
            $params = [$saId];
            if ($semesterId) {
                $where[] = "c.semester_id = ?";
                $params[] = $semesterId;
            }
            if ($status) {
                $where[] = "(cut.status = ? OR c.computation_status = ?)";
                $params[] = $status;
                $params[] = $status;
            }
            if ($search) {
                $where[] = "(cut.cutoff_name LIKE ? OR cut.cutoff_code LIKE ? OR c.computation_status LIKE ?)";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
            }
            $whereSql = implode(' AND ', $where);

            $cStmt = $pdo->prepare("SELECT COUNT(*) FROM allowance_cutoff_computations c JOIN allowance_cutoffs cut ON cut.id = c.cutoff_id WHERE {$whereSql}");
            $cStmt->execute($params);
            $totalRecords = (int) $cStmt->fetchColumn();

            $qStmt = $pdo->prepare("SELECT c.*, cut.cutoff_name, cut.cutoff_code, cut.start_date, cut.end_date, cut.status AS cutoff_status, cut.settled_at, cut.settled_notes, sem.academic_year, sem.term
                                      FROM allowance_cutoff_computations c
                                      JOIN allowance_cutoffs cut ON cut.id = c.cutoff_id
                                      JOIN semesters sem ON sem.id = c.semester_id
                                     WHERE {$whereSql}
                                     ORDER BY cut.start_date DESC
                                     LIMIT {$limit} OFFSET {$offset}");
            $qStmt->execute($params);
            $records = $qStmt->fetchAll(PDO::FETCH_ASSOC);

        } elseif ($category === 'memos') {
            $where = ["m.sa_profile_id = ?", "m.status IN ('APPROVED','ISSUED','ACKNOWLEDGED')"];
            $params = [$saId];
            if ($semesterId) {
                $where[] = "m.semester_id = ?";
                $params[] = $semesterId;
            }
            if ($status) {
                $where[] = "m.status = ?";
                $params[] = $status;
            }
            if ($search) {
                $where[] = "(m.memo_ref_no LIKE ? OR m.subject_line LIKE ? OR m.violation_category LIKE ? OR m.explanation_body LIKE ?)";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
            }
            $whereSql = implode(' AND ', $where);

            $cStmt = $pdo->prepare("SELECT COUNT(*) FROM sa_warning_memos m WHERE {$whereSql}");
            $cStmt->execute($params);
            $totalRecords = (int) $cStmt->fetchColumn();

            $qStmt = $pdo->prepare("SELECT m.*, sem.academic_year, sem.term
                                      FROM sa_warning_memos m
                                      JOIN semesters sem ON sem.id = m.semester_id
                                     WHERE {$whereSql}
                                     ORDER BY m.issued_date DESC, m.id DESC
                                     LIMIT {$limit} OFFSET {$offset}");
            $qStmt->execute($params);
            $records = $qStmt->fetchAll(PDO::FETCH_ASSOC);

        } elseif ($category === 'requests') {
            $where = ["r.sa_profile_id = ?"];
            $params = [$saId];
            if ($semesterId) {
                $where[] = "r.semester_id = ?";
                $params[] = $semesterId;
            }
            if ($status) {
                $where[] = "r.status = ?";
                $params[] = $status;
            }
            if ($search) {
                $where[] = "(r.request_ref_no LIKE ? OR r.request_type LIKE ? OR r.explanation LIKE ? OR r.reason_category LIKE ?)";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
            }
            $whereSql = implode(' AND ', $where);

            $cStmt = $pdo->prepare("SELECT COUNT(*) FROM sa_requests r WHERE {$whereSql}");
            $cStmt->execute($params);
            $totalRecords = (int) $cStmt->fetchColumn();

            $qStmt = $pdo->prepare("SELECT r.*, sem.academic_year, sem.term
                                      FROM sa_requests r
                                      JOIN semesters sem ON sem.id = r.semester_id
                                     WHERE {$whereSql}
                                     ORDER BY r.id DESC
                                     LIMIT {$limit} OFFSET {$offset}");
            $qStmt->execute($params);
            $records = $qStmt->fetchAll(PDO::FETCH_ASSOC);

        } elseif ($category === 'incidents') {
            $where = ["i.sa_profile_id = ?"];
            $params = [$saId];
            if ($semesterId) {
                $where[] = "i.semester_id = ?";
                $params[] = $semesterId;
            }
            if ($status) {
                $where[] = "i.status = ?";
                $params[] = $status;
            }
            if ($search) {
                $where[] = "(i.category LIKE ? OR i.evidence_notes LIKE ? OR i.correction_notes LIKE ?)";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
            }
            $whereSql = implode(' AND ', $where);

            $cStmt = $pdo->prepare("SELECT COUNT(*) FROM sa_attendance_incidents i WHERE {$whereSql}");
            $cStmt->execute($params);
            $totalRecords = (int) $cStmt->fetchColumn();

            $qStmt = $pdo->prepare("SELECT i.*, sem.academic_year, sem.term, u.full_name AS recorded_by_name
                                      FROM sa_attendance_incidents i
                                      JOIN semesters sem ON sem.id = i.semester_id
                                 LEFT JOIN users u ON u.id = i.recorded_by
                                     WHERE {$whereSql}
                                     ORDER BY i.incident_date DESC, i.id DESC
                                     LIMIT {$limit} OFFSET {$offset}");
            $qStmt->execute($params);
            $records = $qStmt->fetchAll(PDO::FETCH_ASSOC);

        } elseif ($category === 'schedules') {
            $where = ["s.sa_profile_id = ?"];
            $params = [$saId];
            if ($semesterId) {
                $where[] = "s.semester_id = ?";
                $params[] = $semesterId;
            }
            if ($search) {
                $where[] = "(s.location LIKE ? OR s.department LIKE ? OR s.day_of_week LIKE ?)";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
            }
            $whereSql = implode(' AND ', $where);

            $cStmt = $pdo->prepare("SELECT COUNT(*) FROM schedule_assignments s WHERE {$whereSql}");
            $cStmt->execute($params);
            $totalRecords = (int) $cStmt->fetchColumn();

            $qStmt = $pdo->prepare("SELECT s.*, sem.academic_year, sem.term, u.full_name AS supervisor_name
                                      FROM schedule_assignments s
                                      JOIN semesters sem ON sem.id = s.semester_id
                                 LEFT JOIN users u ON u.id = s.supervisor_id
                                     WHERE {$whereSql}
                                     ORDER BY FIELD(s.day_of_week, 'MON','TUE','WED','THU','FRI','SAT','SUN'), s.start_time
                                     LIMIT {$limit} OFFSET {$offset}");
            $qStmt->execute($params);
            $records = $qStmt->fetchAll(PDO::FETCH_ASSOC);
        }

        respond([
            'success' => true,
            'category' => $category,
            'records' => $records,
            'totalRecords' => $totalRecords,
            'page' => $page,
            'limit' => $limit,
            'totalPages' => ceil($totalRecords / $limit)
        ]);

    case 'save_duty_plot':
        require_role($user, 'SA');
        $stmt = $pdo->prepare('SELECT p.* FROM sa_profiles p WHERE p.user_id = ?');
        $stmt->execute([$user['id']]);
        $sa = $stmt->fetch();
        if (!$sa) fail('Your S.A. record was not found.', 404);

        $saId = (int) $sa['id'];
        $sem = target_semester(null);
        $pub = publication($sem['id']);
        $isPublished = (($pub['status'] ?? 'DRAFT') === 'PUBLISHED');

        $inData = input();
        $blocks = (array) ($inData['blocks'] ?? []);
        $classBlocks = (array) ($inData['classBlocks'] ?? []);
        $reasonCategory = trim((string) ($inData['reasonCategory'] ?? ''));
        $reasonDetails = trim((string) ($inData['reasonDetails'] ?? ''));

        // If official schedule is already published, require a valid reason
        if ($isPublished && count($blocks) > 0) {
            if (empty($reasonCategory)) {
                fail('Please select a reason for plotting a new schedule (e.g., Change class sched, Dissolve section, etc.).', 422);
            }
            if ($reasonCategory === 'Others' && empty($reasonDetails)) {
                fail('Please specify details for your schedule change reason in the remarks field.', 422);
            }
        }

        // Process proposed class schedule if provided
        $validatedClasses = [];
        $proposedClassesJson = null;
        if (!empty($classBlocks)) {
            $processedClassBlocks = [];
            foreach ($classBlocks as $cIdx => $cb) {
                $cDay = strtoupper(trim((string) ($cb['day'] ?? '')));
                if (!in_array($cDay, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
                    fail("Class #" . ($cIdx + 1) . ": Choose a valid day from Monday to Saturday.", 422);
                }
                $cStart = parse_time((string) ($cb['startTime'] ?? ''));
                $cEnd = parse_time((string) ($cb['endTime'] ?? ''));
                if (!$cStart || !$cEnd) {
                    fail("Class #" . ($cIdx + 1) . ": Enter start and end time.", 422);
                }
                if ($cEnd <= $cStart) {
                    fail("Class #" . ($cIdx + 1) . ": Class end time must be after start time.", 422);
                }
                $cSubj = trim((string) ($cb['subject'] ?? ''));
                if (empty($cSubj)) {
                    fail("Class #" . ($cIdx + 1) . ": Subject name is required.", 422);
                }
                $cSec = trim((string) ($cb['section'] ?? ''));

                // Overlap check among proposed classes
                $csMin = mins($cStart);
                $ceMin = mins($cEnd);
                foreach ($processedClassBlocks as $prevC) {
                    if ($prevC['day'] === $cDay && $csMin < $prevC['end'] && $prevC['start'] < $ceMin) {
                        fail("Class conflict on {$cDay}: '{$cSubj}' overlaps with '{$prevC['subject']}'. Classes cannot overlap.", 422);
                    }
                }
                $processedClassBlocks[] = ['day' => $cDay, 'start' => $csMin, 'end' => $ceMin, 'subject' => $cSubj];
                $validatedClasses[] = [
                    'day' => $cDay,
                    'startTime' => $cStart,
                    'endTime' => $cEnd,
                    'subject' => $cSubj,
                    'section' => $cSec ?: null
                ];
            }
            $proposedClassesJson = json_encode($validatedClasses);
        }

        // Fetch current active classes if no new class blocks provided
        if (empty($validatedClasses)) {
            $classes = $pdo->prepare('SELECT day_of_week, start_time, end_time, subject, section FROM class_schedules WHERE semester_id = ? AND sa_profile_id = ? AND archived_at IS NULL');
            $classes->execute([$sem['id'], $saId]);
            $referenceClasses = $classes->fetchAll();
        } else {
            $referenceClasses = array_map(fn($vc) => [
                'day_of_week' => $vc['day'],
                'start_time' => $vc['startTime'],
                'end_time' => $vc['endTime'],
                'subject' => $vc['subject'],
                'section' => $vc['section']
            ], $validatedClasses);
        }

        $toInsert = [];
        $processedBlocks = [];
        foreach ($blocks as $idx => $b) {
            $day = strtoupper(trim((string) ($b['day'] ?? '')));
            if ($day === 'SUN') {
                fail("Duty Block #" . ($idx + 1) . ": Sunday schedule is restricted. Duty plotting is only allowed from Monday to Saturday.", 422);
            }
            if (!in_array($day, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], true)) {
                fail("Duty Block #" . ($idx + 1) . ": Choose a valid day (Monday to Saturday).", 422);
            }

            $start = parse_time((string) ($b['startTime'] ?? ''));
            $end = parse_time((string) ($b['endTime'] ?? ''));
            if (!$start || !$end) {
                fail("Duty Block #" . ($idx + 1) . ": Enter start and end time.", 422);
            }
            if ($end <= $start) {
                fail("Duty Block #" . ($idx + 1) . ": End time must be after start time.", 422);
            }
            if (mins($end) - mins($start) < 30) {
                fail("Duty Block #" . ($idx + 1) . ": Duty period must be at least 30 minutes.", 422);
            }

            // Check overlap with other duty blocks on the same day
            $sMin = mins($start);
            $eMin = mins($end);
            foreach ($processedBlocks as $prev) {
                if ($prev['day'] === $day) {
                    if ($sMin < $prev['end'] && $prev['start'] < $eMin) {
                        $dayLabel = match($day) {
                            'MON' => 'Monday', 'TUE' => 'Tuesday', 'WED' => 'Wednesday',
                            'THU' => 'Thursday', 'FRI' => 'Friday', 'SAT' => 'Saturday', 'SUN' => 'Sunday',
                            default => $day
                        };
                        fail("Time conflict on {$dayLabel}: Duty Block #" . ($idx + 1) . " overlaps with Duty Block #" . $prev['blockNo'] . " (" . format_time(hhmm($prev['start'])) . " – " . format_time(hhmm($prev['end'])) . "). Overlapping hours on the same day are not allowed.", 422);
                    }
                }
            }
            $processedBlocks[] = ['day' => $day, 'start' => $sMin, 'end' => $eMin, 'blockNo' => $idx + 1];

            // Check overlap with class schedules
            foreach ($referenceClasses as $c) {
                if ($c['day_of_week'] === $day) {
                    $cStart = $c['start_time'];
                    $cEnd = $c['end_time'];
                    if ($start < $cEnd && $end > $cStart) {
                        fail("Conflict on {$day}: Duty clashes with class '{$c['subject']}' (" . format_time($cStart) . " – " . format_time($cEnd) . ").", 422);
                    }
                }
            }

            $toInsert[] = [$day, $start, $end];
        }

        // Save into duty_preferences
        $pdo->beginTransaction();
        try {
            $del = $pdo->prepare('DELETE FROM duty_preferences WHERE semester_id = ? AND sa_profile_id = ?');
            $del->execute([$sem['id'], $saId]);

            if ($toInsert) {
                $ins = $pdo->prepare('INSERT INTO duty_preferences (semester_id, sa_profile_id, day_of_week, start_time, end_time, review_status, reason_category, reason_details, proposed_classes_json, imported_by) VALUES (?, ?, ?, ?, ?, "PENDING", ?, ?, ?, ?)');
                foreach ($toInsert as [$d, $st, $et]) {
                    $ins->execute([$sem['id'], $saId, $d, $st, $et, $reasonCategory ?: null, $reasonDetails ?: null, $proposedClassesJson, $user['id']]);
                }
            }
            audit('SA_DUTY_PREFERENCES_PLOTTED', "{$sa['student_id']} {$sa['first_name']} plotted " . count($toInsert) . " duty preference block(s). Reason: {$reasonCategory}");
            $pdo->commit();

            // Send notification to S.A. Coordinators (role = 'ADMIN')
            $coordStmt = $pdo->query("SELECT id, full_name FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
            $coords = $coordStmt->fetchAll();
            $saFullName = trim($sa['first_name'] . ' ' . $sa['last_name']);
            $saStudentId = $sa['student_id'];
            $blockCount = count($toInsert);

            if ($blockCount > 0) {
                $totalHrs = 0.0;
                foreach ($toInsert as [$d, $st, $et]) {
                    $totalHrs += round((mins($et) - mins($st)) / 60, 1);
                }

                $reasonText = $reasonCategory ? " (Reason: {$reasonCategory}" . ($reasonDetails ? " - {$reasonDetails}" : "") . ")" : "";
                $coordTitle = $isPublished
                    ? "New Schedule Plotting Request: {$saFullName}"
                    : "Plotted Duty Recommendation: {$saFullName}";
                $coordMsg = $isPublished
                    ? "{$saFullName} ({$saStudentId}) submitted a new schedule plotting request{$reasonText} with {$blockCount} duty block(s) ({$totalHrs} hrs/week). Please review and validate."
                    : "{$saFullName} ({$saStudentId}) submitted {$blockCount} preferred duty block(s) ({$totalHrs} hrs/week) as a recommendation for {$sem['label']}.{$reasonText}";

                foreach ($coords as $coord) {
                    create_notification(
                        (int) $coord['id'],
                        $coordTitle,
                        $coordMsg,
                        'DUTY_PLOT_SUBMITTED',
                        '#/admin/sa-management/' . (int) $saId . '?tab=CLASSES',
                        (int) $user['id']
                    );
                }

                // Confirmation notification for the SA
                $saConfTitle = $isPublished ? "Schedule Plotting Request Submitted" : "Duty Schedule Recommendation Submitted";
                $saConfMsg = $isPublished
                    ? "Your new schedule plotting request{$reasonText} with {$blockCount} duty block(s) ({$totalHrs} hrs/week) was successfully submitted to the S.A. Coordinator for validation."
                    : "Your preferred duty schedule ({$blockCount} block(s), {$totalHrs} hrs/week) was successfully submitted as a recommendation to the S.A. Coordinator.";

                create_notification(
                    (int) $user['id'],
                    $saConfTitle,
                    $saConfMsg,
                    'DUTY_PLOT_SAVED',
                    '#/sa/schedule',
                    (int) $user['id']
                );
            } else {
                $coordTitle = "Plotted Duty Cleared: {$saFullName}";
                $coordMsg = "{$saFullName} ({$saStudentId}) cleared their plotted duty preferences for {$sem['label']}.";
                foreach ($coords as $coord) {
                    create_notification(
                        (int) $coord['id'],
                        $coordTitle,
                        $coordMsg,
                        'DUTY_PLOT_CLEARED',
                        '#/admin/sa-management/' . (int) $saId . '?tab=CLASSES',
                        (int) $user['id']
                    );
                }
            }
        } catch (Throwable $e) {
            $pdo->rollBack();
            fail('Could not save plotted duty schedule: ' . $e->getMessage(), 500);
        }

        respond([
            'success' => true,
            'count' => count($toInsert),
            'message' => count($toInsert) > 0
                ? 'Plotted schedule saved! This has been submitted as a recommendation to the S.A. Coordinator.'
                : 'Plotted duty schedule cleared.'
        ]);

    case 'options':
        require_role($user, 'ADMIN');
        respond(['success' => true, 'options' => sa_form_options()]);

    case 'lookup_student':
        require_role($user, 'ADMIN');
        $studentNumber = trim(input()['studentNumber'] ?? input()['student_number'] ?? input()['student_id'] ?? '');
        if (!$studentNumber) fail('Student number required.', 422);

        $stmt = $pdo->prepare("
            SELECT s.student_id, s.student_number, s.first_name, s.middle_name, s.last_name, s.suffix,
                   s.gender, s.birth_date, s.contact_no, s.email,
                   c.course_code, s.status, s.curriculum_id,
                   cr.total_units AS curriculum_total_units,
                   (SELECT MAX(sub.year_level) FROM subjects sub WHERE sub.curriculum_id = s.curriculum_id) AS curriculum_years
            FROM students s
            LEFT JOIN courses c ON c.course_id = s.course_id
            LEFT JOIN curriculums cr ON cr.curriculum_id = s.curriculum_id
            WHERE s.student_number = ?
        ");
        $stmt->execute([$studentNumber]);
        $student = $stmt->fetch();
        if (!$student) respond(['success' => true, 'found' => false]);

        $enrollmentStatus = 'NOT_ENROLLED';
        $yearLevel = null;
        $academicStatus = 'REGULAR';
        $enrolledUnits = 0;

        $enrollStmt = $pdo->prepare("
            SELECT e.enrollment_id, e.status, e.term_id,
                   at.school_year, at.semester AS term_name
            FROM enrollments e
            LEFT JOIN academic_terms at ON at.term_id = e.term_id
            WHERE e.student_id = (SELECT student_id FROM students WHERE student_number = ? LIMIT 1)
            ORDER BY e.enrollment_id DESC
            LIMIT 1
        ");
        $enrollStmt->execute([$studentNumber]);
        $enrollment = $enrollStmt->fetch();

        if ($enrollment) {
            $enrollmentStatus = in_array($enrollment['status'], ['Enrolled', 'enrolled', 'ENROLLED']) ? 'ENROLLED' : 'NOT_ENROLLED';
            $unitStmt = $pdo->prepare("
                SELECT COALESCE(SUM(sub_u.units), 0) AS total_units FROM (
                    SELECT sb.subject_id, SUM(sched.units) AS units
                    FROM enrollment_details ed
                    JOIN subject_schedules sched ON sched.schedule_id = ed.schedule_id
                    JOIN subjects sb ON sb.subject_id = sched.subject_id
                    WHERE ed.enrollment_id = ?
                    GROUP BY sb.subject_id
                ) sub_u
            ");
            $unitStmt->execute([$enrollment['enrollment_id']]);
            $enrolledUnits = (int) $unitStmt->fetchColumn();

            $ylStmt = $pdo->prepare("
                SELECT sb.year_level
                FROM enrollment_details ed
                JOIN subject_schedules sched ON sched.schedule_id = ed.schedule_id
                JOIN subjects sb ON sb.subject_id = sched.subject_id
                WHERE ed.enrollment_id = ?
                GROUP BY sb.year_level
                ORDER BY COUNT(DISTINCT sb.subject_id) DESC
                LIMIT 1
            ");
            $ylStmt->execute([$enrollment['enrollment_id']]);
            $yl = $ylStmt->fetchColumn();
            if ($yl) $yearLevel = (int) $yl;
        }

        $feeAssessment = null;
        if ($enrollment) {
            $feeStmt = $pdo->prepare("SELECT * FROM fee_assessments WHERE enrollment_id = ? LIMIT 1");
            $feeStmt->execute([$enrollment['enrollment_id']]);
            $faRow = $feeStmt->fetch();
            if ($faRow) {
                $feeAssessment = [
                    'tuitionFee' => (float) $faRow['tuition_fee'],
                    'labFee' => (float) $faRow['lab_fee'],
                    'miscFee' => (float) $faRow['misc_fee'],
                    'lmsFee' => (float) $faRow['lms_fee'],
                    'nstpFee' => (float) $faRow['nstp_fee'],
                    'omrFee' => (float) $faRow['omr_fee'],
                    'cashTotal' => (float) $faRow['cash_total'],
                    'installmentTotal' => (float) $faRow['installment_total'],
                ];
            }
        }

        $curriculumYears = $student['curriculum_years'] ? (int) $student['curriculum_years'] : 4;

        // Check if already registered in sa_profiles
        $dupSaStmt = $pdo->prepare("SELECT id, sa_number, sa_status, archived_at FROM sa_profiles WHERE LOWER(TRIM(student_id)) = LOWER(?) LIMIT 1");
        $dupSaStmt->execute([$studentNumber]);
        $existingSa = $dupSaStmt->fetch();

        respond([
            'success' => true,
            'found' => true,
            'alreadyRegistered' => (bool) $existingSa,
            'existingSaId' => $existingSa ? (int) $existingSa['id'] : null,
            'existingSaNumber' => $existingSa['sa_number'] ?? null,
            'student' => [
                'id' => (int) $student['student_id'],
                'studentNumber' => $student['student_number'],
                'firstName' => $student['first_name'],
                'middleName' => $student['middle_name'] ?? '',
                'lastName' => $student['last_name'],
                'suffix' => $student['suffix'] ?? '',
                'sex' => strtoupper($student['gender'] ?? ''),
                'birthDate' => $student['birth_date'] ?? '',
                'contactNumber' => $student['contact_no'] ?? '',
                'schoolEmail' => $student['email'] ?? '',
                'course' => $student['course_code'] ?? '',
                'status' => $student['status'] ?? '',
                'yearLevel' => $yearLevel,
                'enrollmentStatus' => $enrollmentStatus,
                'academicStatus' => $academicStatus,
                'enrolledUnits' => $enrolledUnits,
                'curriculumId' => $student['curriculum_id'] ? (int) $student['curriculum_id'] : null,
                'curriculumYears' => $curriculumYears,
                'schoolYear' => $enrollment ? $enrollment['school_year'] : null,
                'termName' => $enrollment ? $enrollment['term_name'] : null,
                'feeAssessment' => $feeAssessment,
                'alreadyRegistered' => (bool) $existingSa,
                'existingSaNumber' => $existingSa['sa_number'] ?? null,
            ]
        ]);

    case 'list':
        require_role($user, 'ADMIN');
        sync_all_active_sas_from_registrar();
        $rows = $pdo->query(SA_SELECT . ' ORDER BY p.last_name, p.first_name')->fetchAll();
        respond([
            'success' => true,
            'semester' => active_semester(),
            'items' => roster_extras(array_map(fn($r) => format_sa($r, false), $rows))
        ]);

    case 'school_balances':
        require_role($user, 'ADMIN');
        sync_all_active_sas_from_registrar();
        $rows = $pdo->query(SA_SELECT . ' WHERE p.archived_at IS NULL ORDER BY p.last_name, p.first_name')->fetchAll();
        respond(['success' => true, 'items' => roster_extras(array_map(fn($r) => format_sa($r, true), $rows))]);

    case 'get':
        require_role($user, 'ADMIN');
        $targetId = (int) (input()['id'] ?? 0);
        sync_sa_from_registrar($targetId);
        respond(['success' => true, 'semester' => active_semester(), 'sa' => format_sa(find_sa($targetId))]);

    case 'create':
        require_role($user, 'ADMIN');
        [$c, $errors] = validate_sa(input());
        if ($errors) fail('Check the highlighted fields.', 422, ['errors' => $errors]);

        // Pull and lock official student records from the registrar DB
        $regStmt = $pdo->prepare('
            SELECT s.first_name, s.middle_name, s.last_name, s.suffix, s.gender, s.birth_date,
                   s.contact_no, s.email, c.course_code
            FROM students s
            LEFT JOIN courses c ON c.course_id = s.course_id
            WHERE s.student_number = ?
            LIMIT 1
        ');
        $regStmt->execute([$c['student_id']]);
        $official = $regStmt->fetch();
        if ($official) {
            $c['first_name'] = $official['first_name'];
            $c['middle_name'] = $official['middle_name'] ?: null;
            $c['last_name'] = $official['last_name'];
            $c['suffix'] = $official['suffix'] ?: null;
            if (!empty($official['gender'])) $c['sex'] = strtoupper($official['gender']);
            if (!empty($official['birth_date'])) $c['birth_date'] = $official['birth_date'];
            if (!empty($official['contact_no'])) $c['contact_number'] = preg_replace('/[\s-]/', '', $official['contact_no']);
            if (!empty($official['email'])) $c['school_email'] = mb_strtolower($official['email']);
            if (!empty($official['course_code'])) $c['course'] = $official['course_code'];
        }

        $defaultPassword = 'ncst123456789';
        $saNumber = trim((string) (input()['saNumber'] ?? ''));
        if (!$saNumber) {
            $saNumber = generate_sa_number($c['department_type'] ?? null);
        }

        ensure_biometrics_schema($pdo);
        $pdo->beginTransaction();
        try {
            // Login account: username = student ID, email = school email, default password = ncst123456789
            $pdo->prepare(
                'INSERT INTO users (username, password_hash, role, full_name, email, status, must_change_password)
                 VALUES (?, ?, "SA", ?, ?, ?, 1)'
            )->execute([
                $c['student_id'], password_hash($defaultPassword, PASSWORD_DEFAULT), sa_full_name($c), $c['school_email'],
                $c['sa_status'] === 'INACTIVE' ? 'INACTIVE' : 'PENDING_ACTIVATION',
            ]);
            $userId = (int) $pdo->lastInsertId();

            $pdo->prepare(
                'INSERT INTO sa_profiles (user_id, student_id, sa_number, first_name, middle_name, last_name, suffix, birth_date, sex,
                    contact_number, personal_email, course, year_level, semester_id, academic_status, enrollment_status,
                    expected_graduation, sa_category, department_type, office_id, sa_status, appointment_start,
                    appointment_end, assignment_status, weekly_target_hours, hourly_rate, is_reliever, supervisor_id,
                    emergency_name, emergency_number, emergency_relationship, created_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
            )->execute([
                $userId, $c['student_id'], $saNumber, $c['first_name'], $c['middle_name'], $c['last_name'], $c['suffix'],
                $c['birth_date'], $c['sex'], $c['contact_number'], $c['personal_email'], $c['course'], $c['year_level'],
                $c['semester_id'], $c['academic_status'], $c['enrollment_status'], $c['expected_graduation'],
                $c['sa_category'], $c['department_type'], $c['office_id'], $c['sa_status'], $c['appointment_start'],
                $c['appointment_end'], $c['assignment_status'], $c['weekly_target_hours'], $c['hourly_rate'], (int) $c['is_reliever'],
                $c['supervisor_id'], $c['emergency_name'], $c['emergency_number'], $c['emergency_relationship'], $user['id'],
            ]);
            $profileId = (int) $pdo->lastInsertId();
            save_benefits($profileId, $c);

            // Save Face Recognition biometrics if captured
            if (!empty(input()['faceDescriptor'])) {
                try {
                    save_sa_biometrics(
                        $profileId,
                        $userId,
                        input()['faceDescriptor'],
                        input()['facePhoto'] ?? null,
                        (int) $user['id']
                    );
                } catch (Throwable $bioEx) {
                    error_log('Biometrics save warning on create: ' . $bioEx->getMessage());
                }
            }

            audit('SA_REGISTERED', "student ID: {$c['student_id']}, SA number: {$saNumber}");
            if ($pdo->inTransaction()) {
                $pdo->commit();
            }

            try {
                sync_sa_from_registrar($profileId);
            } catch (Throwable $syncEx) {
                error_log('Sync from registrar warning: ' . $syncEx->getMessage());
            }
        } catch (Throwable $ex) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('SA create failed: ' . $ex->getMessage());
            fail('The S.A. could not be saved. Try again.', 500);
        }

        if ($c['assignment_status'] === 'ASSIGNED' && $c['sa_category'] === 'OFFICE' && !empty($c['office_id'])) {
            $semId = (int) $c['semester_id'];
            $offId = (int) $c['office_id'];
            $reqQ = $pdo->prepare('SELECT id, required_sa FROM office_requirements WHERE office_id = ? AND semester_id = ?');
            $reqQ->execute([$offId, $semId]);
            $reqRow = $reqQ->fetch();
            $cntAssigned = (int) $pdo->query("SELECT COUNT(*) FROM sa_profiles WHERE office_id = {$offId} AND sa_status = 'ACTIVE' AND assignment_status = 'ASSIGNED'")->fetchColumn();
            if (!$reqRow) {
                $pdo->prepare('INSERT INTO office_requirements (office_id, semester_id, required_sa, operating_start, operating_end, weekly_target_hours) VALUES (?, ?, ?, "07:00:00", "19:00:00", 35.0)')->execute([$offId, $semId, max(1, $cntAssigned)]);
            }
            ensure_assigned_office_schedules($semId);
        }

        // Email the new S.A. their login details (personal Gmail + school email).
        // Done after commit: a mail failure must never undo a saved account.
        require_once __DIR__ . '/_mailer.php';
        $mailResult = send_sa_account_created_email(
            [$c['personal_email'] ?? null, $c['school_email'] ?? null],
            (string) $c['first_name'],
            (string) $c['student_id'],
            (string) $saNumber,
            $defaultPassword
        );
        audit(
            $mailResult['sent'] ? 'SA_ACCOUNT_EMAIL_SENT' : 'SA_ACCOUNT_EMAIL_FAILED',
            "student ID: {$c['student_id']}" . (!empty($mailResult['recipients']) ? ' to ' . implode(', ', $mailResult['recipients']) : '')
                . ($mailResult['sent'] ? '' : ' (' . $mailResult['error'] . ')')
        );

        respond([
            'success' => true,
            'sa' => format_sa(find_sa($profileId)),
            // Credentials with default password ncst123456789 and auto-generated SA number
            'credentials' => [
                'username' => $c['student_id'],
                'saNumber' => $saNumber,
                'email' => $c['school_email'],
                'temporaryPassword' => $defaultPassword,
                'defaultPassword' => $defaultPassword,
                'mustChangePassword' => true
            ],
            'emailNotice' => [
                'sent' => $mailResult['sent'],
                'recipients' => $mailResult['recipients'] ?? [],
                'error' => $mailResult['error'],
            ],
        ]);

    case 'update':
        require_role($user, 'ADMIN');
        $current = find_sa((int) (input()['id'] ?? 0));
        [$c, $errors] = validate_sa(input(), $current);
        if ($errors) fail('Check the highlighted fields.', 422, ['errors' => $errors]);

        // Registrar details are strictly view-only and immutable
        $c['student_id'] = $current['student_id'];
        $c['first_name'] = $current['first_name'];
        $c['middle_name'] = $current['middle_name'];
        $c['last_name'] = $current['last_name'];
        $c['suffix'] = $current['suffix'];
        $c['birth_date'] = $current['birth_date'];
        $c['sex'] = $current['sex'];
        $c['school_email'] = $current['school_email'];
        $c['contact_number'] = $current['contact_number'];
        $c['course'] = $current['course'];

        $columns = ['student_id', 'first_name', 'middle_name', 'last_name', 'suffix', 'birth_date', 'sex', 'contact_number',
            'personal_email', 'course', 'year_level', 'semester_id', 'academic_status', 'enrollment_status',
            'expected_graduation', 'sa_category', 'department_type', 'office_id', 'sa_status', 'appointment_start',
            'appointment_end', 'assignment_status', 'weekly_target_hours', 'hourly_rate', 'is_reliever', 'supervisor_id',
            'emergency_name', 'emergency_number', 'emergency_relationship'];

        // Record WHICH fields changed (not the personal values themselves)
        $changed = [];
        foreach ($columns as $col) {
            $old = $current[$col] ?? null;
            $new = is_bool($c[$col]) ? (int) $c[$col] : $c[$col];
            $same = (is_numeric($old) && is_numeric($new)) ? (float) $old === (float) $new : (string) $old === (string) $new;
            if (!$same) $changed[] = $col;
        }
        if ($current['school_email'] !== $c['school_email']) $changed[] = 'school_email';

        // Keep the login account in step with the S.A. status
        $accountStatus = $current['account_status'];
        if ($c['sa_status'] === 'INACTIVE') {
            $accountStatus = 'INACTIVE';
        } elseif ($accountStatus === 'INACTIVE') {
            $accountStatus = $current['must_change_password'] ? 'PENDING_ACTIVATION' : 'ACTIVE';
        }

        ensure_biometrics_schema($pdo);
        $pdo->beginTransaction();
        try {
            $set = implode(', ', array_map(fn($col) => "$col = ?", $columns));
            $values = array_map(fn($col) => is_bool($c[$col]) ? (int) $c[$col] : $c[$col], $columns);
            $pdo->prepare("UPDATE sa_profiles SET $set WHERE id = ?")->execute([...$values, $current['id']]);
            $pdo->prepare('UPDATE users SET username = ?, email = ?, full_name = ?, status = ? WHERE id = ?')
                ->execute([$c['student_id'], $c['school_email'], sa_full_name($c), $accountStatus, $current['user_id']]);
            save_benefits((int) $current['id'], $c);

            // Update Face Recognition biometrics if a new capture was provided
            if (!empty(input()['faceDescriptor'])) {
                save_sa_biometrics(
                    (int) $current['id'],
                    (int) $current['user_id'],
                    input()['faceDescriptor'],
                    input()['facePhoto'] ?? null,
                    (int) $user['id']
                );
            }

            $details = "student ID: {$c['student_id']}; changed: " . ($changed ? implode(', ', $changed) : 'benefits only');
            if (in_array('assignment_status', $changed, true)) $details .= "; assignment {$current['assignment_status']} -> {$c['assignment_status']}";
            audit('SA_UPDATED', $details);
            if ($accountStatus !== $current['account_status']) {
                audit('ACCOUNT_STATUS_CHANGED', "{$current['account_status']} -> $accountStatus", (int) $current['user_id']);
            }
            if ($pdo->inTransaction()) {
                $pdo->commit();
            }
        } catch (Throwable $ex) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('SA update failed: ' . $ex->getMessage());
            fail('The changes could not be saved. Try again.', 500);
        }
        $semId = (int) ($c['semester_id'] ?: $current['semester_id']);
        if ($c['assignment_status'] === 'UNASSIGNED') {
            $pdo->prepare('DELETE FROM schedule_assignments WHERE sa_profile_id = ? AND semester_id = ?')->execute([$current['id'], $semId]);
            $pdo->prepare('UPDATE sa_profiles SET office_id = NULL, supervisor_id = NULL WHERE id = ?')->execute([$current['id']]);
        } elseif ($c['assignment_status'] === 'ASSIGNED') {
            if ($c['sa_category'] !== 'OFFICE' || empty($c['office_id'])) {
                $pdo->prepare('DELETE FROM schedule_assignments WHERE sa_profile_id = ? AND semester_id = ? AND requirement_type = "OFFICE"')->execute([$current['id'], $semId]);
                if (empty($c['office_id'])) {
                    $pdo->prepare('UPDATE sa_profiles SET office_id = NULL WHERE id = ?')->execute([$current['id']]);
                }
            } else {
                if (!empty($current['office_id']) && (int) $current['office_id'] !== (int) $c['office_id']) {
                    $pdo->prepare('DELETE FROM schedule_assignments WHERE sa_profile_id = ? AND semester_id = ? AND requirement_type = "OFFICE"')->execute([$current['id'], $semId]);
                }
                $offId = (int) $c['office_id'];
                $reqQ = $pdo->prepare('SELECT id, required_sa FROM office_requirements WHERE office_id = ? AND semester_id = ?');
                $reqQ->execute([$offId, $semId]);
                $reqRow = $reqQ->fetch();
                $cntAssigned = (int) $pdo->query("SELECT COUNT(*) FROM sa_profiles WHERE office_id = {$offId} AND sa_status = 'ACTIVE' AND assignment_status = 'ASSIGNED'")->fetchColumn();
                if (!$reqRow) {
                    $pdo->prepare('INSERT INTO office_requirements (office_id, semester_id, required_sa, operating_start, operating_end, weekly_target_hours) VALUES (?, ?, ?, "07:00:00", "19:00:00", 35.0)')->execute([$offId, $semId, max(1, $cntAssigned)]);
                }
                ensure_assigned_office_schedules($semId);
            }
            if (!empty($c['supervisor_id'])) {
                $pdo->prepare('UPDATE schedule_assignments SET supervisor_id = ? WHERE sa_profile_id = ? AND semester_id = ?')
                    ->execute([(int) $c['supervisor_id'], $current['id'], $semId]);
            }
        }
        respond(['success' => true, 'sa' => format_sa(find_sa((int) $current['id']))]);

    case 'save_face':
        require_role($user, 'ADMIN');
        $saId = (int) (input()['saProfileId'] ?? 0);
        if ($saId <= 0) fail('Student Assistant ID required.', 422);
        $current = find_sa($saId);

        $descriptor = input()['faceDescriptor'] ?? null;
        if (empty($descriptor)) fail('Face biometric descriptor is required.', 422);

        $photo = input()['facePhoto'] ?? null;

        try {
            save_sa_biometrics($saId, (int) $current['user_id'], $descriptor, $photo, (int) $user['id']);
            audit('SA_FACE_REGISTERED', "Registered biometric face model for S.A. {$current['first_name']} {$current['last_name']} ({$current['student_id']})");
        } catch (Throwable $e) {
            fail($e->getMessage(), 422);
        }

        respond([
            'success' => true,
            'message' => "Face recognition biometrics saved for {$current['first_name']} {$current['last_name']}.",
            'sa' => format_sa(find_sa($saId))
        ]);

    case 'archive':
        require_role($user, 'ADMIN');
        $current = find_sa((int) (input()['id'] ?? 0));
        $reason = trim((string) (input()['reason'] ?? ''));

        if ($current['archived_at']) fail('This S.A. is already archived.', 409);
        if (mb_strlen($reason) < 5) {
            fail('Say why this S.A. is being archived.', 422,
                 ['errors' => ['reason' => 'Give a reason of at least 5 characters.']]);
        }
        if (mb_strlen($reason) > 200) {
            fail('That reason is too long.', 422, ['errors' => ['reason' => 'Use 200 characters or fewer.']]);
        }

        $pdo->beginTransaction();
        try {
            // Off the roster: no duty, no sign-in, but every record stays
            $pdo->prepare(
                'UPDATE sa_profiles SET archived_at = NOW(), archive_reason = ?, sa_status = "INACTIVE",
                        assignment_status = "INACTIVE" WHERE id = ?'
            )->execute([$reason, $current['id']]);
            $pdo->prepare('UPDATE users SET status = "INACTIVE" WHERE id = ?')->execute([$current['user_id']]);
            audit('SA_ARCHIVED', "{$current['student_id']} " . sa_full_name($current) . ": $reason");
            $pdo->commit();
        } catch (Throwable $ex) {
            $pdo->rollBack();
            error_log('SA archive failed: ' . $ex->getMessage());
            fail('The S.A. could not be archived. Try again.', 500);
        }
        respond(['success' => true, 'sa' => format_sa(find_sa((int) $current['id']))]);

    case 'restore':
        require_role($user, 'ADMIN');
        $current = find_sa((int) (input()['id'] ?? 0));
        if (!$current['archived_at']) fail('This S.A. is not archived.', 409);

        $pdo->beginTransaction();
        try {
            $pdo->prepare(
                'UPDATE sa_profiles SET archived_at = NULL, archive_reason = NULL, sa_status = "ACTIVE",
                        assignment_status = "UNASSIGNED" WHERE id = ?'
            )->execute([$current['id']]);
            $pdo->prepare('UPDATE users SET status = ? WHERE id = ?')
                ->execute([$current['must_change_password'] ? 'PENDING_ACTIVATION' : 'ACTIVE', $current['user_id']]);
            audit('SA_RESTORED', "{$current['student_id']} " . sa_full_name($current));
            $pdo->commit();
        } catch (Throwable $ex) {
            $pdo->rollBack();
            error_log('SA restore failed: ' . $ex->getMessage());
            fail('The S.A. could not be restored. Try again.', 500);
        }
        respond(['success' => true, 'sa' => format_sa(find_sa((int) $current['id']))]);

    case 'reset_password':
        require_role($user, 'ADMIN');
        $sa = find_sa((int) (input()['id'] ?? 0));
        if ($sa['account_status'] === 'INACTIVE') fail('This account is inactive. Set the S.A. status to Active first.', 422);

        $tempPassword = generate_temp_password();
        // A new password_changed_at signs the S.A. out everywhere
        $pdo->prepare(
            'UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL,
                    password_changed_at = NOW() WHERE id = ?'
        )->execute([password_hash($tempPassword, PASSWORD_DEFAULT), $sa['user_id']]);
        audit('PASSWORD_RESET_BY_ADMIN', "student ID: {$sa['student_id']}");

        // Email the S.A. their new temporary password (personal Gmail + school email)
        require_once __DIR__ . '/_mailer.php';
        $recipients = array_values(array_filter([
            $sa['personal_email'] ?? null,
            $sa['school_email'] ?? null
        ]));
        $mailResult = send_sa_password_reset_email(
            $recipients,
            (string) $sa['first_name'],
            (string) $sa['student_id'],
            $tempPassword
        );
        audit(
            $mailResult['sent'] ? 'SA_PASSWORD_RESET_EMAIL_SENT' : 'SA_PASSWORD_RESET_EMAIL_FAILED',
            "student ID: {$sa['student_id']}" . (!empty($mailResult['recipients']) ? ' to ' . implode(', ', $mailResult['recipients']) : '')
                . ($mailResult['sent'] ? '' : ' (' . $mailResult['error'] . ')')
        );

        respond([
            'success' => true,
            'credentials' => [
                'username' => $sa['username'],
                'saNumber' => $sa['sa_number'] ?? null,
                'email' => $sa['school_email'],
                'temporaryPassword' => $tempPassword
            ],
            'emailNotice' => [
                'sent' => $mailResult['sent'],
                'recipients' => $mailResult['recipients'] ?? [],
                'error' => $mailResult['error'],
            ],
        ]);

    default:
        fail('Unknown action.', 400);
}
