<?php
require __DIR__ . '/../_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();

$action = input()['action'] ?? '';

if ($action === 'list') {
    // 1. Determine active academic term
    $activeTerm = $pdo->query("SELECT term_id, school_year, semester FROM academic_terms WHERE is_active = 1 LIMIT 1")->fetch();
    if (!$activeTerm) {
        $sem = $pdo->query("SELECT * FROM semesters WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1")->fetch();
        if ($sem) {
            $semLabel = ($sem['term'] === '1ST') ? '1st Semester' : (($sem['term'] === '2ND') ? '2nd Semester' : 'Summer');
            $stmt = $pdo->prepare("SELECT term_id, school_year, semester FROM academic_terms WHERE school_year = ? AND semester = ? LIMIT 1");
            $stmt->execute([$sem['academic_year'], $semLabel]);
            $activeTerm = $stmt->fetch();
        }
    }
    $activeTermId = $activeTerm ? (int) $activeTerm['term_id'] : 0;

    $stmt = $pdo->prepare("
        SELECT 
            s.*,
            s.student_id as id, 
            s.student_number as student_number, 
            CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name, ''), ''), ' ', s.last_name) as name,
            c.course_code as course,
            c.course_name as course_name,
            cr.curriculum_code as curriculum_code,
            DATE_FORMAT(s.created_at, '%b %d, %Y') as updated,
            e.enrollment_id,
            e.reference_no,
            e.status as enrollment_record_status,
            e.enrollment_date,
            (SELECT MAX(sub.year_level) 
               FROM enrollment_details ed 
               JOIN subject_schedules ss ON ss.schedule_id = ed.schedule_id 
               JOIN subjects sub ON sub.subject_id = ss.subject_id 
              WHERE ed.enrollment_id = e.enrollment_id) as curriculum_enrolled_year,
            (SELECT ss.section_code 
               FROM enrollment_details ed 
               JOIN subject_schedules ss ON ss.schedule_id = ed.schedule_id 
              WHERE ed.enrollment_id = e.enrollment_id 
              LIMIT 1) as enrolled_section,
            (SELECT COUNT(*) FROM student_cor_documents d WHERE d.student_id = s.student_id AND d.status = 'APPROVED') as approved_cor_count,
            (SELECT COUNT(*) FROM student_cor_documents d WHERE d.student_id = s.student_id AND d.status = 'PENDING') as pending_cor_count
        FROM students s
        LEFT JOIN courses c ON s.course_id = c.course_id
        LEFT JOIN curriculums cr ON s.curriculum_id = cr.curriculum_id
        LEFT JOIN enrollments e ON e.student_id = s.student_id AND e.term_id = ?
        ORDER BY s.student_id DESC
    ");
    $stmt->execute([$activeTermId]);
    $students = $stmt->fetchAll();
    
    $statusColors = [
        'Enrolled'       => 'text-green-700 bg-green-100 border-green-200',
        'Not Enrolled'   => 'text-gray-600 bg-gray-100 border-gray-200',
        'Pending Review' => 'text-amber-700 bg-amber-100 border-amber-200',
        'Dropped'        => 'text-red-700 bg-red-100 border-red-200',
        'Active'         => 'text-blue-700 bg-blue-100 border-blue-200',
        'Inactive'       => 'text-gray-500 bg-gray-100 border-gray-200',
    ];
    $dotColors = [
        'Enrolled'       => 'bg-green-500',
        'Not Enrolled'   => 'bg-gray-400',
        'Pending Review' => 'bg-amber-500',
        'Dropped'        => 'bg-red-500',
        'Active'         => 'bg-blue-500',
        'Inactive'       => 'bg-gray-400',
    ];

    $yearMap = [1 => '1st Year', 2 => '2nd Year', 3 => '3rd Year', 4 => '4th Year', 5 => '5th Year'];

    foreach ($students as &$st) {
        // Enrolled ONLY if they have an active enrollment record (from approved COR) for this semester/year
        if (!empty($st['enrollment_id']) && ($st['enrollment_record_status'] === 'Enrolled' || empty($st['enrollment_record_status']))) {
            $status = 'Enrolled';
            $st['isEnrolled'] = true;
        } elseif (!empty($st['enrollment_id']) && $st['enrollment_record_status'] === 'Dropped') {
            $status = 'Dropped';
            $st['isEnrolled'] = false;
        } elseif ((int)$st['pending_cor_count'] > 0) {
            $status = 'Pending Review';
            $st['isEnrolled'] = false;
        } else {
            $status = 'Not Enrolled';
            $st['isEnrolled'] = false;
        }

        $st['status']      = $status;
        $st['statusColor'] = $statusColors[$status] ?? 'text-gray-600 bg-gray-100 border-gray-200';
        $st['dotColor']    = $dotColors[$status] ?? 'bg-gray-400';
        $st['section']     = $st['enrolled_section'] ?: '—';

        // Year Level: based on enrolled subjects in the curriculum, or student profile year_level
        if (!empty($st['curriculum_enrolled_year']) && isset($yearMap[(int)$st['curriculum_enrolled_year']])) {
            $year = $yearMap[(int)$st['curriculum_enrolled_year']];
        } elseif (!empty($st['year_level'])) {
            $year = $st['year_level'];
        } else {
            $year = '1st Year';
        }
        $st['year']       = $year;
        $st['year_level'] = $year;
    }

    $coursesStmt = $pdo->query("SELECT course_id, course_code, course_name FROM courses ORDER BY course_code");
    $courses = $coursesStmt->fetchAll();

    $curriculumsStmt = $pdo->query("SELECT curriculum_id, curriculum_code, course_id FROM curriculums ORDER BY curriculum_code");
    $curriculums = $curriculumsStmt->fetchAll();

    respond([
        'success'     => true, 
        'students'    => $students, 
        'courses'     => $courses, 
        'curriculums' => $curriculums,
        'activeTerm'  => $activeTerm
    ]);
}

