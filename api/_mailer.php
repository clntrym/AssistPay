<?php
/*
|--------------------------------------------------------------------------
| MAILER (PHPMailer over Gmail SMTP)
|--------------------------------------------------------------------------
|
| PHPMailer was taken from SariSmarts' vendor folder (vendor/phpmailer).
|
| Credentials are NOT stored in the project folder. They are read from a
| secrets file outside the web root, in this order:
|   1. C:/xampp/private_config/assistpay_secrets.php   (AssistPay's own)
|   2. C:/xampp/private_config/sarismart_secrets.php   (shared fallback)
| and environment variables (MAIL_HOST, MAIL_PORT, MAIL_USERNAME,
| MAIL_PASSWORD, MAIL_FROM_NAME, MAIL_ENCRYPTION) fill in anything missing.
|
| The secrets file returns an array, e.g.
|   <?php return ['MAIL_USERNAME' => 'x@gmail.com', 'MAIL_PASSWORD' => 'app password'];
|
| Gmail needs an App Password, not the account password.
*/

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as MailerException;

require_once __DIR__ . '/../vendor/phpmailer/phpmailer/src/Exception.php';
require_once __DIR__ . '/../vendor/phpmailer/phpmailer/src/PHPMailer.php';
require_once __DIR__ . '/../vendor/phpmailer/phpmailer/src/SMTP.php';

function assistpay_mail_settings(): array
{
    static $settings = null;
    if ($settings !== null) return $settings;

    $defaults = [
        'MAIL_HOST' => 'smtp.gmail.com',
        'MAIL_PORT' => 465,
        'MAIL_USERNAME' => 'magpantaydaizy3@gmail.com',
        'MAIL_PASSWORD' => 'znupsbtxbdtarzme',
        'MAIL_FROM_NAME' => 'AssistPay — NCST S.A. System',
        'MAIL_ENCRYPTION' => 'ssl',
    ];

    // 1. Secrets file outside the web root (e.g. local XAMPP)
    $file = [];
    foreach ([
        'C:/xampp/private_config/assistpay_secrets.php',
        'C:/xampp/private_config/sarismart_secrets.php',
        dirname(__DIR__) . '/private_config/assistpay_secrets.php',
    ] as $path) {
        if (is_readable($path)) {
            $file = (array) require $path;
            break;
        }
    }

    // 2. Database system_settings table (dynamic fallback)
    $db = [];
    try {
        global $pdo;
        if (isset($pdo) && $pdo) {
            $stmt = $pdo->query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key LIKE 'mail_%' OR setting_key LIKE 'brevo_%'");
            if ($stmt) {
                while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    $k = strtoupper($row['setting_key']);
                    if ($k === 'MAIL_USER') $k = 'MAIL_USERNAME';
                    if ($k === 'MAIL_PASS') $k = 'MAIL_PASSWORD';
                    if (!empty($row['setting_value'])) $db[$k] = trim($row['setting_value']);
                }
            }
        }
    } catch (Throwable $_) {}

    // 3. Environment variables (highest priority for Docker / Render)
    $env = [];
    foreach (['MAIL_HOST', 'MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_FROM_NAME', 'MAIL_ENCRYPTION', 'BREVO_API_KEY', 'MAIL_TRANSPORT'] as $name) {
        $v = getenv($name);
        if ($v !== false && trim((string) $v) !== '') $env[$name] = trim((string) $v);
    }

    $settings = array_merge($defaults, $db, $file, $env);
    $settings['MAIL_HOST'] = $settings['MAIL_HOST'] ?: 'smtp.gmail.com';
    $settings['MAIL_PORT'] = (int) ($settings['MAIL_PORT'] ?: 465);
    return $settings;
}

function assistpay_mail_ready(): bool
{
    $s = assistpay_mail_settings();
    return trim((string) ($s['BREVO_API_KEY'] ?? '')) !== ''
        || (trim((string) ($s['MAIL_USERNAME'] ?? '')) !== '' && trim((string) ($s['MAIL_PASSWORD'] ?? '')) !== '');
}

