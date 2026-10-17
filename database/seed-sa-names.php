<?php
// Registers the S.A. list the Coordinator provided, with placeholder details
// (contact number, course, fees, emergency contact) that can be edited later.
//
//   php database/seed-sa-names.php            registers everyone who is missing
//   php database/seed-sa-names.php --dry-run  shows what would happen
//
// Every record goes through validate_sa(), the same check the Register form
// uses, so nothing lands in the database that the form would reject.
require __DIR__ . '/../config/config.php';
require __DIR__ . '/../api/_sa.php';

const SEED_PASSWORD = 'AssistPay@2026';     // demo accounts; first sign-in forces a change

$names = <<<'LIST'
ABEGONIA, AECIEL JOY
ABUG, MARIANNE
ADJALUDDIN, JAMIR
AGUILA, RENZER KIELH
AGUILAR, MICHAEL ANTHONY
ALVAREZ, ANGEL
AMPARO, RHAINEE JHOY
ATASIN, DENNISE
BACHO, JESIELYN
BAIÑO, KIRTZ HARRY
BALMACEDA, WENDY
BARILA, LEE RODNEY KIOFRANZ
BELER, ELIZON
BORROMEO, LOUIS ANGELO
BRANZUELA, PRINCESS SARAH
BULANON, JANICE
CABLAO, JOHN MHEG
CAWILI, LINDSAY JUZIENE
CESICAR, DIANE
CIRINEO, JESSIE RHAIN
CORDA, MARINELLE
DACCA, MIKE DENVER
DALONG, SHAKIRA ATASHA
DE GUIA, RAQUEL JEAN
DE LEON, LYKA JANE
DELA CRUZ, JULIANNE
DIEZMO, GERALD
ELLORIN, ANGELICA
ELUMBA, OYEN DOMINIC
FALGUERA, ARVIN JAMES
FRANCISCO, ROCHELLE ANNE
GALARION, DANIELA DINISE
GIPA, JOHN EDUARD VINCENT
IMPERIAL, JHAIMEE
LAURIO, MAIREEN
LOYOLA, DREW CARLY
LUBO, JUSTINE ANN
LUKBAN, MARL BENEDICT
LUNDAY, MAUI JOY
MAGPANTAY, DAIZY
MALBOG, FRANKYZ
MARTICIO, CATHERINE
MARTOS, RHEA MAE
MAUBAY, AICA
MENDOZA, JASMINE
MIRABALLES, VENICE YEN
MONTOYA, LEEANN
MOQUERIO, LORIE MAR
MORENO, RIZCYL JOYCE
NARCISO, JIMMUEL
NIDERA, COLLIN JUSTHIN
OBISPO, JOHN GRAEMAR
OKAYAMA, RYUJI
PAGOTO, PRINCE ANTHONY
PASTOR, JOHN CHRISTIAN
PATAMBANG, CYRIL KEN
QUILAL-LAN, KRISTIANSON
RAMOS, RHON NICO
RESOCO, RHY MARK JOSEPH
RIMANDIMAN, JOSHUA
RIVAS, LIZBETH
ROGACION, LALAINE
ROSELLON, LUIS EMANUEL
SABALLE, JACKLYN
SADIASA, AJ
SAMAR, REYNALD
SAÑEZ, HEREZEL
SANGINES, ALLYSSA JEZREEL
SARMIENTO, ALEXA MAY
SERQUIÑA, RLYMCH
SON, DIXIE
SORDILLA, KIEN RYAN
SYJUCO, KENNETH PAUL
TESTON, ANDREI
TRINIDAD, KURT ANDREI
TUGON, HANNAH PAULA
TUIBEO, PAULINE
LIST;

$dryRun = in_array('--dry-run', $argv, true);
mt_srand(20260926);                          // same placeholder details on every run

$semester = $pdo->query('SELECT * FROM semesters WHERE status = "ACTIVE" ORDER BY start_date DESC LIMIT 1')->fetch();
if (!$semester) exit("No active semester. Create one in Scheduling > Semester Setup first.\n");

$offices = $pdo->query('SELECT id FROM offices WHERE is_active = 1')->fetchAll(PDO::FETCH_COLUMN);
$courses = array_keys(COURSES);
$coordinator = (int) $pdo->query('SELECT id FROM users WHERE role = "ADMIN" ORDER BY id LIMIT 1')->fetchColumn();

// Student IDs continue after the highest one already registered
$year = (int) date('Y', strtotime($semester['start_date']));
$taken = $pdo->query('SELECT student_id FROM sa_profiles')->fetchAll(PDO::FETCH_COLUMN);
$next = 1;
foreach ($taken as $id) {
    if (preg_match('/^' . $year . '-(\d{5})$/', $id, $m)) $next = max($next, (int) $m[1] + 1);
}

/** "BAIÑO, KIRTZ HARRY" -> ["Baiño", "Kirtz Harry"] */
function split_name(string $line): array
{
    $line = preg_replace('/\s+/u', ' ', trim(str_replace('.', ',', $line)));
    [$last, $first] = array_pad(array_map('trim', explode(',', $line, 2)), 2, '');
    $case = fn($v) => mb_convert_case(mb_strtolower($v, 'UTF-8'), MB_CASE_TITLE, 'UTF-8');
    return [$case($last), $case($first)];
}

/** "Baiño" -> "baino", so the email stays plain ASCII */
function slug(string $v): string
{
    $plain = strtr($v, ['Ñ' => 'N', 'ñ' => 'n', 'É' => 'E', 'é' => 'e', 'Á' => 'A', 'á' => 'a',
                        'Í' => 'I', 'í' => 'i', 'Ó' => 'O', 'ó' => 'o', 'Ú' => 'U', 'ú' => 'u']);
    return trim(preg_replace('/[^a-z]+/', '.', mb_strtolower($plain, 'UTF-8')), '.');
}