if ($action === 'add') {
    $data = input();
    $student_number = trim($data['student_number'] ?? '');
    $first_name     = trim($data['first_name'] ?? '');
    $last_name      = trim($data['last_name'] ?? '');
    $middle_name    = trim($data['middle_name'] ?? '');
    $suffix         = trim($data['suffix'] ?? '');
    $course_id      = (int) ($data['course_id'] ?? 0);
    $curriculum_id  = (int) ($data['curriculum_id'] ?? 0);
    $year_level     = trim($data['year_level'] ?? '1st Year');
    $admission_date = !empty($data['admission_date']) ? $data['admission_date'] : date('Y-m-d');
    
    if (!$student_number || !$first_name || !$last_name || !$course_id || !$curriculum_id) {
        fail('Please fill all required fields (Student ID, Name, Course, Curriculum).', 422);
    }

    if (!in_array($year_level, ['1st Year', '2nd Year', '3rd Year', '4th Year'])) {
        $year_level = '1st Year';
    }

    try {
        $stmt = $pdo->prepare("
            INSERT INTO students (
                student_number, admission_date, first_name, middle_name, last_name, suffix,
                course_id, curriculum_id, year_level, address, zip_code, region, province, city, barangay,
                contact_no, landline, mobile_provider, gender, civil_status, nationality,
                birth_date, age, birth_place, email, religion
            ) VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?
            )
        ");
        
        $stmt->execute([
            $student_number,
            $admission_date,
            $first_name,
            $middle_name ?: null,
            $last_name,
            $suffix ?: null,
            $course_id,
            $curriculum_id,
            $year_level,
            $data['address'] ?? null,
            $data['zip_code'] ?? null,
            $data['region'] ?? null,
            $data['province'] ?? null,
            $data['city'] ?? null,
            $data['barangay'] ?? null,
            $data['contact_no'] ?? null,
            $data['landline'] ?? null,
            $data['mobile_provider'] ?? null,
            $data['gender'] ?? 'Female',
            $data['civil_status'] ?? 'Single',
            $data['nationality'] ?? 'Filipino',
            !empty($data['birth_date']) ? $data['birth_date'] : null,
            !empty($data['age']) ? (int)$data['age'] : null,
            $data['birth_place'] ?? null,
            $data['email'] ?? null,
            $data['religion'] ?? null
        ]);
        
        audit('ADD_STUDENT', "Student $student_number added", $user['id']);
        
        respond(['success' => true, 'message' => 'Student record saved successfully!']);
    } catch (PDOException $e) {
        if ($e->getCode() == 23000) {
            fail('Student ID Number already exists.', 422);
        }
        fail('Database error: ' . $e->getMessage(), 500);
    }
}

