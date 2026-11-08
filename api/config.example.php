<?php
// Copy OUTSIDE public_html as tatem-config.php. Never use real credentials here.
return [
    'dsn' => 'mysql:host=localhost;dbname=YOUR_DATABASE;charset=utf8mb4',
    'db_user' => 'YOUR_DATABASE_USER',
    'db_password' => 'YOUR_DATABASE_PASSWORD',
    'origin' => 'https://YOUR_DOMAIN',
    'allow_http' => false, // true ONLY for a local development server
    'admin_idle_seconds' => 1800,
];
