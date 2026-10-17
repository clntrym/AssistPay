<?php
require __DIR__ . '/../_bootstrap.php';

$pdo->exec("CREATE TABLE IF NOT EXISTS student_cor_documents (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id   INT NOT NULL,
    file_name    VARCHAR(160) NOT NULL,
    stored_name  VARCHAR(80)  NOT NULL,
    mime_type    VARCHAR(60)  NOT NULL,
    file_size    INT UNSIGNED NOT NULL,
    status       ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
    uploaded_by  INT UNSIGNED NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cor_student (student_id, created_at),
    CONSTRAINT fk_cor_student FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    CONSTRAINT fk_cor_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

// Add status column if the table already existed without it
if ($pdo->query("SHOW COLUMNS FROM student_cor_documents LIKE 'status'")->rowCount() === 0) {
    $pdo->exec("ALTER TABLE student_cor_documents
                ADD COLUMN status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING' AFTER file_size");
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
require_role($user, 'REGISTRAR', 'ADMIN');

$action = input()['action'] ?? '';

const COR_MAX_BYTES = 10 * 1024 * 1024;
const COR_MIME_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

function cor_documents_dir(): string
{
    $dir = dirname(__DIR__, 2) . '/uploads/cor-documents';
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        fail('The upload folder could not be created on the server.', 500);
    }
    return $dir;
}

if ($action === 'list_students') {
    $stmt = $pdo->query("
        SELECT s.student_id AS id, s.student_number,
               CONCAT(s.first_name, ' ', COALESCE(NULLIF(s.middle_name,''), ''), ' ', s.last_name) AS name,
               (SELECT COUNT(*) FROM student_cor_documents d WHERE d.student_id = s.student_id) AS cor_count,
               (SELECT COUNT(*) FROM student_cor_documents d WHERE d.student_id = s.student_id AND d.status='PENDING') AS pending_count
        FROM students s
        ORDER BY s.last_name, s.first_name
    ");
    respond(['success' => true, 'students' => $stmt->fetchAll()]);
}

if ($action === 'upload_cor') {
    $in = input();
    $studentId = (int) ($in['studentId'] ?? 0);
    if (!$studentId) fail('Which student?', 422);

    $stmt = $pdo->prepare('SELECT student_id FROM students WHERE student_id = ?');
    $stmt->execute([$studentId]);
    if (!$stmt->fetch()) fail('Student not found.', 404);

    $doc  = (array) ($in['document'] ?? []);
    $data = (string) ($doc['data'] ?? '');
    $type = strtolower(trim((string) ($doc['type'] ?? '')));
    $name = trim((string) ($doc['name'] ?? 'cor.jpg'));

    if (!$data) fail('No image provided.', 422);
    if (!isset(COR_MIME_TYPES[$type])) fail('Only JPG, PNG, or WEBP images are accepted.', 422);

    $binary = base64_decode(preg_replace('#^data:[^,]+,#', '', $data), true);
    if ($binary === false || $binary === '') fail('The image could not be read. Try again.', 422);
    if (strlen($binary) > COR_MAX_BYTES) fail('Keep the image under 10 MB.', 422);

    $ext    = COR_MIME_TYPES[$type];
    $stored = bin2hex(random_bytes(16)) . '.' . $ext;
    $path   = cor_documents_dir() . '/' . $stored;
    if (file_put_contents($path, $binary) === false) fail('Could not save the file on the server.', 500);

    if (mb_strlen($name) > 160) $name = mb_substr($name, -160);

    $pdo->prepare(
        "INSERT INTO student_cor_documents (student_id, file_name, stored_name, mime_type, file_size, status, uploaded_by)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?)"
    )->execute([$studentId, $name, $stored, $type, strlen($binary), $user['id']]);

    $id = (int) $pdo->lastInsertId();
    audit('UPLOAD_COR', "COR uploaded for student $studentId (doc $id), pending review", $user['id']);

    respond(['success' => true, 'id' => $id]);
}

if ($action === 'list_cors') {
    $studentId = (int) (input()['studentId'] ?? 0);
    if (!$studentId) fail('Which student?', 422);

    $stmt = $pdo->prepare("
        SELECT d.id, d.file_name, d.mime_type, d.file_size, d.status,
               DATE_FORMAT(d.created_at, '%b %d, %Y %h:%i %p') AS uploaded_at,
               u.full_name AS uploaded_by
        FROM student_cor_documents d
        LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE d.student_id = ?
        ORDER BY d.id DESC
    ");
    $stmt->execute([$studentId]);
    respond(['success' => true, 'docs' => $stmt->fetchAll()]);
}

if ($action === 'delete_cor') {
    $id = (int) (input()['id'] ?? 0);
    if (!$id) fail('Which document?', 422);

    $stmt = $pdo->prepare('SELECT * FROM student_cor_documents WHERE id = ?');
    $stmt->execute([$id]);
    $doc = $stmt->fetch() ?: fail('Document not found.', 404);

    $path = cor_documents_dir() . '/' . basename($doc['stored_name']);
    if (is_file($path)) unlink($path);

    $pdo->prepare('DELETE FROM student_cor_documents WHERE id = ?')->execute([$id]);
    audit('DELETE_COR', "COR doc $id deleted for student {$doc['student_id']}", $user['id']);

    respond(['success' => true]);
}

fail('Unknown action.', 400);