$existing = [];
foreach ($pdo->query('SELECT first_name, last_name FROM sa_profiles') as $row) {
    $existing[mb_strtoupper($row['last_name'] . '|' . $row['first_name'], 'UTF-8')] = true;
}
$usedEmails = array_flip($pdo->query('SELECT email FROM users')->fetchAll(PDO::FETCH_COLUMN));

$created = 0;
$skipped = [];
$rejected = [];

foreach (explode("\n", trim($names)) as $line) {
    if (trim($line) === '') continue;
    [$last, $first] = split_name($line);

    if (isset($existing[mb_strtoupper($last . '|' . $first, 'UTF-8')])) {
        $skipped[] = "$last, $first (already registered)";
        continue;
    }

    $studentId = sprintf('%d-%05d', $year, $next);
    $email = slug($first) . '.' . slug($last) . '@ncst.edu.ph';
    for ($n = 2; isset($usedEmails[$email]); $n++) {
        $email = slug($first) . '.' . slug($last) . $n . '@ncst.edu.ph';
    }

    $category = ['OFFICE', 'OFFICE', 'ACADS', 'ITO'][mt_rand(0, 3)];
    $input = [
        'studentId' => $studentId,
        'firstName' => $first,
        'lastName' => $last,
        'contactNumber' => '09' . str_pad((string) mt_rand(0, 999999999), 9, '0', STR_PAD_LEFT),
        'schoolEmail' => $email,
        'personalEmail' => slug($first) . '.' . slug($last) . '@gmail.com',
        'birthDate' => sprintf('%04d-%02d-%02d', mt_rand(2001, 2006), mt_rand(1, 12), mt_rand(1, 28)),
        'sex' => ['MALE', 'FEMALE'][mt_rand(0, 1)],
        'course' => $courses[mt_rand(0, count($courses) - 1)],
        'yearLevel' => mt_rand(1, 4),
        'semesterId' => (int) $semester['id'],
        'academicStatus' => mt_rand(1, 5) === 1 ? 'IRREGULAR' : 'REGULAR',
        'enrollmentStatus' => 'ENROLLED',
        'expectedGraduation' => sprintf('%04d-%02d', $year + mt_rand(1, 3), 4),
        'saCategory' => $category,
        'departmentType' => $category,
        'officeId' => $category === 'OFFICE' && $offices ? $offices[mt_rand(0, count($offices) - 1)] : null,
        'saStatus' => 'ACTIVE',
        'appointmentStart' => $semester['start_date'],
        'assignmentStatus' => 'UNASSIGNED',
        'weeklyTargetHours' => 35,
        'tuitionFee' => mt_rand(2500, 4800) * 10,
        'miscFee' => mt_rand(300, 900) * 10,
        'emergencyName' => $last . ' Family',
        'emergencyNumber' => '09' . str_pad((string) mt_rand(0, 999999999), 9, '0', STR_PAD_LEFT),
        'emergencyRelationship' => ['Mother', 'Father', 'Guardian', 'Sibling'][mt_rand(0, 3)],
    ];

    [$c, $errors] = validate_sa($input);
    if ($errors) {
        $rejected[] = "$last, $first — " . json_encode($errors, JSON_UNESCAPED_UNICODE);
        continue;
    }

    if ($dryRun) {
        printf("%s  %-28s %-6s Y%d  %s\n", $studentId, "$last, $first", $c['course'], $c['year_level'], $c['sa_category']);
        $next++;
        $usedEmails[$email] = true;
        $created++;
        continue;
    }

    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'INSERT INTO users (username, password_hash, role, full_name, email, status, must_change_password)
             VALUES (?, ?, "SA", ?, ?, "PENDING_ACTIVATION", 1)'
        )->execute([$c['student_id'], password_hash(SEED_PASSWORD, PASSWORD_DEFAULT), sa_full_name($c), $c['school_email']]);
        $userId = (int) $pdo->lastInsertId();

        $pdo->prepare(
            'INSERT INTO sa_profiles (user_id, student_id, first_name, last_name, birth_date, sex, contact_number,
                personal_email, course, year_level, semester_id, academic_status, enrollment_status, expected_graduation,
                sa_category, department_type, office_id, sa_status, appointment_start, assignment_status,
                weekly_target_hours, is_reliever, emergency_name, emergency_number, emergency_relationship, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $userId, $c['student_id'], $c['first_name'], $c['last_name'], $c['birth_date'], $c['sex'],
            $c['contact_number'], $c['personal_email'], $c['course'], $c['year_level'], $c['semester_id'],
            $c['academic_status'], $c['enrollment_status'], $c['expected_graduation'], $c['sa_category'],
            $c['department_type'], $c['office_id'], $c['sa_status'], $c['appointment_start'], $c['assignment_status'],
            $c['weekly_target_hours'], 0, $c['emergency_name'], $c['emergency_number'], $c['emergency_relationship'],
            $coordinator ?: null,
        ]);
        save_benefits((int) $pdo->lastInsertId(), $c);
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        $rejected[] = "$last, $first — " . $ex->getMessage();
        continue;
    }

    $usedEmails[$email] = true;
    $existing[mb_strtoupper($last . '|' . $first, 'UTF-8')] = true;
    $next++;
    $created++;
}

printf("\n%s %d S.A.(s) for %s\n", $dryRun ? 'Would register' : 'Registered', $created, semester_label($semester));
if (!$dryRun && $created) printf("Password for every new account: %s (changed on first sign-in)\n", SEED_PASSWORD);
foreach ($skipped as $s) echo "  skipped: $s\n";
foreach ($rejected as $r) echo "  REJECTED: $r\n";
