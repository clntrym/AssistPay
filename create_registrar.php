<?php
$pdo = new PDO('mysql:host=localhost;dbname=assistpay;charset=utf8mb4', 'root', '');
$pwd = password_hash('password', PASSWORD_DEFAULT);
$pdo->exec("INSERT INTO users (username, password_hash, role, full_name, status, must_change_password) VALUES ('registrar', '$pwd', 'REGISTRAR', 'Academic Registrar', 'ACTIVE', 0)");
echo "User created";
