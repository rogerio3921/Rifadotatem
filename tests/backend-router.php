<?php
declare(strict_types=1);

// Local built-in PHP server router: Apache .htaccess is not honored there.
if (PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
if (preg_match('~(?:^|/)\.~', $path) ||
    preg_match('~^/(?:bin|tests)(?:/|$)~', $path) ||
    (str_starts_with($path, '/api/') && $path !== '/api/index.php')) {
    http_response_code(404);
    exit;
}
return false;
