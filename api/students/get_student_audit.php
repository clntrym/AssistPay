<?php
require __DIR__ . '/../_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();

$action = input()['action'] ?? '';
$currentUserId = (int) $user['id'];

if ($action === 'list') {
    $page     = max(1, (int) (input()['page'] ?? 1));
    $perPage  = min(100, max(10, (int) (input()['perPage'] ?? 25)));
    $search   = trim(input()['search'] ?? '');
    $actionFilter = trim(input()['actionFilter'] ?? '');
    $dateFrom = trim(input()['dateFrom'] ?? '');
    $dateTo   = trim(input()['dateTo'] ?? '');

    // Each account only sees their own audit logs ("kanya-kanya")
    $where = ["a.user_id = ?"];
    $params = [$currentUserId];

    if ($search) {
        $where[] = "(a.action LIKE ? OR a.details LIKE ? OR u.full_name LIKE ? OR u.username LIKE ?)";
        $like = "%$search%";
        $params = array_merge($params, [$like, $like, $like, $like]);
    }
    if ($actionFilter) {
        $where[] = "a.action = ?";
        $params[] = $actionFilter;
    }
    if ($dateFrom) {
        $where[] = "DATE(a.created_at) >= ?";
        $params[] = $dateFrom;
    }
    if ($dateTo) {
        $where[] = "DATE(a.created_at) <= ?";
        $params[] = $dateTo;
    }

    $whereSQL = 'WHERE ' . implode(' AND ', $where);

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id $whereSQL");
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    $offset = ($page - 1) * $perPage;
    $stmt = $pdo->prepare("
        SELECT a.id, a.action, a.details, a.ip_address, a.created_at,
               COALESCE(u.full_name, 'System') AS user_name,
               COALESCE(u.role, '') AS user_role
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        $whereSQL
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $perPage OFFSET $offset
    ");
    $stmt->execute($params);
    $logs = $stmt->fetchAll();

    respond([
        'success' => true,
        'logs' => $logs,
        'total' => $total,
        'page' => $page,
        'perPage' => $perPage,
        'totalPages' => max(1, (int) ceil($total / $perPage))
    ]);
}

if ($action === 'list_actions') {
    $stmt = $pdo->prepare("SELECT DISTINCT action FROM audit_logs WHERE user_id = ? ORDER BY action");
    $stmt->execute([$currentUserId]);
    respond(['success' => true, 'actions' => $stmt->fetchAll(PDO::FETCH_COLUMN)]);
}

fail('Unknown action.', 400);
