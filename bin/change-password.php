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
    $db->beginTransaction();
    if (!$db->query('SELECT id FROM app_settings WHERE id = 1 FOR UPDATE')->fetch()) {
        throw new ApiError(409, 'Install the database first.');
    }
    $update = $db->prepare('UPDATE admins SET password_hash = ?, auth_version = auth_version + 1 WHERE username = ?');
    $update->execute([$hash, $user]);
    if ($update->rowCount() !== 1) {
        throw new ApiError(404, 'Admin not found.');
    }
    $clear = $db->prepare('DELETE FROM login_limits WHERE identifier_hash = ?');
    $clear->execute([hash('sha256', 'account:' . strtolower($user))]);
    $db->commit();
    fwrite(STDOUT, "Password changed. All admin sessions invalidated; no campaign or order history changed.\n");
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    cliFailure($error);
}