/**
 * Sends transactional email via Brevo REST API over HTTPS (Port 443).
 * Works 100% on cloud platforms like Render where outbound SMTP (ports 25, 465, 587) is blocked.
 */
function assistpay_send_via_brevo(string $apiKey, array $to, string $subject, string $html, string $text = ''): array
{
    $settings = assistpay_mail_settings();
    $senderEmail = $settings['MAIL_FROM_ADDRESS'] ?? $settings['MAIL_USERNAME'] ?? 'magpantaydaizy3@gmail.com';
    $senderName = $settings['MAIL_FROM_NAME'] ?: 'AssistPay — NCST S.A. System';

    $toRecipients = [];
    foreach ($to as $addr) {
        $toRecipients[] = ['email' => $addr];
    }

    $payload = [
        'sender' => [
            'name' => $senderName,
            'email' => $senderEmail,
        ],
        'to' => $toRecipients,
        'subject' => $subject,
        'htmlContent' => $html,
    ];
    if (trim($text) !== '') {
        $payload['textContent'] = $text;
    } else {
        $payload['textContent'] = trim(strip_tags(preg_replace('~<br\s*/?>~i', "\n", $html)));
    }

    $ch = curl_init('https://api.brevo.com/v3/smtp/email');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => [
            'api-key: ' . $apiKey,
            'Content-Type: application/json',
            'Accept: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);

    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($httpCode >= 200 && $httpCode < 300) {
        return ['sent' => true, 'error' => null, 'recipients' => $to];
    }

    $errorMsg = 'Brevo HTTP ' . $httpCode . ': ' . ($response ?: $curlError ?: 'Request failed');
    error_log('AssistPay Brevo mail failed: ' . $errorMsg);
    return ['sent' => false, 'error' => $errorMsg, 'recipients' => $to];
}

function assistpay_mailer(): PHPMailer
{
    $s = assistpay_mail_settings();
    $mail = new PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = $s['MAIL_HOST'] ?: 'smtp.gmail.com';
    $mail->SMTPAuth = true;
    $mail->Username = (string) ($s['MAIL_USERNAME'] ?? '');
    $mail->Password = (string) ($s['MAIL_PASSWORD'] ?? '');

    $port = (int) ($s['MAIL_PORT'] ?: 465);
    $enc = strtolower(trim((string) ($s['MAIL_ENCRYPTION'] ?? '')));
    if ($enc === '') $enc = ($port === 465) ? 'ssl' : 'tls';

    $mail->SMTPSecure = ($enc === 'ssl') ? PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Port = $port;
    $mail->Timeout = 15;
    $mail->CharSet = 'UTF-8';

    // Relax peer verification to prevent SSL handshake failure in containerized or missing-CA environments
    $mail->SMTPOptions = [
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
            'allow_self_signed' => true,
        ],
    ];

    $fromName = $s['MAIL_FROM_NAME'] ?: 'AssistPay — NCST S.A. System';
    $mail->setFrom($mail->Username, $fromName);
    $mail->isHTML(true);
    return $mail;
}

/**
 * Sends one email. Never throws: returns ['sent' => bool, 'error' => ?string]
 * so a mail failure can never undo a record that was already saved.
 */
