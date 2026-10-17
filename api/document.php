<?php
// Serves a supporting document filed against a class-schedule change.
//
// The files sit in uploads/, which denies direct access, so this is the only
// way in and the session is checked first: the Coordinator sees any of them,
// an S.A. only their own. Read-only, so a plain GET is right here — everything
// that changes anything still goes through the POST + CSRF endpoints.
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_sa.php';
require __DIR__ . '/_scheduling.php';
require_once __DIR__ . '/_requests.php';

$user = require_auth();
$id = (int) ($_GET['id'] ?? 0);
$type = (string) ($_GET['type'] ?? 'class');
if (!$id) fail('Which document?', 422);

if ($type === 'request') {
    ensure_request_tables($pdo);
    $req = fetch_sa_request_by_id($pdo, $id);
    if (!$req || empty($req['proof_stored_name'])) {
        fail('That supporting proof document was not found.', 404);
    }

    $isAdmin = ($user['role'] ?? '') === 'ADMIN';
    $isOwner = (int) ($req['sa_user_id'] ?? 0) === (int) $user['id'];
    $isAuthorizedSupervisor = ($user['role'] ?? '') === 'SUPERVISOR'
        && can_supervisor_access_sa_request($pdo, $user, $req);

    if (!$isAdmin && !$isOwner && !$isAuthorizedSupervisor) {
        audit('REQUEST_PROOF_ACCESS_DENIED', "User #{$user['id']} ({$user['role']}) denied access to request #{$id} proof");
        fail('This supporting proof document is not yours to open.', 403);
    }

    $path = dirname(__DIR__) . '/uploads/request-documents/' . basename((string) $req['proof_stored_name']);
    if (!is_file($path)) {
        fail('The supporting proof file is missing from the server.', 404);
    }

    $name = preg_replace('/[^\w. \-()]/u', '_', (string) ($req['proof_file_name'] ?: 'supporting_proof'));
    header('Content-Type: ' . ($req['proof_mime_type'] ?: 'application/octet-stream'));
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="' . $name . '"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=300');
    readfile($path);
    exit;
}

$stmt = $pdo->prepare(
    'SELECT d.*, p.user_id FROM class_change_documents d
       JOIN sa_profiles p ON p.id = d.sa_profile_id
      WHERE d.id = ?'
);
$stmt->execute([$id]);
$doc = $stmt->fetch() ?: fail('That document was not found.', 404);

$isAdmin = $user['role'] === 'ADMIN';
$isOwner = (int) $doc['user_id'] === (int) $user['id'];
if (!$isAdmin && !$isOwner) fail('This document is not yours to open.', 403);

$path = dirname(__DIR__) . '/uploads/class-documents/' . basename($doc['stored_name']);
if (!is_file($path)) fail('The file is missing from the server.', 404);

// The name is the Coordinator's own, so it is quoted and stripped of anything
// that could break out of the header.
$name = preg_replace('/[^\w. \-()]/u', '_', $doc['file_name']);

header('Content-Type: ' . $doc['mime_type']);
header('Content-Length: ' . filesize($path));
header('Content-Disposition: inline; filename="' . $name . '"');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=300');
readfile($path);
