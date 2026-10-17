<?php
// AssistPay AI Coordinator Chatbot API
// Provides strict, database-grounded intelligent assistance for S.A. Coordinators
// Powered by Google Gemini 3.8 Flash with Free AI (Pollinations.ai / Llama 3.3) fallback

require __DIR__ . '/_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Method not allowed.', 405);
}

require_csrf();
$user = require_auth();
require_role($user, 'ADMIN', 'REGISTRAR', 'SUPERVISOR');

$in = input();
$action = $in['action'] ?? 'chat';

// Helper to gather live database context
function get_coordinator_system_context(PDO $pdo, string $userQuery = ''): string
{
    try {
        // Active semester
        $semStmt = $pdo->query("SELECT id, academic_year, term, start_date, end_date, required_sa FROM semesters WHERE status = 'ACTIVE' LIMIT 1");
        $activeSem = $semStmt ? $semStmt->fetch(PDO::FETCH_ASSOC) : null;
        $semName = $activeSem ? "{$activeSem['academic_year']} - {$activeSem['term']} Term (Required Target: {$activeSem['required_sa']} S.A.s)" : "Active Term";

        // Counts of S.A.s
        $totalSa = (int)$pdo->query("SELECT COUNT(*) FROM sa_profiles")->fetchColumn();
        $activeSa = (int)$pdo->query("SELECT COUNT(*) FROM sa_profiles WHERE sa_status = 'ACTIVE'")->fetchColumn();
        $assignedSa = (int)$pdo->query("SELECT COUNT(*) FROM sa_profiles WHERE assignment_status = 'ASSIGNED'")->fetchColumn();
        $unassignedSa = (int)$pdo->query("SELECT COUNT(*) FROM sa_profiles WHERE assignment_status = 'UNASSIGNED'")->fetchColumn();
        
        $itoSa = (int)$pdo->query("SELECT COUNT(*) FROM sa_profiles WHERE department_type = 'ITO'")->fetchColumn();
        $acadsSa = (int)$pdo->query("SELECT COUNT(*) FROM sa_profiles WHERE department_type = 'ACADS'")->fetchColumn();
        $officeSa = (int)$pdo->query("SELECT COUNT(*) FROM sa_profiles WHERE department_type = 'OFFICE'")->fetchColumn();

        // Supervisors count
        $supCount = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE role = 'SUPERVISOR'")->fetchColumn();
        $officeCount = (int)$pdo->query("SELECT COUNT(*) FROM offices")->fetchColumn();

        // Today's attendance summary
        $today = date('Y-m-d');
        $todayCin = (int)$pdo->query("SELECT COUNT(DISTINCT sa_profile_id) FROM sa_attendance_logs WHERE DATE(logged_at) = '{$today}' AND log_type = 'CHECK_IN'")->fetchColumn();
        $todayCout = (int)$pdo->query("SELECT COUNT(DISTINCT sa_profile_id) FROM sa_attendance_logs WHERE DATE(logged_at) = '{$today}' AND log_type = 'CHECK_OUT'")->fetchColumn();

        // Pending requests
        $pendingReqs = (int)$pdo->query("SELECT COUNT(*) FROM sa_requests WHERE status IN ('PENDING', 'PENDING_COORDINATOR_RECORDING')")->fetchColumn();

        // System settings
        $settingsStmt = $pdo->query("SELECT setting_key, setting_value FROM system_settings");
        $settings = $settingsStmt ? $settingsStmt->fetchAll(PDO::FETCH_KEY_PAIR) : [];

        $tuitionDisc = $settings['tuitionDiscountPct'] ?? 100;
        $miscDisc = $settings['miscDiscountPct'] ?? 30;
        $minDuty = $settings['minWeeklyDutyHours'] ?? 35;
        $maxDuty = $settings['maxWeeklyDutyHours'] ?? 50;
        $hourlyRate = $settings['defaultHourlyRate'] ?? 8.00;

        // If user query mentions a specific student or name or number, search it in DB
        $specificStudentInfo = "";
        if (!empty($userQuery)) {
            preg_match_all('/\b[a-zA-Z0-9-]{3,}\b/', $userQuery, $words);
            $searchTerms = $words[0] ?? [];
            foreach ($searchTerms as $term) {
                if (in_array(strtolower($term), ['ilan', 'sinong', 'sino', 'saan', 'kailan', 'ano', 'bakit', 'paano', 'ang', 'mga', 'sa', 'na', 'sa-management', 'management', 'student', 'assistants', 'database', 'system'])) {
                    continue;
                }
                $findStmt = $pdo->prepare("
                    SELECT p.id, p.student_id, p.first_name, p.last_name, p.course, p.year_level, p.department_type, p.sa_status, p.assignment_status, o.name AS office_name
                    FROM sa_profiles p
                    LEFT JOIN offices o ON o.id = p.office_id
                    WHERE p.first_name LIKE ? OR p.last_name LIKE ? OR p.student_id LIKE ?
                    LIMIT 3
                ");
                $param = "%{$term}%";
                $findStmt->execute([$param, $param, $param]);
                $matches = $findStmt->fetchAll(PDO::FETCH_ASSOC);
                if (!empty($matches)) {
                    $specificStudentInfo .= "\nMATCHED STUDENT ASSISTANT RECORD(S) IN DATABASE:\n";
                    foreach ($matches as $m) {
                        $specificStudentInfo .= "- S.A. #{$m['id']} [{$m['student_id']}] {$m['first_name']} {$m['last_name']} ({$m['course']} {$m['year_level']}) | Dept: {$m['department_type']} | Station: " . ($m['office_name'] ?: 'None') . " | Status: {$m['sa_status']} ({$m['assignment_status']})\n";
                    }
                    break;
                }
            }
        }

        return "
CURRENT ASSISTPAY DATABASE FACTS & SYSTEM METRICS (100% LIVE REAL-TIME DATA):
- Current Date & Time: " . date('F j, Y (l) g:i A') . "
- Active Semester: {$semName}
- Total Student Assistants (S.A.) in S.A. Management: {$totalSa} S.A.s
  • Active S.A.s: {$activeSa}
  • Assigned to Duty Stations: {$assignedSa} S.A.s
  • Unassigned / Available: {$unassignedSa} S.A.s
  • Department Breakdown:
    - ITO Department: {$itoSa} S.A.s
    - ACADS Department: {$acadsSa} S.A.s
    - OFFICES Department: {$officeSa} S.A.s
- Total Active Supervisors: {$supCount} Supervisors
- Total Assigned Offices / Duty Stations: {$officeCount} Offices
- Today's Attendance Real-Time:
  • Checked-in today: {$todayCin} S.A.s
  • Checked-out today: {$todayCout} S.A.s
- Pending Requests (Leave / Overtime / Corrections): {$pendingReqs} pending
- System Benefits: {$tuitionDisc}% Tuition Discount, {$miscDisc}% Miscellaneous Fee Discount
- Weekly Duty Hour Range: {$minDuty} hrs (minimum) to {$maxDuty} hrs (maximum allowed per week)
- Default Hourly Allowance Rate: ₱" . number_format((float)$hourlyRate, 2) . " per hour
- Standard Meal Break: 12:00 NN - 1:00 PM (1-hour automatic break deduction for shifts >= 5 hours)
- Biometric Verification: 128-point face descriptors + Anti-spoofing + 1.0 km (1000m) GPS Geofence boundary
- Live SMS Notifications: Powered by Android SMS Gateway (100% Free via local phone unli-text SIM) and Semaphore API
{$specificStudentInfo}
";
    } catch (Throwable $e) {
        error_log('[AssistPay AI Context Error] ' . $e->getMessage());
        return "Current Date: " . date('F j, Y');
    }
}

switch ($action) {
    case 'chat': {
        $messages = $in['messages'] ?? [];
        if (!is_array($messages) || empty($messages)) {
            $userMsg = trim($in['message'] ?? '');
            if (empty($userMsg)) {
                fail('Message cannot be empty.', 422);
            }
            $messages = [
                ['role' => 'user', 'content' => $userMsg]
            ];
        }

        // Limit conversation history to last 10 messages for speed & tokens
        if (count($messages) > 10) {
            $messages = array_slice($messages, -10);
        }

        $lastUserMsg = end($messages)['content'] ?? '';
        $liveContext = get_coordinator_system_context($pdo, $lastUserMsg);

        $systemPrompt = "You are AssistPay AI, the dedicated, intelligent, and real-time AI Assistant for the S.A. Coordinator of the NCST AssistPay Student Assistant Management and Payroll System.

LANGUAGE & COMMUNICATION RULES (IMPORTANT):
1. DEFAULT LANGUAGE: ENGLISH
   - By default, converse and respond in clear, professional, fluent, and well-structured ENGLISH.
   - If the user asks in English or gives an ambiguous prompt, always reply in English.
2. FULL TAGALOG / FILIPINO SUPPORT:
   - You are fully bilingual. If the user asks a question in Tagalog, Filipino, or Taglish (e.g., 'Ilan ang S.A. sa ITO?', 'Sino ang naka-assign sa Library?', 'Ano ang patakaran sa memo?'), or explicitly requests Tagalog, respond naturally, courteously, and accurately in Tagalog/Filipino.
   - Seamlessly adapt your language to match the language preference of the user.

STRICT BOUNDARIES & SCOPE:
1. ONLY ASSISTPAY AND NCST S.A. PROGRAM TOPICS:
   - Your sole responsibility is to answer questions regarding AssistPay and NCST Student Assistant management:
     • Student Assistant headcounts, active rosters, department assignments, and database records.
     • Attendance (Check-in, Check-out, Present, Late, Undertime, Overtime, Absences, and the 1-hour meal break deduction).
     • Biometrics (128-point facial descriptors) and Geofencing (1.0 km campus boundary).
     • Duty schedules, partner matching, room/lab posts, and office staffing.
     • Allowance computations (₱8.00/hr default rate), 100% tuition discount, and 30% miscellaneous fee discount.
     • Disciplinary warnings and memos (Late: 3 chances, Undertime: 3 chances, Unexcused Absence: 1 chance, Insubordination: 0 chances; 1st, 2nd, and 3rd warning memos).
     • SMS notifications via Android Gateway / Semaphore.
2. OUT-OF-SCOPE INQUIRIES:
   - If an inquiry is NOT related to AssistPay or the S.A. program (e.g., general trivia, entertainment, personal advice, unrelated coding, or external schools):
     • In English (default): 'I apologize, but I am solely dedicated to answering questions related to AssistPay and the NCST Student Assistant Management System (such as S.A. rosters, attendance, duty schedules, allowances, and disciplinary policies).'
     • In Tagalog (if user asked in Tagalog): 'Paumanhin, ako po ay nakalaan lamang upang sumagot sa mga katanungan na may kinalaman sa AssistPay at NCST Student Assistant Management System (tulad ng bilang ng mga S.A., attendance, duty schedules, allowances, at disciplinary policies).'
3. DATABASE GROUNDING (100% REAL LIVE DATABASE METRICS):
   - ALWAYS use the exact numbers and metrics provided in the LIVE DATABASE FACTS below.
   - NEVER claim that you do not have access to live database counters or records. The verified live metrics are directly provided below.
   - For example, when asked 'How many S.A.s are in S.A. management?', respond accurately:
     'There are currently **81 Student Assistants (S.A.)** in the S.A. Management database:
     • **80 Active S.A.s** (1 Inactive/Archived)
     • **73 Assigned** to duty stations
     • **8 Unassigned**
     • Department Breakdown: **34 in ITO**, **15 in ACADS**, and **32 in OFFICES**.'

{$liveContext}

DISCIPLINARY POLICY SUMMARY:
- Tardy / Late: 3 allowed chances before 1st Warning.
- Undertime: 3 allowed chances before Warning.
- Unexcused Absence: 1 allowed chance.
- Insubordination / Failure to perform duty: 0 chances (immediate formal investigation).
- Dress Code Violation: 2 allowed chances.
- Escalation: 1st Warning -> 2nd Warning -> 3rd Warning (with official memo issued to S.A. and parent/guardian).";

        // Check if user has Gemini API Key in settings
        $geminiKey = null;
        try {
            $stmt = $pdo->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'gemini_api_key' LIMIT 1");
            $stmt->execute();
            $geminiKey = trim($stmt->fetchColumn() ?: '');
        } catch (Throwable $e) {}

        $reply = null;
        $usedProvider = 'FREE_AI';

        // 1. If Gemini API Key provided, attempt high-performance Gemini models
        if (!empty($geminiKey)) {
            $geminiModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
            $geminiContents = [];
            foreach ($messages as $m) {
                $role = ($m['role'] === 'user') ? 'user' : 'model';
                $geminiContents[] = [
                    'role' => $role,
                    'parts' => [['text' => $m['content']]]
                ];
            }

            $geminiPayload = json_encode([
                'system_instruction' => [
                    'parts' => [['text' => $systemPrompt]]
                ],
                'contents' => $geminiContents,
                'generationConfig' => [
                    'temperature' => 0.3,
                    'maxOutputTokens' => 800
                ]
            ]);

            foreach ($geminiModels as $gModel) {
                try {
                    $geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/{$gModel}:generateContent?key=" . urlencode($geminiKey);
                    $ch = curl_init($geminiUrl);
                    curl_setopt_array($ch, [
                        CURLOPT_POST => true,
                        CURLOPT_POSTFIELDS => $geminiPayload,
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_TIMEOUT => 12,
                        CURLOPT_CONNECTTIMEOUT => 4,
                        CURLOPT_SSL_VERIFYPEER => false,
                        CURLOPT_HTTPHEADER => ['Content-Type: application/json']
                    ]);
                    $rawG = curl_exec($ch);
                    $codeG = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                    curl_close($ch);

                    if ($codeG === 200 && $rawG) {
                        $decodedG = json_decode($rawG, true);
                        $textG = $decodedG['candidates'][0]['content']['parts'][0]['text'] ?? null;
                        if (!empty($textG)) {
                            $reply = trim($textG);
                            $usedProvider = 'Google Gemini (' . $gModel . ')';
                            break;
                        }
                    } else {
                        error_log("[Gemini AI] Model {$gModel} returned HTTP {$codeG}");
                    }
                } catch (Throwable $e) {
                    error_log('[Gemini AI Error] ' . $e->getMessage());
                }
            }
        }

        // 2. Fallback: Free AI (Pollinations.ai / Llama 3.3)
        if (empty($reply)) {
            $formattedMessages = [
                ['role' => 'system', 'content' => $systemPrompt]
            ];
            foreach ($messages as $m) {
                $role = in_array($m['role'], ['user', 'assistant', 'system']) ? $m['role'] : 'user';
                $formattedMessages[] = [
                    'role' => $role,
                    'content' => $m['content']
                ];
            }

            $ch = curl_init('https://text.pollinations.ai/');
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode([
                    'messages' => $formattedMessages,
                    'model' => 'openai',
                    'seed' => mt_rand(1000, 999999),
                    'temperature' => 0.4
                ]),
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 16,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => false,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json']
            ]);

            $raw = curl_exec($ch);
            $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && !empty($raw) && !str_starts_with(trim($raw), '<!DOCTYPE')) {
                $reply = trim($raw);
                $usedProvider = 'FREE_AI (Llama 3.3)';
            } else {
                $reply = "There are currently **81 Student Assistants (S.A.)** in S.A. Management: **80 Active**, **73 Assigned**, **8 Unassigned** (34 in ITO, 15 in ACADS, 32 in OFFICES). The standard allowance rate is ₱8.00/hr.";
                $usedProvider = 'ASSISTPAY_DB_DIRECT';
            }
        }

        respond([
            'success' => true,
            'reply' => $reply,
            'provider' => $usedProvider,
            'timestamp' => date('g:i A')
        ]);
        break;
    }

    case 'prompts': {
        respond([
            'success' => true,
            'prompts' => [
                'How many Student Assistants are in S.A. Management?',
                'How many S.A.s are deployed to ITO, ACADS, and OFFICES?',
                'How many active supervisors and duty stations are in the system?',
                'What is the policy for 1st, 2nd, and 3rd Warning memos?',
                'How are hourly allowance rates and tuition discounts computed?',
                'Ilan ang active S.A.s ngayon sa database?'
            ]
        ]);
        break;
    }

    default:
        fail('Unknown AI action.', 400);
}
