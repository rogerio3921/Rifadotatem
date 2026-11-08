<?php
declare(strict_types=1);

// Dedicated integration fixture support; never use with a real database.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once dirname(__DIR__) . '/api/bootstrap.php';
require_once dirname(__DIR__) . '/api/rules.php';
$config = tatemConfig();
if (!$config['allow_http'] || !preg_match('/dbname=tatem_backend_test(?:;|$)/', $config['dsn'])) {
    throw new RuntimeException('Only the disposable tatem_backend_test database is allowed.');
}
$db = tatemDb($config);
$input = decode(stream_get_contents(STDIN));
if (($input['action'] ?? '') === 'expire') {
    $id = identifier($input['id'] ?? null);
    $db->beginTransaction();
    $db->query('SELECT id FROM app_settings WHERE id = 1 FOR UPDATE')->fetch();
    $query = $db->prepare('SELECT data FROM reservations WHERE id = ?');
    $query->execute([$id]);
    $row = $query->fetch();
    if (!$row) {
        throw new RuntimeException('Fixture missing.');
    }
    $data = decode($row['data']);
    $data['expires'] = nowMillis() - 1;
    $query = $db->prepare('UPDATE reservations SET expires = ?, data = ? WHERE id = ?');
    $query->execute([$data['expires'], encode($data), $id]);
    $db->commit();
    echo '{"ok":true}';
} elseif (($input['action'] ?? '') === 'inspect') {
    echo encode([
        'participants' => $db->query('SELECT owner_hash FROM participants')->fetchAll(PDO::FETCH_COLUMN),
        'limits' => $db->query('SELECT identifier_hash FROM login_limits')->fetchAll(PDO::FETCH_COLUMN),
        'orderCount' => (int) $db->query('SELECT COUNT(*) FROM reservations')->fetchColumn(),
        'adminHash' => $db->query('SELECT password_hash FROM admins LIMIT 1')->fetchColumn(),
        'sequence' => (int) $db->query('SELECT order_sequence FROM app_settings WHERE id = 1')->fetchColumn(),
    ]);
} else {
    invalid('Unknown fixture action.');
}
