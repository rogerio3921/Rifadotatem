<?php
declare(strict_types=1);

ini_set('display_errors', '0');
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/service.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
header('Referrer-Policy: no-referrer');

try {
    $config = tatemConfig();
    $secure = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
    if (!$config['allow_http'] && !$secure) {
        throw new ApiError(403, 'HTTPS é obrigatório.');
    }
    if ($secure) {
        header('Strict-Transport-Security: max-age=31536000');
    }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) max(1800, $config['admin_idle_seconds']));
    session_name($secure ? '__Host-TatemSession' : 'TatemSession');
    session_cache_limiter('');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    $ownerCookie = $secure ? '__Host-TatemOwner' : 'TatemOwner';
    $owner = $_COOKIE[$ownerCookie] ?? '';
    if (!is_string($owner) || !preg_match('/^[a-f0-9]{64}$/D', $owner)) {
        $owner = bin2hex(random_bytes(32));
        setcookie($ownerCookie, $owner, [
            'expires' => time() + 31536000, 'path' => '/',
            'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax',
        ]);
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $input = null;
    if ($method === 'POST') {
        if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $config['origin']) {
            throw new ApiError(403, 'Origem não permitida.');
        }
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($token) || !hash_equals($_SESSION['csrf'], $token)) {
            throw new ApiError(403, 'Sessão expirada. Atualize a página antes de tentar novamente.');
        }
        if (!preg_match('~^application/json(?:\s*;\s*charset=utf-8)?$~iD', $_SERVER['CONTENT_TYPE'] ?? '')) {
            throw new ApiError(415, 'Envie JSON com Content-Type application/json.');
        }
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 1048576) {
            throw new ApiError(413, 'Requisição muito grande.');
        }
        $body = file_get_contents('php://input', false, null, 0, 1048577);
        if ($body === false || strlen($body) > 1048576) {
            throw new ApiError(413, 'Requisição muito grande.');
        }
        try {
            $object = json_decode($body, false, 64, JSON_THROW_ON_ERROR);
            if (!$object instanceof stdClass) {
                throw new JsonException();
            }
            $input = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ApiError(400, 'JSON inválido.');
        }
    } elseif ($method !== 'GET') {
        header('Allow: GET, POST');
        throw new ApiError(405, 'Método não permitido.');
    }
    $service = new TatemService(tatemDb($config), hash('sha256', $owner), (string) ($_SERVER['REMOTE_ADDR'] ?? ''), $config['admin_idle_seconds']);
    $response = $service->run($input);
    session_write_close();
    echo encode($response);
} catch (ApiError $error) {
    http_response_code($error->httpStatus);
    if ($error->httpStatus === 429) {
        header('Retry-After: 900');
    }
    echo encode(['error' => $error->getMessage()]);
} catch (Throwable $error) {
    tatemLog($error);
    http_response_code(500);
    echo encode(['error' => 'Serviço indisponível. Tente novamente ou contate o organizador.']);
}
