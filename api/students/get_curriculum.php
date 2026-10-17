<?php
require __DIR__ . '/../_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();

$action = input()['action'] ?? 'list';

// Ensure classification column exists on curriculum-scoped subjects table
$pdo->exec("ALTER TABLE `subjects` ADD COLUMN IF NOT EXISTS `classification` ENUM('MAJOR', 'MINOR') NULL DEFAULT NULL AFTER `units`");

if ($action === 'list') {
    $stmt = $pdo->query("
        SELECT 
            c.curriculum_id,
            c.curriculum_code,
            c.effective_sy,
            c.total_units,
            co.course_id,
            co.course_code,
            co.course_name,
            (SELECT COUNT(*) FROM subjects s WHERE s.curriculum_id = c.curriculum_id) as total_subjects,
            (SELECT COUNT(*) FROM subjects s WHERE s.curriculum_id = c.curriculum_id AND s.classification = 'MAJOR') as major_subjects,
            (SELECT COUNT(*) FROM subjects s WHERE s.curriculum_id = c.curriculum_id AND s.classification = 'MINOR') as minor_subjects,
            (SELECT COUNT(*) FROM subjects s WHERE s.curriculum_id = c.curriculum_id AND s.classification IS NULL) as unclassified_subjects
        FROM curriculums c
        JOIN courses co ON c.course_id = co.course_id
        ORDER BY co.course_code ASC
    ");
    $curriculums = $stmt->fetchAll();

    // Color maps and titles matching the design
    $colorMap = [
        'BSIT' => ['badgeColor' => 'bg-navy', 'badgeText' => 'text-white', 'iconColor' => 'bg-blue-50 text-blue-500'],
        'BSCS' => ['badgeColor' => 'bg-[#223354]', 'badgeText' => 'text-amber-400', 'iconColor' => 'bg-amber-50 text-amber-500'],
        'BSARCHI' => ['badgeColor' => 'bg-amber-100', 'badgeText' => 'text-amber-800', 'iconColor' => 'bg-orange-50 text-orange-500'],
        'BSARCH' => ['badgeColor' => 'bg-amber-100', 'badgeText' => 'text-amber-800', 'iconColor' => 'bg-orange-50 text-orange-500'],
        'BSBA' => ['badgeColor' => 'bg-[#1b254b]', 'badgeText' => 'text-amber-300', 'iconColor' => 'bg-purple-50 text-purple-500'],
        'BSTM' => ['badgeColor' => 'bg-emerald-700', 'badgeText' => 'text-white', 'iconColor' => 'bg-emerald-50 text-emerald-600'],
        'BSHM' => ['badgeColor' => 'bg-amber-700', 'badgeText' => 'text-white', 'iconColor' => 'bg-amber-50 text-amber-600'],
        'BSPSY' => ['badgeColor' => 'bg-indigo-700', 'badgeText' => 'text-white', 'iconColor' => 'bg-indigo-50 text-indigo-600'],
        'ABCOM' => ['badgeColor' => 'bg-pink-700', 'badgeText' => 'text-white', 'iconColor' => 'bg-pink-50 text-pink-600'],
        'BSA' => ['badgeColor' => 'bg-teal-700', 'badgeText' => 'text-white', 'iconColor' => 'bg-teal-50 text-teal-600'],
        'BSBA-FM' => ['badgeColor' => 'bg-blue-900', 'badgeText' => 'text-amber-300', 'iconColor' => 'bg-amber-50 text-amber-500'],
        'BSBA-MM' => ['badgeColor' => 'bg-indigo-950', 'badgeText' => 'text-cyan-300', 'iconColor' => 'bg-cyan-50 text-cyan-600'],
        'BSBA-OM' => ['badgeColor' => 'bg-slate-800', 'badgeText' => 'text-amber-300', 'iconColor' => 'bg-amber-50 text-amber-600'],
        'BSCPE' => ['badgeColor' => 'bg-rose-900', 'badgeText' => 'text-rose-100', 'iconColor' => 'bg-rose-50 text-rose-600'],
        'BSE' => ['badgeColor' => 'bg-lime-800', 'badgeText' => 'text-lime-100', 'iconColor' => 'bg-lime-50 text-lime-700'],
        'BSCRIM' => ['badgeColor' => 'bg-red-900', 'badgeText' => 'text-amber-200', 'iconColor' => 'bg-red-50 text-red-700'],
        'BSEd-FIL' => ['badgeColor' => 'bg-sky-800', 'badgeText' => 'text-sky-100', 'iconColor' => 'bg-sky-50 text-sky-600'],
        'BSEd-ENG' => ['badgeColor' => 'bg-blue-800', 'badgeText' => 'text-blue-100', 'iconColor' => 'bg-blue-50 text-blue-600'],
        'BSEd-MATH' => ['badgeColor' => 'bg-emerald-800', 'badgeText' => 'text-emerald-100', 'iconColor' => 'bg-emerald-50 text-emerald-600'],
        'BSEd' => ['badgeColor' => 'bg-sky-800', 'badgeText' => 'text-sky-100', 'iconColor' => 'bg-sky-50 text-sky-600'],
        'BSECE' => ['badgeColor' => 'bg-cyan-900', 'badgeText' => 'text-cyan-100', 'iconColor' => 'bg-cyan-50 text-cyan-600'],
        'BSEE' => ['badgeColor' => 'bg-cyan-900', 'badgeText' => 'text-cyan-100', 'iconColor' => 'bg-cyan-50 text-cyan-600']
    ];

    $summary = [
        'total_subjects' => 0,
        'major_subjects' => 0,
        'minor_subjects' => 0,
        'unclassified_subjects' => 0,
    ];

    foreach ($curriculums as &$curr) {
        $code = $curr['course_code'];
        $curr['style'] = $colorMap[$code] ?? ['badgeColor' => 'bg-navy', 'badgeText' => 'text-white', 'iconColor' => 'bg-blue-50 text-blue-500'];
        $curr['total_subjects'] = (int) $curr['total_subjects'];
        $curr['major_subjects'] = (int) $curr['major_subjects'];
        $curr['minor_subjects'] = (int) $curr['minor_subjects'];
        $curr['unclassified_subjects'] = (int) $curr['unclassified_subjects'];

        $summary['total_subjects'] += $curr['total_subjects'];
        $summary['major_subjects'] += $curr['major_subjects'];
        $summary['minor_subjects'] += $curr['minor_subjects'];
        $summary['unclassified_subjects'] += $curr['unclassified_subjects'];
    }

    $coursesStmt = $pdo->query("SELECT course_id, course_code, course_name FROM courses ORDER BY course_code");
    $courses = $coursesStmt->fetchAll();

    respond([
        'success' => true,
        'curriculums' => $curriculums,
        'courses' => $courses,
        'summary' => $summary
    ]);
}

// Self-install student_subject_status table
$pdo->exec("CREATE TABLE IF NOT EXISTS student_subject_status (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    student_id  INT NOT NULL,
    subject_id  INT NOT NULL,
    status      ENUM('Passed','Failed','Incomplete','Enrolled','Not Taken','Dropped') NOT NULL DEFAULT 'Not Taken',
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_student_subject (student_id, subject_id),
    CONSTRAINT fk_sss_student FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    CONSTRAINT fk_sss_subject FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

if ($action === 'get_student_statuses') {
    $raw_id = input()['student_id'] ?? input()['student_number'] ?? input()['studentId'] ?? '';
    $student_id = 0;

    if (is_numeric($raw_id) && (int) $raw_id > 0) {
        $student_id = (int) $raw_id;
    } else if (!empty($raw_id)) {
        $st = $pdo->prepare("SELECT student_id FROM students WHERE student_number = ? LIMIT 1");
        $st->execute([$raw_id]);
        $student_id = (int) $st->fetchColumn();
    }

    if (!$student_id) respond(['success' => true, 'statuses' => (object) []]);

    $stmt = $pdo->prepare("SELECT subject_id, status FROM student_subject_status WHERE student_id = ?");
    $stmt->execute([$student_id]);
    $rows = $stmt->fetchAll();
    $map = [];
    foreach ($rows as $r) $map[$r['subject_id']] = $r['status'];
    respond(['success' => true, 'statuses' => $map]);
}

if ($action === 'save_subject_status') {
    require_role($user, 'REGISTRAR', 'ADMIN');
    $student_id = (int) (input()['student_id'] ?? 0);
    $subject_id = (int) (input()['subject_id'] ?? 0);
    $status = trim(input()['status'] ?? '');

    if (!$student_id || !$subject_id || !$status) fail('Student, subject, and status required.', 422);

    $allowed = ['Passed','Failed','Incomplete','Enrolled','Not Taken','Dropped'];
    if (!in_array($status, $allowed)) fail('Invalid status.', 422);

    $pdo->prepare("INSERT INTO student_subject_status (student_id, subject_id, status) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE status = VALUES(status)")
        ->execute([$student_id, $subject_id, $status]);

    audit('SAVE_SUBJECT_STATUS', "Subject $subject_id status set to $status for student $student_id", $user['id']);
    respond(['success' => true]);
}

if ($action === 'get_structure') {
    $curriculum_id = (int) (input()['curriculum_id'] ?? 0);
    $course_code = trim(input()['course_code'] ?? '');
    $classificationFilter = strtoupper(trim(input()['classification'] ?? ''));

    if (!$curriculum_id && $course_code) {
        $findStmt = $pdo->prepare("SELECT c.curriculum_id FROM curriculums c JOIN courses co ON c.course_id = co.course_id WHERE co.course_code = ? LIMIT 1");
        $findStmt->execute([$course_code]);
        $curriculum_id = (int) $findStmt->fetchColumn();
    }

    if (!$curriculum_id) {
        fail('Curriculum not found.', 404);
    }

    // Get curriculum detail
    $currStmt = $pdo->prepare("
        SELECT c.*, co.course_code, co.course_name 
        FROM curriculums c
        JOIN courses co ON c.course_id = co.course_id
        WHERE c.curriculum_id = ?
    ");
    $currStmt->execute([$curriculum_id]);
    $curriculum = $currStmt->fetch();
    if (!$curriculum) {
        fail('Curriculum not found.', 404);
    }

    $whereClause = "WHERE s.curriculum_id = ?";
    $params = [$curriculum_id];
    if ($classificationFilter === 'MAJOR' || $classificationFilter === 'MINOR') {
        $whereClause .= " AND s.classification = ?";
        $params[] = $classificationFilter;
    } elseif ($classificationFilter === 'UNCLASSIFIED') {
        $whereClause .= " AND s.classification IS NULL";
    }

    // Get subjects with prerequisites and classification
    $subjStmt = $pdo->prepare("
        SELECT 
            s.subject_id,
            s.curriculum_id,
            s.subject_code,
            s.description,
            s.units,
            s.classification,
            s.year_level as year,
            s.semester as sem,
            GROUP_CONCAT(p_sub.subject_code SEPARATOR ', ') as prereq
        FROM subjects s
        LEFT JOIN subject_prerequisites sp ON s.subject_id = sp.subject_id
        LEFT JOIN subjects p_sub ON sp.prereq_subject_id = p_sub.subject_id
        $whereClause
        GROUP BY s.subject_id
        ORDER BY s.year_level ASC, s.semester ASC, s.subject_id ASC
    ");
    $subjStmt->execute($params);
    $subjects = $subjStmt->fetchAll();

    // Classification counts across the whole curriculum (unfiltered)
    $countStmt = $pdo->prepare("
        SELECT
            COUNT(*) AS total_subjects,
            COALESCE(SUM(classification = 'MAJOR'), 0) AS major_subjects,
            COALESCE(SUM(classification = 'MINOR'), 0) AS minor_subjects,
            COALESCE(SUM(classification IS NULL), 0) AS unclassified_subjects
        FROM subjects
        WHERE curriculum_id = ?
    ");
    $countStmt->execute([$curriculum_id]);
    $counts = $countStmt->fetch();

    // Compute status and can_enroll display states
    foreach ($subjects as &$sub) {
        if ($sub['year'] < 3) {
            $sub['status'] = 'Passed';
            $sub['statusClass'] = 'bg-green-100 text-green-700 border-green-200';
            $sub['can_enroll'] = 'NO';
            $sub['enrollClass'] = 'bg-gray-100 text-gray-400';
        } else if ($sub['year'] == 3 && $sub['sem'] == 1) {
            $sub['status'] = 'Enrolled';
            $sub['statusClass'] = 'bg-amber-100 text-amber-700 border-amber-200';
            $sub['can_enroll'] = 'NO';
            $sub['enrollClass'] = 'bg-gray-100 text-gray-400';
        } else if ($sub['year'] == 3 && $sub['sem'] == 2) {
            $sub['status'] = 'Pending';
            $sub['statusClass'] = 'bg-gray-100 text-gray-600 border-gray-200';
            $sub['can_enroll'] = 'YES';
            $sub['enrollClass'] = 'bg-green-100 text-green-700 font-bold border border-green-200';
        } else {
            $sub['status'] = 'Pending';
            $sub['statusClass'] = 'bg-gray-100 text-gray-600 border-gray-200';
            $sub['can_enroll'] = 'NO';
            $sub['enrollClass'] = 'bg-gray-100 text-gray-400';
        }
        $sub['prereq'] = $sub['prereq'] ?: '—';
        $sub['classification'] = $sub['classification'] ?: null;
    }

    respond([
        'success' => true,
        'curriculum' => $curriculum,
        'subjects' => $subjects,
        'classification_summary' => [
            'total_subjects' => (int) ($counts['total_subjects'] ?? 0),
            'major_subjects' => (int) ($counts['major_subjects'] ?? 0),
            'minor_subjects' => (int) ($counts['minor_subjects'] ?? 0),
            'unclassified_subjects' => (int) ($counts['unclassified_subjects'] ?? 0),
            'is_fully_classified' => ((int) ($counts['total_subjects'] ?? 0) > 0) && ((int) ($counts['unclassified_subjects'] ?? 0) === 0)
        ]
    ]);
}

if ($action === 'list_subjects_review') {
    require_role($user, 'REGISTRAR', 'ADMIN');

    $curriculum_id = (int) (input()['curriculum_id'] ?? 0);
    $classification = strtoupper(trim(input()['classification'] ?? 'UNCLASSIFIED'));
    $search = trim(input()['search'] ?? '');

    $where = [];
    $params = [];

    if ($curriculum_id > 0) {
        $where[] = "s.curriculum_id = ?";
        $params[] = $curriculum_id;
    }

    if ($classification === 'MAJOR' || $classification === 'MINOR') {
        $where[] = "s.classification = ?";
        $params[] = $classification;
    } elseif ($classification === 'UNCLASSIFIED') {
        $where[] = "s.classification IS NULL";
    }

    if ($search !== '') {
        $where[] = "(s.subject_code LIKE ? OR s.description LIKE ? OR c.curriculum_code LIKE ? OR co.course_code LIKE ?)";
        $like = '%' . $search . '%';
        array_push($params, $like, $like, $like, $like);
    }

    $whereSql = count($where) ? ('WHERE ' . implode(' AND ', $where)) : '';

    $stmt = $pdo->prepare("
        SELECT
            s.subject_id,
            s.curriculum_id,
            s.subject_code,
            s.description,
            s.units,
            s.classification,
            s.year_level AS year,
            s.semester AS sem,
            c.curriculum_code,
            c.effective_sy,
            co.course_code,
            co.course_name
        FROM subjects s
        JOIN curriculums c ON c.curriculum_id = s.curriculum_id
        JOIN courses co ON co.course_id = c.course_id
        $whereSql
        ORDER BY co.course_code ASC, s.year_level ASC, s.semester ASC, s.subject_code ASC
        LIMIT 500
    ");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    respond([
        'success' => true,
        'subjects' => $rows
    ]);
}

if ($action === 'add_curriculum') {
    require_role($user, 'REGISTRAR', 'ADMIN');

    $course_id = (int) (input()['course_id'] ?? 0);
    $curriculum_code = trim(input()['curriculum_code'] ?? '');
    $effective_sy = trim(input()['effective_sy'] ?? '');
    $total_units = (float) (input()['total_units'] ?? 0.00);

    if (!$course_id || !$curriculum_code || !$effective_sy) {
        fail('Please fill all required curriculum fields.', 422);
    }

    try {
        $stmt = $pdo->prepare("INSERT INTO curriculums (course_id, curriculum_code, effective_sy, total_units) VALUES (?, ?, ?, ?)");
        $stmt->execute([$course_id, $curriculum_code, $effective_sy, $total_units]);
        $newId = $pdo->lastInsertId();

        audit('ADD_CURRICULUM', "Curriculum $curriculum_code added", $user['id']);
        respond(['success' => true, 'message' => 'Curriculum created successfully!', 'curriculum_id' => $newId]);
    } catch (PDOException $e) {
        if ($e->getCode() == 23000) {
            fail('Curriculum Code already exists.', 422);
        }
        fail('Database error: ' . $e->getMessage(), 500);
    }
}

if ($action === 'add_subject') {
    require_role($user, 'REGISTRAR', 'ADMIN');

    $curriculum_id = (int) (input()['curriculum_id'] ?? 0);
    $subject_code = trim(input()['subject_code'] ?? '');
    $description = trim(input()['description'] ?? '');
    $units = (float) (input()['units'] ?? 3.00);
    $classification = strtoupper(trim(input()['classification'] ?? ''));
    $year_level = (int) (input()['year_level'] ?? 1);
    $semester = (int) (input()['semester'] ?? 1);
    $prereq_code = trim(input()['prereq_code'] ?? '');

    if (!$curriculum_id || !$subject_code || !$description) {
        fail('Please provide subject code and description.', 422);
    }

    if (!in_array($classification, ['MAJOR', 'MINOR'], true)) {
        fail('Subject classification is required and must be either MAJOR or MINOR.', 422);
    }

    try {
        $stmt = $pdo->prepare("INSERT INTO subjects (curriculum_id, subject_code, description, units, classification, year_level, semester) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$curriculum_id, $subject_code, $description, $units, $classification, $year_level, $semester]);
        $subject_id = $pdo->lastInsertId();

        if (!empty($prereq_code)) {
            // Find prereq subject ID
            $pStmt = $pdo->prepare("SELECT subject_id FROM subjects WHERE subject_code = ? AND curriculum_id = ? LIMIT 1");
            $pStmt->execute([$prereq_code, $curriculum_id]);
            $prereq_id = $pStmt->fetchColumn();
            if ($prereq_id) {
                $insPrereq = $pdo->prepare("INSERT INTO subject_prerequisites (subject_id, prereq_subject_id) VALUES (?, ?)");
                $insPrereq->execute([$subject_id, $prereq_id]);
            }
        }

        // Update total units in curriculum
        $updUnits = $pdo->prepare("UPDATE curriculums SET total_units = (SELECT COALESCE(SUM(units), 0) FROM subjects WHERE curriculum_id = ?) WHERE curriculum_id = ?");
        $updUnits->execute([$curriculum_id, $curriculum_id]);

        audit('ADD_SUBJECT', "Subject $subject_code ($classification) added to curriculum $curriculum_id", $user['id']);
        respond(['success' => true, 'message' => 'Subject added successfully!', 'subject_id' => (int) $subject_id]);
    } catch (PDOException $e) {
        fail('Database error: ' . $e->getMessage(), 500);
    }
}

if ($action === 'edit_subject') {
    require_role($user, 'REGISTRAR', 'ADMIN');

    $subject_id = (int) (input()['subject_id'] ?? 0);
    $subject_code = trim(input()['subject_code'] ?? '');
    $description = trim(input()['description'] ?? '');
    $units = (float) (input()['units'] ?? 3.00);
    $classification = strtoupper(trim(input()['classification'] ?? ''));
    $year_level = (int) (input()['year_level'] ?? 1);
    $semester = (int) (input()['semester'] ?? 1);
    $prereq_code = trim(input()['prereq_code'] ?? '');

    if (!$subject_id || !$subject_code || !$description) {
        fail('Please fill all required subject fields.', 422);
    }

    if (!in_array($classification, ['MAJOR', 'MINOR'], true)) {
        fail('Subject classification is required and must be either MAJOR or MINOR.', 422);
    }

    try {
        $findStmt = $pdo->prepare("SELECT curriculum_id FROM subjects WHERE subject_id = ?");
        $findStmt->execute([$subject_id]);
        $curriculum_id = (int) $findStmt->fetchColumn();

        if (!$curriculum_id) fail('Subject not found.', 404);

        $stmt = $pdo->prepare("UPDATE subjects SET subject_code = ?, description = ?, units = ?, classification = ?, year_level = ?, semester = ? WHERE subject_id = ?");
        $stmt->execute([$subject_code, $description, $units, $classification, $year_level, $semester, $subject_id]);

        // Update prerequisite
        $delPrereq = $pdo->prepare("DELETE FROM subject_prerequisites WHERE subject_id = ?");
        $delPrereq->execute([$subject_id]);

        if (!empty($prereq_code)) {
            $pStmt = $pdo->prepare("SELECT subject_id FROM subjects WHERE subject_code = ? AND curriculum_id = ? AND subject_id != ? LIMIT 1");
            $pStmt->execute([$prereq_code, $curriculum_id, $subject_id]);
            $prereq_id = $pStmt->fetchColumn();
            if ($prereq_id) {
                $insPrereq = $pdo->prepare("INSERT INTO subject_prerequisites (subject_id, prereq_subject_id) VALUES (?, ?)");
                $insPrereq->execute([$subject_id, $prereq_id]);
            }
        }

        // Recalculate total units
        $updUnits = $pdo->prepare("UPDATE curriculums SET total_units = (SELECT COALESCE(SUM(units), 0) FROM subjects WHERE curriculum_id = ?) WHERE curriculum_id = ?");
        $updUnits->execute([$curriculum_id, $curriculum_id]);

        audit('EDIT_SUBJECT', "Subject $subject_code updated (Classification: $classification)", $user['id']);
        respond(['success' => true, 'message' => 'Subject updated successfully!']);
    } catch (PDOException $e) {
        fail('Database error: ' . $e->getMessage(), 500);
    }
}

if ($action === 'update_classification') {
    require_role($user, 'REGISTRAR', 'ADMIN');

    $subject_id = (int) (input()['subject_id'] ?? 0);
    $classification = strtoupper(trim(input()['classification'] ?? ''));

    if (!$subject_id) {
        fail('Invalid subject ID.', 422);
    }

    if (!in_array($classification, ['MAJOR', 'MINOR'], true)) {
        fail('Subject classification must be either MAJOR or MINOR.', 422);
    }

    $findStmt = $pdo->prepare("SELECT subject_id, curriculum_id, subject_code, description, classification FROM subjects WHERE subject_id = ?");
    $findStmt->execute([$subject_id]);
    $sub = $findStmt->fetch();
    if (!$sub) {
        fail('Subject not found.', 404);
    }

    $updStmt = $pdo->prepare("UPDATE subjects SET classification = ? WHERE subject_id = ?");
    $updStmt->execute([$classification, $subject_id]);

    $prev = $sub['classification'] ?: 'UNCLASSIFIED';
    audit('CLASSIFY_SUBJECT', "Subject {$sub['subject_code']} (ID {$subject_id}, Curriculum {$sub['curriculum_id']}) classification set from {$prev} to {$classification}", $user['id']);

    respond([
        'success' => true,
        'message' => "Subject {$sub['subject_code']} classified as {$classification}.",
        'subject_id' => $subject_id,
        'classification' => $classification
    ]);
}

if ($action === 'bulk_update_classification') {
    require_role($user, 'REGISTRAR', 'ADMIN');

    $subjectIds = input()['subject_ids'] ?? [];
    $classification = strtoupper(trim(input()['classification'] ?? ''));

    if (!is_array($subjectIds) || empty($subjectIds)) {
        fail('Please select at least one subject to classify.', 422);
    }

    if (!in_array($classification, ['MAJOR', 'MINOR'], true)) {
        fail('Subject classification must be either MAJOR or MINOR.', 422);
    }

    $cleanIds = array_values(array_unique(array_filter(array_map('intval', $subjectIds), fn($id) => $id > 0)));
    if (empty($cleanIds)) {
        fail('Invalid subject IDs provided.', 422);
    }

    try {
        $pdo->beginTransaction();
        $placeholders = implode(',', array_fill(0, count($cleanIds), '?'));
        $params = array_merge([$classification], $cleanIds);
        $stmt = $pdo->prepare("UPDATE subjects SET classification = ? WHERE subject_id IN ($placeholders)");
        $stmt->execute($params);
        $updatedCount = $stmt->rowCount();
        $pdo->commit();

        audit('BULK_CLASSIFY_SUBJECTS', "Classified " . count($cleanIds) . " subject(s) as {$classification}", $user['id']);

        respond([
            'success' => true,
            'message' => count($cleanIds) . " subject(s) classified as {$classification}.",
            'updated_count' => $updatedCount,
            'classification' => $classification
        ]);
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        fail('Database error: ' . $e->getMessage(), 500);
    }
}

if ($action === 'delete_subject') {
    require_role($user, 'REGISTRAR', 'ADMIN');

    $subject_id = (int) (input()['subject_id'] ?? 0);
    if (!$subject_id) fail('Invalid subject ID.', 422);

    try {
        $findStmt = $pdo->prepare("SELECT curriculum_id, subject_code FROM subjects WHERE subject_id = ?");
        $findStmt->execute([$subject_id]);
        $sub = $findStmt->fetch();

        if (!$sub) fail('Subject not found.', 404);

        $curriculum_id = (int) $sub['curriculum_id'];
        $subject_code = $sub['subject_code'];

        $delStmt = $pdo->prepare("DELETE FROM subjects WHERE subject_id = ?");
        $delStmt->execute([$subject_id]);

        // Recalculate total units
        $updUnits = $pdo->prepare("UPDATE curriculums SET total_units = (SELECT COALESCE(SUM(units), 0) FROM subjects WHERE curriculum_id = ?) WHERE curriculum_id = ?");
        $updUnits->execute([$curriculum_id, $curriculum_id]);

        audit('DELETE_SUBJECT', "Subject $subject_code deleted from curriculum $curriculum_id", $user['id']);
        respond(['success' => true, 'message' => 'Subject archived/deleted successfully!']);
    } catch (PDOException $e) {
        fail('Database error: ' . $e->getMessage(), 500);
    }
}

fail('Unknown action.', 400);
