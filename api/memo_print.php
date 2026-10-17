<?php
/**
 * Official Printable Document Generator for Warning Memos (1st, 2nd, 3rd Warning)
 * and Student Assistant Under Agreement Contracts.
 *
 * Uses existing AssistPay session authentication and institutional NCST branding.
 * Supports:
 *   GET api/memo_print.php?type=memo&id=<memo_id>
 *   GET api/memo_print.php?type=agreement&id=<agreement_id>
 */
require __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_violations.php';

// Override JSON Content-Type from _bootstrap.php to HTML for printable output
header('Content-Type: text/html; charset=utf-8');

$user = session_user();
if (!$user) {
    http_response_code(401);
    echo '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;"><h2>Unauthorized</h2><p>Please sign in to AssistPay to view or print official disciplinary documents.</p></body></html>';
    exit;
}

ensure_violation_schema($pdo);

$type = strtolower(trim((string) ($_GET['type'] ?? 'memo')));
$id   = (int) ($_GET['id'] ?? 0);

if ($id <= 0) {
    http_response_code(400);
    echo 'Invalid document reference.';
    exit;
}

$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');

if ($type === 'agreement') {
    $stmt = $pdo->prepare("
        SELECT ua.*,
               p.user_id AS sa_user_id, p.student_id, p.sa_number,
               p.first_name, p.last_name, p.suffix, p.course, p.year_level,
               p.department_type, o.name AS office_name,
               s.academic_year, s.term,
               w.violation_category, w.allowed_chances, w.recorded_occurrences,
               w.incident_dates_json, w.attendance_evidence,
               m.memo_ref_no
        FROM sa_under_agreements ua
        JOIN sa_profiles p ON p.id = ua.sa_profile_id
        JOIN semesters s ON s.id = ua.semester_id
        JOIN sa_disciplinary_warnings w ON w.id = ua.third_warning_id
        LEFT JOIN sa_warning_memos m ON m.warning_id = w.id
        LEFT JOIN offices o ON o.id = p.office_id
        WHERE ua.id = ?
    ");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        http_response_code(404);
        echo 'Under Agreement document not found.';
        exit;
    }

    if ($user['role'] === 'SA' && (int) $doc['sa_user_id'] !== (int) $user['id']) {
        http_response_code(403);
        echo 'Access denied.';
        exit;
    }

    $saName   = sa_full_name($doc);
    $semLabel = semester_label($doc);
    $office   = $doc['office_name'] ?: $doc['department_type'];
    $catLabel = VIOLATION_CATEGORIES[$doc['violation_category']]['label'] ?? $doc['violation_category'];
    $incDates = json_decode($doc['incident_dates_json'] ?: '[]', true) ?: [];
    $formattedDates = implode(', ', array_map(fn($d) => date('M j, Y', strtotime($d)), $incDates));
    $effDate  = $doc['effective_date'] ? date('F j, Y', strtotime($doc['effective_date'])) : '—';
    $endDate  = $doc['end_date'] ? date('F j, Y', strtotime($doc['end_date'])) : 'End of ' . $semLabel;
    $signedAt = $doc['signed_at'] ? date('F j, Y', strtotime($doc['signed_at'])) : '________________________';
    $approver = $doc['approver_name'] ?: 'S.A. Coordinator';
    ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Under Agreement — <?= $h($doc['agreement_ref_no']) ?> | AssistPay NCST</title>
    <style>
        @page { size: A4 portrait; margin: 18mm 18mm 18mm 18mm; }
        body { font-family: "Times New Roman", Georgia, serif; color: #111827; line-height: 1.5; font-size: 11.5pt; margin: 0; padding: 24px; background: #f3f4f6; }
        .sheet { max-width: 760px; margin: 0 auto; background: #fff; padding: 36px 44px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; }
        .toolbar { max-width: 760px; margin: 0 auto 16px; display: flex; justify-content: space-between; align-items: center; font-family: system-ui, sans-serif; }
        .btn-print { background: #0b2b5c; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px; }
        .header { display: flex; align-items: center; justify-content: center; gap: 16px; border-bottom: 3px double #0b2b5c; padding-bottom: 14px; margin-bottom: 20px; text-align: center; }
        .header img { width: 64px; height: 64px; object-fit: contain; }
        .inst-name { font-size: 15pt; font-weight: 700; color: #0b2b5c; letter-spacing: 0.4px; text-transform: uppercase; margin: 0; }
        .inst-sub { font-size: 10pt; color: #374151; margin: 2px 0 0; }
        .doc-title { text-align: center; font-size: 13.5pt; font-weight: 700; text-transform: uppercase; margin: 16px 0 4px; color: #0b2b5c; letter-spacing: 0.5px; }
        .doc-ref { text-align: center; font-size: 10pt; font-weight: 600; color: #4b5563; margin-bottom: 18px; }
        .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 10.5pt; }
        .meta-table td { padding: 6px 10px; border: 1px solid #d1d5db; }
        .meta-table td.lbl { font-weight: 700; background: #f9fafb; width: 22%; color: #1f2937; }
        .sec-title { font-size: 11pt; font-weight: 700; text-transform: uppercase; color: #0b2b5c; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; margin: 16px 0 8px; }
        .pre-block { white-space: pre-line; text-align: justify; margin: 8px 0; }
        .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 38px; page-break-inside: avoid; }
        .sig-box { border-top: 1px solid #111827; padding-top: 6px; margin-top: 36px; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9.5pt; font-weight: 700; background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; }
        @media print {
            body { background: #fff; padding: 0; }
            .sheet { box-shadow: none; border: none; padding: 0; max-width: 100%; }
            .toolbar { display: none !important; }
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <span style="font-size:13px;color:#4b5563;">Official NCST Student Assistant Under Agreement Document</span>
        <button class="btn-print" onclick="window.print()">Print / Save as PDF</button>
    </div>
    <div class="sheet">
        <div class="header">
            <img src="../assets/logo-96.png" alt="NCST Logo">
            <div>
                <p class="inst-name">National College of Science and Technology</p>
                <p class="inst-sub">Amafel Building, Aguinaldo Highway, Dasmariñas City, Cavite</p>
                <p class="inst-sub"><strong>Office of the Student Assistant Coordinator — AssistPay System</strong></p>
            </div>
        </div>

        <div class="doc-title">Student Assistant "Under Agreement" Probationary Undertaking</div>
        <div class="doc-ref">
            Agreement Ref. No.: <?= $h($doc['agreement_ref_no']) ?> &nbsp;|&nbsp;
            Status: <span class="badge"><?= $h(str_replace('_', ' ', $doc['status'])) ?></span>
        </div>

        <table class="meta-table">
            <tr>
                <td class="lbl">S.A. Full Name:</td>
                <td><strong><?= $h($saName) ?></strong></td>
                <td class="lbl">Effective Date:</td>
                <td><?= $h($effDate) ?></td>
            </tr>
            <tr>
                <td class="lbl">Student / S.A. No.:</td>
                <td><?= $h($doc['student_id']) ?><?= $doc['sa_number'] ? ' (' . $h($doc['sa_number']) . ')' : '' ?></td>
                <td class="lbl">Effectivity Period:</td>
                <td>Until <?= $h($endDate) ?></td>
            </tr>
            <tr>
                <td class="lbl">Course &amp; Year:</td>
                <td><?= $h($doc['course'] . ' - Year ' . $doc['year_level']) ?></td>
                <td class="lbl">Assigned Office:</td>
                <td><?= $h($office) ?></td>
            </tr>
            <tr>
                <td class="lbl">Semester / Term:</td>
                <td><?= $h($semLabel) ?></td>
                <td class="lbl">3rd Warning Memo:</td>
                <td><?= $h($doc['memo_ref_no'] ?: 'N/A') ?> (<?= $h($catLabel) ?>)</td>
            </tr>
        </table>

        <div class="sec-title">I. Basis for Placement Under Agreement</div>
        <div class="pre-block"><?= $h($doc['reason']) ?></div>
        <p style="font-size:10.5pt;margin:6px 0;">
            <strong>Recorded Qualifying Violation:</strong> <?= $h($catLabel) ?> — <?= (int) $doc['recorded_occurrences'] ?> occurrence(s) vs. <?= (int) $doc['allowed_chances'] ?> allowed chances.<br>
            <strong>Recorded Incident Date(s):</strong> <?= $h($formattedDates ?: 'See attached attendance log') ?>
        </p>

        <div class="sec-title">II. Terms, Conditions, and Expectations</div>
        <div class="pre-block"><?= $h($doc['conditions_text']) ?></div>

        <div class="sec-title">III. Student Assistant Undertaking &amp; Acknowledgment</div>
        <p style="text-align:justify;font-size:10.5pt;">
            I, <strong><?= $h($saName) ?></strong> (Student No. <?= $h($doc['student_id']) ?>), hereby acknowledge that I have read and understood the terms of this
            <em>Under Agreement Probationary Undertaking</em>. I understand that my placement under agreement allows me to continue my Student Assistantship assignment
            subject to strict compliance with the attendance and disciplinary policies of the National College of Science and Technology.
        </p>

        <div class="sig-grid">
            <div>
                <div class="sig-box">
                    <strong><?= $h($saName) ?></strong><br>
                    <span style="font-size:10pt;color:#4b5563;">Student Assistant Signature over Printed Name</span><br>
                    <span style="font-size:9.5pt;color:#4b5563;">Date Signed: <?= $h($signedAt) ?></span>
                </div>
            </div>
            <div>
                <div class="sig-box">
                    <strong><?= $h($approver) ?></strong><br>
                    <span style="font-size:10pt;color:#4b5563;">Authorized Approver / S.A. Coordinator</span><br>
                    <span style="font-size:9.5pt;color:#4b5563;">Date Approved: <?= $h($doc['approved_at'] ? date('F j, Y', strtotime($doc['approved_at'])) : 'Pending Approval') ?></span>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
<?php
    exit;
}

// Default: Official Warning Memorandum (1st, 2nd, or 3rd Warning)
$stmt = $pdo->prepare("
    SELECT m.*, p.user_id AS sa_user_id
    FROM sa_warning_memos m
    JOIN sa_profiles p ON p.id = m.sa_profile_id
    WHERE m.id = ?
");
$stmt->execute([$id]);
$memo = $stmt->fetch();

if (!$memo) {
    http_response_code(404);
    echo 'Warning Memorandum not found.';
    exit;
}

if ($user['role'] === 'SA' && (int) $memo['sa_user_id'] !== (int) $user['id']) {
    http_response_code(403);
    echo 'Access denied.';
    exit;
}

$levelLabel = WARNING_LEVEL_LABELS[$memo['warning_level']] ?? $memo['warning_level'];
$catLabel   = VIOLATION_CATEGORIES[$memo['violation_category']]['label'] ?? $memo['violation_category'];
$incDates   = json_decode($memo['incident_dates_json'] ?: '[]', true) ?: [];
$formattedDates = implode(', ', array_map(fn($d) => date('M j, Y', strtotime($d)), $incDates));
$issuedDate = $memo['issued_date'] ? date('F j, Y', strtotime($memo['issued_date'])) : date('F j, Y');
$ackDate    = $memo['acknowledged_at'] ? date('F j, Y', strtotime($memo['acknowledged_at'])) : '________________________';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title><?= $h($levelLabel) ?> Memo — <?= $h($memo['memo_ref_no']) ?> | AssistPay NCST</title>
    <style>
        @page { size: A4 portrait; margin: 16mm 18mm 16mm 18mm; }
        body { font-family: "Times New Roman", Georgia, serif; color: #111827; line-height: 1.48; font-size: 11.5pt; margin: 0; padding: 24px; background: #f3f4f6; }
        .sheet { max-width: 760px; margin: 0 auto; background: #fff; padding: 36px 44px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; }
        .toolbar { max-width: 760px; margin: 0 auto 16px; display: flex; justify-content: space-between; align-items: center; font-family: system-ui, sans-serif; }
        .btn-print { background: #0b2b5c; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px; }
        .header { display: flex; align-items: center; justify-content: center; gap: 16px; border-bottom: 3px double #0b2b5c; padding-bottom: 14px; margin-bottom: 18px; text-align: center; }
        .header img { width: 64px; height: 64px; object-fit: contain; }
        .inst-name { font-size: 15pt; font-weight: 700; color: #0b2b5c; letter-spacing: 0.4px; text-transform: uppercase; margin: 0; }
        .inst-sub { font-size: 10pt; color: #374151; margin: 2px 0 0; }
        .memo-banner { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #cbd5e1; padding: 8px 14px; margin-bottom: 16px; font-size: 10.5pt; }
        .memo-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11pt; }
        .memo-table td { padding: 4px 6px; vertical-align: top; }
        .memo-table td.lbl { width: 140px; font-weight: 700; text-transform: uppercase; color: #1f2937; }
        .divider { border-top: 2px solid #0b2b5c; margin: 12px 0 16px; }
        .sec-title { font-size: 10.5pt; font-weight: 700; text-transform: uppercase; color: #0b2b5c; margin: 14px 0 6px; }
        .evidence-box { background: #f9fafb; border: 1px solid #d1d5db; padding: 10px 14px; font-size: 10pt; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-line; margin: 6px 0 12px; }
        .pre-block { white-space: pre-line; text-align: justify; margin: 6px 0 10px; }
        .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 32px; page-break-inside: avoid; }
        .sig-box { border-top: 1px solid #111827; padding-top: 6px; margin-top: 34px; }
        .status-pill { font-family: system-ui, sans-serif; font-size: 9pt; font-weight: 700; padding: 2px 8px; border-radius: 4px; background: #e0e7ff; color: #1e3a8a; text-transform: uppercase; }
        @media print {
            body { background: #fff; padding: 0; }
            .sheet { box-shadow: none; border: none; padding: 0; max-width: 100%; }
            .toolbar { display: none !important; }
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <span style="font-size:13px;color:#4b5563;">Official NCST Disciplinary Memorandum — <?= $h($memo['memo_ref_no']) ?></span>
        <button class="btn-print" onclick="window.print()">Print / Save as PDF</button>
    </div>
    <div class="sheet">
        <div class="header">
            <img src="../assets/logo-96.png" alt="NCST Logo">
            <div>
                <p class="inst-name">National College of Science and Technology</p>
                <p class="inst-sub">Amafel Building, Aguinaldo Highway, Dasmariñas City, Cavite</p>
                <p class="inst-sub"><strong>Office of the Student Assistant Coordinator — AssistPay System</strong></p>
            </div>
        </div>

        <div class="memo-banner">
            <div><strong>MEMO REF. NO.:</strong> <?= $h($memo['memo_ref_no']) ?></div>
            <div><strong>WARNING LEVEL:</strong> <?= $h(strtoupper($levelLabel)) ?></div>
            <div><strong>STATUS:</strong> <span class="status-pill"><?= $h(str_replace('_', ' ', $memo['status'])) ?></span></div>
        </div>

        <table class="memo-table">
            <tr>
                <td class="lbl">TO:</td>
                <td>
                    <strong><?= $h($memo['recipient_name']) ?></strong><br>
                    Student No.: <?= $h($memo['student_number']) ?><?= $memo['sa_number'] ? ' | S.A. No.: ' . $h($memo['sa_number']) : '' ?><br>
                    Course &amp; Year: <?= $h($memo['course_year']) ?> | Assigned Office: <?= $h($memo['assigned_office']) ?>
                </td>
            </tr>
            <tr>
                <td class="lbl">FROM:</td>
                <td><strong><?= $h($memo['coordinator_name']) ?></strong>, <?= $h($memo['coordinator_title']) ?></td>
            </tr>
            <tr>
                <td class="lbl">DATE ISSUED:</td>
                <td><?= $h($issuedDate) ?> &nbsp; (Semester: <?= $h($memo['semester_label']) ?>)</td>
            </tr>
            <tr>
                <td class="lbl">SUBJECT:</td>
                <td><strong><?= $h($memo['subject_line']) ?></strong></td>
            </tr>
        </table>

        <div class="divider"></div>

        <div class="sec-title">1. Summary of Attendance Violation</div>
        <p style="margin:4px 0 8px;font-size:10.5pt;">
            <strong>Violation Category:</strong> <?= $h($catLabel) ?> &nbsp;|&nbsp;
            <strong>Allowed Chances:</strong> <?= (int) $memo['allowed_chances'] ?> &nbsp;|&nbsp;
            <strong>Recorded Occurrences:</strong> <?= (int) $memo['recorded_occurrences'] ?><br>
            <strong>Incident Date(s):</strong> <?= $h($formattedDates ?: 'None') ?>
        </p>

        <div class="sec-title">2. Official Attendance Evidence</div>
        <div class="evidence-box"><?= $h($memo['attendance_records_text']) ?></div>

        <?php if (!empty($memo['previous_warnings_text']) && $memo['warning_level'] !== 'FIRST_WARNING'): ?>
        <div class="sec-title">3. Relevant Previous Warning(s) on Record</div>
        <div class="pre-block" style="font-size:10.5pt;"><?= $h($memo['previous_warnings_text']) ?></div>
        <?php endif; ?>

        <div class="sec-title"><?= (!empty($memo['previous_warnings_text']) && $memo['warning_level'] !== 'FIRST_WARNING') ? '4.' : '3.' ?> Explanation &amp; Applicable Institutional Policy</div>
        <div class="pre-block"><?= $h($memo['explanation_body']) ?></div>
        <p style="font-size:10.5pt;margin:4px 0 10px;"><strong>Applicable Policy / Rule:</strong> <?= $h($memo['applicable_policy']) ?></p>

        <div class="sec-title"><?= (!empty($memo['previous_warnings_text']) && $memo['warning_level'] !== 'FIRST_WARNING') ? '5.' : '4.' ?> Required Corrective Action &amp; Expectations</div>
        <div class="pre-block"><?= $h($memo['corrective_action']) ?></div>

        <?php if ($memo['warning_level'] === 'THIRD_WARNING'): ?>
        <p style="background:#fef2f2;border:1px solid #fecaca;padding:8px 12px;font-size:10pt;color:#991b1b;margin-top:10px;">
            <strong>Notice of Under Agreement Status:</strong> Reaching the Third Warning flags your Student Assistantship record for placement under
            <em>Under Agreement</em> probationary status, subject to Coordinator approval and execution of the official Under Agreement Undertaking.
        </p>
        <?php endif; ?>

        <div class="sig-grid">
            <div>
                <p style="font-size:10pt;margin-bottom:0;"><strong>Issued and Approved By:</strong></p>
                <div class="sig-box">
                    <strong><?= $h($memo['coordinator_name']) ?></strong><br>
                    <span style="font-size:10pt;color:#4b5563;"><?= $h($memo['coordinator_title']) ?></span><br>
                    <span style="font-size:9.5pt;color:#4b5563;">Date Issued: <?= $h($issuedDate) ?></span>
                </div>
            </div>
            <div>
                <p style="font-size:10pt;margin-bottom:0;"><strong>Received and Acknowledged By:</strong></p>
                <div class="sig-box">
                    <strong><?= $h($memo['recipient_name']) ?></strong><br>
                    <span style="font-size:10pt;color:#4b5563;">Student Assistant Signature over Printed Name</span><br>
                    <span style="font-size:9.5pt;color:#4b5563;">Date Acknowledged: <?= $h($ackDate) ?></span>
                </div>
            </div>
        </div>
    </div>
</body>
</html>

