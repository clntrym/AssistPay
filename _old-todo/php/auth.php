<?php
require "../config/config.php";
header("Content-Type: application/json");

$data = json_decode(file_get_contents("php://input"), true);
$action = $data["action"] ?? "";

if ($action == "register") {
    $u = $data["username"];
    $e = $data["email"];
    $p = password_hash($data["password"], PASSWORD_DEFAULT);
    $sql = $conn->prepare(
        "INSERT INTO users(username,email,password) VALUES(?,?,?)"
    );

    $sql->bind_param("sss", $u, $e, $p);

    if ($sql->execute()) {
        $_SESSION["user_id"] = $sql->insert_id;
        echo json_encode(["success" => true]);
    } else {
        echo json_encode([
            "success" => false,
            "message" => "Username or email already exists"
        ]);
    }

    exit;
}


if ($action == "login") {
    $login = $data["login"];

    $sql = $conn->prepare(
        "SELECT * FROM users
         WHERE username=? OR email=?"
    );

    $sql->bind_param("ss", $login, $login);
    $sql->execute();
    $user = $sql->get_result()->fetch_assoc();

    if ($user && password_verify($data["password"], $user["password"])) {
        $_SESSION["user_id"] = $user["id"];
        echo json_encode([
            "success" => true,
            "user" => $user["username"]
        ]);
    } else {
        echo json_encode([
            "success" => false,
            "message" => "Invalid username or password"
        ]);
    }
    exit;
}


if ($action == "logout") {
    session_destroy();
    echo json_encode(["success" => true]);
}
?>