if ($action === 'update') {
    $data = input();
    $student_id     = (int) ($data['student_id'] ?? 0);
    $student_number = trim($data['student_number'] ?? '');
    $first_name     = trim($data['first_name'] ?? '');
    $last_name      = trim($data['last_name'] ?? '');
    $middle_name    = trim($data['middle_name'] ?? '');
    $suffix         = trim($data['suffix'] ?? '');
    $course_id      = (int) ($data['course_id'] ?? 0);
    $curriculum_id  = (int) ($data['curriculum_id'] ?? 0);
    $year_level     = trim($data['year_level'] ?? '1st Year');
    $status         = $data['status'] ?? 'Active';

    if (!$student_id || !$student_number || !$first_name || !$last_name || !$course_id || !$curriculum_id) {
        fail('Please fill all required fields (Student ID, Name, Course, Curriculum).', 422);
    }

    if (!in_array($year_level, ['1st Year', '2nd Year', '3rd Year', '4th Year'])) {
        $year_level = '1st Year';
    }

    $allowedStatuses = ['Enrolled', 'Active', 'Inactive', 'Transfer'];
    if (!in_array($status, $allowedStatuses)) {
        $status = 'Active';
    }

    try {
        $stmt = $pdo->prepare("
            UPDATE students SET
                student_number = ?, first_name = ?, middle_name = ?, last_name = ?, suffix = ?,
                course_id = ?, curriculum_id = ?, year_level = ?, status = ?,
                address = ?, zip_code = ?, region = ?, province = ?, city = ?, barangay = ?,
                contact_no = ?, landline = ?, mobile_provider = ?,
                gender = ?, civil_status = ?, nationality = ?,
                birth_date = ?, age = ?, birth_place = ?, email = ?, religion = ?
            WHERE student_id = ?
        ");

        $stmt->execute([
            $student_number,
            $first_name,
            $middle_name ?: null,
            $last_name,
            $suffix ?: null,
            $course_id,
            $curriculum_id,
            $year_level,
            $status,
            $data['address'] ?? null,
            $data['zip_code'] ?? null,
            $data['region'] ?? null,
            $data['province'] ?? null,
            $data['city'] ?? null,
            $data['barangay'] ?? null,
            $data['contact_no'] ?? null,
            $data['landline'] ?? null,
            $data['mobile_provider'] ?? null,
            $data['gender'] ?? 'Female',
            $data['civil_status'] ?? 'Single',
            $data['nationality'] ?? 'Filipino',
            !empty($data['birth_date']) ? $data['birth_date'] : null,
            !empty($data['age']) ? (int)$data['age'] : null,
            $data['birth_place'] ?? null,
            $data['email'] ?? null,
            $data['religion'] ?? null,
            $student_id
        ]);

        audit('UPDATE_STUDENT', "Student $student_number updated", $user['id']);

        respond(['success' => true, 'message' => 'Student record updated successfully!']);
    } catch (PDOException $e) {
        if ($e->getCode() == 23000) {
            fail('Student ID Number already exists.', 422);
        }
        fail('Database error: ' . $e->getMessage(), 500);
    }
}

fail('Unknown action.', 400);


