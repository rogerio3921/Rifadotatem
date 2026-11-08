#!/usr/bin/env python3
"""Initialize a disposable local database after starting MariaDB; no secret args.

Run from repository root with /usr/bin/php and MariaDB available:
  python3 tests/backend-setup.py
MariaDB must be listening on 127.0.0.1:3307, and root accessible through the
relative .backend-local/mysql.sock socket. Refuses existing test databases.
Writes ../tatem-config.php and ../tatem-test-credentials.json outside web root.
Never use this on a shared/production DB.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
CONFIG = ROOT.parent / "tatem-config.php"
if CONFIG.exists():
    raise SystemExit("External config already exists; refusing to overwrite.")
LOCAL = ROOT / ".backend-local"
LOCAL.mkdir(mode=0o700, exist_ok=True)
db_password = secrets.token_hex(24)
admin_password = secrets.token_urlsafe(24)
database = "tatem_backend_test"
sql = f"""
CREATE DATABASE {database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'tatem_backend_test'@'127.0.0.1' IDENTIFIED BY '{db_password}';
GRANT ALL PRIVILEGES ON {database}.* TO 'tatem_backend_test'@'127.0.0.1';
"""
subprocess.run(["mariadb", "--no-defaults", "--socket=.backend-local/mysql.sock", "-u", "root"],
               input=sql, text=True, check=True, stdout=subprocess.DEVNULL)
config_text = f"""<?php
return [
    'dsn' => 'mysql:host=127.0.0.1;port=3307;dbname={database};charset=utf8mb4',
    'db_user' => 'tatem_backend_test',
    'db_password' => '{db_password}',
    'origin' => 'http://127.0.0.1:8877',
    'allow_http' => true,
    'admin_idle_seconds' => 60,
];
"""
with os.fdopen(os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as out:
    out.write(config_text)
credentials = ROOT.parent / "tatem-test-credentials.json"
with os.fdopen(os.open(credentials, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as out:
    json.dump({"user": "backend-admin", "password": admin_password}, out)
env = dict(os.environ, TATEM_CONFIG=str(CONFIG), TATEM_ADMIN_USER="backend-admin",
           TATEM_ADMIN_PASSWORD=admin_password)
subprocess.run(["/usr/bin/php", "bin/install.php"], env=env, check=True)
print("Ready: private config ../tatem-config.php; test credentials ../tatem-test-credentials.json")
