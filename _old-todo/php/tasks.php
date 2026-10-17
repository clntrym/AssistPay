<?php
require "../config/config.php";
header("Content-Type: application/json");

if (!isset($_SESSION["user_id"])) {
    echo json_encode(["success" => false]);
    exit;
}

$user = $_SESSION["user_id"];
$data = json_decode(file_get_contents("php://input"), true);
$action = $data["action"] ?? "get";

if ($action == "get") {

    $sql = $conn->prepare(
        "SELECT * FROM tasks
         WHERE user_id=?
         ORDER BY id DESC"
    );

    $sql->bind_param("i", $user);
    $sql->execute();

    echo json_encode([
        "success" => true,
        "tasks" => $sql->get_result()->fetch_all(MYSQLI_ASSOC)
    ]);
    exit;
}

if ($action == "save") {
    if ($data["id"] > 0) {
        $sql = $conn->prepare(
            "UPDATE tasks
             SET title=?,subject=?,status=?,notes=?
             WHERE id=? AND user_id=?"
        );
        $sql->bind_param(
            "ssssii",
            $data["title"],
            $data["subject"],
            $data["status"],
            $data["notes"],
            $data["id"],
            $user
        );
    } else {
        $sql = $conn->prepare(
            "INSERT INTO tasks
             (user_id,title,subject,status,notes)
             VALUES(?,?,?,?,?)"
        );
        $sql->bind_param(
            "issss",
            $user,
            $data["title"],
            $data["subject"],
            $data["status"],
            $data["notes"]
        );
    }

    $sql->execute();
    echo json_encode(["success" => true]);
    exit;
}

if ($action == "delete") {
    $sql = $conn->prepare(
        "DELETE FROM tasks
         WHERE id=? AND user_id=?"
    );

    $sql->bind_param("ii", $data["id"], $user);
    $sql->execute();
    echo json_encode(["success" => true]);
    exit;
}


if ($action == "toggle") {
    $sql = $conn->prepare(
        "SELECT status FROM tasks
         WHERE id=? AND user_id=?"
    );

    $sql->bind_param("ii", $data["id"], $user);
    $sql->execute();
    $task = $sql->get_result()->fetch_assoc();

    $next = [
        "Pending" => "In Progress",
        "In Progress" => "Completed",
        "Completed" => "Pending"
    ];
    $status = $next[$task["status"]];
    $sql = $conn->prepare(
        "UPDATE tasks SET status=?
         WHERE id=? AND user_id=?"
    );
    $sql->bind_param(
        "sii",
        $status,
        $data["id"],
        $user
    );
    $sql->execute();
    echo json_encode(["success" => true]);
}
?>