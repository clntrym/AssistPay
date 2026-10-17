<?php
// Serves user profile picture securely with content verification and cache headers.
require_once __DIR__ . '/_bootstrap.php';

$userId = isset($_GET['id']) ? (int) $_GET['id'] : 0;
if (!$userId && !empty($_SESSION['user_id'])) {
    $userId = (int) $_SESSION['user_id'];
}

if ($userId <= 0) {
    http_response_code(400);
    exit('Invalid user ID.');
}

$stmt = $pdo->prepare('SELECT id, avatar_path, updated_at FROM users WHERE id = ? LIMIT 1');
$stmt->execute([$userId]);
$userRow = $stmt->fetch();

if (!$userRow || empty($userRow['avatar_path'])) {
    http_response_code(404);
    exit('No profile picture set.');
}

$relPath = (string) $userRow['avatar_path'];
// Prevent directory traversal: must be within uploads/avatars/
$cleanName = basename($relPath);
$realBaseDir = realpath(dirname(__DIR__) . '/uploads/avatars');
$targetPath = $realBaseDir . DIRECTORY_SEPARATOR . $cleanName;

if (!$realBaseDir || !is_file($targetPath) || !str_starts_with(realpath($targetPath) ?: '', $realBaseDir)) {
    http_response_code(404);
    exit('Profile picture not found.');
}

$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime = (string) $finfo->file($targetPath);
$allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];

if (!in_array($mime, $allowedMimes, true)) {
    http_response_code(415);
    exit('Invalid image type.');
}

header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($targetPath));
header('Cache-Control: private, max-age=86400');
header('X-Content-Type-Options: nosniff');
readfile($targetPath);
exit;

