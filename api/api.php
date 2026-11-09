<?php
/* Lakeview Guest House MIS - API
   Called by js/app.js as api/api.php?action=NAME
   Every rule (availability, balances, roles) is enforced here on the server. */
require __DIR__ . '/config.php';

const ROLE_KEY = ['receptionist' => 'reception', 'manager' => 'manager', 'accountant' => 'accounts', 'admin' => 'admin', 'guest' => 'guest'];
const ROLES_ALL = ['receptionist', 'manager', 'accountant', 'admin'];
const FRONT    = ['receptionist', 'manager'];

function fail(string $msg, int $code = 400): void { respond(['error' => $msg], $code); }
function need(array $d, array $keys): void {
    foreach ($keys as $k) if (!isset($d[$k]) || $d[$k] === '') fail("Please fill in: $k");
}
function validDate($d): bool { return is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && strtotime($d) !== false; }
/* Validates and saves an uploaded JPG, PNG or WebP into /uploads.
   Returns the file name, or null when no file was sent. */
function store_image(?array $f, string $prefix): ?string {
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) return null;
    if ($f['error'] !== UPLOAD_ERR_OK) fail('The image could not be uploaded. Try a smaller file.');
    if ($f['size'] > 2 * 1024 * 1024) fail('The image must be under 2 MB.');
    $info = @getimagesize($f['tmp_name']);
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$info['mime'] ?? ''] ?? null;
    if (!$ext) fail('Only JPG, PNG or WebP images are allowed.');
    $dir = dirname(__DIR__) . '/uploads';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $name = $prefix . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], "$dir/$name")) fail('Could not save the image. Check the uploads folder.', 500);
    return $name;
}
function drop_image(?string $name): void {
    $p = dirname(__DIR__) . '/uploads/' . basename((string) $name);
    if ($name && is_file($p)) @unlink($p);
}

function ugx(int $n): string { return 'UGX ' . number_format($n); }

function booking(int $id): array {
    $st = db()->prepare('SELECT * FROM bookings WHERE booking_id = ?');
    $st->execute([$id]);
    $b = $st->fetch();
    if (!$b) fail('Booking not found.', 404);
    return $b;
}

function guestId(int $userId): int {
    $st = db()->prepare('SELECT guest_id FROM guests WHERE user_id = ?');
    $st->execute([$userId]);
    $id = $st->fetchColumn();
    if (!$id) fail('Your guest profile was not found. Please ask the front desk.', 404);
    return (int) $id;
}

/* Amount still owed: room nights + restaurant orders - payments */
function balance(int $id): int {
    $st = db()->prepare(
        "SELECT DATEDIFF(b.check_out, b.check_in) * t.rate
           + COALESCE((SELECT SUM(o.qty * m.price) FROM orders o JOIN menu_items m ON m.item_id = o.item_id WHERE o.booking_id = b.booking_id), 0)
           - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.booking_id), 0)
         FROM bookings b JOIN rooms r ON r.room_id = b.room_id JOIN room_types t ON t.type_id = r.type_id
         WHERE b.booking_id = ?");
    $st->execute([$id]);
    return (int) $st->fetchColumn();
}

/* Everything the screens need, shaped like the old localStorage data */
function snapshot(): array {
    $q = fn(string $sql) => db()->query($sql)->fetchAll();
    $rooms = $q('SELECT room_id AS id, room_no AS no, type_id AS type, maintenance AS maint FROM rooms ORDER BY room_no');
    foreach ($rooms as &$r) { $r['maint'] = (bool) $r['maint']; }
    unset($r);
    return [
        'types'    => $q('SELECT type_id AS id, name, rate, photo FROM room_types ORDER BY type_id'),
        'rooms'    => $rooms,
        'guests'   => $q('SELECT guest_id AS id, name, phone, id_no AS idno FROM guests'),
        'bookings' => $q('SELECT booking_id AS id, guest_id AS guest, room_id AS room, check_in AS `in`, check_out AS `out`, status, source FROM bookings ORDER BY booking_id'),
        'payments' => $q('SELECT payment_id AS id, booking_id AS booking, amount, method, paid_on AS `date` FROM payments'),
        'menu'     => $q('SELECT item_id AS id, name, price, photo FROM menu_items'),
        'orders'   => $q('SELECT order_id AS id, booking_id AS booking, item_id AS item, qty, ordered_on AS `date` FROM orders'),
        'stock'    => $q('SELECT stock_id AS id, item, qty, reorder_level AS `min` FROM inventory'),
    ];
}

