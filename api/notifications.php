<?php
require __DIR__ . '/_bootstrap.php';
require_once __DIR__ . '/_evaluation_workflow.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed.', 405);
require_csrf();
$user = require_auth();
$in = input();
$action = $in['action'] ?? 'list';

switch ($action) {
    case 'list':
        try {
            if (!function_exists('schema_guard_ready') || !schema_guard_ready('eval_deadlines_poll', 120)) {
                process_evaluation_deadlines_and_reminders($pdo);
                if (function_exists('schema_guard_mark_ready')) {
                    schema_guard_mark_ready('eval_deadlines_poll');
                }
            }
        } catch (Throwable $e) {
            error_log('[AssistPay Eval Reminder Hook] ' . $e->getMessage());
        }
        $userId = (int) $user['id'];
        $stmt = $pdo->prepare('
            SELECT n.id, n.sender_id, n.type, n.title, n.message, n.link, n.is_read, n.created_at,
                   u.full_name AS sender_name, u.role AS sender_role
              FROM notifications n
         LEFT JOIN users u ON u.id = n.sender_id
             WHERE n.user_id = ?
             ORDER BY n.id DESC
             LIMIT 50
        ');
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        $unreadStmt = $pdo->prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0');
        $unreadStmt->execute([$userId]);
        $unreadCount = (int) $unreadStmt->fetchColumn();

        $now = time();
        $formatted = array_map(function($r) use ($now) {
            $ts = strtotime($r['created_at']);
            $diff = max(0, $now - $ts);
            if ($diff < 60) {
                $timeAgo = 'Just now';
            } elseif ($diff < 3600) {
                $timeAgo = floor($diff / 60) . 'm ago';
            } elseif ($diff < 86400) {
                $timeAgo = floor($diff / 3600) . 'h ago';
            } elseif ($diff < 86400 * 7) {
                $timeAgo = floor($diff / 86400) . 'd ago';
            } else {
                $timeAgo = date('M j, Y', $ts);
            }

            $link = $r['link'] ?? '';
            // 1. Normalize legacy #/admin/sa/:id -> #/admin/sa-management/:id?tab=CLASSES
            if (preg_match('/^#?\/admin\/sa\/(\d+)/', $link, $mSa)) {
                $link = '#/admin/sa-management/' . $mSa[1] . '?tab=CLASSES';
            }
            // 2. Normalize legacy #/sa/my-schedule -> #/sa/schedule
            if ($link === '#/sa/my-schedule' || $link === '/sa/my-schedule') {
                $link = '#/sa/schedule';
            }
            // 3. Smart-resolve Class Schedule notifications that still point to generic recommendations
            if (($r['type'] === 'CLASS_SCHEDULE_CHANGED' || stripos($r['title'], 'Class Schedule') !== false)
                && (empty($link) || strpos($link, 'recommendations') !== false)) {
                if (preg_match('/(?:class schedule|class period) of ([^(]+)/i', $r['message'], $mName)) {
                    $extracted = trim($mName[1]);
                    $profStmt = $pdo->prepare("SELECT id FROM sa_profiles WHERE TRIM(CONCAT(first_name, ' ', last_name)) = ? OR first_name = ? LIMIT 1");
                    $profStmt->execute([$extracted, $extracted]);
                    $pId = $profStmt->fetchColumn();
                    if ($pId) {
                        $link = '#/admin/sa-management/' . (int) $pId . '?tab=CLASSES';
                    } else {
                        $link = '#/admin/scheduling/class-schedules?q=' . urlencode($extracted);
                    }
                } else {
                    $link = '#/admin/scheduling/class-schedules';
                }
            }
            // 4. Smart-resolve Request notifications missing ?ref=
            if (strpos($link, 'requests') !== false && strpos($link, 'ref=') === false) {
                if (preg_match('/\((NCST-REQ-[^\)]+|REQ-[^\)]+)\)/i', $r['title'] . ' ' . $r['message'], $mRef)) {
                    $link .= (strpos($link, '?') !== false ? '&' : '?') . 'ref=' . urlencode(trim($mRef[1]));
                }
            }

            return [
                'id' => (int) $r['id'],
                'senderId' => $r['sender_id'] ? (int) $r['sender_id'] : null,
                'senderName' => $r['sender_name'],
                'senderRole' => $r['sender_role'],
                'type' => $r['type'],
                'title' => $r['title'],
                'message' => $r['message'],
                'link' => $link,
                'isRead' => (bool) $r['is_read'],
                'createdAt' => $r['created_at'],
                'timeAgo' => $timeAgo,
            ];
        }, $rows);

        respond([
            'success' => true,
            'notifications' => $formatted,
            'unreadCount' => $unreadCount,
        ]);

    case 'mark_read':
        $notifId = (int) ($in['id'] ?? 0);
        if ($notifId > 0) {
            $stmt = $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?');
            $stmt->execute([$notifId, $user['id']]);
        }
        respond(['success' => true]);

    case 'mark_all_read':
        $stmt = $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0');
        $stmt->execute([$user['id']]);
        respond(['success' => true]);

    case 'clear_all':
        $stmt = $pdo->prepare('DELETE FROM notifications WHERE user_id = ?');
        $stmt->execute([$user['id']]);
        respond(['success' => true]);

    default:
        fail('Unknown action.', 400);
}

