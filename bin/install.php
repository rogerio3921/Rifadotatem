<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/cli.php';

try {
    if ($argc !== 1) {
        throw new ApiError(422, 'Do not pass credentials as command-line arguments.');
    }
    $db = tatemDb(tatemConfig());
    $user = cliUser();
    $hash = password_hash(cliPassword(), PASSWORD_DEFAULT);
    $schema = file_get_contents(dirname(__DIR__) . '/api/schema.sql');
    if ($schema === false) {
        throw new RuntimeException('Schema unavailable.');
    }
    foreach (explode(';', $schema) as $statement) {
        if (trim($statement) !== '') {
            $db->exec($statement);
        }
    }
    $db->beginTransaction();
    $insert = $db->prepare('INSERT IGNORE INTO app_settings (id, settings, order_sequence) VALUES (1, ?, 0)');
    $insert->execute([encode(defaultBackendSettings())]);
    $db->query('SELECT id FROM app_settings WHERE id = 1 FOR UPDATE')->fetch();
    if ((int) $db->query('SELECT COUNT(*) FROM admins')->fetchColumn() !== 0) {
        throw new ApiError(409, 'Already installed. Use bin/change-password.php for recovery. Existing data was not reset.');
    }
    $insert = $db->prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)');
    $insert->execute([$user, $hash]);
    $db->commit();
    fwrite(STDOUT, "Installed. No campaigns seeded. Configure Pix and rules through the admin before accepting reservations.\n");
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    cliFailure($error);
}
