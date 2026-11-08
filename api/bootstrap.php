<?php
declare(strict_types=1);

function tatemConfig(): array
{
    $path = getenv('TATEM_CONFIG') ?: dirname(__DIR__, 2) . '/tatem-config.php';
    $real = realpath($path);
    $webRoot = realpath(dirname(__DIR__));
    if (!$real || ($webRoot && ($real === $webRoot || str_starts_with($real, $webRoot . DIRECTORY_SEPARATOR)))) {
        throw new RuntimeException('External configuration unavailable.');
    }
    $config = require $real;
    if (!is_array($config) || !is_string($config['dsn'] ?? null) ||
        !str_starts_with($config['dsn'], 'mysql:') ||
        !str_contains($config['dsn'], 'charset=utf8mb4') ||
        !is_string($config['db_user'] ?? null) || !is_string($config['db_password'] ?? null) ||
        !is_string($config['origin'] ?? null) ||
        !preg_match('~^https?://[a-zA-Z0-9.\[\]:-]+$~D', $config['origin']) ||
        !is_bool($config['allow_http'] ?? false) ||
        (!(($config['allow_http'] ?? false)) && !str_starts_with($config['origin'], 'https://'))) {
        throw new RuntimeException('Invalid external configuration.');
    }
    $config['allow_http'] ??= false;
    $config['admin_idle_seconds'] ??= 1800;
    if (!is_int($config['admin_idle_seconds']) || $config['admin_idle_seconds'] < 60 ||
        $config['admin_idle_seconds'] > 86400) {
        throw new RuntimeException('Invalid session configuration.');
    }
    return $config;
}

function tatemDb(array $config): PDO
{
    return new PDO($config['dsn'], $config['db_user'], $config['db_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function tatemLog(Throwable $error): void
{
    // Do not log exception messages, request payloads, configuration or SQL.
    error_log('Tatem backend failure: ' . get_class($error));
}
