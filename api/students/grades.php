<?php
require __DIR__ . '/../_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
require_role($user, 'REGISTRAR', 'ADMIN');

// Self-install grades table
$pdo->exec("CREATE TABLE IF NOT EXISTS student_grades (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    enrollment_detail_id INT NOT NULL,
    prelims         DECIMAL(5,2) NULL,
    midterms        DECIMAL(5,2) NULL,
    prefinals       DECIMAL(5,2) NULL,
    finals          DECIMAL(5,2) NULL,
    final_grade     DECIMAL(5,2) GENERATED ALWAYS AS (
        IF(prelims IS NOT NULL AND midterms IS NOT NULL AND prefinals IS NOT NULL AND finals IS NOT NULL,
           ROUND((prelims + midterms + prefinals + finals) / 4, 2),
           NULL)
    ) STORED,
    points          DECIMAL(3,2) GENERATED ALWAYS AS (
        CASE
            WHEN final_grade >= 97 THEN 1.00
            WHEN final_grade >= 94 THEN 1.25
            WHEN final_grade >= 91 THEN 1.50
            WHEN final_grade >= 88 THEN 1.75
            WHEN final_grade >= 85 THEN 2.00
            WHEN final_grade >= 82 THEN 2.25
            WHEN final_grade >= 80 THEN 2.50
            WHEN final_grade >= 78 THEN 2.75
            WHEN final_grade >= 75 THEN 3.00
            WHEN final_grade IS NULL THEN NULL
            ELSE 5.00
        END
    ) STORED,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_grades_detail (enrollment_detail_id),
    CONSTRAINT fk_grades_detail FOREIGN KEY (enrollment_detail_id) REFERENCES enrollment_details(detail_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$action = input()['action'] ?? '';

if ($action === 'list_terms') {
    $stmt = $pdo->query("
        SELECT term_id, school_year, semester, is_active
        FROM academic_terms
        ORDER BY school_year DESC, FIELD(semester, '1st Semester', '2nd Semester', 'Summer')
    ");
    $terms = $stmt->fetchAll();
    // If no active term found, mark first one as active
    $hasActive = array_filter($terms, fn($t) => $t['is_active']);
    if (empty($hasActive) && !empty($terms)) {
        $terms[0]['is_active'] = 1;
    }
    respond(['success' => true, 'terms' => $terms]);
}

if ($action === 'list_for_grading') {
    $termId = (int) (input()['termId'] ?? 0);
    if (!$termId) fail('Which term?', 422);

    $stmt = $pdo->prepare("
        SELECT DISTINCT
            e.enrollment_id, e.student_id, e.reference_no,
            s.student_number,
            CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS student_name,
            t.school_year, t.semester,
            COUNT(DISTINCT sched.subject_id) AS subject_count
        FROM enrollments e
        JOIN students s ON s.student_id = e.student_id
        JOIN academic_terms t ON t.term_id = e.term_id
        JOIN enrollment_details ed ON ed.enrollment_id = e.enrollment_id
        JOIN subject_schedules sched ON sched.schedule_id = ed.schedule_id
        WHERE e.term_id = ?
        GROUP BY e.enrollment_id
        ORDER BY s.last_name, s.first_name
    ");
    $stmt->execute([$termId]);
    respond(['success' => true, 'enrollments' => $stmt->fetchAll()]);
}

if ($action === 'get_grades') {
    $enrollmentId = (int) (input()['enrollmentId'] ?? 0);
    if (!$enrollmentId) fail('Which enrollment?', 422);

    $stmt = $pdo->prepare("
        SELECT e.enrollment_id, e.student_id, e.reference_no,
               s.student_number,
               CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''),''), ' ', s.last_name) AS student_name,
               t.school_year, t.semester
        FROM enrollments e
        JOIN students s ON s.student_id = e.student_id
        JOIN academic_terms t ON t.term_id = e.term_id
        WHERE e.enrollment_id = ?
    ");
    $stmt->execute([$enrollmentId]);
    $enrollment = $stmt->fetch() ?: fail('Enrollment not found.', 404);

    $stmt = $pdo->prepare("
        SELECT MIN(ed.detail_id) AS detail_id,
               sb.subject_id,
               sb.subject_code, sb.description,
               sb.classification,
               SUM(sched.units) AS units,
               COALESCE(MAX(gr.prelims), '') AS prelims,
               COALESCE(MAX(gr.midterms), '') AS midterms,
               COALESCE(MAX(gr.prefinals), '') AS prefinals,
               COALESCE(MAX(gr.finals), '') AS finals,
               COALESCE(MAX(gr.final_grade), '') AS final_grade,
               COALESCE(MAX(gr.points), '') AS points
        FROM enrollment_details ed
        JOIN subject_schedules sched ON sched.schedule_id = ed.schedule_id
        JOIN subjects sb ON sb.subject_id = sched.subject_id
        LEFT JOIN student_grades gr ON gr.enrollment_detail_id = ed.detail_id
        WHERE ed.enrollment_id = ?
        GROUP BY sb.subject_id, sb.subject_code, sb.description, sb.classification
        ORDER BY sb.subject_code
    ");
    $stmt->execute([$enrollmentId]);
    $subjects = $stmt->fetchAll();

    respond(['success' => true, 'enrollment' => $enrollment, 'subjects' => $subjects]);
}

if ($action === 'save_grade') {
    $detailId = (int) (input()['detailId'] ?? 0);
    $prelims  = input()['prelims'] ?? null;
    $midterms = input()['midterms'] ?? null;
    $prefinals = input()['prefinals'] ?? null;
    $finals   = input()['finals'] ?? null;

    if (!$detailId) fail('Which subject?', 422);

    // Normalize empty strings to NULL
    $prelims  = $prelims !== '' && $prelims !== null ? floatval($prelims) : null;
    $midterms = $midterms !== '' && $midterms !== null ? floatval($midterms) : null;
    $prefinals = $prefinals !== '' && $prefinals !== null ? floatval($prefinals) : null;
    $finals   = $finals !== '' && $finals !== null ? floatval($finals) : null;

    // Validate detail exists
    $stmt = $pdo->prepare('SELECT detail_id FROM enrollment_details WHERE detail_id = ?');
    $stmt->execute([$detailId]);
    if (!$stmt->fetch()) fail('Subject not found.', 404);

    // Insert or update
    $stmt = $pdo->prepare('SELECT id FROM student_grades WHERE enrollment_detail_id = ?');
    $stmt->execute([$detailId]);
    if ($stmt->fetch()) {
        $pdo->prepare('UPDATE student_grades SET prelims=?, midterms=?, prefinals=?, finals=? WHERE enrollment_detail_id=?')
            ->execute([$prelims, $midterms, $prefinals, $finals, $detailId]);
    } else {
        $pdo->prepare('INSERT INTO student_grades (enrollment_detail_id, prelims, midterms, prefinals, finals) VALUES (?, ?, ?, ?, ?)')
            ->execute([$detailId, $prelims, $midterms, $prefinals, $finals]);
    }

    audit('SAVE_GRADE', "Grades saved for detail $detailId", $user['id']);
    respond(['success' => true]);
}

fail('Unknown action.', 400);
