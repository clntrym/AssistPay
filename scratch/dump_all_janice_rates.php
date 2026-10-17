<?php
require_once __DIR__ . '/../config/config.php';

$semRate = $pdo->query('SELECT hourly_rate FROM allowance_rates WHERE semester_id = 1')->fetchColumn();
echo "SEMESTER RATE IN allowance_rates (Coordinator Decision): $semRate\n";

$sa = $pdo->query('SELECT id, student_id, first_name, last_name, hourly_rate FROM sa_profiles WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
echo "JANICE IN sa_profiles: " . json_encode($sa) . "\n";

$hist = $pdo->query('SELECT * FROM sa_rate_history WHERE sa_profile_id = 1 ORDER BY id DESC')->fetchAll(PDO::FETCH_ASSOC);
echo "JANICE IN sa_rate_history: " . json_encode($hist) . "\n";

$comp = $pdo->query('SELECT * FROM allowance_cutoff_computations WHERE sa_profile_id = 1 ORDER BY id DESC')->fetchAll(PDO::FETCH_ASSOC);
echo "JANICE IN allowance_cutoff_computations: " . json_encode($comp) . "\n";

