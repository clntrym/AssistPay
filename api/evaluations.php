<?php
// Student Assistant Performance Evaluation Module API (5-Stage Workflow)
// Process:
// 1. Supervisor completes evaluation (Ratings 1-10, comments, recommendation, supervisor signature) -> FOR_SA_REVIEW
//    - Locked after submission against ordinary editing; corrections require authorized return-for-revision.
//    - Automatically assigns 5-school-day acknowledgment task to S.A. (excluding weekends & school_holidays).
// 2. S.A. receives and reviews evaluation (Views ratings, adds optional comments/concerns, signs acknowledgment,
//    or requests extension / submits concern / records exception) -> FOR_COORDINATOR_REVIEW
// 3. S.A. Coordinator reviews (Checks supervisor recommendation, S.A. response/concerns, action history, and records;
//    can approve/reject extensions or return to Supervisor for revision with required reason)
// 4. Coordinator records final decision (Retain, Improvement Plan, Reassignment, or Non-Renewal, with reason & date) -> FINALIZED
// 5. Finalized Result (Read-only for ordinary users; S.A. & Supervisor notified; reopening requires Coordinator auth + audit log)

require_once __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_sa.php';
require_once __DIR__ . '/_scheduling.php';
require_once __DIR__ . '/_matching.php';
require_once __DIR__ . '/_evaluation_workflow.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();

$in = input();
$action = $in['action'] ?? '';

ensure_evaluation_tables($pdo);

/**
 * Helper to fetch all active Supervisors and their department/office scopes.
 */
