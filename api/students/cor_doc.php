<?php
// Serves a student's Certificate of Registration image.
// Files are stored outside the web root; this is the only way in and the
// session is checked first. Registrars and Admins can see all; others are denied.
require __DIR__ . '/../_bootstrap.php';

$user = require_auth();
require_role($user, 'REGISTRAR', 'ADMIN');

$id = (int) ($_GET['id'] ?? 0);
if (!$id) fail('Which document?', 422);

$stmt = $pdo->prepare('SELECT * FROM student_cor_documents WHERE id = ?');
$stmt->execute([$id]);
$doc = $stmt->fetch() ?: fail('Document not found.', 404);

$dir  = dirname(__DIR__, 2) . '/uploads/cor-documents';
$path = $dir . '/' . basename($doc['stored_name']);
if (!is_file($path)) fail('The file is missing from the server.', 404);

$name = preg_replace('/[^\w. \-()]/u', '_', $doc['file_name']);

header('Content-Type: ' . $doc['mime_type']);
header('Content-Length: ' . filesize($path));
header('Content-Disposition: inline; filename="' . $name . '"');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=300');
readfile($path);
