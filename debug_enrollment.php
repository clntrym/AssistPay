<?php
require 'api/_bootstrap.php';

$studentNum = '2024-58030';

echo "=== STUDENT INFO ===\n";
$stmt = $pdo->prepare("SELECT student_id, first_name, last_name FROM students WHERE student_number = ?");
$stmt->execute([$studentNum]);
$student = $stmt->fetch();
if (!$student) die("Student not found");
$studentId = $student['student_id'];
echo "Student ID: {$studentId}\n";

echo "\n=== ENROLLMENTS ===\n";
$stmt = $pdo->prepare("
  SELECT e.enrollment_id, e.reference_no, t.school_year, t.semester, e.status, COUNT(ed.detail_id) as subject_count
  FROM enrollments e
  JOIN academic_terms t ON t.term_id = e.term_id
  LEFT JOIN enrollment_details ed ON ed.enrollment_id = e.enrollment_id
  WHERE e.student_id = ?
  GROUP BY e.enrollment_id
  ORDER BY t.school_year DESC, t.semester
");
$stmt->execute([$studentId]);
$enrollments = $stmt->fetchAll();
foreach ($enrollments as $e) {
  echo "Enrollment ID: {$e['enrollment_id']}, Ref: {$e['reference_no']}, {$e['school_year']} {$e['semester']}, Status: {$e['status']}, Subjects: {$e['subject_count']}\n";

  // Show subjects for this enrollment
  $stmt2 = $pdo->prepare("
    SELECT sb.subject_code, sb.description, ss.days, ss.start_time, ss.end_time, t.school_year, t.semester
    FROM enrollment_details ed
    JOIN subject_schedules ss ON ss.schedule_id = ed.schedule_id
    JOIN subjects sb ON sb.subject_id = ss.subject_id
    JOIN academic_terms t ON t.term_id = ss.term_id
    WHERE ed.enrollment_id = ?
  ");
  $stmt2->execute([$e['enrollment_id']]);
  $subjects = $stmt2->fetchAll();
  foreach ($subjects as $s) {
    echo "  - {$s['subject_code']}: {$s['description']} ({$s['school_year']} {$s['semester']}) {$s['days']} {$s['start_time']}-{$s['end_time']}\n";
  }
}

echo "\n=== FEE ASSESSMENTS ===\n";
$stmt = $pdo->prepare("
  SELECT fa.assessment_id, e.enrollment_id, t.school_year, t.semester,
         fa.tuition_fee, fa.lab_fee, fa.misc_fee, fa.lms_fee, fa.nstp_fee, fa.omr_fee,
         fa.cash_total, fa.installment_total
  FROM fee_assessments fa
  JOIN enrollments e ON e.enrollment_id = fa.enrollment_id
  JOIN academic_terms t ON t.term_id = e.term_id
  WHERE e.student_id = ?
  ORDER BY t.school_year DESC, t.semester
");
$stmt->execute([$studentId]);
$fees = $stmt->fetchAll();
foreach ($fees as $f) {
  echo "Assessment {$f['assessment_id']}: {$f['school_year']} {$f['semester']}, Tuition: {$f['tuition_fee']}, Lab: {$f['lab_fee']}, Total: {$f['cash_total']}\n";
}

echo "\n=== COR DOCUMENTS ===\n";
$stmt = $pdo->prepare("
  SELECT id, file_name, status, created_at FROM student_cor_documents WHERE student_id = ? ORDER BY created_at DESC
");
$stmt->execute([$studentId]);
$cors = $stmt->fetchAll();
foreach ($cors as $c) {
  echo "COR {$c['id']}: {$c['file_name']}, Status: {$c['status']}, Created: {$c['created_at']}\n";
}
?>
