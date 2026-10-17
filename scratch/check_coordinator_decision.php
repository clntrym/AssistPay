<?php
require_once __DIR__ . '/../config/config.php';

echo "=== SEMESTER ALLOWANCE RATE (COORDINATOR BASE RATE) ===\n";
$rates = $pdo->query('SELECT * FROM allowance_rates')->fetchAll(PDO::FETCH_ASSOC);
print_r($rates);

echo "\n=== SA RATE HISTORY (COORDINATOR RATE DECISIONS) ===\n";
$hist = $pdo->query('SELECT * FROM sa_rate_history ORDER BY id DESC LIMIT 10')->fetchAll(PDO::FETCH_ASSOC);
print_r($hist);

echo "\n=== ALLOWANCE ENDORSEMENTS (COORDINATOR ENDORSEMENT DECISIONS) ===\n";
$endorse = $pdo->query('SELECT * FROM allowance_endorsements ORDER BY id DESC LIMIT 5')->fetchAll(PDO::FETCH_ASSOC);
print_r($endorse);

echo "\n=== ALLOWANCE CUTOFF COMPUTATIONS FOR JANICE (SA #1) ===\n";
$comp = $pdo->query('SELECT id, cutoff_id, sa_profile_id, semester_id, hourly_rate, credited_hours, gross_allowance, computation_status FROM allowance_cutoff_computations WHERE sa_profile_id = 1')->fetchAll(PDO::FETCH_ASSOC);
print_r($comp);

echo "\n=== JANICE PROFILE HOURLY RATE ===\n";
$janice = $pdo->query('SELECT id, student_id, first_name, last_name, hourly_rate FROM sa_profiles WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
print_r($janice);