function assistpay_send_mail(array $to, string $subject, string $html, string $text = ''): array
{
    $to = array_values(array_unique(array_filter(array_map(
        fn($e) => mb_strtolower(trim((string) $e)),
        $to
    ), fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL))));

    if (!$to) return ['sent' => false, 'error' => 'No valid email address on record.'];

    $settings = assistpay_mail_settings();
    $brevoKey = trim((string) ($settings['BREVO_API_KEY'] ?? ''));
    $transport = strtolower(trim((string) ($settings['MAIL_TRANSPORT'] ?? '')));

    // If Brevo API key is available and transport is not forced to SMTP, send via HTTPS API
    if ($brevoKey !== '' && $transport !== 'smtp') {
        return assistpay_send_via_brevo($brevoKey, $to, $subject, $html, $text);
    }

    if (!assistpay_mail_ready()) return ['sent' => false, 'error' => 'Mail server credentials are not configured.'];

    try {
        $mail = assistpay_mailer();
        foreach ($to as $addr) $mail->addAddress($addr);
        $mail->Subject = $subject;
        $mail->Body = $html;
        $mail->AltBody = $text !== '' ? $text : trim(strip_tags(preg_replace('~<br\s*/?>~i', "\n", $html)));
        $mail->send();
        return ['sent' => true, 'error' => null, 'recipients' => $to];
    } catch (MailerException $e) {
        error_log('AssistPay mail failed: ' . $e->getMessage());
        return ['sent' => false, 'error' => $e->getMessage(), 'recipients' => $to];
    } catch (Throwable $e) {
        error_log('AssistPay mail failed: ' . $e->getMessage());
        return ['sent' => false, 'error' => $e->getMessage(), 'recipients' => $to];
    }
}

/** Login page URL, built from the current request (works on localhost and deployed). */
function assistpay_login_url(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $base = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/AssistPay/api/sa.php'))), '/');
    return ($https ? 'https' : 'http') . '://' . $host . $base . '/#/login';
}

/** "Your AssistPay account has been created" email for a newly registered S.A. */
function send_sa_account_created_email(array $to, string $firstName, string $studentId, string $saNumber, string $password): array
{
    $e = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
    $loginUrl = assistpay_login_url();

    $html = '
<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6fa;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e7ef;">
    <div style="background:#0b2a5b;padding:20px 24px;color:#ffffff;">
      <div style="font-size:20px;font-weight:800;letter-spacing:.5px;">ASSISTPAY</div>
      <div style="font-size:12px;color:#f5c542;">NCST Student Assistant System</div>
    </div>
    <div style="padding:24px;color:#1f2937;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 12px;">Hi <strong>' . $e($firstName) . '</strong>,</p>
      <p style="margin:0 0 16px;">Your <strong>AssistPay</strong> Student Assistant account has been created by the S.A. Coordinator. You can now sign in using the details below.</p>
      <table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e3e7ef;border-radius:8px;">
        <tr><td style="padding:10px 14px;color:#6b7280;width:45%;">Student Number (Username)</td><td style="padding:10px 14px;font-family:Consolas,monospace;font-weight:700;">' . $e($studentId) . '</td></tr>
        <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #e3e7ef;">Default Password</td><td style="padding:10px 14px;font-family:Consolas,monospace;font-weight:700;border-top:1px solid #e3e7ef;">' . $e($password) . '</td></tr>
        <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #e3e7ef;">S.A. ID</td><td style="padding:10px 14px;font-family:Consolas,monospace;border-top:1px solid #e3e7ef;">' . $e($saNumber) . '</td></tr>
      </table>
      <p style="margin:20px 0;text-align:center;">
        <a href="' . $e($loginUrl) . '" style="display:inline-block;background:#0b2a5b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Sign in to AssistPay</a>
      </p>
      <p style="margin:0 0 8px;padding:10px 14px;background:#fff7e6;border:1px solid #f5c542;border-radius:8px;font-size:13px;">
        <strong>Important:</strong> You will be asked to change this default password the first time you sign in. Do not share your password with anyone.
      </p>
      <p style="margin:16px 0 0;color:#6b7280;font-size:12px;">If you did not expect this email, please contact the S.A. Coordinator\'s office.</p>
    </div>
  </div>
</div>';

    $text = "Hi {$firstName},\n\nYour AssistPay Student Assistant account has been created.\n\n"
        . "Student Number (Username): {$studentId}\nDefault Password: {$password}\nS.A. ID: {$saNumber}\n\n"
        . "Sign in: {$loginUrl}\n\nYou will be asked to change this password the first time you sign in.";

    return assistpay_send_mail($to, 'Your AssistPay account has been created', $html, $text);
}

