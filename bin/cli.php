<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once dirname(__DIR__) . '/api/bootstrap.php';
require_once dirname(__DIR__) . '/api/rules.php';

function cliUser(): string
{
    $user = getenv('TATEM_ADMIN_USER');
    if ($user === false) {
        fwrite(STDOUT, 'Admin username: ');
        $user = fgets(STDIN);
    }
    return text($user === false ? '' : $user, 80);
}

function secretPrompt(string $label): string
{
    if (!function_exists('stream_isatty') || !stream_isatty(STDIN) || !function_exists('exec')) {
        throw new RuntimeException('Use an interactive terminal or explicitly set TATEM_ADMIN_PASSWORD in the environment.');
    }
    $output = [];
    exec('stty -g 2>/dev/null', $output, $status);
    if ($status !== 0 || count($output) !== 1) {
        throw new RuntimeException('Cannot disable password echo. Use TATEM_ADMIN_PASSWORD instead.');
    }
    $mode = $output[0];
    exec('stty -echo 2>/dev/null', $ignored, $status);
    if ($status !== 0) {
        throw new RuntimeException('Cannot disable password echo.');
    }
    $restore = static function () use ($mode): void {
        exec('stty ' . escapeshellarg($mode) . ' 2>/dev/null');
    };
    register_shutdown_function($restore);
    try {
        fwrite(STDOUT, $label);
        $line = fgets(STDIN);
        fwrite(STDOUT, PHP_EOL);
        if ($line === false) {
            throw new RuntimeException('Password input unavailable.');
        }
        return rtrim($line, "\r\n");
    } finally {
        $restore();
    }
}

function cliPassword(): string
{
    $password = getenv('TATEM_ADMIN_PASSWORD');
    if ($password !== false) {
        putenv('TATEM_ADMIN_PASSWORD');
        unset($_ENV['TATEM_ADMIN_PASSWORD'], $_SERVER['TATEM_ADMIN_PASSWORD']);
        return passwordValue($password);
    }
    $password = secretPrompt('New password (12–72 bytes): ');
    if (!hash_equals($password, secretPrompt('Repeat password: '))) {
        throw new RuntimeException('Passwords do not match.');
    }
    return passwordValue($password);
}

function cliFailure(Throwable $error): never
{
    // Safe validation messages only; PDO/config exceptions may contain secrets.
    if ($error instanceof ApiError) {
        fwrite(STDERR, $error->getMessage() . PHP_EOL);
    } else {
        tatemLog($error);
        fwrite(STDERR, "Failed. Check external configuration, permissions, PHP extensions and database access.\n");
    }
    exit(1);
}
