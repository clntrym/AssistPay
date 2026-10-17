<?php
// Gamitin ang tamang config file na 'config/config.php'
require __DIR__ . '/../../config/config.php';

try {
    $pdo->beginTransaction();

    echo "Starting Database Seeding...\n";

    // 1. SEED COURSES
    $stmtCourse = $pdo->prepare("INSERT INTO courses (course_code, course_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE course_id=LAST_INSERT_ID(course_id)");
    
    $stmtCourse->execute(['BSIT', 'Bachelor of Science in Information Technology']);
    $bsit_id = $pdo->lastInsertId();

    $stmtCourse->execute(['BSCS', 'Bachelor of Science in Computer Science']);
    $bscs_id = $pdo->lastInsertId();

    $stmtCourse->execute(['BSBA', 'Bachelor of Science in Business Administration']);
    $bsba_id = $pdo->lastInsertId();

    // 2. SEED MASTER CURRICULUMS
    $stmtCurriculum = $pdo->prepare("INSERT INTO curriculums (course_id, curriculum_code, effective_sy, total_units) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE curriculum_id=LAST_INSERT_ID(curriculum_id)");
    
    $stmtCurriculum->execute([$bsit_id, 'BSIT-2024', '2024–2025', 146.00]);
    $bsit_curriculum_id = $pdo->lastInsertId();

    $stmtCurriculum->execute([$bscs_id, 'BSCS-2024', '2024–2025', 152.00]);
    $stmtCurriculum->execute([$bsba_id, 'BSBA-2024', '2024–2025', 138.00]);

    // 3. SEED BSIT SUBJECTS (1st Year, 1st Sem)
    $stmtSubject = $pdo->prepare("INSERT INTO subjects (curriculum_id, subject_code, description, units, year_level, semester) VALUES (?, ?, ?, ?, ?, ?)");
    
    $subjects = [
        ['GE 003C', 'Mathematics in the Modern World', 3.00, 1, 1],
        ['GE 005', 'Science, Technology & Society', 3.00, 1, 1],
        ['GE 007', 'Contemporary World', 3.00, 1, 1],
        ['GELEC 004-IT', 'Living in the IT Era', 3.00, 1, 1],
        ['IT 101', 'Introduction to Computing', 3.00, 1, 1],
        ['IT 102', 'Computer Programming 1', 3.00, 1, 1],
        ['NCST 001', 'Nation Builders (NCST Culture 1)', 3.00, 1, 1],
        ['NSTP 001', 'National Service Training Program 1', 0.00, 1, 1],
        ['PATHFIT 1', 'Physical Activities Towards Health & Fitness 1', 2.00, 1, 1]
    ];

    $subject_ids = [];
    foreach ($subjects as $sub) {
        $stmtSubject->execute([$bsit_curriculum_id, $sub[0], $sub[1], $sub[2], $sub[3], $sub[4]]);
        $subject_ids[$sub[0]] = $pdo->lastInsertId();
    }

    // 4. SEED SAMPLE STUDENT
    $stmtStudent = $pdo->prepare("INSERT INTO students (student_number, course_id, curriculum_id, last_name, first_name, middle_name, gender, contact_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE student_id=LAST_INSERT_ID(student_id)");
    $stmtStudent->execute(['2024-58030', $bsit_id, $bsit_curriculum_id, 'Magpantay', 'Daizy', 'Salva', 'Female', '0962-970-9515']);
    $student_id = $pdo->lastInsertId();

    // 5. SEED ACADEMIC TERM
    $stmtTerm = $pdo->prepare("INSERT INTO academic_terms (school_year, semester, is_active) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE term_id=LAST_INSERT_ID(term_id)");
    $stmtTerm->execute(['2026–2027', '1st Semester', 1]);
    $term_id = $pdo->lastInsertId();

    // 6. SEED SAMPLE STUDENT GRADES
    $stmtGrade = $pdo->prepare("INSERT INTO student_grades (student_id, term_id, subject_id, final_grade, points, status) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status=VALUES(status)");
    
    foreach ($subject_ids as $code => $id) {
        $stmtGrade->execute([$student_id, $term_id, $id, 91.50, 1.50, 'Passed']);
    }

    $pdo->commit();
    echo "Seeding completed successfully!\n";

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo "Seeding failed: " . $e->getMessage() . "\n";
}
?>