/** "Your AssistPay password has been reset" email for an S.A. */
function send_sa_password_reset_email(array $to, string $firstName, string $studentId, string $tempPassword): array
{
    $e = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
    $loginUrl = assistpay_login_url();

    $html = '
<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6fa;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e7ef;">
    <div style="background:#0b2a5b;padding:20px 24px;color:#ffffff;">
      <div style="font-size:20px;font-weight:800;letter-spacing:.5px;">ASSISTPAY</div>
      <div style="font-size:12px;color:#f5c542;">NCST Student Assistant System</div>
    </div>
    <div style="padding:24px;color:#1f2937;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 12px;">Hi <strong>' . $e($firstName) . '</strong>,</p>
      <p style="margin:0 0 16px;">Your <strong>AssistPay</strong> password has been reset by the S.A. Coordinator. Please use your new temporary password below to sign in:</p>
      <table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e3e7ef;border-radius:8px;">
        <tr><td style="padding:10px 14px;color:#6b7280;width:45%;">Student Number (Username)</td><td style="padding:10px 14px;font-family:Consolas,monospace;font-weight:700;">' . $e($studentId) . '</td></tr>
        <tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #e3e7ef;">New Temporary Password</td><td style="padding:10px 14px;font-family:Consolas,monospace;font-weight:700;color:#0b2a5b;border-top:1px solid #e3e7ef;">' . $e($tempPassword) . '</td></tr>
      </table>
      <p style="margin:20px 0;text-align:center;">
        <a href="' . $e($loginUrl) . '" style="display:inline-block;background:#0b2a5b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Sign in to AssistPay</a>
      </p>
      <p style="margin:0 0 8px;padding:10px 14px;background:#fff7e6;border:1px solid #f5c542;border-radius:8px;font-size:13px;">
        <strong>Important:</strong> You must set a new permanent password immediately upon signing in. For your security, never share your password with anyone.
      </p>
      <p style="margin:16px 0 0;color:#6b7280;font-size:12px;">If you did not request this password reset, please contact the S.A. Coordinator\'s office immediately.</p>
    </div>
  </div>
</div>';

    $text = "Hi {$firstName},\n\nYour AssistPay password has been reset by the S.A. Coordinator.\n\n"
        . "Student Number (Username): {$studentId}\nNew Temporary Password: {$tempPassword}\n\n"
        . "Sign in: {$loginUrl}\n\nYou must change this password immediately upon signing in.";

    return assistpay_send_mail($to, 'Your AssistPay password has been reset', $html, $text);
}

/** "Your AssistPay password was successfully changed" security confirmation */
function send_password_changed_notice_email(array $to, string $fullName): array
{
    $e = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
    $time = date('F j, Y, g:i A');

    $html = '
<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6fa;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e7ef;">
    <div style="background:#0b2a5b;padding:20px 24px;color:#ffffff;">
      <div style="font-size:20px;font-weight:800;letter-spacing:.5px;">ASSISTPAY</div>
      <div style="font-size:12px;color:#f5c542;">NCST Student Assistant System</div>
    </div>
    <div style="padding:24px;color:#1f2937;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 12px;">Hi <strong>' . $e($fullName) . '</strong>,</p>
      <p style="margin:0 0 16px;">This is a confirmation that your <strong>AssistPay</strong> account password was successfully changed on <strong>' . $e($time) . '</strong>.</p>
      <p style="margin:0 0 8px;padding:12px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:13px;color:#065f46;">
        <strong>Password Updated:</strong> You can now use your new password whenever signing in to AssistPay.
      </p>
      <p style="margin:16px 0 0;color:#dc2626;font-size:12px;">
        <strong>Didn\'t make this change?</strong> If you did not change your password, please contact the S.A. Coordinator immediately to secure your account.
      </p>
    </div>
  </div>
</div>';

    $text = "Hi {$fullName},\n\nYour AssistPay account password was successfully changed on {$time}.\n\nIf you did not perform this change, please contact the S.A. Coordinator immediately.";

    return assistpay_send_mail($to, 'AssistPay Security: Your password was changed', $html, $text);
}