function get_all_supervisors_with_scope(PDO $pdo): array
{
    $stmt = $pdo->query("
        SELECT u.id, u.username, u.full_name, u.email, u.supervisor_category, u.office_id, u.status,
               o.name AS primary_office_name
          FROM users u
          LEFT JOIN offices o ON o.id = u.office_id
         WHERE u.role = 'SUPERVISOR' AND u.status IN ('ACTIVE', 'PENDING_ACTIVATION')
         ORDER BY u.id ASC
    ");
    $rows = $stmt->fetchAll();

    $soStmt = $pdo->query("
        SELECT so.supervisor_id, so.office_id, o.name AS office_name
          FROM supervisor_offices so
          JOIN offices o ON o.id = so.office_id
         ORDER BY so.id ASC
    ");
    $extraOffices = [];
    foreach ($soStmt as $r) {
        $sid = (int) $r['supervisor_id'];
        $extraOffices[$sid][] = [
            'id' => (int) $r['office_id'],
            'name' => $r['office_name'] === 'PRMD' ? 'PRD' : $r['office_name']
        ];
    }

    $supervisors = [];
    foreach ($rows as $s) {
        $supId = (int) $s['id'];
        $officeIds = [];
        $officeNames = [];
        if ($s['office_id']) {
            $officeIds[] = (int) $s['office_id'];
            if ($s['primary_office_name']) {
                $officeNames[] = $s['primary_office_name'] === 'PRMD' ? 'PRD' : $s['primary_office_name'];
            }
        }
        foreach ($extraOffices[$supId] ?? [] as $eo) {
            if (!in_array($eo['id'], $officeIds, true)) $officeIds[] = $eo['id'];
            if (!in_array($eo['name'], $officeNames, true)) $officeNames[] = $eo['name'];
        }
        $cat = strtoupper((string) ($s['supervisor_category'] ?? 'OFFICE'));
        if ($cat === 'ITO' && !in_array('ITO', $officeNames, true)) {
            $officeNames[] = 'ITO';
        } elseif ($cat === 'ACADS' && !in_array('ACADS', $officeNames, true)) {
            $officeNames[] = 'ACADS';
        }

        $supervisors[$supId] = [
            'id' => $supId,
            'empId' => $s['username'],
            'name' => $s['full_name'],
            'email' => $s['email'] ?? null,
            'category' => $cat,
            'officeIds' => $officeIds,
            'departments' => $officeNames,
            'deptLabel' => implode(', ', $officeNames) ?: $cat
        ];
    }
    return $supervisors;
}

/**
 * Helper to resolve all active Student Assistants along with their assigned
 * Department/Location, Immediate Supervisor, and relevant academic/disciplinary records.
 */
function resolve_semester_sa_roster(PDO $pdo, int $semId): array
{
    ensure_assigned_office_schedules($semId);
    sync_approved_to_assignments($semId);
    $sched = schedule_view($semId);
    $bySaSched = [];
    foreach ($sched['staff'] ?? [] as $st) {
        $bySaSched[(int) ($st['saId'] ?? 0)] = $st;
    }

    $supervisors = get_all_supervisors_with_scope($pdo);

    $warningsBySa = [];
    try {
        $wStmt = $pdo->query("SELECT sa_profile_id, COUNT(*) AS cnt FROM sa_warning_memos GROUP BY sa_profile_id");
        foreach ($wStmt as $wr) {
            $warningsBySa[(int) $wr['sa_profile_id']] = (int) $wr['cnt'];
        }
    } catch (Throwable $e) {}

    $stmt = $pdo->query("
        SELECT p.id, p.user_id, p.student_id, p.sa_number, p.first_name, p.middle_name, p.last_name, p.suffix,
               p.course, p.year_level, p.sa_category, p.office_id, p.supervisor_id,
               p.academic_status, p.enrollment_status, p.disciplinary_status, p.weekly_target_hours,
               p.personal_email, u.email AS user_email,
               o.name AS office_name
          FROM sa_profiles p
          LEFT JOIN users u ON u.id = p.user_id
          LEFT JOIN offices o ON o.id = p.office_id
         WHERE p.sa_status = 'ACTIVE' AND p.archived_at IS NULL
         ORDER BY p.last_name ASC, p.first_name ASC
    ");
    $saRows = $stmt->fetchAll();

    $roster = [];
    foreach ($saRows as $sa) {
        $saId = (int) $sa['id'];
        $fullName = preg_replace('/\s+/', ' ', trim(implode(' ', array_filter([
            $sa['first_name'], $sa['middle_name'], $sa['last_name'], $sa['suffix']
        ]))));
        $cat = strtoupper((string) ($sa['sa_category'] ?? 'OFFICE'));
        $officeId = $sa['office_id'] ? (int) $sa['office_id'] : null;
        $officeName = $sa['office_name'] === 'PRMD' ? 'PRD' : ($sa['office_name'] ?? '');

        $stSched = $bySaSched[$saId] ?? null;
        $schedDept = strtoupper((string) ($stSched['department'] ?? $cat));
        $location = $stSched['location'] ?? ($officeName ?: ($cat . ' Department'));

        $primarySupervisor = null;
        $matchingSupervisorIds = [];

        $explicitSupId = $sa['supervisor_id'] ? (int) $sa['supervisor_id'] : null;
        if ($explicitSupId && isset($supervisors[$explicitSupId])) {
            $primarySupervisor = $supervisors[$explicitSupId];
            $matchingSupervisorIds[] = $explicitSupId;
        }

        foreach ($supervisors as $supId => $sup) {
            $inScope = ($explicitSupId === $supId)
                || ($sup['category'] === 'ITO' && ($cat === 'ITO' || $schedDept === 'ITO'))
                || ($sup['category'] === 'ACADS' && ($cat === 'ACADS' || $schedDept === 'ACADS'))
                || ($officeId && in_array($officeId, $sup['officeIds'], true));
            if ($inScope) {
                if (!in_array($supId, $matchingSupervisorIds, true)) {
                    $matchingSupervisorIds[] = $supId;
                }
                if (!$primarySupervisor) {
                    $primarySupervisor = $sup;
                }
            }
        }

        $roster[$saId] = [
            'saProfileId' => $saId,
            'userId' => $sa['user_id'] ? (int) $sa['user_id'] : null,
            'email' => $sa['user_email'] ?: ($sa['personal_email'] ?? null),
            'studentId' => $sa['student_id'],
            'saNumber' => $sa['sa_number'] ?? null,
            'studentName' => $fullName,
            'positionTitle' => "Student Assistant ({$sa['student_id']})",
            'course' => $sa['course'],
            'yearLevel' => (int) $sa['year_level'],
            'category' => $cat === 'OFFICE' ? 'OFFICES' : $cat,
            'department' => $location,
            'officeName' => $officeName ?: $cat,
            'supervisorId' => $primarySupervisor ? $primarySupervisor['id'] : null,
            'supervisorName' => $primarySupervisor ? $primarySupervisor['name'] : 'S.A. Coordinator',
            'matchingSupervisorIds' => $matchingSupervisorIds,
            'creditedHours' => (float) ($stSched['creditedHours'] ?? 0),
            'weeklyTargetHours' => (float) ($sa['weekly_target_hours'] ?? 35),
            'academicStatus' => $sa['academic_status'] ?? 'REGULAR',
            'enrollmentStatus' => $sa['enrollment_status'] ?? 'ENROLLED',
            'disciplinaryStatus' => $sa['disciplinary_status'] ?? 'GOOD_STANDING',
            'warningCount' => $warningsBySa[$saId] ?? 0,
        ];
    }

    return [
        'supervisors' => $supervisors,
        'roster' => $roster
    ];
}

function compute_rating_label(float $avg, int $answered): string
{
    if ($answered === 0) return 'Pending Assessment';
    if ($avg >= 3.5) return 'Above Average';
    if ($avg >= 2.5) return 'Satisfactory';
    if ($avg >= 1.8) return 'Below Average';
    return 'Unsatisfactory';
}

function format_decision_label(?string $decision): ?string
{
    return match (strtoupper((string) $decision)) {
        'RETAIN' => 'Retain',
        'IMPROVEMENT_PLAN' => 'Improvement Plan',
        'REASSIGNMENT' => 'Reassignment',
        'NOT_RENEWED', 'DISQUALIFIED' => 'Non-Renewal / Discontinued',
        default => null,
    };
}

function normalize_evaluation_status(?string $rawStatus, ?array $ev = null): string
{
    $s = strtoupper(trim((string) ($rawStatus ?? 'PENDING')));
    return match ($s) {
        'PENDING', 'STEP1_IN_PROGRESS' => 'PENDING',
        'RETURNED_FOR_REVISION', 'STEP1_RETURNED_FOR_REVISION' => 'RETURNED_FOR_REVISION',
        'FOR_COORDINATOR_REVIEW', 'STEP2_PENDING_COORDINATOR_REVIEW', 'STEP3_PENDING_COORDINATOR_REVIEW', 'PENDING_COORDINATOR_REVIEW' => 'FOR_COORDINATOR_REVIEW',
        'REJECTED', 'COORDINATOR_REJECTED' => 'REJECTED',
        'FOR_SA_REVIEW', 'STEP3_PENDING_ACKNOWLEDGMENT', 'STEP2_PENDING_ACKNOWLEDGMENT' => 'FOR_SA_REVIEW',
        'FOR_FINAL_DECISION', 'STEP4_PENDING_FINAL_DECISION' => 'FOR_COORDINATOR_REVIEW',
        'FINALIZED', 'STEP4_FINALIZED', 'STEP5_FINALIZED' => 'FINALIZED',
        'COMPLETED' => (!empty($ev['coordinator_decision']) && !empty($ev['sa_acknowledged_at']))
            ? 'FINALIZED'
            : (!empty($ev['coordinator_decision']) ? 'FOR_SA_REVIEW' : 'FOR_COORDINATOR_REVIEW'),
        default => 'PENDING',
    };
}

function compute_process_step(string $status): int
{
    $norm = normalize_evaluation_status($status);
    return match ($norm) {
        'PENDING', 'RETURNED_FOR_REVISION' => 1,
        'FOR_SA_REVIEW' => 3,
        'FOR_COORDINATOR_REVIEW', 'FOR_FINAL_DECISION', 'REJECTED' => 4,
        'FINALIZED' => 5,
        default => 1,
    };
}

function compute_workflow_stage_key(string $status): string
{
    $norm = normalize_evaluation_status($status);
    return match ($norm) {
        'PENDING', 'RETURNED_FOR_REVISION' => 'step1_in_progress',
        'FOR_SA_REVIEW' => 'pending_sa_acknowledgment',
        'FOR_COORDINATOR_REVIEW', 'FOR_FINAL_DECISION' => 'pending_coordinator_review',
        'REJECTED' => 'coordinator_rejected',
        'FINALIZED' => 'completed',
        default => 'step1_in_progress',
    };
}

/**
 * Fetches action history and notification logs in bulk for a list of evaluation IDs.
 */
function fetch_evaluation_audit_maps(PDO $pdo, array $evaluationIds): array
{
    $evaluationIds = array_values(array_unique(array_filter(array_map('intval', $evaluationIds))));
    if (empty($evaluationIds)) {
        return ['actions' => [], 'notifications' => []];
    }
    $inClause = implode(',', $evaluationIds);

    $actionsByEval = [];
    try {
        $aStmt = $pdo->query("
            SELECT id, evaluation_id, actor_user_id, actor_name, actor_role,
                   action_type, from_status, to_status, ack_status, remarks, created_at
              FROM evaluation_action_history
             WHERE evaluation_id IN ({$inClause})
             ORDER BY id DESC
        ");
        foreach ($aStmt as $row) {
            $eid = (int) $row['evaluation_id'];
            $actionsByEval[$eid][] = [
                'id' => (int) $row['id'],
                'actorUserId' => $row['actor_user_id'] ? (int) $row['actor_user_id'] : null,
                'actorName' => $row['actor_name'],
                'actorRole' => $row['actor_role'],
                'actionType' => $row['action_type'],
                'fromStatus' => $row['from_status'],
                'toStatus' => $row['to_status'],
                'ackStatus' => $row['ack_status'],
                'remarks' => $row['remarks'],
                'createdAt' => $row['created_at'],
            ];
        }
    } catch (Throwable $e) {}

    $notifsByEval = [];
    try {
        $nStmt = $pdo->query("
            SELECT l.id, l.evaluation_id, l.recipient_user_id, l.recipient_email,
                   l.event_key, l.channel, l.subject, l.delivery_status, l.error_message, l.created_at,
                   u.full_name AS recipient_name, u.role AS recipient_role
              FROM evaluation_notification_logs l
              LEFT JOIN users u ON u.id = l.recipient_user_id
             WHERE l.evaluation_id IN ({$inClause})
             ORDER BY l.id DESC
             LIMIT 300
        ");
        foreach ($nStmt as $row) {
            $eid = (int) $row['evaluation_id'];
            $notifsByEval[$eid][] = [
                'id' => (int) $row['id'],
                'recipientUserId' => (int) $row['recipient_user_id'],
                'recipientName' => $row['recipient_name'] ?? 'User #' . $row['recipient_user_id'],
                'recipientRole' => $row['recipient_role'] ?? '',
                'recipientEmail' => $row['recipient_email'],
                'eventKey' => $row['event_key'],
                'channel' => $row['channel'],
                'subject' => $row['subject'],
                'deliveryStatus' => $row['delivery_status'],
                'errorMessage' => $row['error_message'],
                'createdAt' => $row['created_at'],
            ];
        }
    } catch (Throwable $e) {}

    return ['actions' => $actionsByEval, 'notifications' => $notifsByEval];
}

function ensure_clean_evaluation_signature(?string $sig, string $name, string $role, ?string $date, bool $isSigned): string {
    $flourishSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="380" height="100" viewBox="0 0 380 100">' .
        '<rect width="380" height="100" fill="#FFFFFF"/>' .
        '<path d="M 110 35 C 125 72 135 74 145 45 C 150 28 165 32 175 52 C 182 66 195 64 205 42 C 215 26 235 76 245 32 C 252 22 260 70 265 72 M 130 42 C 170 38 220 44 275 58" fill="none" stroke="#0F2C59" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' .
        '</svg>';

    // If it's already a clean hand-drawn PNG or clean stroke and not static font text, preserve it
    if (!empty($sig) && str_starts_with($sig, 'data:image')) {
        if (str_starts_with($sig, 'data:image/svg+xml')) {
            $commaPos = strpos($sig, ',');
            $decodedSvg = $commaPos !== false ? (base64_decode(substr($sig, $commaPos + 1)) ?: '') : $sig;
            if (str_contains($decodedSvg, '<text') || str_contains($decodedSvg, 'Georgia') || str_contains($decodedSvg, 'font-family')) {
                return $isSigned ? ('data:image/svg+xml;base64,' . base64_encode($flourishSvg)) : '';
            }
        }
        if (!str_contains($sig, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB') && !str_contains($sig, 'Electronically')) {
            return $sig;
        }
    }
    if ($isSigned) {
        return 'data:image/svg+xml;base64,' . base64_encode($flourishSvg);
    }
    return '';
}

function format_evaluation_row(
    ?array $ev,
    array $saItem,
    string $defaultTerm,
    ?string $campaignDeadline = null,
    array $actionHistory = [],
    array $notificationLogs = [],
    ?string $viewerRole = null
): array {
    $criteria = [];
    $answeredCount = 0;
    for ($i = 1; $i <= 10; $i++) {
        $val = isset($ev["c{$i}"]) && $ev["c{$i}"] !== null ? (int) $ev["c{$i}"] : null;
        if ($val !== null && $val >= 1 && $val <= 4) {
            $answeredCount++;
        }
        $criteria[$i] = $val;
    }

    $status = normalize_evaluation_status($ev['status'] ?? 'PENDING', $ev);
    $workflowStage = compute_workflow_stage_key($status);

    $ackStatus = $ev['acknowledgment_status'] ?? 'PENDING';
    if ($ackStatus === 'PENDING' && (!empty($ev['sa_acknowledged_at']) || !empty($ev['student_signature']))) {
        $ackStatus = 'SIGNED';
    }

    $supervisorDone = in_array($status, ['FOR_COORDINATOR_REVIEW', 'REJECTED', 'FOR_SA_REVIEW', 'FINALIZED'], true);
    $saAcknowledged = ($ackStatus === 'SIGNED')
        || !empty($ev['sa_acknowledged_at'])
        || !empty($ev['student_signature']);
    $isFinalized = ($status === 'FINALIZED');
    $canSupervisorEdit = in_array($status, ['PENDING', 'RETURNED_FOR_REVISION'], true);
    $canSaAcknowledge = ($status === 'FOR_SA_REVIEW' && !$saAcknowledged);
    $hasDraft = !$supervisorDone && ($answeredCount > 0 || !empty($ev['strengths_weaknesses']));

    $ackDueDate = $ev['ack_due_date'] ?? null;
    $today = date('Y-m-d');
    $isAckOverdue = ($status === 'FOR_SA_REVIEW' && !$saAcknowledged && !empty($ackDueDate) && $today > $ackDueDate)
        || in_array($ackStatus, ['OVERDUE_AWAITING_SA', 'OVERDUE_AWAITING_COORDINATOR'], true);

    $ackStatusLabel = EVAL_ACK_STATUSES[$ackStatus] ?? $ackStatus;
    if ($status === 'FOR_SA_REVIEW' && $ackStatus === 'PENDING') {
        $ackStatusLabel = 'Awaiting S.A.';
    }

    $studentName = $ev['student_name'] ?? $saItem['studentName'];
    $supervisorName = $ev['supervisor_name'] ?? $saItem['supervisorName'];

    if ($canSupervisorEdit) {
        $nextActionRole = 'SUPERVISOR';
        $nextActionAssignedTo = $supervisorName;
    } elseif ($status === 'FOR_COORDINATOR_REVIEW') {
        $nextActionRole = 'COORDINATOR';
        $nextActionAssignedTo = 'S.A. Coordinator';
    } elseif ($status === 'REJECTED') {
        $nextActionRole = 'COORDINATOR';
        $nextActionAssignedTo = 'Rejected by Coordinator';
    } elseif ($status === 'FOR_SA_REVIEW') {
        $nextActionRole = 'SA';
        $nextActionAssignedTo = $studentName;
    } else {
        $nextActionRole = 'NONE';
        $nextActionAssignedTo = 'Completed';
    }

    $authorizedActions = [
        'workflowStage' => $workflowStage,
        'activeStep' => compute_process_step($status),
        'nextActionRole' => $nextActionRole,
        'nextActionAssignedTo' => $nextActionAssignedTo,
        'supervisor' => $canSupervisorEdit
            ? ['SAVE_DRAFT_STEP1', 'SIGN_SUBMIT_RECOMMENDATION']
            : ($isFinalized ? ['VIEW_FINALIZED_EVALUATION'] : ['VIEW_EVALUATION', 'REQUEST_REVISION_AUTH']),
        'sa' => $canSaAcknowledge
            ? ['VIEW_EVALUATION', 'ACKNOWLEDGE_EVALUATION', 'SUBMIT_RESPONSE']
            : ($isFinalized ? ['VIEW_EVALUATION'] : []),
        'coordinator' => ($status === 'FOR_COORDINATOR_REVIEW')
            ? ['REVIEW_EVALUATION', 'APPROVE_DECISION', 'RETURN_FOR_REVISION', 'REJECT_RECOMMENDATION']
            : ($status === 'FOR_SA_REVIEW' ? ['VIEW_EVALUATION', 'RETURN_FOR_REVISION'] : ($isFinalized ? ['VIEW_FINALIZED_EVALUATION', 'REOPEN_EVALUATION'] : ['VIEW_EVALUATION'])),
    ];

    $evForTracker = $ev ? array_merge($ev, ['status' => $status]) : null;
    $tracker = build_evaluation_tracker($evForTracker, $saItem, $campaignDeadline);
    $evalId = $ev ? (int) $ev['id'] : null;
    $evaluationRef = $evalId ? ('EVAL-#' . $evalId) : ('EVAL-SA-' . $saItem['saProfileId']);

    $supervisorRecommendation = $ev['supervisor_recommendation'] ?? null;
    if (!$supervisorRecommendation && !empty($ev['recommendation'])) {
        $supervisorRecommendation = ($ev['recommendation'] === 'NOT_RECOMMENDED') ? 'NOT_RENEWED' : 'RETAIN';
    }
    $supervisorReason = $ev['supervisor_reason'] ?? ($ev['strengths_weaknesses'] ?? '');
    $disclosedFeedback = $ev['disclosed_feedback'] ?? ($ev['coordinator_reason'] ?? ($ev['strengths_weaknesses'] ?? ''));
    $rejectionReason = $ev['rejection_reason'] ?? '';
    $rejectedAt = $ev['rejected_at'] ?? null;
    $rejectedByName = $ev['rejected_by_name'] ?? null;

    $isSaViewer = ($viewerRole === 'SA') || (($GLOBALS['user']['role'] ?? '') === 'SA');
    $isReleasedToSa = in_array($status, ['FOR_SA_REVIEW', 'FOR_COORDINATOR_REVIEW', 'FINALIZED'], true);

    if ($isSaViewer && !$isReleasedToSa) {
        $criteria = array_fill(1, 10, null);
        $totalScore = 0;
        $averageScore = 0.00;
        $ratingLabel = 'Pending Supervisor Assessment';
        $disclosedFeedback = '';
    } else {
        $totalScore = $ev ? (int) $ev['total_score'] : 0;
        $averageScore = $ev ? round((float) $ev['average_score'], 2) : 0.00;
        $ratingLabel = $ev['rating_label'] ?? 'Pending Assessment';
    }

    $supSigned = !empty($ev['supervisor_sign_date']) || !empty($ev['supervisor_signature']);
    $rawSupSig = ($isSaViewer && !$isReleasedToSa) ? '' : ensure_clean_evaluation_signature(
        $ev['supervisor_signature'] ?? '',
        $ev['supervisor_name'] ?? 'Immediate Supervisor',
        $ev['supervisor_title'] ?? 'Immediate Supervisor',
        !empty($ev['supervisor_sign_date']) ? date('F j, Y', strtotime($ev['supervisor_sign_date'])) : '',
        $supSigned && !($isSaViewer && !$isReleasedToSa)
    );

    $stuSigned = !empty($ev['sa_acknowledged_at'])
        || !empty($ev['student_signature'])
        || !empty($ev['student_sign_date'])
        || in_array($status, ['FOR_COORDINATOR_REVIEW', 'FOR_FINAL_DECISION', 'FINALIZED'], true);
    $rawStuSig = ensure_clean_evaluation_signature(
        $ev['student_signature'] ?? '',
        $ev['student_name'] ?? 'Student Assistant',
        $ev['student_role'] ?? 'Student Assistant',
        !empty($ev['student_sign_date']) ? date('F j, Y', strtotime($ev['student_sign_date'])) : (!empty($ev['sa_acknowledged_at']) ? date('F j, Y', strtotime($ev['sa_acknowledged_at'])) : ''),
        $stuSigned
    );

    return [
        'evaluationId' => $evalId,
        'evaluationRef' => $evaluationRef,
        'campaignId' => $ev ? (int) $ev['campaign_id'] : null,
        'saProfileId' => $saItem['saProfileId'],
        'saUserId' => !empty($ev['sa_user_id']) ? (int) $ev['sa_user_id'] : ($saItem['userId'] ?? null),
        'studentId' => $saItem['studentId'],
        'saNumber' => $saItem['saNumber'] ?? null,
        'studentName' => $studentName,
        'positionTitle' => $ev['position_title'] ?? $saItem['positionTitle'],
        'course' => $saItem['course'],
        'yearLevel' => $saItem['yearLevel'],
        'category' => $saItem['category'],
        'department' => $ev['department'] ?? $saItem['department'],
        'supervisorId' => $ev && $ev['supervisor_id'] ? (int) $ev['supervisor_id'] : $saItem['supervisorId'],
        'supervisorName' => $supervisorName,
        'evaluationPeriod' => $ev['evaluation_period'] ?? $defaultTerm,
        'evalDate' => $ev['eval_date'] ?? date('Y-m-d'),
        'criteria' => $criteria,
        'answeredCriteriaCount' => ($isSaViewer && !$isReleasedToSa) ? 0 : $answeredCount,
        'hasDraft' => $hasDraft,
        'totalScore' => $totalScore,
        'averageScore' => $averageScore,
        'ratingLabel' => $ratingLabel,
        'strengthsWeaknesses' => ($isSaViewer && !$isReleasedToSa) ? null : ($ev['strengths_weaknesses'] ?? ''),
        'standardRemarks' => ($isSaViewer && !$isReleasedToSa) ? null : ($ev['standard_remarks'] ?? ''),
        'recommendation' => ($isSaViewer && !$isReleasedToSa) ? 'PENDING' : ($ev['recommendation'] ?? 'PENDING'),
        'supervisorRecommendation' => ($isSaViewer && !$isReleasedToSa) ? null : $supervisorRecommendation,
        'supervisorRecommendationLabel' => ($isSaViewer && !$isReleasedToSa) ? null : format_decision_label($supervisorRecommendation),
        'supervisorReason' => ($isSaViewer && !$isReleasedToSa) ? null : $supervisorReason,
        'disclosedFeedback' => $isReleasedToSa ? $disclosedFeedback : '',
        'rejectionReason' => $isSaViewer ? null : $rejectionReason,
        'rejectedAt' => $isSaViewer ? null : $rejectedAt,
        'rejectedByName' => $isSaViewer ? null : $rejectedByName,


        'supervisorSignature' => $rawSupSig,
        'supervisorTitle' => $ev['supervisor_title'] ?? 'Immediate Supervisor',
        'supervisorSignDate' => !empty($rawSupSig) ? ($ev['supervisor_sign_date'] ?? date('Y-m-d')) : ($ev['supervisor_sign_date'] ?? ''),
        'studentSignature' => $rawStuSig,
        'studentRole' => $ev['student_role'] ?? 'Student Assistant',
        'studentSignDate' => $stuSigned
            ? (!empty($ev['student_sign_date']) ? $ev['student_sign_date'] : (!empty($ev['sa_acknowledged_at']) ? substr((string) $ev['sa_acknowledged_at'], 0, 10) : ($ev['eval_date'] ?? date('Y-m-d'))))
            : '',
        'saComments' => $ev['sa_comments'] ?? '',
        'saConcernText' => $ev['sa_concern_text'] ?? '',
        'saHasDispute' => !empty($ev['sa_has_dispute']) || $ackStatus === 'CONCERN_SUBMITTED',
        'saExceptionReason' => $ev['sa_exception_reason'] ?? '',
        'saAcknowledgedAt' => $ev['sa_acknowledged_at'] ?? null,
        'acknowledgmentStatus' => $ackStatus,
        'acknowledgmentStatusLabel' => $ackStatusLabel,
        'ackReleasedAt' => $ev['ack_released_at'] ?? ($ev['submitted_at'] ?? null),
        'ackDueDate' => $ackDueDate,
        'originalAckDueDate' => $ev['original_ack_due_date'] ?? $ackDueDate,
        'isAckOverdue' => $isAckOverdue,
        'extensionStatus' => $ev['extension_status'] ?? 'NONE',
        'extensionReasonCategory' => $ev['extension_reason_category'] ?? '',
        'extensionExplanation' => $ev['extension_explanation'] ?? '',
        'extensionRequestedAt' => $ev['extension_requested_at'] ?? null,
        'extensionRequestedDays' => !empty($ev['extension_requested_days']) ? (int) $ev['extension_requested_days'] : EVAL_DEFAULT_EXTENSION_SCHOOL_DAYS,
        'extensionDecidedBy' => !empty($ev['extension_decided_by']) ? (int) $ev['extension_decided_by'] : null,
        'extensionDecidedByName' => $ev['extension_decided_by_name'] ?? null,
        'extensionDecidedAt' => $ev['extension_decided_at'] ?? null,
        'extensionDecisionReason' => $ev['extension_decision_reason'] ?? '',
        'revisionCount' => !empty($ev['revision_count']) ? (int) $ev['revision_count'] : 0,
        'lastReturnReason' => $isSaViewer ? null : ($ev['last_return_reason'] ?? ''),
        'returnedBy' => $isSaViewer ? null : (!empty($ev['returned_by']) ? (int) $ev['returned_by'] : null),
        'returnedByName' => $isSaViewer ? null : ($ev['returned_by_name'] ?? null),
        'returnedAt' => $isSaViewer ? null : ($ev['returned_at'] ?? null),
        'supervisorRevisionRequest' => $isSaViewer ? null : ($ev['supervisor_revision_request'] ?? ''),
        'supervisorRevisionRequestedAt' => $isSaViewer ? null : ($ev['supervisor_revision_requested_at'] ?? null),
        'coordinatorDecision' => $isSaViewer ? null : ($ev['coordinator_decision'] ?? null),
        'coordinatorDecisionLabel' => $isSaViewer ? null : format_decision_label($ev['coordinator_decision'] ?? null),
        'coordinatorReason' => $isSaViewer ? null : ($ev['coordinator_reason'] ?? ''),
        'effectiveDate' => $ev['effective_date'] ?? null,
        'coordinatorId' => !empty($ev['coordinator_id']) ? (int) $ev['coordinator_id'] : null,
        'coordinatorName' => $ev['coordinator_name'] ?? null,
        'finalizedAt' => $ev['finalized_at'] ?? null,
        'reopenedBy' => !empty($ev['reopened_by']) ? (int) $ev['reopened_by'] : null,
        'reopenedByName' => $ev['reopened_by_name'] ?? null,
        'reopenedAt' => $ev['reopened_at'] ?? null,
        'reopenReason' => $ev['reopen_reason'] ?? '',
        'status' => $status,
        'workflowStage' => $workflowStage,
        'processStep' => compute_process_step($status),
        'nextActionRole' => $nextActionRole,
        'nextActionAssignedTo' => $nextActionAssignedTo,
        'authorizedActions' => $authorizedActions,
        'supervisorDone' => $supervisorDone,
        'canSupervisorEdit' => $canSupervisorEdit,
        'canSaAcknowledge' => $canSaAcknowledge,
        'saAcknowledged' => $saAcknowledged,
        'isFinalized' => $isFinalized,
        'isReleasedToSa' => $isReleasedToSa,
        'submittedAt' => $ev['submitted_at'] ?? null,
        'updatedAt' => $ev['updated_at'] ?? null,
        'tracker' => $tracker,
        'actionHistory' => $actionHistory,
        'notificationLogs' => $notificationLogs,
        // Relevant S.A. records for Step 3 Coordinator review
        'records' => [
            'creditedHours' => $saItem['creditedHours'],
            'weeklyTargetHours' => $saItem['weeklyTargetHours'],
            'academicStatus' => $saItem['academicStatus'],
            'enrollmentStatus' => $saItem['enrollmentStatus'],
            'disciplinaryStatus' => $saItem['disciplinaryStatus'],
            'warningCount' => $saItem['warningCount'],
        ],
    ];
}

function load_fresh_formatted_evaluation(
    PDO $pdo,
    int $evalIdOrSemId,
    int $semIdOrSaProfileId,
    int|string|null $saProfileIdOrDefaultTerm = null,
    ?array $saItem = null,
    ?string $defaultTerm = null,
    ?string $viewerRole = null
): ?array {
    try {
        if (is_string($saProfileIdOrDefaultTerm) || $saProfileIdOrDefaultTerm === null) {
            $semId = $evalIdOrSemId;
            $saProfileId = $semIdOrSaProfileId;
            $termLabel = is_string($saProfileIdOrDefaultTerm) && $saProfileIdOrDefaultTerm !== ''
                ? $saProfileIdOrDefaultTerm
                : ($defaultTerm ?: 'Current Semester');
            $stmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
            $stmt->execute([$semId, $saProfileId]);
            $ev = $stmt->fetch() ?: null;
            $evalId = $ev ? (int) $ev['id'] : 0;
        } else {
            $evalId = $evalIdOrSemId;
            $semId = $semIdOrSaProfileId;
            $saProfileId = (int) $saProfileIdOrDefaultTerm;
            $termLabel = $defaultTerm ?: 'Current Semester';
            $ev = null;
            if ($evalId > 0) {
                $stmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE id = ? LIMIT 1");
                $stmt->execute([$evalId]);
                $ev = $stmt->fetch() ?: null;
            }
            if (!$ev && $semId > 0 && $saProfileId > 0) {
                $stmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
                $stmt->execute([$semId, $saProfileId]);
                $ev = $stmt->fetch() ?: null;
                $evalId = $ev ? (int) $ev['id'] : 0;
            }
        }

        if (!$ev) {
            return null;
        }
        if (!$saItem) {
            $resolved = resolve_semester_sa_roster($pdo, $semId);
            $saItem = $resolved['roster'][$saProfileId] ?? null;
        }
        if (!$saItem) {
            return null;
        }
        $campDeadline = null;
        if (!empty($ev['campaign_id'])) {
            $cStmt = $pdo->prepare("SELECT deadline FROM evaluation_campaigns WHERE id = ? LIMIT 1");
            $cStmt->execute([(int) $ev['campaign_id']]);
            $campDeadline = $cStmt->fetchColumn() ?: null;
        }
        $auditMaps = fetch_evaluation_audit_maps($pdo, $evalId > 0 ? [$evalId] : []);
        return format_evaluation_row(
            $ev,
            $saItem,
            $ev['evaluation_period'] ?? $termLabel,
            $campDeadline,
            $auditMaps['actions'][$evalId] ?? [],
            $auditMaps['notifications'][$evalId] ?? [],
            $viewerRole
        );
    } catch (Throwable $e) {
        error_log('[AssistPay load_fresh_formatted_evaluation Error] ' . $e->getMessage());
        return null;
    }
}

switch ($action) {

    // =========================================================================
    // 1. ADMIN OVERVIEW (Coordinator views campaign + all S.A. evaluations)
    // =========================================================================
    case 'admin_overview':
        require_role($user, 'ADMIN');
        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $reminderStats = process_evaluation_deadlines_and_reminders($pdo, $semId);

        $campStmt = $pdo->prepare("SELECT * FROM evaluation_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1");
        $campStmt->execute([$semId]);
        $camp = $campStmt->fetch() ?: null;

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $supervisors = $resolved['supervisors'];
        $roster = $resolved['roster'];

        $evalMap = [];
        $evalIds = [];
        $eStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? ORDER BY id ASC");
        $eStmt->execute([$semId]);
        foreach ($eStmt as $er) {
            $evalMap[(int) $er['sa_profile_id']] = $er;
            $evalIds[] = (int) $er['id'];
        }
        if ($camp) {
            $cStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE campaign_id = ? ORDER BY id ASC");
            $cStmt->execute([(int) $camp['id']]);
            foreach ($cStmt as $er) {
                $evalMap[(int) $er['sa_profile_id']] = $er;
                if (!in_array((int) $er['id'], $evalIds, true)) {
                    $evalIds[] = (int) $er['id'];
                }
            }
        }

        $auditMaps = fetch_evaluation_audit_maps($pdo, $evalIds);
        $defaultTerm = $camp ? $camp['academic_term'] : $sem['label'];
        $campDeadline = $camp['deadline'] ?? null;

        $evaluations = [];
        $completedCount = 0; // Supervisor completed (Step 1 done)
        $pendingCount = 0;   // Waiting for Supervisor (Step 1 pending or returned)
        $forSaReviewCount = 0;
        $forCoordinatorCount = 0;
        $forFinalDecisionCount = 0;
        $finalizedCount = 0;
        $recommendedCount = 0;
        $notRecommendedCount = 0;
        $overdueCount = 0;
        $extensionPendingCount = 0;
        $concernCount = 0;
        $returnedCount = 0;
        $inProgressCount = 0;
        $awaitingActionCount = 0;
        $sumAvg = 0.0;

        foreach ($roster as $saId => $saItem) {
            $ev = $evalMap[$saId] ?? null;
            $eid = $ev ? (int) $ev['id'] : 0;
            $formatted = format_evaluation_row(
                $ev,
                $saItem,
                $defaultTerm,
                $campDeadline,
                $auditMaps['actions'][$eid] ?? [],
                $auditMaps['notifications'][$eid] ?? [],
                'ADMIN'
            );
            if ($formatted['supervisorDone']) {
                $completedCount++;
                $sumAvg += $formatted['averageScore'];
                if ($formatted['recommendation'] === 'RECOMMENDED') $recommendedCount++;
                elseif ($formatted['recommendation'] === 'NOT_RECOMMENDED') $notRecommendedCount++;
            } else {
                $pendingCount++;
            }
            if ($formatted['status'] === 'RETURNED_FOR_REVISION') {
                $returnedCount++;
                $inProgressCount++;
                $awaitingActionCount++;
            } elseif ($formatted['status'] === 'FOR_SA_REVIEW') {
                $forSaReviewCount++;
                $inProgressCount++;
                if ($formatted['isAckOverdue'] || $formatted['extensionStatus'] === 'PENDING' || $formatted['acknowledgmentStatus'] === 'EXTENSION_REQUESTED' || !empty($formatted['supervisorRevisionRequest'])) {
                    $awaitingActionCount++;
                }
            } elseif ($formatted['status'] === 'FOR_COORDINATOR_REVIEW') {
                $forCoordinatorCount++;
                $inProgressCount++;
                $awaitingActionCount++;
            } elseif ($formatted['status'] === 'FOR_FINAL_DECISION') {
                $forCoordinatorCount++;
                $forFinalDecisionCount++;
                $inProgressCount++;
                $awaitingActionCount++;
            } elseif ($formatted['status'] === 'FINALIZED') {
                $finalizedCount++;
            } else {
                // PENDING Step 1
                if ($formatted['hasDraft']) {
                    $inProgressCount++;
                }
                if ($camp) {
                    $awaitingActionCount++;
                }
            }

            if ($formatted['isAckOverdue']) $overdueCount++;
            if ($formatted['extensionStatus'] === 'PENDING' || $formatted['acknowledgmentStatus'] === 'EXTENSION_REQUESTED') {
                $extensionPendingCount++;
            }
            if ($formatted['saHasDispute'] || in_array($formatted['acknowledgmentStatus'], ['CONCERN_SUBMITTED', 'ACKNOWLEDGMENT_DECLINED', 'UNABLE_TO_ACKNOWLEDGE'], true)) {
                $concernCount++;
            }

            $evaluations[] = $formatted;
        }

        // Compute per-supervisor progress summary
        $supProgress = [];
        foreach ($supervisors as $supId => $sup) {
            $assignedTotal = 0;
            $completedTotal = 0;
            foreach ($roster as $saId => $saItem) {
                if (in_array($supId, $saItem['matchingSupervisorIds'], true)) {
                    $assignedTotal++;
                    $ev = $evalMap[$saId] ?? null;
                    if ($ev && !in_array($ev['status'], ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
                        $completedTotal++;
                    }
                }
            }
            $supProgress[] = [
                'supervisorId' => $supId,
                'name' => $sup['name'],
                'empId' => $sup['empId'],
                'category' => $sup['category'] === 'OFFICE' ? 'OFFICES' : $sup['category'],
                'department' => $sup['deptLabel'],
                'assignedCount' => $assignedTotal,
                'completedCount' => $completedTotal,
                'pendingCount' => max(0, $assignedTotal - $completedTotal),
            ];
        }

        $holidays = [];
        try {
            $hStmt = $pdo->query("SELECT id, holiday_date, name FROM school_holidays ORDER BY holiday_date ASC");
            foreach ($hStmt as $hr) {
                $holidays[] = [
                    'id' => (int) $hr['id'],
                    'date' => $hr['holiday_date'],
                    'name' => $hr['name'],
                ];
            }
        } catch (Throwable $e) {}

        respond([
            'success' => true,
            'semester' => $sem,
            'campaign' => $camp ? [
                'id' => (int) $camp['id'],
                'title' => $camp['title'],
                'academicTerm' => $camp['academic_term'],
                'instructions' => $camp['instructions'],
                'deadline' => $camp['deadline'],
                'status' => $camp['status'],
                'createdAt' => $camp['created_at'],
            ] : null,
            'summary' => [
                'totalSas' => count($evaluations),
                'completedCount' => $completedCount,
                'pendingCount' => $pendingCount,
                'forSaReviewCount' => $forSaReviewCount,
                'forCoordinatorCount' => $forCoordinatorCount,
                'forFinalDecisionCount' => $forFinalDecisionCount,
                'finalizedCount' => $finalizedCount,
                'inProgressCount' => $inProgressCount,
                'awaitingActionCount' => $awaitingActionCount,
                'recommendedCount' => $recommendedCount,
                'notRecommendedCount' => $notRecommendedCount,
                'overdueCount' => $overdueCount,
                'extensionPendingCount' => $extensionPendingCount,
                'concernCount' => $concernCount,
                'returnedCount' => $returnedCount,
                'overallAverage' => $completedCount > 0 ? round($sumAvg / $completedCount, 2) : 0.00,
                'reminderCheck' => $reminderStats,
            ],
            'supervisorProgress' => $supProgress,
            'evaluations' => $evaluations,
            'extensionReasonCategories' => EVAL_EXTENSION_REASON_CATEGORIES,
            'schoolHolidays' => $holidays,
        ]);

    // =========================================================================
    // 2. SEND / LAUNCH EVALUATION CAMPAIGN TO SUPERVISORS (Coordinator)
    // =========================================================================
    case 'send_campaign':
        require_role($user, 'ADMIN');
        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $title = trim($in['title'] ?? '') ?: ($sem['label'] . ' Student Assistant Performance Evaluation');
        $academicTerm = trim($in['academicTerm'] ?? '') ?: $sem['label'];
        $instructions = trim($in['instructions'] ?? '') ?: 'Please evaluate each Student Assistant assigned to your department or office using the 5-Step NCST Evaluation Form.';
        $deadline = !empty($in['deadline']) ? trim($in['deadline']) : null;

        if ($deadline && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $deadline)) {
            fail('Invalid deadline date format.', 422);
        }

        $campStmt = $pdo->prepare("SELECT * FROM evaluation_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1");
        $campStmt->execute([$semId]);
        $existingCamp = $campStmt->fetch();

        if ($existingCamp) {
            $campId = (int) $existingCamp['id'];
            $pdo->prepare("
                UPDATE evaluation_campaigns
                   SET title = ?, academic_term = ?, instructions = ?, deadline = ?, status = 'OPEN', closed_at = NULL
                 WHERE id = ?
            ")->execute([$title, $academicTerm, $instructions, $deadline, $campId]);
        } else {
            $pdo->prepare("
                INSERT INTO evaluation_campaigns (semester_id, title, academic_term, instructions, deadline, status, created_by)
                VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
            ")->execute([$semId, $title, $academicTerm, $instructions, $deadline, (int) $user['id']]);
            $campId = (int) $pdo->lastInsertId();
        }

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $supervisors = $resolved['supervisors'];
        $roster = $resolved['roster'];

        $insEval = $pdo->prepare("
            INSERT INTO sa_evaluations (
                campaign_id, semester_id, sa_profile_id, supervisor_id, sa_user_id,
                student_name, position_title, department, supervisor_name,
                evaluation_period, eval_date, status, acknowledgment_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 'PENDING', 'PENDING')
            ON DUPLICATE KEY UPDATE
                evaluation_period = VALUES(evaluation_period),
                supervisor_id = COALESCE(sa_evaluations.supervisor_id, VALUES(supervisor_id)),
                sa_user_id = COALESCE(sa_evaluations.sa_user_id, VALUES(sa_user_id))
        ");

        foreach ($roster as $saId => $saItem) {
            $insEval->execute([
                $campId,
                $semId,
                $saId,
                $saItem['supervisorId'],
                $saItem['userId'],
                $saItem['studentName'],
                $saItem['positionTitle'],
                $saItem['department'],
                $saItem['supervisorName'],
                $academicTerm,
            ]);
        }

        $notifiedSupervisors = 0;
        $deadlineText = $deadline ? " Deadline: {$deadline}." : "";
        foreach ($supervisors as $supId => $sup) {
            $mySaCount = 0;
            foreach ($roster as $saItem) {
                if (in_array($supId, $saItem['matchingSupervisorIds'], true)) {
                    $mySaCount++;
                }
            }
            create_notification(
                $supId,
                "S.A. Performance Evaluation: {$title}",
                "The S.A. Coordinator has sent the semester evaluation form for your {$mySaCount} assigned Student Assistant(s) ({$sup['deptLabel']}).{$deadlineText} Click to evaluate now.",
                'SA_EVALUATION',
                '#/supervisor/evaluations',
                (int) $user['id']
            );
            $notifiedSupervisors++;
        }

        // Notify Student Assistants that evaluation campaign is open
        foreach ($roster as $saItem) {
            if (!empty($saItem['userId'])) {
                create_notification(
                    (int) $saItem['userId'],
                    "Performance Evaluation Period: {$title}",
                    "The S.A. Performance Evaluation campaign for {$academicTerm} has been opened. Your Immediate Supervisor will complete your evaluation ratings and recommendation first.{$deadlineText}",
                    'SA_EVALUATION',
                    '#/sa/evaluations',
                    (int) $user['id']
                );
            }
        }

        audit('EVALUATION_CAMPAIGN_SENT', "Sent evaluation campaign #{$campId} '{$title}' to {$notifiedSupervisors} supervisors (" . count($roster) . " S.A.s)", (int) $user['id']);

        respond([
            'success' => true,
            'campaignId' => $campId,
            'notifiedSupervisors' => $notifiedSupervisors,
            'totalSas' => count($roster),
            'message' => "Evaluation forms sent to {$notifiedSupervisors} Supervisor(s) for " . count($roster) . " assigned Student Assistants.",
        ]);

    // =========================================================================
    // 3. REMIND SUPERVISORS (Coordinator sends follow-up notification)
    // =========================================================================
    case 'remind_supervisors':
        require_role($user, 'ADMIN');
        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];
        $targetSupId = !empty($in['supervisorId']) ? (int) $in['supervisorId'] : null;

        $campStmt = $pdo->prepare("SELECT * FROM evaluation_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1");
        $campStmt->execute([$semId]);
        $camp = $campStmt->fetch() ?: fail('Please launch/send the semester evaluation campaign first.', 400);

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $supervisors = $resolved['supervisors'];
        $roster = $resolved['roster'];

        $evalMap = [];
        $eStmt = $pdo->prepare("SELECT sa_profile_id, status FROM sa_evaluations WHERE campaign_id = ?");
        $eStmt->execute([(int) $camp['id']]);
        foreach ($eStmt as $er) {
            $evalMap[(int) $er['sa_profile_id']] = $er['status'];
        }

        $remindedCount = 0;
        foreach ($supervisors as $supId => $sup) {
            if ($targetSupId && $supId !== $targetSupId) continue;

            $pendingCount = 0;
            foreach ($roster as $saId => $saItem) {
                if (in_array($supId, $saItem['matchingSupervisorIds'], true)) {
                    $st = $evalMap[$saId] ?? 'PENDING';
                    if (in_array($st, ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
                        $pendingCount++;
                    }
                }
            }

            if ($pendingCount > 0 || $targetSupId === $supId) {
                create_notification(
                    $supId,
                    "Reminder: Pending S.A. Evaluations ({$camp['academic_term']})",
                    "You have {$pendingCount} pending Student Assistant evaluation(s) for {$sup['deptLabel']}. Please complete Step 1 of the NCST S.A. Performance Evaluation Process.",
                    'SA_EVALUATION_REMINDER',
                    '#/supervisor/evaluations',
                    (int) $user['id']
                );
                $remindedCount++;
            }
        }

        audit('EVALUATION_REMINDER_SENT', "Sent evaluation reminder to {$remindedCount} supervisor(s)", (int) $user['id']);

        respond([
            'success' => true,
            'remindedCount' => $remindedCount,
            'message' => "Reminder notification sent to {$remindedCount} Supervisor(s).",
        ]);

    // =========================================================================
    // 4. SUPERVISOR LIST (Supervisor views their assigned S.A.s to evaluate)
    // =========================================================================
    case 'supervisor_list':
        require_role($user, 'SUPERVISOR', 'ADMIN');
        $supId = ($user['role'] === 'ADMIN' && !empty($in['supervisorId']))
            ? (int) $in['supervisorId']
            : (int) $user['id'];

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        process_evaluation_deadlines_and_reminders($pdo, $semId);

        $campStmt = $pdo->prepare("SELECT * FROM evaluation_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1");
        $campStmt->execute([$semId]);
        $camp = $campStmt->fetch() ?: null;

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $supervisors = $resolved['supervisors'];
        $roster = $resolved['roster'];

        $mySupProfile = $supervisors[$supId] ?? [
            'id' => (int) $user['id'],
            'empId' => $user['username'],
            'name' => $user['full_name'],
            'category' => 'ALL',
            'officeIds' => [],
            'departments' => ['All Departments'],
            'deptLabel' => 'All Departments',
        ];

        $evalMap = [];
        $evalIds = [];
        $eStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? ORDER BY id ASC");
        $eStmt->execute([$semId]);
        foreach ($eStmt as $er) {
            $evalMap[(int) $er['sa_profile_id']] = $er;
            $evalIds[] = (int) $er['id'];
        }
        if ($camp) {
            $cStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE campaign_id = ? ORDER BY id ASC");
            $cStmt->execute([(int) $camp['id']]);
            foreach ($cStmt as $er) {
                $evalMap[(int) $er['sa_profile_id']] = $er;
                if (!in_array((int) $er['id'], $evalIds, true)) {
                    $evalIds[] = (int) $er['id'];
                }
            }
        }

        $auditMaps = fetch_evaluation_audit_maps($pdo, $evalIds);
        $defaultTerm = $camp ? $camp['academic_term'] : $sem['label'];
        $campDeadline = $camp['deadline'] ?? null;

        $myEvaluations = [];
        foreach ($roster as $saId => $saItem) {
            $inScope = ($user['role'] === 'ADMIN' && empty($in['supervisorId']))
                || in_array($supId, $saItem['matchingSupervisorIds'], true);
            if (!$inScope) continue;

            $ev = $evalMap[$saId] ?? null;
            $eid = $ev ? (int) $ev['id'] : 0;
            $row = format_evaluation_row(
                $ev,
                $saItem,
                $defaultTerm,
                $campDeadline,
                $auditMaps['actions'][$eid] ?? [],
                $auditMaps['notifications'][$eid] ?? [],
                'SUPERVISOR'
            );
            if (!$row['supervisorDone'] && !empty($mySupProfile['name'])) {
                $row['supervisorName'] = $mySupProfile['name'];
            }
            $myEvaluations[] = $row;
        }

        $completedCount = count(array_filter($myEvaluations, fn($e) => $e['supervisorDone']));
        $returnedCount = count(array_filter($myEvaluations, fn($e) => $e['status'] === 'RETURNED_FOR_REVISION'));
        $finalizedCount = count(array_filter($myEvaluations, fn($e) => $e['status'] === 'FINALIZED'));
        $inProgressCount = count(array_filter($myEvaluations, fn($e) => ($e['supervisorDone'] && $e['status'] !== 'FINALIZED') || $e['hasDraft']));

        respond([
            'success' => true,
            'semester' => $sem,
            'supervisor' => $mySupProfile,
            'campaign' => $camp ? [
                'id' => (int) $camp['id'],
                'title' => $camp['title'],
                'academicTerm' => $camp['academic_term'],
                'instructions' => $camp['instructions'],
                'deadline' => $camp['deadline'],
                'status' => $camp['status'],
                'createdAt' => $camp['created_at'],
            ] : null,
            'summary' => [
                'totalAssigned' => count($myEvaluations),
                'completedCount' => $completedCount,
                'finalizedCount' => $finalizedCount,
                'inProgressCount' => $inProgressCount,
                'returnedCount' => $returnedCount,
                'pendingCount' => max(0, count($myEvaluations) - $completedCount),
            ],
            'evaluations' => $myEvaluations,
        ]);

    // =========================================================================
    // 4B. PROCESS STEP 1 (DRAFT): SUPERVISOR SAVES DRAFT EVALUATION
    //     Allows saving partial or complete ratings/comments while status is PENDING or RETURNED_FOR_REVISION
    // =========================================================================
    case 'save_draft':
        if ($user['role'] !== 'SUPERVISOR') {
            fail('Only the Immediate Supervisor is allowed to edit or save a draft in Step 1.', 403);
        }
        require_role($user, 'SUPERVISOR');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $campStmt = $pdo->prepare("SELECT * FROM evaluation_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1");
        $campStmt->execute([$semId]);
        $camp = $campStmt->fetch();
        if (!$camp) {
            $title = $sem['label'] . ' Student Assistant Performance Evaluation';
            $pdo->prepare("
                INSERT INTO evaluation_campaigns (semester_id, title, academic_term, instructions, status, created_by)
                VALUES (?, ?, ?, 'Student Assistant Semester Performance Evaluation', 'OPEN', ?)
            ")->execute([$semId, $title, $sem['label'], (int) $user['id']]);
            $campId = (int) $pdo->lastInsertId();
            $camp = ['id' => $campId, 'title' => $title, 'academic_term' => $sem['label'], 'status' => 'OPEN'];
        } else {
            $campId = (int) $camp['id'];
        }

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $saItem = $resolved['roster'][$saProfileId] ?? fail('Student Assistant not found in active roster.', 404);
        if (!in_array((int) $user['id'], $saItem['matchingSupervisorIds'], true)) {
            audit('ACCESS_DENIED', "Supervisor #{$user['id']} attempted to save draft for unauthorized SA #{$saProfileId}", (int) $user['id']);
            fail('You can only evaluate Student Assistants assigned to your department or office.', 403);
        }

        $existStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE campaign_id = ? AND sa_profile_id = ? LIMIT 1");
        $existStmt->execute([$campId, $saProfileId]);
        $existingEv = $existStmt->fetch();
        $prevStatus = $existingEv['status'] ?? 'PENDING';
        if ($existingEv && !in_array($prevStatus, ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
            fail('This evaluation has already been submitted and locked against ordinary editing.', 422);
        }

        $criteriaIn = is_array($in['criteria'] ?? null) ? $in['criteria'] : [];
        $cVals = [];
        $totalScore = 0;
        $answered = 0;
        for ($i = 1; $i <= 10; $i++) {
            $raw = $criteriaIn[$i] ?? ($criteriaIn[(string) $i] ?? ($in["c{$i}"] ?? null));
            $val = ($raw !== null && $raw !== '') ? (int) $raw : null;
            if ($val !== null && ($val < 1 || $val > 4)) {
                $val = null;
            }
            $cVals[$i] = $val;
            if ($val !== null) {
                $totalScore += $val;
                $answered++;
            }
        }
        $averageScore = $answered > 0 ? round($totalScore / $answered, 2) : 0.00;
        $ratingLabel = compute_rating_label($averageScore, $answered);

        $studentName = trim($in['studentName'] ?? '') ?: $saItem['studentName'];
        $positionTitle = trim($in['positionTitle'] ?? '') ?: $saItem['positionTitle'];
        $department = trim($in['department'] ?? '') ?: $saItem['department'];
        $supervisorName = trim($in['supervisorName'] ?? '') ?: $user['full_name'];
        $evaluationPeriod = trim($in['evaluationPeriod'] ?? '') ?: $camp['academic_term'];
        $evalDate = !empty($in['evalDate']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $in['evalDate'])
            ? $in['evalDate'] : date('Y-m-d');
        $strengthsWeaknesses = trim($in['strengthsWeaknesses'] ?? '');
        $supervisorReason = trim((string) ($in['supervisorReason'] ?? $strengthsWeaknesses));
        $supervisorRecommendation = strtoupper(trim((string) ($in['supervisorRecommendation'] ?? ($in['recommendedDecision'] ?? ''))));
        if (!in_array($supervisorRecommendation, ['RETAIN', 'IMPROVEMENT_PLAN', 'REASSIGNMENT', 'NOT_RENEWED'], true)) {
            $supervisorRecommendation = null;
        }
        $effectiveDate = !empty($in['effectiveDate']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $in['effectiveDate'])
            ? $in['effectiveDate'] : null;

        $standardRemarks = trim($in['standardRemarks'] ?? '');
        $recommendation = strtoupper(trim($in['recommendation'] ?? 'PENDING'));
        if ($supervisorRecommendation !== null) {
            $recommendation = ($supervisorRecommendation === 'NOT_RENEWED') ? 'NOT_RECOMMENDED' : 'RECOMMENDED';
        } elseif (!in_array($recommendation, ['PENDING', 'RECOMMENDED', 'NOT_RECOMMENDED'], true)) {
            $recommendation = 'PENDING';
        }
        $supervisorSignature = trim((string) ($in['supervisorSignature'] ?? ''));
        $supervisorTitle = trim($in['supervisorTitle'] ?? '') ?: 'Immediate Supervisor';
        // Auto-determine supervisor sign date from system (cannot be client-manipulated)
        $supervisorSignDate = null;
        if ($supervisorSignature !== '') {
            $supervisorSignDate = !empty($existingEv['supervisor_sign_date']) ? $existingEv['supervisor_sign_date'] : date('Y-m-d');
        }

        $keepStatus = $prevStatus === 'RETURNED_FOR_REVISION' ? 'RETURNED_FOR_REVISION' : 'PENDING';
        $keepAck = $prevStatus === 'RETURNED_FOR_REVISION' ? 'RETURNED_FOR_REVISION' : 'PENDING';

        $pdo->prepare("
            INSERT INTO sa_evaluations (
                campaign_id, semester_id, sa_profile_id, supervisor_id, sa_user_id,
                student_name, position_title, department, supervisor_name,
                evaluation_period, eval_date,
                c1, c2, c3, c4, c5, c6, c7, c8, c9, c10,
                total_score, average_score, rating_label,
                strengths_weaknesses, supervisor_reason, supervisor_recommendation, standard_remarks, recommendation,
                effective_date, supervisor_signature, supervisor_title, supervisor_sign_date,
                acknowledgment_status, status, evaluated_by
            ) VALUES (
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?
            )
            ON DUPLICATE KEY UPDATE
                supervisor_id = VALUES(supervisor_id),
                sa_user_id = VALUES(sa_user_id),
                student_name = VALUES(student_name),
                position_title = VALUES(position_title),
                department = VALUES(department),
                supervisor_name = VALUES(supervisor_name),
                evaluation_period = VALUES(evaluation_period),
                eval_date = VALUES(eval_date),
                c1 = VALUES(c1), c2 = VALUES(c2), c3 = VALUES(c3), c4 = VALUES(c4), c5 = VALUES(c5),
                c6 = VALUES(c6), c7 = VALUES(c7), c8 = VALUES(c8), c9 = VALUES(c9), c10 = VALUES(c10),
                total_score = VALUES(total_score),
                average_score = VALUES(average_score),
                rating_label = VALUES(rating_label),
                strengths_weaknesses = VALUES(strengths_weaknesses),
                supervisor_reason = VALUES(supervisor_reason),
                supervisor_recommendation = VALUES(supervisor_recommendation),
                standard_remarks = VALUES(standard_remarks),
                recommendation = VALUES(recommendation),
                effective_date = VALUES(effective_date),
                supervisor_signature = VALUES(supervisor_signature),
                supervisor_title = VALUES(supervisor_title),
                supervisor_sign_date = VALUES(supervisor_sign_date),
                evaluated_by = VALUES(evaluated_by)
        ")->execute([
            $campId, $semId, $saProfileId, (int) $user['id'], $saItem['userId'] ? (int) $saItem['userId'] : null,
            $studentName, $positionTitle, $department, $supervisorName,
            $evaluationPeriod, $evalDate,
            $cVals[1], $cVals[2], $cVals[3], $cVals[4], $cVals[5],
            $cVals[6], $cVals[7], $cVals[8], $cVals[9], $cVals[10],
            $totalScore, $averageScore, $ratingLabel,
            $supervisorReason !== '' ? $supervisorReason : ($strengthsWeaknesses !== '' ? $strengthsWeaknesses : null),
            $supervisorReason !== '' ? $supervisorReason : null,
            $supervisorRecommendation,
            $standardRemarks !== '' ? $standardRemarks : null,
            $recommendation,
            $effectiveDate,
            $supervisorSignature !== '' ? $supervisorSignature : null,
            $supervisorTitle,
            $supervisorSignDate,
            $keepAck, $keepStatus, (int) $user['id']
        ]);

        $evalId = $existingEv ? (int) $existingEv['id'] : (int) $pdo->lastInsertId();
        if (!$evalId) {
            $idStmt = $pdo->prepare("SELECT id FROM sa_evaluations WHERE campaign_id = ? AND sa_profile_id = ? LIMIT 1");
            $idStmt->execute([$campId, $saProfileId]);
            $evalId = (int) $idStmt->fetchColumn();
        }

        log_evaluation_action(
            $pdo,
            $evalId,
            (int) $user['id'],
            $supervisorName,
            'SUPERVISOR',
            'SUPERVISOR_SAVED_DRAFT',
            $prevStatus,
            $keepStatus,
            $keepAck,
            "Saved Step 1 draft evaluation ({$answered}/10 criteria rated)."
        );

        $freshDraftEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, $saItem);

        respond([
            'success' => true,
            'evaluationId' => $evalId,
            'status' => $keepStatus,
            'workflowStage' => compute_workflow_stage_key($keepStatus),
            'hasDraft' => true,
            'evaluation' => $freshDraftEval,
            'message' => "Draft evaluation saved for {$studentName} ({$answered}/10 criteria rated). You can continue editing before submitting.",
        ]);

    // =========================================================================
    // 5. PROCESS STEP 1: SUPERVISOR COMPLETES EVALUATION
    //    (Ratings 1-10, comments, recommendation, and supervisor signature)
    //    - Locked after submission unless returned for revision by Coordinator
    //    - Automatically sets 5-school-day acknowledgment deadline & sends Day 0 notification
    // =========================================================================
    case 'save_evaluation':
        if ($user['role'] !== 'SUPERVISOR') {
            fail('Only the Immediate Supervisor is allowed to complete and submit Step 1 of the Student Assistant evaluation.', 403);
        }
        require_role($user, 'SUPERVISOR');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $campStmt = $pdo->prepare("SELECT * FROM evaluation_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1");
        $campStmt->execute([$semId]);
        $camp = $campStmt->fetch();

        if (!$camp) {
            $title = $sem['label'] . ' Student Assistant Performance Evaluation';
            $pdo->prepare("
                INSERT INTO evaluation_campaigns (semester_id, title, academic_term, instructions, status, created_by)
                VALUES (?, ?, ?, 'Student Assistant Semester Performance Evaluation', 'OPEN', ?)
            ")->execute([$semId, $title, $sem['label'], (int) $user['id']]);
            $campId = (int) $pdo->lastInsertId();
            $camp = [
                'id' => $campId,
                'title' => $title,
                'academic_term' => $sem['label'],
                'status' => 'OPEN',
            ];
        } else {
            $campId = (int) $camp['id'];
        }

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $roster = $resolved['roster'];
        $saItem = $roster[$saProfileId] ?? fail('Student Assistant not found in active roster.', 404);

        if (!in_array((int) $user['id'], $saItem['matchingSupervisorIds'], true)) {
            audit('ACCESS_DENIED', "Supervisor #{$user['id']} attempted to evaluate unauthorized SA #{$saProfileId}", (int) $user['id']);
            fail('You can only evaluate Student Assistants assigned to your department or office.', 403);
        }

        // Validate all 10 performance criteria (scale 1 to 4)
        $criteriaIn = is_array($in['criteria'] ?? null) ? $in['criteria'] : [];
        $cVals = [];
        $totalScore = 0;
        $answered = 0;
        for ($i = 1; $i <= 10; $i++) {
            $raw = $criteriaIn[$i] ?? ($criteriaIn[(string) $i] ?? ($in["c{$i}"] ?? null));
            $val = (int) $raw;
            if ($val < 1 || $val > 4) {
                fail("Please rate Criterion #{$i} on a scale of 1 to 4.", 422);
            }
            $cVals[$i] = $val;
            $totalScore += $val;
            $answered++;
        }

        $averageScore = round($totalScore / 10, 2);
        $ratingLabel = compute_rating_label($averageScore, $answered);

        $supervisorRecommendation = strtoupper(trim((string) ($in['supervisorRecommendation'] ?? ($in['recommendedDecision'] ?? ''))));
        if (!in_array($supervisorRecommendation, ['RETAIN', 'IMPROVEMENT_PLAN', 'REASSIGNMENT', 'NOT_RENEWED'], true)) {
            fail('Please select a Recommended Decision: Retain, Improvement Plan, Reassignment, or Non-Renewal.', 422);
        }

        $supervisorReason = trim((string) ($in['supervisorReason'] ?? ($in['strengthsWeaknesses'] ?? '')));
        if (mb_strlen($supervisorReason) < 3) {
            fail('Please provide the Rationale / Feedback for your recommendation.', 422);
        }

        $effectiveDate = trim((string) ($in['effectiveDate'] ?? ''));
        if (!$effectiveDate || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $effectiveDate)) {
            fail('Please provide a valid Effective Date (YYYY-MM-DD).', 422);
        }

        $standardRemarks = trim($in['standardRemarks'] ?? '');
        $recommendation = ($supervisorRecommendation === 'NOT_RENEWED') ? 'NOT_RECOMMENDED' : 'RECOMMENDED';
        $recLabel = format_decision_label($supervisorRecommendation) ?? $supervisorRecommendation;

        $supervisorSignature = trim((string) ($in['supervisorSignature'] ?? ''));
        if ($supervisorSignature === '') {
            fail('Please sign the Supervisor Signature pad before submitting your recommendation.', 422);
        }
        $supervisorTitle = trim($in['supervisorTitle'] ?? '') ?: 'Immediate Supervisor';
        // System auto-determines supervisor sign date upon official submission (cannot be client-manipulated)
        $supervisorSignDate = date('Y-m-d');

        $studentName = trim($in['studentName'] ?? '') ?: $saItem['studentName'];
        $positionTitle = trim($in['positionTitle'] ?? '') ?: $saItem['positionTitle'];
        $department = trim($in['department'] ?? '') ?: $saItem['department'];
        $supervisorName = trim($in['supervisorName'] ?? '') ?: $user['full_name'];
        $evaluationPeriod = trim($in['evaluationPeriod'] ?? '') ?: $camp['academic_term'];
        $evalDate = !empty($in['evalDate']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $in['evalDate'])
            ? $in['evalDate'] : date('Y-m-d');

        $supIdToStore = (int) $user['id'];
        $saUserId = $saItem['userId'] ? (int) $saItem['userId'] : null;
        $nextStatus = 'FOR_SA_REVIEW';
        $nextAckStatus = 'PENDING';
        $todayYmd = date('Y-m-d');
        $ackDueDate = add_school_days($pdo, $todayYmd, EVAL_DEFAULT_ACK_SCHOOL_DAYS);

        // Lock row inside a transaction to prevent duplicate submissions / race conditions
        $alreadySubmitted = false;
        $evalId = 0;
        $prevStatus = 'PENDING';
        $existingEv = null;

        $pdo->beginTransaction();
        try {
            $existStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE campaign_id = ? AND sa_profile_id = ? LIMIT 1 FOR UPDATE");
            $existStmt->execute([$campId, $saProfileId]);
            $existingEv = $existStmt->fetch();

            $prevStatus = normalize_evaluation_status($existingEv['status'] ?? 'PENDING', $existingEv ?: null);
            if ($existingEv && !in_array($prevStatus, ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
                $evalId = (int) $existingEv['id'];
                // Idempotent handling: if the same authorized Supervisor repeats a completed recommendation submission,
                // return a controlled response reflecting the current saved state rather than duplicating or corrupting.
                if ((int) ($existingEv['supervisor_id'] ?? 0) === $supIdToStore || (int) ($existingEv['evaluated_by'] ?? 0) === $supIdToStore) {
                    $pdo->rollBack();
                    $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, $saItem, null, 'SUPERVISOR');
                    respond([
                        'success' => true,
                        'alreadySubmitted' => true,
                        'evaluationId' => $evalId,
                        'evaluationRef' => "EVAL-#{$evalId}",
                        'averageScore' => round((float) ($existingEv['average_score'] ?? $averageScore), 2),
                        'ratingLabel' => $existingEv['rating_label'] ?? $ratingLabel,
                        'recommendation' => $existingEv['recommendation'] ?? $recommendation,
                        'supervisorRecommendation' => $existingEv['supervisor_recommendation'] ?? $supervisorRecommendation,
                        'effectiveDate' => $existingEv['effective_date'] ?? $effectiveDate,
                        'status' => $prevStatus,
                        'workflowStage' => compute_workflow_stage_key($prevStatus),
                        'nextActionRole' => 'SA',
                        'nextActionAssignedTo' => $studentName,
                        'evaluation' => $freshEval,
                        'message' => "Your recommendation has already been sent to {$studentName} for acknowledgment.",
                    ]);
                }
                $pdo->rollBack();
                fail('This evaluation has already been submitted and sent for acknowledgment. Duplicate submissions are not allowed. If a correction is needed, please use "Request Revision Authorization".', 422);
            }

            $pdo->prepare("
                INSERT INTO sa_evaluations (
                    campaign_id, semester_id, sa_profile_id, supervisor_id, sa_user_id,
                    student_name, position_title, department, supervisor_name,
                    evaluation_period, eval_date,
                    c1, c2, c3, c4, c5, c6, c7, c8, c9, c10,
                    total_score, average_score, rating_label,
                    strengths_weaknesses, supervisor_reason, supervisor_recommendation, standard_remarks, recommendation,
                    effective_date, supervisor_signature, supervisor_title, supervisor_sign_date,
                    ack_released_at, ack_due_date, original_ack_due_date,
                    acknowledgment_status,
                    status, evaluated_by, submitted_at
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    NOW(), ?, ?,
                    ?,
                    ?, ?, NOW()
                )
                ON DUPLICATE KEY UPDATE
                    supervisor_id = VALUES(supervisor_id),
                    sa_user_id = VALUES(sa_user_id),
                    student_name = VALUES(student_name),
                    position_title = VALUES(position_title),
                    department = VALUES(department),
                    supervisor_name = VALUES(supervisor_name),
                    evaluation_period = VALUES(evaluation_period),
                    eval_date = VALUES(eval_date),
                    c1 = VALUES(c1), c2 = VALUES(c2), c3 = VALUES(c3), c4 = VALUES(c4), c5 = VALUES(c5),
                    c6 = VALUES(c6), c7 = VALUES(c7), c8 = VALUES(c8), c9 = VALUES(c9), c10 = VALUES(c10),
                    total_score = VALUES(total_score),
                    average_score = VALUES(average_score),
                    rating_label = VALUES(rating_label),
                    strengths_weaknesses = VALUES(strengths_weaknesses),
                    supervisor_reason = VALUES(supervisor_reason),
                    supervisor_recommendation = VALUES(supervisor_recommendation),
                    standard_remarks = VALUES(standard_remarks),
                    recommendation = VALUES(recommendation),
                    effective_date = VALUES(effective_date),
                    supervisor_signature = VALUES(supervisor_signature),
                    supervisor_title = VALUES(supervisor_title),
                    supervisor_sign_date = VALUES(supervisor_sign_date),
                    student_signature = NULL,
                    student_sign_date = NULL,
                    sa_acknowledged_at = NULL,
                    ack_released_at = NOW(),
                    ack_due_date = VALUES(ack_due_date),
                    original_ack_due_date = COALESCE(original_ack_due_date, VALUES(original_ack_due_date)),
                    acknowledgment_status = 'PENDING',
                    supervisor_revision_request = NULL,
                    supervisor_revision_requested_at = NULL,
                    status = 'FOR_SA_REVIEW',
                    evaluated_by = VALUES(evaluated_by),
                    submitted_at = NOW()
            ")->execute([
                $campId, $semId, $saProfileId, $supIdToStore, $saUserId,
                $studentName, $positionTitle, $department, $supervisorName,
                $evaluationPeriod, $evalDate,
                $cVals[1], $cVals[2], $cVals[3], $cVals[4], $cVals[5],
                $cVals[6], $cVals[7], $cVals[8], $cVals[9], $cVals[10],
                $totalScore, $averageScore, $ratingLabel,
                $supervisorReason, $supervisorReason, $supervisorRecommendation, $standardRemarks, $recommendation,
                $effectiveDate, $supervisorSignature, $supervisorTitle, $supervisorSignDate,
                $ackDueDate, $ackDueDate,
                $nextAckStatus,
                $nextStatus, (int) $user['id']
            ]);

            $evalId = $existingEv ? (int) $existingEv['id'] : (int) $pdo->lastInsertId();
            if (!$evalId) {
                $idStmt = $pdo->prepare("SELECT id FROM sa_evaluations WHERE campaign_id = ? AND sa_profile_id = ? LIMIT 1");
                $idStmt->execute([$campId, $saProfileId]);
                $evalId = (int) $idStmt->fetchColumn();
            }

            $wasRevision = ($prevStatus === 'RETURNED_FOR_REVISION');
            $actionType = $wasRevision ? 'SUPERVISOR_RESUBMITTED_FOR_SA_REVIEW' : 'SUPERVISOR_SUBMITTED_FOR_SA_REVIEW';

            log_evaluation_action(
                $pdo,
                $evalId,
                (int) $user['id'],
                $supervisorName,
                'SUPERVISOR',
                $actionType,
                $prevStatus,
                $nextStatus,
                $nextAckStatus,
                ($wasRevision ? "Resubmitted revised recommendation to {$studentName} for acknowledgment (Step 3). " : "Submitted evaluation recommendation to {$studentName} for acknowledgment (Step 3). ")
                    . "Score: {$averageScore}/4.0 ({$ratingLabel}), Recommendation: {$recLabel}, Effective: {$effectiveDate}. Rationale: {$supervisorReason}"
            );

            $pdo->commit();
        } catch (Throwable $txErr) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log("[AssistPay save_evaluation Transaction Error EVAL-SA-{$saProfileId}] " . $txErr->getMessage());
            fail('Could not submit the evaluation recommendation due to a database error. Please try again.', 500);
        }

        $wasRevision = ($prevStatus === 'RETURNED_FOR_REVISION');
        $evalRef = "EVAL-#{$evalId} ({$studentName} • {$evaluationPeriod})";
        $revSuffix = $wasRevision ? "_REV" . ((int) ($existingEv['revision_count'] ?? 0) + 1) : '';
        $notificationQueuedForRetry = false;
        $simulateNotifFail = !empty($in['_simulateNotificationFailure']);

        try {
            // Notify Student Assistant (In-App + Email) to review and sign acknowledgment
            if ($saUserId > 0) {
                $saNotifRes = send_evaluation_notification(
                    $pdo,
                    $evalId,
                    (int) $saUserId,
                    "SUPERVISOR_SENT_SA_ACK{$revSuffix}",
                    ($wasRevision ? "Revised Evaluation Sent for Acknowledgment: " : "Performance Evaluation Ready for Review: ") . "{$studentName}",
                    "{$supervisorName} has completed your performance evaluation for {$evaluationPeriod} ({$department}) — Score: {$averageScore}/4.0 ({$ratingLabel}) • Recommendation: {$recLabel}. Please review your criteria ratings and sign acknowledgment within 5 school days (Deadline: {$ackDueDate}).",
                    'SA_EVALUATION_FOR_REVIEW',
                    "#/sa/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'Review Evaluation & Sign Acknowledgment',
                        'currentStatus' => 'Step 3: Awaiting S.A. Acknowledgment',
                        'dueDate' => $ackDueDate,
                        'simulateNotificationFailure' => $simulateNotifFail,
                    ],
                    true
                );
                if (!empty($saNotifRes['queuedForRetry'])) {
                    $notificationQueuedForRetry = true;
                }
            }

            // Also notify S.A. Coordinators (ADMIN) (In-App)
            $coordStmt = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
            foreach ($coordStmt->fetchAll(PDO::FETCH_COLUMN) as $coordId) {
                send_evaluation_notification(
                    $pdo,
                    $evalId,
                    (int) $coordId,
                    "SUPERVISOR_SUBMITTED_COORD{$revSuffix}",
                    "Evaluation Recommendation Submitted for {$studentName}",
                    "{$supervisorName} submitted an evaluation recommendation ({$recLabel}) for {$studentName} ({$department}) and sent it for Student Assistant acknowledgment (Step 3).",
                    'SA_EVALUATION_SUBMITTED',
                    "#/admin/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'Awaiting S.A. Acknowledgment (Step 3)',
                        'currentStatus' => 'Sent to S.A. for Review & Acknowledgment',
                        'dueDate' => $ackDueDate,
                        'simulateNotificationFailure' => $simulateNotifFail,
                    ],
                    false
                );
            }

            audit(
                $wasRevision ? 'SA_EVALUATION_REVISION_SUBMITTED' : 'SA_EVALUATION_RECOMMENDATION_SUBMITTED',
                "Supervisor evaluated SA {$saItem['studentId']} ({$studentName}): Avg {$averageScore}/4.0 ({$ratingLabel}), Recommendation={$supervisorRecommendation}, Effective={$effectiveDate} -> FOR_SA_REVIEW",
                (int) $user['id']
            );
        } catch (Throwable $postCommitErr) {
            $notificationQueuedForRetry = true;
            error_log("[AssistPay save_evaluation Post-Commit Notification Warning EVAL-#{$evalId}] " . $postCommitErr->getMessage());
        }

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, $saItem, null, 'SUPERVISOR');

        respond([
            'success' => true,
            'alreadySubmitted' => false,
            'evaluationId' => $evalId,
            'evaluationRef' => "EVAL-#{$evalId}",
            'averageScore' => $averageScore,
            'ratingLabel' => $ratingLabel,
            'recommendation' => $recommendation,
            'supervisorRecommendation' => $supervisorRecommendation,
            'supervisorRecommendationLabel' => $recLabel,
            'effectiveDate' => $effectiveDate,
            'status' => $nextStatus,
            'workflowStage' => compute_workflow_stage_key($nextStatus),
            'nextActionRole' => 'SA',
            'nextActionAssignedTo' => $studentName,
            'acknowledgmentStatus' => $nextAckStatus,
            'ackDueDate' => $ackDueDate,
            'notificationQueuedForRetry' => $notificationQueuedForRetry,
            'evaluation' => $freshEval,
            'message' => "Evaluation recommendation ({$recLabel}) signed and sent to {$studentName} for acknowledgment.",
        ]);

    // =========================================================================
    // 5B. SUPERVISOR REQUESTS REVISION AUTHORIZATION FROM COORDINATOR
    //     (Since submitted evaluations cannot be ordinarily edited without Coordinator return)
    // =========================================================================
    case 'supervisor_request_revision':
        require_role($user, 'SUPERVISOR');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        $reason = trim((string) ($in['reason'] ?? ''));
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);
        if (mb_strlen($reason) < 5) {
            fail('Please provide a clear reason (at least 5 characters) why this evaluation needs to be returned for revision.', 422);
        }

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
        $evStmt->execute([$semId, $saProfileId]);
        $ev = $evStmt->fetch();
        if (!$ev || $ev['status'] === 'PENDING') {
            fail('This evaluation has not been submitted yet.', 400);
        }
        if ($ev['status'] === 'FINALIZED') {
            fail('This evaluation is already finalized. Please contact the S.A. Coordinator to reopen it.', 422);
        }

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $saItem = $resolved['roster'][$saProfileId] ?? fail('Student Assistant not found.', 404);
        if (!in_array((int) $user['id'], $saItem['matchingSupervisorIds'], true)) {
            fail('You do not have permission for this Student Assistant.', 403);
        }

        $evalId = (int) $ev['id'];
        $pdo->prepare("
            UPDATE sa_evaluations
               SET supervisor_revision_request = ?,
                   supervisor_revision_requested_at = NOW()
             WHERE id = ?
        ")->execute([$reason, $evalId]);

        log_evaluation_action(
            $pdo,
            $evalId,
            (int) $user['id'],
            $user['full_name'],
            'SUPERVISOR',
            'SUPERVISOR_REQUESTED_REVISION',
            $ev['status'],
            $ev['status'],
            $ev['acknowledgment_status'],
            "Supervisor requested authorization to revise evaluation: {$reason}"
        );

        $evalRef = "EVAL-#{$evalId} ({$ev['student_name']} • {$ev['evaluation_period']})";
        $coordStmt = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
        foreach ($coordStmt->fetchAll(PDO::FETCH_COLUMN) as $coordId) {
            send_evaluation_notification(
                $pdo,
                $evalId,
                (int) $coordId,
                'SUP_REVISION_REQ_' . time(),
                "Revision Requested by Supervisor: {$ev['student_name']}",
                "Supervisor {$user['full_name']} requested to revise the submitted evaluation for {$ev['student_name']} ({$ev['department']}). Reason: {$reason}",
                'SA_EVALUATION_REVISION_REQUEST',
                "#/admin/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                (int) $user['id'],
                [
                    'evalRef' => $evalRef,
                    'requiredAction' => 'Review & Return Evaluation to Supervisor for Revision',
                    'currentStatus' => $ev['status'],
                    'dueDate' => $ev['ack_due_date'] ?? 'N/A',
                ]
            );
        }

        audit('SA_EVALUATION_REVISION_REQUESTED', "Supervisor requested revision for evaluation #{$evalId} ({$ev['student_name']}): {$reason}", (int) $user['id']);

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'evaluation' => $freshEval,
            'message' => 'Revision request sent to the S.A. Coordinator. Once authorized, you will be notified to edit and resubmit.',
        ]);

    // =========================================================================
    // 6. S.A. VIEW (Student Assistant views their own evaluation & status)
    // =========================================================================
    case 'sa_my_evaluation':
        require_role($user, 'SA');
        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        process_evaluation_deadlines_and_reminders($pdo, $semId);

        $saStmt = $pdo->prepare("SELECT id FROM sa_profiles WHERE user_id = ? LIMIT 1");
        $saStmt->execute([(int) $user['id']]);
        $saProfileId = (int) $saStmt->fetchColumn();
        if (!$saProfileId) {
            fail('Student Assistant profile not found.', 404);
        }

        $campStmt = $pdo->prepare("SELECT * FROM evaluation_campaigns WHERE semester_id = ? ORDER BY id DESC LIMIT 1");
        $campStmt->execute([$semId]);
        $camp = $campStmt->fetch() ?: null;

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $roster = $resolved['roster'];
        $saItem = $roster[$saProfileId] ?? null;

        if (!$saItem) {
            fail('Your active Student Assistant roster entry was not found for this semester.', 404);
        }

        $ev = null;
        if ($camp) {
            $eStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE campaign_id = ? AND sa_profile_id = ? LIMIT 1");
            $eStmt->execute([(int) $camp['id'], $saProfileId]);
            $ev = $eStmt->fetch() ?: null;
        }
        if (!$ev) {
            $eStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
            $eStmt->execute([$semId, $saProfileId]);
            $ev = $eStmt->fetch() ?: null;
        }

        $evalId = $ev ? (int) $ev['id'] : 0;
        $auditMaps = fetch_evaluation_audit_maps($pdo, $evalId ? [$evalId] : []);

        $defaultTerm = $camp ? $camp['academic_term'] : $sem['label'];
        $formatted = format_evaluation_row(
            $ev,
            $saItem,
            $defaultTerm,
            $camp['deadline'] ?? null,
            $auditMaps['actions'][$evalId] ?? [],
            $auditMaps['notifications'][$evalId] ?? [],
            'SA'
        );

        // Fetch past semester evaluations for history if any
        $histStmt = $pdo->prepare("
            SELECT e.*, s.term, s.academic_year
              FROM sa_evaluations e
              JOIN semesters s ON s.id = e.semester_id
             WHERE e.sa_profile_id = ? AND e.status <> 'PENDING'
             ORDER BY e.id DESC
        ");
        $histStmt->execute([$saProfileId]);
        $history = [];
        foreach ($histStmt as $hr) {
            $history[] = format_evaluation_row($hr, $saItem, $hr['evaluation_period'], null, [], [], 'SA');
        }

        respond([
            'success' => true,
            'semester' => $sem,
            'campaign' => $camp ? [
                'id' => (int) $camp['id'],
                'title' => $camp['title'],
                'academicTerm' => $camp['academic_term'],
                'instructions' => $camp['instructions'],
                'deadline' => $camp['deadline'],
                'status' => $camp['status'],
            ] : null,
            'evaluation' => $formatted,
            'history' => $history,
            'extensionReasonCategories' => EVAL_EXTENSION_REASON_CATEGORIES,
        ]);

    // =========================================================================
    // 6B. PROCESS STEP 2: S.A. SAVES OPTIONAL RESPONSE / COMMENTS
    //     (Saves optional S.A. response or comments without advancing workflow)
    // =========================================================================
    case 'sa_save_response':
        if (($user['role'] ?? '') !== 'SA') {
            audit('ACCESS_DENIED', "User #{$user['id']} (Role: {$user['role']}) attempted S.A. Step 2 response save", (int) $user['id']);
            fail('Only the designated Student Assistant is authorized to submit a response for this evaluation.', 403);
        }
        require_role($user, 'SA');
        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $saStmt = $pdo->prepare("SELECT id, student_id, first_name, last_name FROM sa_profiles WHERE user_id = ? LIMIT 1");
        $saStmt->execute([(int) $user['id']]);
        $saRow = $saStmt->fetch();
        if (!$saRow) {
            fail('Student Assistant profile not found.', 404);
        }
        $saProfileId = (int) $saRow['id'];

        if (!empty($in['saProfileId']) && (int) $in['saProfileId'] !== $saProfileId) {
            audit('ACCESS_DENIED', "SA user #{$user['id']} (profile #{$saProfileId}) attempted to save response for SA profile #{$in['saProfileId']}", (int) $user['id']);
            fail('You are not authorized to submit a response on behalf of another Student Assistant.', 403);
        }

        if (!empty($in['evaluationId'])) {
            $chkEvStmt = $pdo->prepare("SELECT id, sa_profile_id, sa_user_id FROM sa_evaluations WHERE id = ? LIMIT 1");
            $chkEvStmt->execute([(int) $in['evaluationId']]);
            $chkEv = $chkEvStmt->fetch();
            if ($chkEv && ((int) $chkEv['sa_profile_id'] !== $saProfileId || (!empty($chkEv['sa_user_id']) && (int) $chkEv['sa_user_id'] !== (int) $user['id']))) {
                audit('ACCESS_DENIED', "SA user #{$user['id']} (profile #{$saProfileId}) attempted to save response on evaluation #{$in['evaluationId']} belonging to another S.A.", (int) $user['id']);
                fail('You are not authorized to modify another Student Assistant\'s evaluation.', 403);
            }
        }

        $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
        $evStmt->execute([$semId, $saProfileId]);
        $ev = $evStmt->fetch();
        if (!$ev || in_array(normalize_evaluation_status($ev['status']), ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
            fail('Your supervisor has not released your evaluation for review yet.', 400);
        }
        if ((int) $ev['sa_profile_id'] !== $saProfileId || (!empty($ev['sa_user_id']) && (int) $ev['sa_user_id'] !== (int) $user['id'])) {
            audit('ACCESS_DENIED', "SA user #{$user['id']} attempted to save response on evaluation #{$ev['id']} assigned to user #{$ev['sa_user_id']}", (int) $user['id']);
            fail('You are not authorized to submit a response for another Student Assistant\'s evaluation.', 403);
        }

        $evalId = (int) $ev['id'];
        $currentNormStatus = normalize_evaluation_status($ev['status'], $ev);
        if ($currentNormStatus === 'FINALIZED') {
            $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);
            fail('This evaluation has already been finalized and is read-only.', 422, ['evaluation' => $freshEval]);
        }

        $saComments = trim((string) ($in['saComments'] ?? ''));
        if ($saComments === '') {
            fail('Please enter your response or comments before clicking Submit Response.', 422);
        }

        $existingComments = trim((string) ($ev['sa_comments'] ?? ''));
        $studentName = $ev['student_name'] ?: ($saRow['first_name'] . ' ' . $saRow['last_name']);

        if ($existingComments !== $saComments) {
            $pdo->prepare("
                UPDATE sa_evaluations
                   SET sa_user_id = ?,
                       sa_comments = ?
                 WHERE id = ?
            ")->execute([
                (int) $user['id'],
                $saComments,
                $evalId,
            ]);

            log_evaluation_action(
                $pdo,
                $evalId,
                (int) $user['id'],
                $studentName,
                'SA',
                'SA_SUBMITTED_RESPONSE',
                $ev['status'],
                $ev['status'],
                $ev['acknowledgment_status'] ?? 'PENDING',
                "Submitted Student Assistant response/comments: {$saComments}"
            );

            audit('SA_EVALUATION_RESPONSE_SAVED', "SA {$saRow['student_id']} ({$studentName}) saved response comments for evaluation #{$evalId}", (int) $user['id']);
        }

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'evaluationId' => $evalId,
            'evaluationRef' => "EVAL-#{$evalId}",
            'status' => $currentNormStatus,
            'workflowStage' => $freshEval['workflowStage'] ?? compute_workflow_stage_key($currentNormStatus),
            'evaluation' => $freshEval,
            'message' => !empty($ev['sa_acknowledged_at'])
                ? 'Your response has been saved. Your evaluation is already acknowledged and is awaiting Coordinator review (Step 3).'
                : 'Your response has been saved! Please also click "Acknowledge Evaluation" to confirm receipt and advance to Step 3 (Coordinator Review).',
        ]);

    // =========================================================================
    // 7. PROCESS STEP 2: S.A. REVIEWS & ACKNOWLEDGES EVALUATION
    //    (Confirms receipt & review, saves timestamp & logged-in S.A. identity,
    //     changes status to step3_pending_coordinator_review / FOR_COORDINATOR_REVIEW,
    //     assigns next action to S.A. Coordinator, and notifies Coordinator)
    // =========================================================================
    case 'sa_acknowledge':
        if (($user['role'] ?? '') !== 'SA') {
            audit('ACCESS_DENIED', "User #{$user['id']} (Role: {$user['role']}) attempted S.A. Step 2 acknowledgment", (int) $user['id']);
            fail('Only the designated Student Assistant is authorized to acknowledge this performance evaluation.', 403);
        }
        require_role($user, 'SA');
        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $saStmt = $pdo->prepare("SELECT id, student_id, first_name, last_name FROM sa_profiles WHERE user_id = ? LIMIT 1");
        $saStmt->execute([(int) $user['id']]);
        $saRow = $saStmt->fetch();
        if (!$saRow) {
            fail('Student Assistant profile not found.', 404);
        }
        $saProfileId = (int) $saRow['id'];

        if (!empty($in['saProfileId']) && (int) $in['saProfileId'] !== $saProfileId) {
            audit('ACCESS_DENIED', "SA user #{$user['id']} (profile #{$saProfileId}) attempted to acknowledge evaluation on behalf of SA profile #{$in['saProfileId']}", (int) $user['id']);
            fail('You are not authorized to acknowledge an evaluation on behalf of another Student Assistant.', 403);
        }

        if (!empty($in['evaluationId'])) {
            $chkEvStmt = $pdo->prepare("SELECT id, sa_profile_id, sa_user_id FROM sa_evaluations WHERE id = ? LIMIT 1");
            $chkEvStmt->execute([(int) $in['evaluationId']]);
            $chkEv = $chkEvStmt->fetch();
            if ($chkEv && ((int) $chkEv['sa_profile_id'] !== $saProfileId || (!empty($chkEv['sa_user_id']) && (int) $chkEv['sa_user_id'] !== (int) $user['id']))) {
                audit('ACCESS_DENIED', "SA user #{$user['id']} (profile #{$saProfileId}) attempted to acknowledge evaluation #{$in['evaluationId']} belonging to another S.A.", (int) $user['id']);
                fail('You are not authorized to acknowledge an evaluation belonging to another Student Assistant.', 403);
            }
        }

        $alreadyAcknowledged = false;
        $evalId = 0;
        $nextAckStatus = 'SIGNED';
        $studentName = '';
        $evalRef = '';
        $hasDispute = false;
        $saComments = '';
        $saConcernText = '';
        $revisionCycle = 0;

        $pdo->beginTransaction();
        try {
            $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE");
            $evStmt->execute([$semId, $saProfileId]);
            $ev = $evStmt->fetch();
            $currentNormStatus = $ev ? normalize_evaluation_status($ev['status'], $ev) : 'PENDING';

            if (!$ev || $currentNormStatus !== 'FOR_SA_REVIEW') {
                $pdo->rollBack();
                if ($currentNormStatus === 'FINALIZED') {
                    $freshEval = load_fresh_formatted_evaluation($pdo, (int)$ev['id'], $semId, $saProfileId, null, $sem['label'], 'SA');
                    fail('This evaluation has already been finalized.', 422, ['evaluation' => $freshEval]);
                }
                fail('Your evaluation is not currently released for receipt acknowledgment.', 400);
            }

            // Never allow a different user to reuse or acknowledge another user's evaluation
            if ((int) $ev['sa_profile_id'] !== $saProfileId || (!empty($ev['sa_user_id']) && (int) $ev['sa_user_id'] !== (int) $user['id'])) {
                $pdo->rollBack();
                audit('ACCESS_DENIED', "SA user #{$user['id']} attempted to acknowledge evaluation #{$ev['id']} assigned to user #{$ev['sa_user_id']}", (int) $user['id']);
                fail('You are not authorized to acknowledge an evaluation belonging to another Student Assistant.', 403);
            }

            $evalId = (int) $ev['id'];
            $revisionCycle = (int) ($ev['revision_count'] ?? 0);
            $studentName = $ev['student_name'] ?: ($saRow['first_name'] . ' ' . $saRow['last_name']);
            $evalRef = "EVAL-#{$evalId} ({$studentName} • {$ev['evaluation_period']})";

            $studentSignature = trim((string) ($in['studentSignature'] ?? ''));
            if ($studentSignature === '') {
                $pdo->rollBack();
                fail('Please sign the Student Assistant Signature pad to confirm receipt and acknowledgment of your evaluation.', 422);
            }
            $studentRole = trim($in['studentRole'] ?? '') ?: 'Student Assistant';
            // System auto-determines student assistant sign date upon official receipt acknowledgment (cannot be client-manipulated)
            $studentSignDate = date('Y-m-d');
            $saComments = trim((string) ($in['saComments'] ?? ''));
            $saConcernText = trim((string) ($in['saConcernText'] ?? ''));
            $hasDispute = !empty($in['saHasDispute']) || $saConcernText !== '';

            $nextAckStatus = $hasDispute ? 'CONCERN_SUBMITTED' : 'SIGNED';

            $pdo->prepare("
                UPDATE sa_evaluations
                   SET sa_user_id = ?,
                       student_signature = ?,
                       student_role = ?,
                       student_sign_date = ?,
                       sa_comments = COALESCE(?, sa_comments),
                       sa_concern_text = COALESCE(?, sa_concern_text),
                       sa_has_dispute = ?,
                       sa_acknowledged_at = NOW(),
                       acknowledgment_status = ?,
                       status = 'FOR_COORDINATOR_REVIEW'
                 WHERE id = ? AND sa_profile_id = ?
            ")->execute([
                (int) $user['id'],
                $studentSignature,
                $studentRole,
                $studentSignDate,
                $saComments !== '' ? $saComments : null,
                $saConcernText !== '' ? $saConcernText : null,
                $hasDispute ? 1 : 0,
                $nextAckStatus,
                $evalId,
                $saProfileId,
            ]);

            log_evaluation_action(
                $pdo,
                $evalId,
                (int) $user['id'],
                $studentName,
                'SA',
                $hasDispute ? 'SA_ACKNOWLEDGED_WITH_CONCERN' : 'SA_ACKNOWLEDGED_FORWARDED_TO_COORDINATOR',
                $ev['status'],
                'FOR_COORDINATOR_REVIEW',
                $nextAckStatus,
                ($hasDispute ? "Acknowledged evaluation receipt ({$evalRef}) with concern: {$saConcernText}. Forwarded to Coordinator for review." : "Acknowledged receipt and signed evaluation ({$evalRef}). Forwarded to Coordinator for review.")
                    . ($saComments !== '' ? " | S.A. Response: {$saComments}" : '')
            );

            $pdo->commit();
        } catch (Throwable $txErr) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('[AssistPay sa_acknowledge Transaction Error] ' . $txErr->getMessage());
            fail('Could not record your evaluation acknowledgment due to a database error. Please try again.', 500);
        }

        // Handle post-acknowledgment notifications and audit logging separately so a notification failure
        // never reports the committed acknowledgment as failed (uses evaluation_notification_logs outbox for retry).
        $notificationQueuedForRetry = false;
        $simulateNotifFail = !empty($in['_simulateNotificationFailure']);
        try {
            $coordEventKey = "SA_ACK_COORD_REV{$revisionCycle}_" . time();
            $coordStmt = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
            foreach ($coordStmt->fetchAll(PDO::FETCH_COLUMN) as $coordId) {
                $nRes = send_evaluation_notification(
                    $pdo,
                    $evalId,
                    (int) $coordId,
                    $coordEventKey,
                    $hasDispute
                        ? "Evaluation Acknowledged with Concern: {$studentName}"
                        : "S.A. Acknowledged Evaluation (Pending Review): {$studentName}",
                    "{$studentName} ({$ev['department']}) has reviewed and signed acknowledgment for their performance evaluation"
                        . ($hasDispute ? " with a recorded concern" : ($saComments !== '' ? " with comments" : ""))
                        . ". The evaluation is now awaiting Step 4 Coordinator Review & Final Decision.",
                    $hasDispute ? 'SA_EVALUATION_CONCERN' : 'SA_EVALUATION_ACKNOWLEDGED',
                    "#/admin/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'Review Evaluation & Authorize Final Decision',
                        'currentStatus' => 'Step 4: Pending Coordinator Review',
                        'dueDate' => 'Immediate Follow-up',
                        'simulateNotificationFailure' => $simulateNotifFail,
                    ],
                    false
                );
                if (!empty($nRes['queuedForRetry'])) {
                    $notificationQueuedForRetry = true;
                }
            }

            if (!empty($ev['supervisor_id'])) {
                $supEventKey = "SA_ACK_SUP_REV{$revisionCycle}_" . time();
                $supRes = send_evaluation_notification(
                    $pdo,
                    $evalId,
                    (int) $ev['supervisor_id'],
                    $supEventKey,
                    "S.A. Acknowledged Evaluation: {$studentName}",
                    "{$studentName} has reviewed and signed acknowledgment for their performance evaluation. The evaluation has been forwarded to the S.A. Coordinator for final review.",
                    'SA_EVALUATION_ACKNOWLEDGED',
                    "#/supervisor/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'Under Coordinator Review (Step 4)',
                        'currentStatus' => 'Step 4: Pending Coordinator Review',
                        'dueDate' => 'Pending Coordinator Action',
                        'simulateNotificationFailure' => $simulateNotifFail,
                    ],
                    false
                );
                if (!empty($supRes['queuedForRetry'])) {
                    $notificationQueuedForRetry = true;
                }
            }

            audit('SA_EVALUATION_ACKNOWLEDGED', "SA {$saRow['student_id']} ({$studentName}) signed acknowledgment for evaluation #{$evalId} -> FOR_COORDINATOR_REVIEW", (int) $user['id']);
        } catch (Throwable $postCommitErr) {
            $notificationQueuedForRetry = true;
            error_log('[AssistPay sa_acknowledge Post-Commit Notification Warning] ' . $postCommitErr->getMessage());
        }

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label'], 'SA');

        respond([
            'success' => true,
            'alreadyAcknowledged' => false,
            'evaluationId' => $evalId,
            'evaluationRef' => "EVAL-#{$evalId}",
            'status' => 'FOR_COORDINATOR_REVIEW',
            'workflowStage' => compute_workflow_stage_key('FOR_COORDINATOR_REVIEW'),
            'acknowledgmentStatus' => $nextAckStatus,
            'saAcknowledgedAt' => $freshEval['saAcknowledgedAt'] ?? date('Y-m-d H:i:s'),
            'nextActionRole' => 'COORDINATOR',
            'nextActionAssignedTo' => 'S.A. Coordinator',
            'notificationQueuedForRetry' => $notificationQueuedForRetry,
            'evaluation' => $freshEval,
            'message' => 'Evaluation receipt confirmed and signed. Forwarded to the S.A. Coordinator for final review.',
        ]);

    // =========================================================================
    // 7B. STEP 2 EXTENSION REQUEST: S.A. REQUESTS DEADLINE EXTENSION
    //     (Supports standard requests before deadline + emergency requests after deadline)
    // =========================================================================
    case 'sa_request_extension':
        require_role($user, 'SA');
        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $saStmt = $pdo->prepare("SELECT id, student_id, first_name, last_name FROM sa_profiles WHERE user_id = ? LIMIT 1");
        $saStmt->execute([(int) $user['id']]);
        $saRow = $saStmt->fetch() ?: fail('Student Assistant profile not found.', 404);
        $saProfileId = (int) $saRow['id'];

        $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
        $evStmt->execute([$semId, $saProfileId]);
        $ev = $evStmt->fetch();
        if (!$ev || in_array($ev['status'], ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
            fail('Your evaluation has not been released for acknowledgment yet.', 400);
        }
        if ($ev['status'] === 'FINALIZED' || !empty($ev['sa_acknowledged_at'])) {
            fail('This evaluation has already been acknowledged or finalized.', 422);
        }

        $reasonCategory = trim((string) ($in['reasonCategory'] ?? ''));
        if (!in_array($reasonCategory, EVAL_EXTENSION_REASON_CATEGORIES, true)) {
            fail('Please select a valid extension reason category.', 422);
        }
        $explanation = trim((string) ($in['explanation'] ?? ''));
        $requestedDays = max(1, min(10, (int) ($in['requestedDays'] ?? EVAL_DEFAULT_EXTENSION_SCHOOL_DAYS)));

        $today = date('Y-m-d');
        $currentDue = $ev['ack_due_date'] ?: add_school_days($pdo, substr($ev['submitted_at'] ?? $today, 0, 10), EVAL_DEFAULT_ACK_SCHOOL_DAYS);
        $isLateRequest = ($today > $currentDue);

        if ($isLateRequest && $explanation === '') {
            fail('Since the original acknowledgment deadline has passed, please include a brief explanation for your late/emergency extension request.', 422);
        }

        $evalId = (int) $ev['id'];
        $pdo->prepare("
            UPDATE sa_evaluations
               SET sa_user_id = ?,
                   acknowledgment_status = 'EXTENSION_REQUESTED',
                   extension_status = 'PENDING',
                   extension_reason_category = ?,
                   extension_explanation = ?,
                   extension_requested_at = NOW(),
                   extension_requested_days = ?,
                   ack_due_date = COALESCE(ack_due_date, ?),
                   original_ack_due_date = COALESCE(original_ack_due_date, ?)
             WHERE id = ?
        ")->execute([
            (int) $user['id'],
            $reasonCategory,
            $explanation !== '' ? $explanation : null,
            $requestedDays,
            $currentDue,
            $currentDue,
            $evalId,
        ]);

        $studentName = $ev['student_name'] ?: ($saRow['first_name'] . ' ' . $saRow['last_name']);
        $evalRef = "EVAL-#{$evalId} ({$studentName} • {$ev['evaluation_period']})";

        log_evaluation_action(
            $pdo,
            $evalId,
            (int) $user['id'],
            $studentName,
            'SA',
            $isLateRequest ? 'SA_REQUESTED_LATE_EXTENSION' : 'SA_REQUESTED_EXTENSION',
            $ev['status'],
            $ev['status'],
            'EXTENSION_REQUESTED',
            "Requested +{$requestedDays} school days extension (Current Due: {$currentDue}). Category: {$reasonCategory}"
                . ($explanation !== '' ? " | Explanation: {$explanation}" : '')
        );

        $coordStmt = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
        foreach ($coordStmt->fetchAll(PDO::FETCH_COLUMN) as $coordId) {
            send_evaluation_notification(
                $pdo,
                $evalId,
                (int) $coordId,
                'EXT_REQ_' . time(),
                ($isLateRequest ? "Emergency/Late Extension Request: " : "Extension Request: ") . $studentName,
                "{$studentName} ({$ev['department']}) requested a {$requestedDays}-school-day extension for their evaluation acknowledgment (Current Due: {$currentDue}). Reason: {$reasonCategory}"
                    . ($explanation !== '' ? " — {$explanation}" : '') . ". Please approve or reject.",
                'SA_EVALUATION_EXTENSION_REQUEST',
                "#/admin/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                (int) $user['id'],
                [
                    'evalRef' => $evalRef,
                    'requiredAction' => 'Approve or Reject S.A. Acknowledgment Extension Request',
                    'currentStatus' => 'Step 2: Extension Requested',
                    'dueDate' => $currentDue,
                ]
            );
        }

        if (!empty($ev['supervisor_id'])) {
            send_evaluation_notification(
                $pdo,
                $evalId,
                (int) $ev['supervisor_id'],
                'EXT_REQ_SUP_' . time(),
                ($isLateRequest ? "Emergency/Late Extension Requested: " : "Extension Requested: ") . $studentName,
                "{$studentName} ({$ev['department']}) requested a {$requestedDays}-school-day extension for their evaluation acknowledgment. Reason: {$reasonCategory}. S.A. Coordinator has been notified for decision.",
                'SA_EVALUATION_EXTENSION_REQUEST',
                "#/supervisor/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                (int) $user['id'],
                [
                    'evalRef' => $evalRef,
                    'requiredAction' => 'View Extension Status',
                    'currentStatus' => 'Step 3: Extension Requested',
                    'dueDate' => $currentDue,
                ],
                false
            );
        }

        audit('SA_EVALUATION_EXTENSION_REQUESTED', "SA {$saRow['student_id']} ({$studentName}) requested extension for evaluation #{$evalId}: {$reasonCategory}", (int) $user['id']);

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'acknowledgmentStatus' => 'EXTENSION_REQUESTED',
            'extensionStatus' => 'PENDING',
            'evaluation' => $freshEval,
            'message' => 'Your extension request has been submitted to the S.A. Coordinator for review.',
        ]);

    // =========================================================================
    // 7C. STEP 2 EXCEPTION / CONCERN SUBMISSION BY S.A.
    //     (Submit concern/dispute, decline acknowledgment, or report inability to acknowledge)
    // =========================================================================
    case 'sa_submit_concern':
        require_role($user, 'SA');
        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $saStmt = $pdo->prepare("SELECT id, student_id, first_name, last_name FROM sa_profiles WHERE user_id = ? LIMIT 1");
        $saStmt->execute([(int) $user['id']]);
        $saRow = $saStmt->fetch() ?: fail('Student Assistant profile not found.', 404);
        $saProfileId = (int) $saRow['id'];

        $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
        $evStmt->execute([$semId, $saProfileId]);
        $ev = $evStmt->fetch();
        if (!$ev || in_array($ev['status'], ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
            fail('Your evaluation has not been released yet.', 400);
        }
        if ($ev['status'] === 'FINALIZED') {
            fail('This evaluation is already finalized.', 422);
        }

        $exceptionType = strtoupper(trim((string) ($in['exceptionType'] ?? 'CONCERN_SUBMITTED')));
        if (!in_array($exceptionType, ['CONCERN_SUBMITTED', 'ACKNOWLEDGMENT_DECLINED', 'UNABLE_TO_ACKNOWLEDGE'], true)) {
            fail('Invalid concern or exception status selected.', 422);
        }

        $reasonText = trim((string) ($in['reasonText'] ?? ''));
        if (mb_strlen($reasonText) < 5) {
            fail('Please provide a clear explanation or reason (at least 5 characters) for the S.A. Coordinator to review.', 422);
        }

        $studentSignature = trim((string) ($in['studentSignature'] ?? ''));
        $saComments = trim((string) ($in['saComments'] ?? ''));
        $evalId = (int) $ev['id'];

        $pdo->prepare("
            UPDATE sa_evaluations
               SET sa_user_id = ?,
                   student_signature = CASE WHEN ? <> '' THEN ? ELSE student_signature END,
                   student_sign_date = CASE WHEN ? <> '' THEN CURDATE() ELSE student_sign_date END,
                   sa_comments = COALESCE(?, sa_comments),
                   sa_concern_text = CASE WHEN ? = 'CONCERN_SUBMITTED' THEN ? ELSE sa_concern_text END,
                   sa_has_dispute = CASE WHEN ? = 'CONCERN_SUBMITTED' THEN 1 ELSE sa_has_dispute END,
                   sa_exception_reason = ?,
                   acknowledgment_status = ?,
                   status = 'FOR_COORDINATOR_REVIEW'
             WHERE id = ?
        ")->execute([
            (int) $user['id'],
            $studentSignature, $studentSignature,
            $studentSignature,
            $saComments !== '' ? $saComments : null,
            $exceptionType, $reasonText,
            $exceptionType,
            $reasonText,
            $exceptionType,
            $evalId,
        ]);

        $studentName = $ev['student_name'] ?: ($saRow['first_name'] . ' ' . $saRow['last_name']);
        $evalRef = "EVAL-#{$evalId} ({$studentName} • {$ev['evaluation_period']})";
        $statusLabel = EVAL_ACK_STATUSES[$exceptionType] ?? $exceptionType;

        log_evaluation_action(
            $pdo,
            $evalId,
            (int) $user['id'],
            $studentName,
            'SA',
            'SA_' . $exceptionType,
            $ev['status'],
            'FOR_COORDINATOR_REVIEW',
            $exceptionType,
            "{$statusLabel}: {$reasonText}"
        );

        $coordStmt = $pdo->query("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
        foreach ($coordStmt->fetchAll(PDO::FETCH_COLUMN) as $coordId) {
            send_evaluation_notification(
                $pdo,
                $evalId,
                (int) $coordId,
                'SA_EXC_COORD_' . time(),
                "S.A. Evaluation {$statusLabel}: {$studentName}",
                "{$studentName} ({$ev['department']}) recorded '{$statusLabel}' on their performance evaluation. Details: {$reasonText}. Routed to S.A. Coordinator for Step 3 review (Supervisor's original ratings remain preserved).",
                'SA_EVALUATION_CONCERN',
                "#/admin/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                (int) $user['id'],
                [
                    'evalRef' => $evalRef,
                    'requiredAction' => 'Step 3: Coordinator Review of S.A. Concern / Exception',
                    'currentStatus' => "Step 3: {$statusLabel}",
                    'dueDate' => $ev['ack_due_date'] ?? 'N/A',
                ]
            );
        }

        if (!empty($ev['supervisor_id'])) {
            send_evaluation_notification(
                $pdo,
                $evalId,
                (int) $ev['supervisor_id'],
                'SA_EXC_SUP_' . time(),
                "S.A. Evaluation {$statusLabel}: {$studentName}",
                "{$studentName} ({$ev['department']}) noted '{$statusLabel}' on their performance evaluation ({$reasonText}). This has been forwarded to the S.A. Coordinator for Step 4 review.",
                'SA_EVALUATION_CONCERN',
                "#/supervisor/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                (int) $user['id'],
                [
                    'evalRef' => $evalRef,
                    'requiredAction' => 'Step 4: Pending Coordinator Review',
                    'currentStatus' => "Step 3: {$statusLabel}",
                    'dueDate' => $ev['ack_due_date'] ?? 'N/A',
                ],
                false
            );
        }

        audit('SA_EVALUATION_EXCEPTION_SUBMITTED', "SA {$saRow['student_id']} ({$studentName}) submitted {$exceptionType} for evaluation #{$evalId}: {$reasonText}", (int) $user['id']);

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'status' => 'FOR_COORDINATOR_REVIEW',
            'workflowStage' => 'step3_pending_coordinator_review',
            'acknowledgmentStatus' => $exceptionType,
            'evaluation' => $freshEval,
            'message' => "Your {$statusLabel} record has been saved and routed to the S.A. Coordinator for review.",
        ]);

    // =========================================================================
    // 8A. COORDINATOR APPROVES OR REJECTS S.A. EXTENSION REQUEST
    // =========================================================================
    case 'coordinator_review_extension':
        require_role($user, 'ADMIN');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $decision = strtoupper(trim((string) ($in['decision'] ?? '')));
        if (!in_array($decision, ['APPROVED', 'REJECTED'], true)) {
            fail('Please choose APPROVED or REJECTED for the extension request.', 422);
        }

        $decisionReason = trim((string) ($in['decisionReason'] ?? ''));
        if (mb_strlen($decisionReason) < 3) {
            fail('Please provide a reason for approving or rejecting the extension request.', 422);
        }

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
        $evStmt->execute([$semId, $saProfileId]);
        $ev = $evStmt->fetch() ?: fail('Evaluation record not found.', 404);
        $evalId = (int) $ev['id'];

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $saItem = $resolved['roster'][$saProfileId] ?? null;
        $saUserId = !empty($ev['sa_user_id']) ? (int) $ev['sa_user_id'] : ($saItem['userId'] ?? 0);
        $studentName = $ev['student_name'] ?: ($saItem['studentName'] ?? 'Student Assistant');
        $coordName = $user['full_name'] ?: 'S.A. Coordinator';

        $today = date('Y-m-d');
        $currentDue = $ev['ack_due_date'] ?: $today;

        if ($decision === 'APPROVED') {
            $extensionDays = max(1, min(15, (int) ($in['extensionDays'] ?? ($ev['extension_requested_days'] ?: EVAL_DEFAULT_EXTENSION_SCHOOL_DAYS))));
            $customDueDate = trim((string) ($in['newDueDate'] ?? ''));
            if ($customDueDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $customDueDate) && $customDueDate >= $today) {
                $newDueDate = $customDueDate;
            } else {
                $baseDate = $currentDue >= $today ? $currentDue : $today;
                $newDueDate = add_school_days($pdo, $baseDate, $extensionDays);
            }
            $nextAckStatus = 'EXTENDED';
        } else {
            $newDueDate = $currentDue;
            $nextAckStatus = ($today > $currentDue) ? 'OVERDUE_AWAITING_SA' : 'PENDING';
        }

        $pdo->prepare("
            UPDATE sa_evaluations
               SET ack_due_date = ?,
                   acknowledgment_status = ?,
                   extension_status = ?,
                   extension_decided_by = ?,
                   extension_decided_by_name = ?,
                   extension_decided_at = NOW(),
                   extension_decision_reason = ?
             WHERE id = ?
        ")->execute([
            $newDueDate,
            $nextAckStatus,
            $decision,
            (int) $user['id'],
            $coordName,
            $decisionReason,
            $evalId,
        ]);

        log_evaluation_action(
            $pdo,
            $evalId,
            (int) $user['id'],
            $coordName,
            'ADMIN',
            $decision === 'APPROVED' ? 'COORDINATOR_APPROVED_EXTENSION' : 'COORDINATOR_REJECTED_EXTENSION',
            $ev['status'],
            $ev['status'],
            $nextAckStatus,
            ($decision === 'APPROVED'
                ? "Approved extension request. New acknowledgment deadline: {$newDueDate}."
                : "Rejected extension request. Original deadline retained: {$newDueDate}.")
                . " Reason: {$decisionReason}"
        );

        $evalRef = "EVAL-#{$evalId} ({$studentName} • {$ev['evaluation_period']})";
        if ($saUserId > 0) {
            send_evaluation_notification(
                $pdo,
                $evalId,
                $saUserId,
                'EXT_DECISION_' . time(),
                $decision === 'APPROVED'
                    ? "Extension Approved: New Evaluation Acknowledgment Deadline ({$newDueDate})"
                    : "Extension Request Update: S.A. Performance Evaluation",
                $decision === 'APPROVED'
                    ? "The S.A. Coordinator ({$coordName}) approved your extension request. Your new deadline to review and sign your performance evaluation is {$newDueDate}. Remarks: {$decisionReason}"
                    : "The S.A. Coordinator ({$coordName}) reviewed your extension request and retained the deadline ({$newDueDate}). Remarks: {$decisionReason}. Please sign in to complete your acknowledgment.",
                'SA_EVALUATION_EXTENSION_DECISION',
                "#/sa/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                (int) $user['id'],
                [
                    'evalRef' => $evalRef,
                    'requiredAction' => 'Review & Sign Evaluation Acknowledgment',
                    'currentStatus' => $decision === 'APPROVED' ? "Step 2: Extended (Due {$newDueDate})" : 'Step 2: Awaiting S.A. Acknowledgment',
                    'dueDate' => $newDueDate,
                ]
            );
        }

        if (!empty($ev['supervisor_id'])) {
            send_evaluation_notification(
                $pdo,
                $evalId,
                (int) $ev['supervisor_id'],
                'EXT_DECISION_SUP_' . time(),
                $decision === 'APPROVED'
                    ? "Extension Approved for {$studentName}"
                    : "Extension Request Update for {$studentName}",
                $decision === 'APPROVED'
                    ? "The S.A. Coordinator ({$coordName}) approved {$studentName}'s extension request. New acknowledgment deadline: {$newDueDate}."
                    : "The S.A. Coordinator ({$coordName}) reviewed {$studentName}'s extension request and retained the deadline: {$newDueDate}.",
                'SA_EVALUATION_EXTENSION_DECISION',
                "#/supervisor/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                (int) $user['id'],
                [
                    'evalRef' => $evalRef,
                    'requiredAction' => 'Awaiting S.A. Acknowledgment',
                    'currentStatus' => $decision === 'APPROVED' ? "Step 3: Extended (Due {$newDueDate})" : 'Step 3: Awaiting S.A. Acknowledgment',
                    'dueDate' => $newDueDate,
                ],
                false
            );
        }

        audit('SA_EVALUATION_EXTENSION_' . $decision, "Coordinator {$decision} extension for evaluation #{$evalId} ({$studentName}), Due={$newDueDate}: {$decisionReason}", (int) $user['id']);

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'extensionStatus' => $decision,
            'acknowledgmentStatus' => $nextAckStatus,
            'ackDueDate' => $newDueDate,
            'evaluation' => $freshEval,
            'message' => $decision === 'APPROVED'
                ? "Extension approved! New acknowledgment deadline for {$studentName} is {$newDueDate}."
                : "Extension request rejected. Original deadline ({$newDueDate}) retained and S.A. notified.",
        ]);

    // =========================================================================
    // 8B. COORDINATOR RETURNS EVALUATION TO SUPERVISOR FOR REVISION
    // =========================================================================
    case 'coordinator_return_revision':
        if (($user['role'] ?? '') !== 'ADMIN') {
            audit('ACCESS_DENIED', "User #{$user['id']} (Role: {$user['role']}) attempted Coordinator return for revision", (int) $user['id']);
            fail('Only the S.A. Coordinator is authorized to return an evaluation for clarification or revision.', 403);
        }
        require_role($user, 'ADMIN');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $returnReason = trim((string) ($in['returnReason'] ?? ''));
        if (mb_strlen($returnReason) < 5) {
            fail('Please provide a clear reason (at least 5 characters) for returning the evaluation to the Supervisor.', 422);
        }

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];
        $coordName = $user['full_name'] ?: 'S.A. Coordinator';

        $evalId = 0;
        $ev = null;
        $pdo->beginTransaction();
        try {
            $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE");
            $evStmt->execute([$semId, $saProfileId]);
            $ev = $evStmt->fetch();
            if (!$ev) {
                $pdo->rollBack();
                fail('Evaluation record not found.', 404);
            }
            $currNorm = normalize_evaluation_status($ev['status'], $ev);
            if ($currNorm === 'PENDING') {
                $pdo->rollBack();
                fail('Step 1 has not been submitted by the Supervisor yet.', 422);
            }
            if ($currNorm === 'FINALIZED') {
                $pdo->rollBack();
                fail('This evaluation is already finalized. Please use "Reopen Finalized Evaluation" first.', 422);
            }
            $evalId = (int) $ev['id'];

            // Idempotent check if already returned for revision with the same reason
            if ($currNorm === 'RETURNED_FOR_REVISION' && trim((string) ($ev['last_return_reason'] ?? '')) === $returnReason) {
                $pdo->rollBack();
                $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);
                respond([
                    'success' => true,
                    'alreadyReturned' => true,
                    'evaluationId' => $evalId,
                    'status' => 'RETURNED_FOR_REVISION',
                    'workflowStage' => 'step1_in_progress',
                    'acknowledgmentStatus' => 'RETURNED_FOR_REVISION',
                    'evaluation' => $freshEval,
                    'message' => "Evaluation is already returned to {$ev['supervisor_name']} for revision.",
                ]);
            }

            $pdo->prepare("
                UPDATE sa_evaluations
                   SET status = 'RETURNED_FOR_REVISION',
                       acknowledgment_status = 'RETURNED_FOR_REVISION',
                       revision_count = revision_count + 1,
                       last_return_reason = ?,
                       returned_by = ?,
                       returned_by_name = ?,
                       returned_at = NOW(),
                       supervisor_revision_request = NULL,
                       supervisor_revision_requested_at = NULL
                 WHERE id = ?
            ")->execute([
                $returnReason,
                (int) $user['id'],
                $coordName,
                $evalId,
            ]);

            log_evaluation_action(
                $pdo,
                $evalId,
                (int) $user['id'],
                $coordName,
                'ADMIN',
                'RETURNED_FOR_REVISION',
                $ev['status'],
                'RETURNED_FOR_REVISION',
                'RETURNED_FOR_REVISION',
                "Returned evaluation to Supervisor ({$ev['supervisor_name']}) for revision. Reason: {$returnReason}"
            );

            $pdo->commit();
        } catch (Throwable $txErr) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log("[AssistPay coordinator_return_revision Transaction Error EVAL-SA-{$saProfileId}] " . $txErr->getMessage());
            fail('Could not return the evaluation for revision due to a database error. Please try again.', 500);
        }

        $evalRef = "EVAL-#{$evalId} ({$ev['student_name']} • {$ev['evaluation_period']})";
        $simulateNotifFail = !empty($in['_simulateNotificationFailure']);
        try {
            if (!empty($ev['supervisor_id'])) {
                send_evaluation_notification(
                    $pdo,
                    $evalId,
                    (int) $ev['supervisor_id'],
                    'RETURN_REV_SUP_' . ((int) ($ev['revision_count'] ?? 0) + 1),
                    "Action Required: Evaluation Returned for Revision ({$ev['student_name']})",
                    "The S.A. Coordinator ({$coordName}) returned your performance evaluation for {$ev['student_name']} ({$ev['department']}) for revision. Reason: {$returnReason}. Please review, update, and resubmit Step 1.",
                    'SA_EVALUATION_RETURNED',
                    "#/supervisor/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'Revise & Resubmit Step 1 Evaluation',
                        'currentStatus' => 'Step 1: Returned for Revision',
                        'dueDate' => 'Immediate Follow-up',
                        'simulateNotificationFailure' => $simulateNotifFail,
                    ],
                    true
                );
            }

            if (!empty($ev['sa_user_id'])) {
                send_evaluation_notification(
                    $pdo,
                    $evalId,
                    (int) $ev['sa_user_id'],
                    'RETURN_REV_SA_' . ((int) ($ev['revision_count'] ?? 0) + 1),
                    "Evaluation Returned to Supervisor for Revision",
                    "Your performance evaluation for {$ev['evaluation_period']} has been returned to your Immediate Supervisor by the S.A. Coordinator for revision ({$returnReason}). You will be notified once the revised evaluation is released.",
                    'SA_EVALUATION_RETURNED',
                    "#/sa/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'Wait for Supervisor to Resubmit Revised Evaluation',
                        'currentStatus' => 'Step 1: Returned for Revision',
                        'dueDate' => 'Pending Revision',
                        'simulateNotificationFailure' => $simulateNotifFail,
                    ],
                    true
                );
            }

            audit('SA_EVALUATION_RETURNED_FOR_REVISION', "Coordinator returned evaluation #{$evalId} ({$ev['student_name']}) to Supervisor: {$returnReason}", (int) $user['id']);
        } catch (Throwable $postCommitErr) {
            error_log("[AssistPay coordinator_return_revision Post-Commit Warning EVAL-#{$evalId}] " . $postCommitErr->getMessage());
        }

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'evaluationId' => $evalId,
            'status' => 'RETURNED_FOR_REVISION',
            'workflowStage' => 'step1_in_progress',
            'acknowledgmentStatus' => 'RETURNED_FOR_REVISION',
            'evaluation' => $freshEval,
            'message' => "Evaluation returned to {$ev['supervisor_name']} for revision. Audit history preserved and notifications sent.",
        ]);

    // =========================================================================
    // 8C. COORDINATOR RECORDS FOLLOW-UP / EXCEPTION FOR OVERDUE OR ABSENT S.A.
    // =========================================================================
    case 'coordinator_mark_exception':
        if (($user['role'] ?? '') !== 'ADMIN') {
            audit('ACCESS_DENIED', "User #{$user['id']} (Role: {$user['role']}) attempted Coordinator exception logging", (int) $user['id']);
            fail('Only the S.A. Coordinator is authorized to log an overdue follow-up or exception.', 403);
        }
        require_role($user, 'ADMIN');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $ackStatus = strtoupper(trim((string) ($in['acknowledgmentStatus'] ?? 'OVERDUE_AWAITING_COORDINATOR')));
        if (!in_array($ackStatus, ['OVERDUE_AWAITING_COORDINATOR', 'UNABLE_TO_ACKNOWLEDGE', 'ACKNOWLEDGMENT_DECLINED'], true)) {
            fail('Invalid exception status selected.', 422);
        }
        $remarks = trim((string) ($in['remarks'] ?? ''));
        if (mb_strlen($remarks) < 5) {
            fail('Please provide follow-up notes or the documented exception reason (at least 5 characters).', 422);
        }

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
        $evStmt->execute([$semId, $saProfileId]);
        $ev = $evStmt->fetch() ?: fail('Evaluation record not found.', 404);
        if (in_array(normalize_evaluation_status($ev['status'], $ev), ['PENDING', 'RETURNED_FOR_REVISION', 'FINALIZED'], true)) {
            fail('This evaluation is not in Step 2/3 review.', 422);
        }

        $evalId = (int) $ev['id'];
        $coordName = $user['full_name'] ?: 'S.A. Coordinator';

        $pdo->prepare("
            UPDATE sa_evaluations
               SET acknowledgment_status = ?,
                   sa_exception_reason = ?,
                   status = 'FOR_COORDINATOR_REVIEW'
             WHERE id = ?
        ")->execute([
            $ackStatus,
            $remarks,
            $evalId,
        ]);

        $statusLabel = EVAL_ACK_STATUSES[$ackStatus] ?? $ackStatus;
        log_evaluation_action(
            $pdo,
            $evalId,
            (int) $user['id'],
            $coordName,
            'ADMIN',
            'COORDINATOR_RECORDED_EXCEPTION',
            $ev['status'],
            'FOR_COORDINATOR_REVIEW',
            $ackStatus,
            "Coordinator documented Step 2 follow-up / exception ({$statusLabel}): {$remarks}"
        );

        audit('SA_EVALUATION_EXCEPTION_LOGGED', "Coordinator logged {$ackStatus} for evaluation #{$evalId} ({$ev['student_name']}): {$remarks}", (int) $user['id']);

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'evaluationId' => $evalId,
            'status' => 'FOR_COORDINATOR_REVIEW',
            'workflowStage' => 'step3_pending_coordinator_review',
            'acknowledgmentStatus' => $ackStatus,
            'evaluation' => $freshEval,
            'message' => "Recorded '{$statusLabel}' and routed evaluation to Step 3 Coordinator Review.",
        ]);

    // =========================================================================
    // 8C-2. PROCESS STEP 3 -> STEP 4: COORDINATOR COMPLETES REVIEW & ADVANCES TO FINAL DECISION
    // =========================================================================
    case 'coordinator_complete_review':
        if (($user['role'] ?? '') !== 'ADMIN') {
            audit('ACCESS_DENIED', "User #{$user['id']} (Role: {$user['role']}) attempted Step 3 Coordinator Review completion", (int) $user['id']);
            fail('Only the S.A. Coordinator is authorized to complete Step 3 Coordinator Review.', 403);
        }
        require_role($user, 'ADMIN');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $reviewNotes = trim((string) ($in['reviewNotes'] ?? ''));
        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];
        $coordName = $user['full_name'] ?: 'S.A. Coordinator';

        $evalId = 0;
        $ev = null;
        $ackStatus = 'PENDING';

        $pdo->beginTransaction();
        try {
            $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE");
            $evStmt->execute([$semId, $saProfileId]);
            $ev = $evStmt->fetch();
            if (!$ev) {
                $pdo->rollBack();
                fail('Evaluation record not found.', 404);
            }

            $evalId = (int) $ev['id'];
            $currentNormStatus = normalize_evaluation_status($ev['status'], $ev);

            if (in_array($currentNormStatus, ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
                $pdo->rollBack();
                fail('The Supervisor must complete and submit Step 1 before Coordinator Review can be completed.', 422);
            }
            if ($currentNormStatus === 'FINALIZED') {
                $pdo->rollBack();
                fail('This evaluation is already finalized.', 422);
            }

            // Idempotent check: if Step 3 review was already completed and evaluation is already in Step 4 (FOR_FINAL_DECISION),
            // return a controlled response reflecting its current status without duplicating the action log.
            if ($currentNormStatus === 'FOR_FINAL_DECISION') {
                $pdo->rollBack();
                $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);
                respond([
                    'success' => true,
                    'alreadyReviewed' => true,
                    'evaluationId' => $evalId,
                    'evaluationRef' => "EVAL-#{$evalId}",
                    'status' => 'FOR_FINAL_DECISION',
                    'workflowStage' => 'step4_pending_final_decision',
                    'nextActionRole' => 'COORDINATOR',
                    'nextActionAssignedTo' => 'S.A. Coordinator',
                    'evaluation' => $freshEval,
                    'message' => 'Step 3 (Coordinator Review) has already been completed. This evaluation is currently at Step 4: Final Decision.',
                ]);
            }

            $ackStatus = $ev['acknowledgment_status'] ?? 'PENDING';
            $today = date('Y-m-d');
            $isOverdue = !empty($ev['ack_due_date']) && $today > $ev['ack_due_date'];
            if ($currentNormStatus === 'FOR_SA_REVIEW' && empty($ev['sa_acknowledged_at']) && !$isOverdue
                && !in_array($ackStatus, ['SIGNED', 'CONCERN_SUBMITTED', 'ACKNOWLEDGMENT_DECLINED', 'UNABLE_TO_ACKNOWLEDGE', 'OVERDUE_AWAITING_SA', 'OVERDUE_AWAITING_COORDINATOR'], true)
            ) {
                $pdo->rollBack();
                fail("Step 2 (S.A. Acknowledgment) is still awaiting the Student Assistant until {$ev['ack_due_date']}. Please wait for S.A. acknowledgment or record a documented exception first.", 422);
            }

            $pdo->prepare("
                UPDATE sa_evaluations
                   SET status = 'FOR_FINAL_DECISION'
                 WHERE id = ?
            ")->execute([$evalId]);

            $noteSummary = $reviewNotes !== ''
                ? "Completed Step 3 Coordinator Review and advanced to Step 4 Final Decision. Notes: {$reviewNotes}"
                : "Completed Step 3 Coordinator Review (verified Supervisor evaluation, S.A. acknowledgment, and supporting records) and advanced to Step 4 Final Decision.";

            log_evaluation_action(
                $pdo,
                $evalId,
                (int) $user['id'],
                $coordName,
                'ADMIN',
                'COORDINATOR_COMPLETED_REVIEW',
                $ev['status'],
                'FOR_FINAL_DECISION',
                $ackStatus,
                $noteSummary
            );

            $pdo->commit();
        } catch (Throwable $txErr) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log("[AssistPay coordinator_complete_review Transaction Error EVAL-SA-{$saProfileId}] " . $txErr->getMessage());
            fail('Could not complete Step 3 Coordinator Review due to a database error. Please try again.', 500);
        }

        try {
            audit('SA_EVALUATION_REVIEW_COMPLETED', "Coordinator completed Step 3 review for evaluation #{$evalId} ({$ev['student_name']}) and advanced to Step 4 Final Decision.", (int) $user['id']);
        } catch (Throwable $postErr) {
            error_log("[AssistPay coordinator_complete_review Audit Warning EVAL-#{$evalId}] " . $postErr->getMessage());
        }

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'alreadyReviewed' => false,
            'evaluationId' => $evalId,
            'evaluationRef' => "EVAL-#{$evalId}",
            'status' => 'FOR_FINAL_DECISION',
            'workflowStage' => 'step4_pending_final_decision',
            'nextActionRole' => 'COORDINATOR',
            'nextActionAssignedTo' => 'S.A. Coordinator',
            'evaluation' => $freshEval,
            'message' => "Step 3 (Coordinator Review) marked complete. Evaluation is now at Step 4: Final Decision.",
        ]);

    // =========================================================================
    // 8D-1. PROCESS STEP 4 DRAFT: COORDINATOR SAVES FINAL DECISION DRAFT
    //       (Saves decision, rationale, and effective date without finalizing or advancing to Step 5)
    // =========================================================================
    case 'coordinator_save_decision_draft':
        if (($user['role'] ?? '') !== 'ADMIN') {
            audit('ACCESS_DENIED', "User #{$user['id']} (Role: {$user['role']}) attempted Step 4 Coordinator Decision Draft save", (int) $user['id']);
            fail('Only the S.A. Coordinator is authorized to save a Final Decision draft.', 403);
        }
        require_role($user, 'ADMIN');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
        $evStmt->execute([$semId, $saProfileId]);
        $ev = $evStmt->fetch() ?: fail('Evaluation record not found.', 404);

        $currentNormStatus = normalize_evaluation_status($ev['status'], $ev);
        if (in_array($currentNormStatus, ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
            fail('Step 1 must be submitted before a Step 4 decision draft can be saved.', 422);
        }
        if ($currentNormStatus === 'FINALIZED') {
            fail('This evaluation has already been finalized and is read-only.', 422);
        }

        $decision = strtoupper(trim((string) ($in['coordinatorDecision'] ?? '')));
        if ($decision !== '' && !in_array($decision, ['RETAIN', 'IMPROVEMENT_PLAN', 'REASSIGNMENT', 'NOT_RENEWED'], true)) {
            fail('Invalid decision option selected.', 422);
        }
        $reason = trim((string) ($in['coordinatorReason'] ?? ''));
        $effectiveDate = trim((string) ($in['effectiveDate'] ?? ''));
        if ($effectiveDate !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $effectiveDate)) {
            $effectiveDate = '';
        }

        $coordinatorName = trim((string) ($user['full_name'] ?? 'S.A. Coordinator'));
        $evalId = (int) $ev['id'];

        // Preserve current status (e.g., FOR_COORDINATOR_REVIEW or FOR_FINAL_DECISION); never advance to FINALIZED
        $pdo->prepare("
            UPDATE sa_evaluations
               SET coordinator_decision = ?,
                   coordinator_reason = ?,
                   effective_date = ?,
                   coordinator_id = ?,
                   coordinator_name = ?
             WHERE id = ?
        ")->execute([
            $decision !== '' ? $decision : null,
            $reason !== '' ? $reason : null,
            $effectiveDate !== '' ? $effectiveDate : null,
            (int) $user['id'],
            $coordinatorName,
            $evalId,
        ]);

        log_evaluation_action(
            $pdo,
            $evalId,
            (int) $user['id'],
            $coordinatorName,
            'ADMIN',
            'COORDINATOR_SAVED_DECISION_DRAFT',
            $ev['status'],
            $ev['status'],
            $ev['acknowledgment_status'] ?? 'SIGNED',
            "Saved Step 4 Final Decision draft (" . ($decision ?: 'Unspecified') . "). Workflow remains at {$currentNormStatus}."
        );

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'evaluationId' => $evalId,
            'evaluationRef' => "EVAL-#{$evalId}",
            'status' => $currentNormStatus,
            'workflowStage' => compute_workflow_stage_key($currentNormStatus),
            'evaluation' => $freshEval,
            'message' => 'Final Decision draft saved! The evaluation remains in Step 4 until you click Finalize Decision.',
        ]);

    // =========================================================================
    // 8D. PROCESS STEP 3 & 4: COORDINATOR REVIEWS & RECORDS FINAL DECISION
    //     (Retain, Improvement Plan, Reassignment, or Non-Renewal, with reason & effective date)
    //     -> Advances to STEP 5 (S.A. & Supervisor notified; record becomes read-only)
    // =========================================================================
    case 'coordinator_decide':
        if (($user['role'] ?? '') !== 'ADMIN') {
            audit('ACCESS_DENIED', "User #{$user['id']} (Role: {$user['role']}) attempted Step 4 Final Decision submission", (int) $user['id']);
            fail('Only the S.A. Coordinator is authorized to record and finalize the evaluation decision.', 403);
        }
        require_role($user, 'ADMIN');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $decision = strtoupper(trim((string) ($in['coordinatorDecision'] ?? '')));
        if (!in_array($decision, ['RETAIN', 'IMPROVEMENT_PLAN', 'REASSIGNMENT', 'NOT_RENEWED'], true)) {
            // Default to supervisor's recommendation if available
            $decision = 'RETAIN';
        }

        $reason = trim((string) ($in['coordinatorReason'] ?? ''));
        $disclosedFeedback = trim((string) ($in['disclosedFeedback'] ?? ($in['coordinatorReason'] ?? '')));

        $effectiveDate = trim((string) ($in['effectiveDate'] ?? ''));
        if (!$effectiveDate || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $effectiveDate)) {
            $effectiveDate = date('Y-m-d');
        }

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];
        $coordinatorName = trim((string) ($user['full_name'] ?? 'S.A. Coordinator'));

        $evalId = 0;
        $ev = null;
        $decisionLabel = format_decision_label($decision) ?? $decision;
        $todayYmd = date('Y-m-d');
        $ackDueDate = add_school_days($pdo, $todayYmd, EVAL_DEFAULT_ACK_SCHOOL_DAYS);

        $pdo->beginTransaction();
        try {
            $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE");
            $evStmt->execute([$semId, $saProfileId]);
            $ev = $evStmt->fetch();
            if (!$ev) {
                $pdo->rollBack();
                fail('Evaluation record not found.', 404);
            }

            $evalId = (int) $ev['id'];
            $currentNormStatus = normalize_evaluation_status($ev['status'], $ev);

            if (in_array($currentNormStatus, ['PENDING', 'RETURNED_FOR_REVISION'], true)) {
                $pdo->rollBack();
                fail('The Supervisor must submit an evaluation recommendation before the Coordinator can review and approve a final decision.', 422);
            }

            if ($currentNormStatus === 'FINALIZED') {
                $pdo->rollBack();
                $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label'], 'ADMIN');
                fail('This evaluation is already finalized and read-only. To modify the decision, please reopen it first.', 422, ['evaluation' => $freshEval]);
            }

            // If empty, inherit supervisor's recommendation or feedback
            if (empty($in['coordinatorDecision']) && !empty($ev['supervisor_recommendation'])) {
                $decision = $ev['supervisor_recommendation'];
                $decisionLabel = format_decision_label($decision) ?? $decision;
            }
            if (empty($in['effectiveDate']) && !empty($ev['effective_date'])) {
                $effectiveDate = $ev['effective_date'];
            }
            if ($disclosedFeedback === '' && !empty($ev['supervisor_reason'])) {
                $disclosedFeedback = $ev['supervisor_reason'];
            }
            if ($reason === '' && !empty($ev['supervisor_reason'])) {
                $reason = $ev['supervisor_reason'];
            }

            $pdo->prepare("
                UPDATE sa_evaluations
                   SET coordinator_decision = ?,
                       coordinator_reason = ?,
                       disclosed_feedback = ?,
                       effective_date = ?,
                       coordinator_id = ?,
                       coordinator_name = ?,
                       finalized_at = NOW(),
                       status = 'FINALIZED',
                       rejection_reason = NULL,
                       rejected_at = NULL,
                       rejected_by = NULL,
                       rejected_by_name = NULL
                 WHERE id = ?
            ")->execute([
                $decision,
                $reason,
                $disclosedFeedback,
                $effectiveDate,
                (int) $user['id'],
                $coordinatorName,
                $evalId
            ]);

            log_evaluation_action(
                $pdo,
                $evalId,
                (int) $user['id'],
                $coordinatorName,
                'ADMIN',
                'COORDINATOR_FINALIZED_EVALUATION',
                $ev['status'],
                'FINALIZED',
                $ev['acknowledgment_status'] ?? 'SIGNED',
                "Approved final decision: {$decisionLabel} (Effective: {$effectiveDate}). Official evaluation record finalized and preserved."
            );

            $pdo->commit();
        } catch (Throwable $txErr) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log("[AssistPay coordinator_decide Transaction Error EVAL-SA-{$saProfileId}] " . $txErr->getMessage());
            fail('Could not approve the evaluation decision due to a database error. Please try again.', 500);
        }

        $resolved = resolve_semester_sa_roster($pdo, $semId);
        $saItem = $resolved['roster'][$saProfileId] ?? null;
        $studentName = $ev['student_name'] ?: ($saItem['studentName'] ?? 'Student Assistant');
        $saUserId = !empty($ev['sa_user_id']) ? (int) $ev['sa_user_id'] : ($saItem['userId'] ?? 0);
        $evalRef = "EVAL-#{$evalId} ({$studentName} • {$ev['evaluation_period']})";
        $revCycle = (int) ($ev['revision_count'] ?? 0);
        $notificationQueuedForRetry = false;
        $simulateNotifFail = !empty($in['_simulateNotificationFailure']);

        try {
            // Notify the Student Assistant (In-App + Email) that evaluation is finalized
            if ($saUserId > 0) {
                $saNotif = send_evaluation_notification(
                    $pdo,
                    $evalId,
                    $saUserId,
                    "FINALIZED_SA_REV{$revCycle}",
                    "Your Performance Evaluation Has Been Finalized",
                    "The S.A. Coordinator ({$coordinatorName}) has approved the final evaluation decision ({$decisionLabel}, Effective: {$effectiveDate}). Your performance evaluation record is now finalized and preserved.",
                    'SA_EVALUATION_FINALIZED',
                    "#/sa/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'View Finalized Evaluation Record',
                        'currentStatus' => 'Step 5: Finalized Evaluation',
                        'dueDate' => 'Completed',
                        'simulateNotificationFailure' => $simulateNotifFail,
                    ],
                    true
                );
                if (!empty($saNotif['queuedForRetry'])) {
                    $notificationQueuedForRetry = true;
                }
            }

            // Notify the Immediate Supervisor
            if (!empty($ev['supervisor_id'])) {
                $supNotif = send_evaluation_notification(
                    $pdo,
                    $evalId,
                    (int) $ev['supervisor_id'],
                    "FINALIZED_SUP_REV{$revCycle}",
                    "Evaluation Finalized for {$studentName}",
                    "S.A. Coordinator ({$coordinatorName}) approved the final decision ({$decisionLabel}, Effective: {$effectiveDate}) for {$studentName} ({$ev['department']}). The evaluation record is now finalized and locked.",
                    'SA_EVALUATION_FINALIZED',
                    "#/supervisor/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'View Finalized Evaluation Record',
                        'currentStatus' => 'Step 5: Finalized Evaluation',
                        'dueDate' => 'Completed',
                        'simulateNotificationFailure' => $simulateNotifFail,
                    ],
                    true
                );
                if (!empty($supNotif['queuedForRetry'])) {
                    $notificationQueuedForRetry = true;
                }
            }

            audit('SA_EVALUATION_FINALIZED', "Coordinator approved final decision for evaluation #{$evalId} ({$studentName}): Decision={$decisionLabel}, Effective={$effectiveDate} -> FINALIZED", (int) $user['id']);
        } catch (Throwable $postCommitErr) {
            $notificationQueuedForRetry = true;
            error_log("[AssistPay coordinator_decide Post-Commit Notification Warning EVAL-#{$evalId}] " . $postCommitErr->getMessage());
        }

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label'], 'ADMIN');

        respond([
            'success' => true,
            'evaluationId' => $evalId,
            'evaluationRef' => "EVAL-#{$evalId}",
            'status' => 'FINALIZED',
            'workflowStage' => compute_workflow_stage_key('FINALIZED'),
            'coordinatorDecision' => $decision,
            'coordinatorDecisionLabel' => $decisionLabel,
            'effectiveDate' => $effectiveDate,
            'notificationQueuedForRetry' => $notificationQueuedForRetry,
            'evaluation' => $freshEval,
            'message' => "Evaluation decision ({$decisionLabel}) approved! Official record finalized and preserved.",
        ]);

    // =========================================================================
    // 8D-2. COORDINATOR REJECTS SUPERVISOR RECOMMENDATION (Required Reason)
    // =========================================================================
    case 'coordinator_reject':
        if (($user['role'] ?? '') !== 'ADMIN') {
            audit('ACCESS_DENIED', "User #{$user['id']} (Role: {$user['role']}) attempted Coordinator Rejection", (int) $user['id']);
            fail('Only the S.A. Coordinator is authorized to reject an evaluation recommendation.', 403);
        }
        require_role($user, 'ADMIN');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $rejectionReason = trim((string) ($in['rejectionReason'] ?? ($in['reason'] ?? '')));
        if (mb_strlen($rejectionReason) < 5) {
            fail('Please provide a required reason (at least 5 characters) for rejecting the evaluation recommendation.', 422);
        }

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];
        $coordName = $user['full_name'] ?: 'S.A. Coordinator';

        $evalId = 0;
        $ev = null;

        $pdo->beginTransaction();
        try {
            $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE");
            $evStmt->execute([$semId, $saProfileId]);
            $ev = $evStmt->fetch();
            if (!$ev) {
                $pdo->rollBack();
                fail('Evaluation record not found.', 404);
            }
            $evalId = (int) $ev['id'];
            $currNorm = normalize_evaluation_status($ev['status'], $ev);

            if ($currNorm === 'FINALIZED') {
                $pdo->rollBack();
                fail('This evaluation is already finalized and cannot be rejected without reopening.', 422);
            }

            $pdo->prepare("
                UPDATE sa_evaluations
                   SET status = 'REJECTED',
                       rejection_reason = ?,
                       rejected_at = NOW(),
                       rejected_by = ?,
                       rejected_by_name = ?
                 WHERE id = ?
            ")->execute([
                $rejectionReason,
                (int) $user['id'],
                $coordName,
                $evalId
            ]);

            log_evaluation_action(
                $pdo,
                $evalId,
                (int) $user['id'],
                $coordName,
                'ADMIN',
                'COORDINATOR_REJECTED',
                $ev['status'],
                'REJECTED',
                $ev['acknowledgment_status'] ?? 'PENDING',
                "Coordinator rejected evaluation recommendation. Reason: {$rejectionReason}"
            );

            $pdo->commit();
        } catch (Throwable $txErr) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log("[AssistPay coordinator_reject Transaction Error EVAL-SA-{$saProfileId}] " . $txErr->getMessage());
            fail('Could not reject the evaluation recommendation due to a database error. Please try again.', 500);
        }

        $evalRef = "EVAL-#{$evalId} ({$ev['student_name']} • {$ev['evaluation_period']})";
        try {
            if (!empty($ev['supervisor_id'])) {
                send_evaluation_notification(
                    $pdo,
                    $evalId,
                    (int) $ev['supervisor_id'],
                    'REJECT_NOTIF_SUP_' . time(),
                    "Evaluation Recommendation Rejected: {$ev['student_name']}",
                    "The S.A. Coordinator ({$coordName}) rejected the evaluation recommendation for {$ev['student_name']} ({$ev['department']}). Reason: {$rejectionReason}",
                    'SA_EVALUATION_REJECTED',
                    "#/supervisor/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'View Rejection Details',
                        'currentStatus' => 'Recommendation Rejected',
                        'dueDate' => 'N/A'
                    ],
                    false
                );
            }

            $saUserId = !empty($ev['sa_user_id']) ? (int) $ev['sa_user_id'] : 0;
            if ($saUserId > 0) {
                send_evaluation_notification(
                    $pdo,
                    $evalId,
                    $saUserId,
                    'REJECT_NOTIF_SA_' . time(),
                    "Evaluation Recommendation Update",
                    "The S.A. Coordinator ({$coordName}) reviewed your performance evaluation recommendation for {$ev['evaluation_period']}. Reason: {$rejectionReason}",
                    'SA_EVALUATION_REJECTED',
                    "#/sa/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                    (int) $user['id'],
                    [
                        'evalRef' => $evalRef,
                        'requiredAction' => 'View Evaluation Details',
                        'currentStatus' => 'Recommendation Rejected',
                        'dueDate' => 'N/A'
                    ],
                    false
                );
            }
            audit('SA_EVALUATION_REJECTED', "Coordinator rejected evaluation #{$evalId} ({$ev['student_name']}): {$rejectionReason}", (int) $user['id']);
        } catch (Throwable $postErr) {
            error_log("[AssistPay coordinator_reject Post-Commit Warning EVAL-#{$evalId}] " . $postErr->getMessage());
        }

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label'], 'ADMIN');

        respond([
            'success' => true,
            'evaluationId' => $evalId,
            'status' => 'REJECTED',
            'workflowStage' => compute_workflow_stage_key('REJECTED'),
            'evaluation' => $freshEval,
            'message' => "Evaluation recommendation rejected. Reason documented and Supervisor notified.",
        ]);

    // =========================================================================
    // 8E. COORDINATOR REOPENS A FINALIZED EVALUATION (Authorized Action + Audit Log)
    // =========================================================================
    case 'coordinator_reopen':
        require_role($user, 'ADMIN');
        $saProfileId = (int) ($in['saProfileId'] ?? 0);
        if (!$saProfileId) fail('Student Assistant ID is required.', 422);

        $reopenReason = trim((string) ($in['reopenReason'] ?? ''));
        if (mb_strlen($reopenReason) < 5) {
            fail('Please provide a clear authorization reason (at least 5 characters) for reopening this finalized evaluation.', 422);
        }

        $targetStage = strtoupper(trim((string) ($in['targetStage'] ?? 'FOR_COORDINATOR_REVIEW')));
        if (!in_array($targetStage, ['FOR_COORDINATOR_REVIEW', 'FOR_FINAL_DECISION', 'RETURNED_FOR_REVISION'], true)) {
            $targetStage = 'FOR_COORDINATOR_REVIEW';
        }

        $sem = target_semester($in['semesterId'] ?? null);
        $semId = (int) $sem['id'];

        $evStmt = $pdo->prepare("SELECT * FROM sa_evaluations WHERE semester_id = ? AND sa_profile_id = ? ORDER BY id DESC LIMIT 1");
        $evStmt->execute([$semId, $saProfileId]);
        $ev = $evStmt->fetch() ?: fail('Evaluation record not found.', 404);
        if ($ev['status'] !== 'FINALIZED') {
            fail('Only finalized evaluations need to be reopened.', 422);
        }

        $evalId = (int) $ev['id'];
        $coordName = $user['full_name'] ?: 'S.A. Coordinator';
        $nextAckStatus = $targetStage === 'RETURNED_FOR_REVISION'
            ? 'RETURNED_FOR_REVISION'
            : ($ev['acknowledgment_status'] ?: 'SIGNED');

        $pdo->prepare("
            UPDATE sa_evaluations
               SET status = ?,
                   acknowledgment_status = ?,
                   reopened_by = ?,
                   reopened_by_name = ?,
                   reopened_at = NOW(),
                   reopen_reason = ?,
                   revision_count = CASE WHEN ? = 'RETURNED_FOR_REVISION' THEN revision_count + 1 ELSE revision_count END,
                   last_return_reason = CASE WHEN ? = 'RETURNED_FOR_REVISION' THEN ? ELSE last_return_reason END
             WHERE id = ?
        ")->execute([
            $targetStage,
            $nextAckStatus,
            (int) $user['id'],
            $coordName,
            $reopenReason,
            $targetStage,
            $targetStage,
            $reopenReason,
            $evalId,
        ]);

        log_evaluation_action(
            $pdo,
            $evalId,
            (int) $user['id'],
            $coordName,
            'ADMIN',
            'COORDINATOR_REOPENED_FINALIZED',
            'FINALIZED',
            $targetStage,
            $nextAckStatus,
            "Reopened finalized evaluation -> {$targetStage}. Reason: {$reopenReason}"
        );

        $evalRef = "EVAL-#{$evalId} ({$ev['student_name']} • {$ev['evaluation_period']})";
        if ($targetStage === 'RETURNED_FOR_REVISION' && !empty($ev['supervisor_id'])) {
            send_evaluation_notification(
                $pdo,
                $evalId,
                (int) $ev['supervisor_id'],
                'REOPEN_SUP_' . time(),
                "Finalized Evaluation Reopened & Returned for Revision: {$ev['student_name']}",
                "The S.A. Coordinator ({$coordName}) reopened the finalized evaluation for {$ev['student_name']} and returned it to you for revision. Reason: {$reopenReason}",
                'SA_EVALUATION_REOPENED',
                "#/supervisor/evaluations?saProfileId={$saProfileId}&evalId={$evalId}",
                (int) $user['id'],
                [
                    'evalRef' => $evalRef,
                    'requiredAction' => 'Revise & Resubmit Step 1 Evaluation',
                    'currentStatus' => 'Step 1: Returned for Revision',
                    'dueDate' => 'Immediate Follow-up',
                ]
            );
        }

        audit('SA_EVALUATION_REOPENED', "Coordinator reopened finalized evaluation #{$evalId} ({$ev['student_name']}) -> {$targetStage}: {$reopenReason}", (int) $user['id']);

        $freshEval = load_fresh_formatted_evaluation($pdo, $evalId, $semId, $saProfileId, null, $sem['label']);

        respond([
            'success' => true,
            'status' => $targetStage,
            'workflowStage' => $freshEval['workflowStage'] ?? 'step3_pending_coordinator_review',
            'acknowledgmentStatus' => $nextAckStatus,
            'evaluation' => $freshEval,
            'message' => $targetStage === 'RETURNED_FOR_REVISION'
                ? "Finalized evaluation reopened and returned to {$ev['supervisor_name']} for revision."
                : "Finalized evaluation reopened for Coordinator decision review.",
        ]);

    // =========================================================================
    // 9. TRIGGER AUTOMATED DEADLINE & REMINDER CHECK / MANAGE SCHOOL HOLIDAYS
    // =========================================================================
    case 'process_reminders':
        require_role($user, 'ADMIN');
        $sem = target_semester($in['semesterId'] ?? null);
        $stats = process_evaluation_deadlines_and_reminders($pdo, (int) $sem['id']);
        audit('EVALUATION_REMINDERS_PROCESSED', "Checked={$stats['checkedCount']}, Sent={$stats['remindersSent']}, OverdueMarked={$stats['overdueMarked']}", (int) $user['id']);
        respond([
            'success' => true,
            'stats' => $stats,
            'message' => "Processed {$stats['checkedCount']} pending S.A. acknowledgment(s): {$stats['remindersSent']} reminder(s) dispatched, {$stats['overdueMarked']} newly marked overdue.",
        ]);

    case 'add_holiday':
        require_role($user, 'ADMIN');
        $hDate = trim((string) ($in['holidayDate'] ?? ''));
        $hName = trim((string) ($in['holidayName'] ?? ''));
        if (!$hDate || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $hDate) || $hName === '') {
            fail('Please provide a valid holiday date (YYYY-MM-DD) and holiday name.', 422);
        }
        $pdo->prepare("
            INSERT INTO school_holidays (holiday_date, name)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE name = VALUES(name)
        ")->execute([$hDate, $hName]);
        audit('SCHOOL_HOLIDAY_SAVED', "Saved school holiday {$hDate}: {$hName}", (int) $user['id']);
        respond(['success' => true, 'message' => "School holiday ({$hName} on {$hDate}) saved."]);

    case 'delete_holiday':
        require_role($user, 'ADMIN');
        $hId = (int) ($in['holidayId'] ?? 0);
        if ($hId > 0) {
            $pdo->prepare("DELETE FROM school_holidays WHERE id = ?")->execute([$hId]);
            audit('SCHOOL_HOLIDAY_DELETED', "Deleted school holiday #{$hId}", (int) $user['id']);
        }
        respond(['success' => true, 'message' => 'School holiday removed.']);

    default:
        fail('Unknown evaluation action.', 400);
}
