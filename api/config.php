<?php
/* Lakeview Guest House MIS - shared configuration.
   Every API file starts with: require __DIR__ . '/config.php'; */

// ---- Database settings (XAMPP defaults) ----
const DB_HOST = 'localhost';
const DB_NAME = 'lakeview_mis';
const DB_USER = 'root';   // default XAMPP user
const DB_PASS = '';       // default XAMPP password is empty

// ---- Session (keeps the user logged in between requests) ----
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// ---- JSON responses for every API file ----
header('Content-Type: application/json; charset=utf-8');

// ---- One shared PDO connection ----
function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $pdo = new PDO(
                'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
                DB_USER,
                DB_PASS,
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
        } catch (PDOException $e) {
            respond(['error' => 'Database connection failed. Is MySQL running and is lakeview_mis imported?'], 500);
        }
    }
    return $pdo;
}

// ---- Send JSON and stop ----
function respond($data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// ---- Read the JSON body sent by fetch() ----
function input(): array {
    $raw = file_get_contents('php://input');
    return $raw ? (json_decode($raw, true) ?? []) : [];
}

// ---- Access control: call at the top of protected API files ----
// Example: require_role(['manager', 'accounts']);
function require_role(array $allowed = []): array {
    if (empty($_SESSION['user'])) {
        respond(['error' => 'Please sign in first.'], 401);
    }
    if ($allowed && !in_array($_SESSION['user']['role'], $allowed, true)) {
        respond(['error' => 'Your role cannot do this.'], 403);
    }
    return $_SESSION['user'];
}