$action = $_GET['action'] ?? '';
$d = input() ?: $_POST;
if (!in_array($action, ['data', 'me', 'users', 'g_data', 'feedback_list'], true) && $_SERVER['REQUEST_METHOD'] !== 'POST') fail('Use POST for this action.', 405);

try {
    switch ($action) {

        case 'login':
            need($d, ['username', 'password']);
            $st = db()->prepare('SELECT * FROM users WHERE username = ?');
            $st->execute([strtolower(trim($d['username']))]);
            $u = $st->fetch();
            if (!$u || !password_verify($d['password'], $u['password_hash'])) fail('Wrong username or password. Try again.', 401);
            if (!$u['active']) fail('This account is disabled. Ask the administrator.', 403);
            session_regenerate_id(true);
            $_SESSION['user'] = ['id' => $u['user_id'], 'name' => $u['full_name'], 'role' => $u['role']];
            respond(['role' => ROLE_KEY[$u['role']]]);

        case 'logout':
            $_SESSION = [];
            session_destroy();
            respond(['ok' => true]);

        case 'me':
            $u = require_role();
            respond(['role' => ROLE_KEY[$u['role']], 'name' => $u['name']]);

        case 'data':
            require_role(['receptionist', 'manager', 'accountant', 'admin']);
            respond(snapshot());

        case 'book':
            require_role(FRONT);
            need($d, ['name', 'phone', 'idno', 'room', 'in', 'out']);
            if (!validDate($d['in']) || !validDate($d['out'])) fail('Enter valid dates.');
            if ($d['out'] <= $d['in']) fail('Check-out must be after check-in.');
            if ($d['in'] < date('Y-m-d')) fail('Check-in cannot be in the past.');
            $pdo = db();
            $pdo->beginTransaction();
            $st = $pdo->prepare('SELECT maintenance FROM rooms WHERE room_id = ? FOR UPDATE');
            $st->execute([(int) $d['room']]);
            $room = $st->fetch();
            if (!$room) fail('Room not found.', 404);
            if ($room['maintenance']) fail('That room is under maintenance.');
            $st = $pdo->prepare("SELECT COUNT(*) FROM bookings WHERE room_id = ? AND status IN ('Reserved','Checked in') AND check_in < ? AND check_out > ?");
            $st->execute([(int) $d['room'], $d['out'], $d['in']]);
            if ($st->fetchColumn() > 0) fail('That room is already booked for those dates.');
            $st = $pdo->prepare('SELECT guest_id, name FROM guests WHERE phone = ?');
            $st->execute([trim($d['phone'])]);
            $g = $st->fetch();
            if ($g && strcasecmp(trim($g['name']), trim($d['name'])) !== 0) {
                fail('That phone number is already registered to ' . $g['name'] . '. Use a different phone number, or type the same name.');
            }
            $gid = $g ? $g['guest_id'] : false;
            if (!$gid) {
                $pdo->prepare('INSERT INTO guests (name, phone, id_no) VALUES (?,?,?)')->execute([trim($d['name']), trim($d['phone']), trim($d['idno'])]);
                $gid = $pdo->lastInsertId();
            }
            $pdo->prepare("INSERT INTO bookings (guest_id, room_id, check_in, check_out, status) VALUES (?,?,?,?, 'Reserved')")
                ->execute([$gid, (int) $d['room'], $d['in'], $d['out']]);
            $pdo->commit();
            respond(['ok' => true]);

        case 'checkin':
            require_role(FRONT);
            need($d, ['booking']);
            $b = booking((int) $d['booking']);
            if ($b['status'] !== 'Reserved') fail('Only a reserved booking can be checked in.');
            $st = db()->prepare("SELECT COUNT(*) FROM bookings WHERE room_id = ? AND status = 'Checked in'");
            $st->execute([$b['room_id']]);
            if ($st->fetchColumn() > 0) fail('That room still has a guest checked in.');
            db()->prepare("UPDATE bookings SET status = 'Checked in' WHERE booking_id = ?")->execute([$b['booking_id']]);
            respond(['ok' => true]);

        case 'checkout':
            require_role(FRONT);
            need($d, ['booking']);
            $b = booking((int) $d['booking']);
            if ($b['status'] !== 'Checked in') fail('Only a checked-in guest can be checked out.');
            $bal = balance((int) $b['booking_id']);
            if ($bal > 0) fail('Clear the ' . ugx($bal) . ' balance in Billing before checkout.');
            db()->prepare("UPDATE bookings SET status = 'Checked out' WHERE booking_id = ?")->execute([$b['booking_id']]);
            respond(['ok' => true]);

        case 'cancel':
            require_role(FRONT);
            need($d, ['booking']);
            $b = booking((int) $d['booking']);
            if ($b['status'] !== 'Reserved') fail('Only a reserved booking can be cancelled.');
            db()->prepare("UPDATE bookings SET status = 'Cancelled' WHERE booking_id = ?")->execute([$b['booking_id']]);
            respond(['ok' => true]);

        case 'pay':
            require_role(['receptionist', 'manager', 'accountant']);
            need($d, ['booking', 'amount', 'method']);
            $amt = (int) $d['amount'];
            if ($amt < 1) fail('Enter an amount above zero.');
            if (!in_array($d['method'], ['Cash', 'Mobile Money', 'Card'], true)) fail('Choose a valid payment method.');
            $b = booking((int) $d['booking']);
            if (!in_array($b['status'], ['Checked in', 'Checked out'], true)) fail('Payments are taken for guests in house.');
            if ($amt > max(0, balance((int) $b['booking_id']))) fail('Payment is more than the balance due.');
            db()->prepare('INSERT INTO payments (booking_id, amount, method, paid_on) VALUES (?,?,?, CURDATE())')
                ->execute([$b['booking_id'], $amt, $d['method']]);
            respond(['ok' => true]);

        case 'order':
            require_role(FRONT);
            need($d, ['booking', 'item', 'qty']);
            $qty = (int) $d['qty'];
            if ($qty < 1 || $qty > 100) fail('Quantity must be between 1 and 100.');
            $b = booking((int) $d['booking']);
            if ($b['status'] !== 'Checked in') fail('Orders can only be charged to a guest in house.');
            db()->prepare('INSERT INTO orders (booking_id, item_id, qty, ordered_on) VALUES (?,?,?, CURDATE())')
                ->execute([$b['booking_id'], (int) $d['item'], $qty]);
            respond(['ok' => true]);

        case 'stock':
            require_role(['manager']);
            need($d, ['item', 'delta']);
            $delta = (int) $d['delta'];
            if ($delta === 0) fail('Enter a quantity above zero.');
            $st = db()->prepare('UPDATE inventory SET qty = qty + ? WHERE stock_id = ? AND qty + ? >= 0');
            $st->execute([$delta, (int) $d['item'], $delta]);
            if ($st->rowCount() === 0) fail('Not enough stock to issue that quantity.');
            respond(['ok' => true]);

        case 'addroom':
            require_role(['manager']);
            need($d, ['no', 'type']);
            $no = trim($d['no']);
            $st = db()->prepare('SELECT COUNT(*) FROM rooms WHERE room_no = ?');
            $st->execute([$no]);
            if ($st->fetchColumn() > 0) fail('That room number already exists.');
            db()->prepare('INSERT INTO rooms (room_no, type_id) VALUES (?,?)')->execute([$no, (int) $d['type']]);
            respond(['ok' => true]);

        case 'maint':
            require_role(['manager']);
            need($d, ['room']);
            $st = db()->prepare("SELECT COUNT(*) FROM bookings WHERE room_id = ? AND status = 'Checked in'");
            $st->execute([(int) $d['room']]);
            if ($st->fetchColumn() > 0) fail('A guest is in that room right now.');
            db()->prepare('UPDATE rooms SET maintenance = 1 - maintenance WHERE room_id = ?')->execute([(int) $d['room']]);
            respond(['ok' => true]);

        /* ---------- Guest accounts ---------- */
        case 'register':
            need($d, ['name', 'phone', 'idno', 'username', 'password']);
            $uname = strtolower(trim($d['username']));
            $phone = trim($d['phone']);
            if (!preg_match('/^[a-z0-9_]{3,30}$/', $uname)) fail('Username: 3 to 30 lowercase letters, numbers or underscores.');
            if (!preg_match('/^[0-9+ ]{9,15}$/', $phone)) fail('Enter a valid phone number.');
            if (strlen($d['password']) < 6) fail('Password must be at least 6 characters.');
            $pdo = db();
            $pdo->beginTransaction();
            $st = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = ?');
            $st->execute([$uname]);
            if ($st->fetchColumn() > 0) fail('That username is already taken.');
            $pdo->prepare("INSERT INTO users (full_name, username, password_hash, role) VALUES (?,?,?, 'guest')")
                ->execute([trim($d['name']), $uname, password_hash($d['password'], PASSWORD_DEFAULT)]);
            $uid = (int) $pdo->lastInsertId();
            $st = $pdo->prepare('SELECT guest_id, user_id, name, id_no FROM guests WHERE phone = ? FOR UPDATE');
            $st->execute([$phone]);
            $g = $st->fetch();
            if ($g) {
                if ($g['user_id']) fail('That phone number already has an account. Please sign in.');
                $same = strcasecmp(trim($g['name']), trim($d['name'])) === 0 && strcasecmp(trim($g['id_no']), trim($d['idno'])) === 0;
                if (!$same) fail('That phone number is already on file for another guest. Use a different number, or give the exact name and ID the front desk recorded.');
                $pdo->prepare('UPDATE guests SET user_id = ? WHERE guest_id = ?')->execute([$uid, $g['guest_id']]);
            } else {
                $pdo->prepare('INSERT INTO guests (name, phone, id_no, user_id) VALUES (?,?,?,?)')
                    ->execute([trim($d['name']), $phone, trim($d['idno']), $uid]);
            }
            $pdo->commit();
            session_regenerate_id(true);
            $_SESSION['user'] = ['id' => $uid, 'name' => trim($d['name']), 'role' => 'guest'];
            respond(['role' => 'guest']);

        case 'g_data':
            $u = require_role(['guest']);
            $gid = guestId((int) $u['id']);
            $st = db()->prepare(
                "SELECT b.booking_id AS id, r.room_no AS room, t.name AS type, b.check_in AS `in`, b.check_out AS `out`, b.status,
                        DATEDIFF(b.check_out, b.check_in) * t.rate
                        + COALESCE((SELECT SUM(o.qty * m.price) FROM orders o JOIN menu_items m ON m.item_id = o.item_id WHERE o.booking_id = b.booking_id), 0) AS total,
                        f.rating, f.`comment` AS `comment`
                 FROM bookings b
                 JOIN rooms r ON r.room_id = b.room_id
                 JOIN room_types t ON t.type_id = r.type_id
                 LEFT JOIN feedback f ON f.booking_id = b.booking_id
                 WHERE b.guest_id = ? ORDER BY b.booking_id DESC");
            $st->execute([$gid]);
            respond([
                'me'       => ['name' => $u['name']],
                'types'    => db()->query('SELECT type_id AS id, name, rate, photo FROM room_types ORDER BY type_id')->fetchAll(),
                'menu'     => db()->query('SELECT item_id AS id, name, price, photo FROM menu_items ORDER BY item_id')->fetchAll(),
                'bookings' => $st->fetchAll(),
            ]);

        case 'g_book':
            $u = require_role(['guest']);
            need($d, ['type', 'in', 'out']);
            if (!validDate($d['in']) || !validDate($d['out'])) fail('Enter valid dates.');
            if ($d['out'] <= $d['in']) fail('Check-out must be after check-in.');
            if ($d['in'] < date('Y-m-d')) fail('Check-in cannot be in the past.');
            if ((strtotime($d['out']) - strtotime($d['in'])) / 86400 > 60) fail('Online bookings are limited to 60 nights.');
            $gid = guestId((int) $u['id']);
            $pdo = db();
            $pdo->beginTransaction();
            $st = $pdo->prepare(
                "SELECT r.room_id FROM rooms r
                 WHERE r.type_id = ? AND r.maintenance = 0
                   AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.room_id AND b.status IN ('Reserved','Checked in') AND b.check_in < ? AND b.check_out > ?)
                 ORDER BY r.room_no LIMIT 1 FOR UPDATE");
            $st->execute([(int) $d['type'], $d['out'], $d['in']]);
            $rid = $st->fetchColumn();
            if (!$rid) fail('Sorry, no room of that type is free for those dates. Try other dates or another room type.');
            $pdo->prepare("INSERT INTO bookings (guest_id, room_id, check_in, check_out, status, source) VALUES (?,?,?,?, 'Reserved', 'Online')")
                ->execute([$gid, $rid, $d['in'], $d['out']]);
            $pdo->commit();
            respond(['ok' => true]);

        case 'g_avail':
            require_role(['guest']);
            need($d, ['in', 'out']);
            if (!validDate($d['in']) || !validDate($d['out']) || $d['out'] <= $d['in']) fail('Choose valid dates.');
            $st = db()->prepare(
                "SELECT t.type_id AS id, COUNT(r.room_id) AS total,
                        COALESCE(SUM(CASE WHEN r.maintenance = 0 AND NOT EXISTS (
                            SELECT 1 FROM bookings b WHERE b.room_id = r.room_id AND b.status IN ('Reserved','Checked in')
                              AND b.check_in < ? AND b.check_out > ?) THEN 1 ELSE 0 END), 0) AS free
                 FROM room_types t LEFT JOIN rooms r ON r.type_id = t.type_id GROUP BY t.type_id");
            $st->execute([$d['out'], $d['in']]);
            respond(array_map(fn($r) => ['id' => (int) $r['id'], 'total' => (int) $r['total'], 'free' => (int) $r['free']], $st->fetchAll()));

        case 'g_cancel':
            $u = require_role(['guest']);
            need($d, ['booking']);
            $st = db()->prepare("UPDATE bookings SET status = 'Cancelled' WHERE booking_id = ? AND guest_id = ? AND status = 'Reserved'");
            $st->execute([(int) $d['booking'], guestId((int) $u['id'])]);
            if ($st->rowCount() === 0) fail('Only your own reserved bookings can be cancelled.');
            respond(['ok' => true]);

        case 'g_feedback':
            $u = require_role(['guest']);
            need($d, ['booking', 'rating']);
            $rating = (int) $d['rating'];
            if ($rating < 1 || $rating > 5) fail('Choose a rating from 1 to 5 stars.');
            $comment = trim((string) ($d['comment'] ?? ''));
            $comment = function_exists('mb_substr') ? mb_substr($comment, 0, 1000) : substr($comment, 0, 1000);
            $gid = guestId((int) $u['id']);
            $st = db()->prepare('SELECT status FROM bookings WHERE booking_id = ? AND guest_id = ?');
            $st->execute([(int) $d['booking'], $gid]);
            $status = $st->fetchColumn();
            if (!$status) fail('Stay not found.', 404);
            if ($status !== 'Checked out') fail('You can rate a stay after you have checked out.');
            db()->prepare('INSERT INTO feedback (booking_id, guest_id, rating, `comment`) VALUES (?,?,?,?)
                           ON DUPLICATE KEY UPDATE rating = VALUES(rating), `comment` = VALUES(`comment`)')
                ->execute([(int) $d['booking'], $gid, $rating, $comment]);
            respond(['ok' => true]);

        /* Managers and admins can only READ feedback; there is no edit or delete for staff */
        case 'feedback_list':
            require_role(['manager', 'admin']);
            respond(db()->query(
                "SELECT f.feedback_id AS id, g.name AS guest, r.room_no AS room, t.name AS type, b.check_in AS `in`, b.check_out AS `out`,
                        f.rating, f.`comment` AS `comment`, f.created_at AS created, f.updated_at AS updated
                 FROM feedback f
                 JOIN guests g ON g.guest_id = f.guest_id
                 JOIN bookings b ON b.booking_id = f.booking_id
                 JOIN rooms r ON r.room_id = b.room_id
                 JOIN room_types t ON t.type_id = r.type_id
                 ORDER BY f.updated_at DESC")->fetchAll());

        case 'purge_cancelled':
            require_role(['manager']);
            $pdo = db();
            $pdo->beginTransaction();
            $n = $pdo->exec("DELETE FROM bookings WHERE status = 'Cancelled'
                AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = bookings.booking_id)
                AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.booking_id = bookings.booking_id)
                AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.booking_id = bookings.booking_id)");
            $pdo->exec("DELETE FROM guests WHERE user_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.guest_id = guests.guest_id)
                AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.guest_id = guests.guest_id)");
            $pdo->commit();
            respond(['deleted' => (int) $n]);

        /* ---------- Admin only ---------- */
        case 'users':
            require_role(['admin']);
            respond(db()->query('SELECT user_id AS id, full_name AS name, username, role, active FROM users ORDER BY user_id')->fetchAll());

        case 'user_add':
            require_role(['admin']);
            need($d, ['name', 'username', 'role', 'password']);
            $uname = strtolower(trim($d['username']));
            if (!preg_match('/^[a-z0-9_]{3,30}$/', $uname)) fail('Username: 3 to 30 lowercase letters, numbers or underscores.');
            if (!in_array($d['role'], ROLES_ALL, true)) fail('Choose a valid role.');
            if (strlen($d['password']) < 6) fail('Password must be at least 6 characters.');
            $st = db()->prepare('SELECT COUNT(*) FROM users WHERE username = ?');
            $st->execute([$uname]);
            if ($st->fetchColumn() > 0) fail('That username is already taken.');
            db()->prepare('INSERT INTO users (full_name, username, password_hash, role) VALUES (?,?,?,?)')
                ->execute([trim($d['name']), $uname, password_hash($d['password'], PASSWORD_DEFAULT), $d['role']]);
            respond(['ok' => true]);

        case 'user_update':
            $me = require_role(['admin']);
            need($d, ['id']);
            $id = (int) $d['id'];
            $st = db()->prepare('SELECT COUNT(*) FROM users WHERE user_id = ?');
            $st->execute([$id]);
            if (!$st->fetchColumn()) fail('User not found.', 404);
            $self = $id === (int) $me['id'];
            if ($self && ((isset($d['active']) && !$d['active']) || (isset($d['role']) && $d['role'] !== 'admin'))) {
                fail('You cannot disable or demote your own account.');
            }
            if (isset($d['role'])) {
                if (!in_array($d['role'], ROLES_ALL, true)) fail('Choose a valid role.');
                db()->prepare('UPDATE users SET role = ? WHERE user_id = ?')->execute([$d['role'], $id]);
            }
            if (isset($d['active'])) {
                db()->prepare('UPDATE users SET active = ? WHERE user_id = ?')->execute([$d['active'] ? 1 : 0, $id]);
            }
            if (!empty($d['password'])) {
                if (strlen($d['password']) < 6) fail('Password must be at least 6 characters.');
                db()->prepare('UPDATE users SET password_hash = ? WHERE user_id = ?')->execute([password_hash($d['password'], PASSWORD_DEFAULT), $id]);
            }
            respond(['ok' => true]);

        case 'type_update':
            require_role(['admin']);
            need($d, ['id', 'rate']);
            if ((int) $d['rate'] < 1000) fail('Enter a rate of at least UGX 1,000.');
            db()->prepare('UPDATE room_types SET rate = ? WHERE type_id = ?')->execute([(int) $d['rate'], (int) $d['id']]);
            respond(['ok' => true]);

        case 'type_photo':
            require_role(['admin', 'manager']);
            $tid = (int) ($_POST['type'] ?? 0);
            $st = db()->prepare('SELECT photo FROM room_types WHERE type_id = ?');
            $st->execute([$tid]);
            $row = $st->fetch();
            if (!$row) fail('Room type not found.', 404);
            $f = $_FILES['photo'] ?? null;
            if (!$f || $f['error'] !== UPLOAD_ERR_OK) fail('Choose an image to upload.');
            if ($f['size'] > 2 * 1024 * 1024) fail('The image must be under 2 MB.');
            $info = @getimagesize($f['tmp_name']);
            $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$info['mime'] ?? ''] ?? null;
            if (!$ext) fail('Only JPG, PNG or WebP images are allowed.');
            $dir = dirname(__DIR__) . '/uploads';
            if (!is_dir($dir)) mkdir($dir, 0755, true);
            $name = 'type' . $tid . '_' . time() . '.' . $ext;
            if (!move_uploaded_file($f['tmp_name'], "$dir/$name")) fail('Could not save the image. Check the uploads folder.', 500);
            if ($row['photo'] && is_file("$dir/" . basename($row['photo']))) @unlink("$dir/" . basename($row['photo']));
            db()->prepare('UPDATE room_types SET photo = ? WHERE type_id = ?')->execute([$name, $tid]);
            respond(['ok' => true]);

        case 'menu_add':
            require_role(['admin']);
            need($d, ['name', 'price']);
            if ((int) $d['price'] < 500) fail('Enter a price of at least UGX 500.');
            $photo = store_image($_FILES['photo'] ?? null, 'menu');
            db()->prepare('INSERT INTO menu_items (name, price, photo) VALUES (?,?,?)')->execute([trim($d['name']), (int) $d['price'], $photo]);
            respond(['ok' => true]);

        case 'menu_update':
            require_role(['admin']);
            need($d, ['id', 'price']);
            if ((int) $d['price'] < 500) fail('Enter a price of at least UGX 500.');
            db()->prepare('UPDATE menu_items SET price = ? WHERE item_id = ?')->execute([(int) $d['price'], (int) $d['id']]);
            respond(['ok' => true]);

        case 'menu_photo':
            require_role(['admin']);
            need($d, ['id']);
            $st = db()->prepare('SELECT photo FROM menu_items WHERE item_id = ?');
            $st->execute([(int) $d['id']]);
            $row = $st->fetch();
            if (!$row) fail('Menu item not found.', 404);
            $name = store_image($_FILES['photo'] ?? null, 'menu');
            if (!$name) fail('Choose an image to upload.');
            drop_image($row['photo']);
            db()->prepare('UPDATE menu_items SET photo = ? WHERE item_id = ?')->execute([$name, (int) $d['id']]);
            respond(['ok' => true]);

        default:
            fail('Unknown action.', 404);
    }
} catch (PDOException $e) {
    fail('Database error. Check that the invoice, room and item you chose still exist, then try again.', 500);
}
