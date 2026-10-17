<?php
require __DIR__ . '/../api/_bootstrap.php';
require __DIR__ . '/../api/_sa.php';
global $pdo;

echo "=== TEST 1: SA FORM OPTIONS ===\n";
$options = sa_form_options();
$sirAlex = null;
foreach ($options['offices'] as $o) {
    if ($o['id'] == 28) $sirAlex = $o;
}
print_r($sirAlex);
assert($sirAlex['requiredSa'] === 1, "Required must be 1");
assert($sirAlex['assignedSa'] === 1, "Assigned must be 1");
assert($sirAlex['vacancies'] === 0, "Vacancies must be 0");
assert($sirAlex['isFull'] === true, "Must be full");

echo "\n=== TEST 2: ATTEMPT TO ASSIGN UNASSIGNED SA (ID 52) TO SIR ALEX ===\n";
$stmt = $pdo->prepare(SA_SELECT . ' WHERE p.id = ?');
$stmt->execute([52]);
$sa52 = $stmt->fetch();

$payload52 = [
    'studentId' => $sa52['student_id'],
    'firstName' => $sa52['first_name'],
    'lastName' => $sa52['last_name'],
    'course' => $sa52['course'],
    'yearLevel' => $sa52['year_level'],
    'semesterId' => $sa52['semester_id'],
    'academicStatus' => $sa52['academic_status'],
    'enrollmentStatus' => $sa52['enrollment_status'],
    'saCategory' => 'OFFICE',
    'departmentType' => 'OFFICE',
    'assignmentStatus' => 'ASSIGNED',
    'officeId' => 28, // SIR ALEX
    'supervisorId' => 109,
    'hourlyRate' => 8,
    'appointmentStart' => '2026-08-17',
    'emergencyName' => 'Parent Name',
    'emergencyRelationship' => 'Parent',
    'emergencyNumber' => '09171234567',
];

[$clean, $errors] = validate_sa($payload52, $sa52);
echo "Validation errors for SA 52:\n";
print_r($errors);
assert(isset($errors['officeId']), "Must have officeId error");
assert(str_contains($errors['officeId'], 'No vacancy'), "Must say No vacancy");
echo ">>> BLOCKED AS EXPECTED: " . $errors['officeId'] . "\n";

echo "\n=== TEST 3: EXISTING SA IN SIR ALEX (ID 53) UPDATING OWN RECORD ===\n";
$stmt = $pdo->prepare(SA_SELECT . ' WHERE p.id = ?');
$stmt->execute([53]);
$sa53 = $stmt->fetch();

$payload53 = [
    'studentId' => $sa53['student_id'],
    'firstName' => $sa53['first_name'],
    'lastName' => $sa53['last_name'],
    'course' => $sa53['course'],
    'yearLevel' => $sa53['year_level'],
    'semesterId' => $sa53['semester_id'],
    'academicStatus' => $sa53['academic_status'],
    'enrollmentStatus' => $sa53['enrollment_status'],
    'saCategory' => 'OFFICE',
    'departmentType' => 'OFFICE',
    'assignmentStatus' => 'ASSIGNED',
    'officeId' => 28, // SIR ALEX
    'supervisorId' => 109,
    'hourlyRate' => 8,
    'appointmentStart' => '2026-08-17',
    'emergencyName' => 'Parent Name',
    'emergencyRelationship' => 'Parent',
    'emergencyNumber' => '09171234567',
];

[$clean53, $errors53] = validate_sa($payload53, $sa53);
echo "Validation errors for SA 53:\n";
print_r($errors53);
assert(!isset($errors53['officeId']), "Must NOT have officeId error for the current holder");
echo ">>> ALLOWED AS EXPECTED (Occupies own slot)\n";

echo "\n=== ALL TESTS PASSED! ===\n";

