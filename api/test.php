<?php
require __DIR__ . '/config.php';
$counts = [];
foreach (['users','guests','room_types','rooms','bookings','payments','menu_items','orders','suppliers','inventory'] as $t) {
    $counts[$t] = (int) db()->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
}
respond(['status' => 'Connected to ' . DB_NAME, 'row_counts' => $counts]);
