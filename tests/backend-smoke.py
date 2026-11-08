#!/usr/bin/env python3
"""Repeatable image/router/installer checks after backend-integration.py.

TATEM_TEST_DISPOSABLE=yes python3 tests/backend-smoke.py
Uses the same local, external private fixture configuration and credentials.
Never deletes orders or existing campaigns; creates/deletes one unreserved
test campaign only.
"""
import base64
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
if os.environ.get("TATEM_TEST_DISPOSABLE") != "yes":
    raise SystemExit("Set TATEM_TEST_DISPOSABLE=yes for disposable local testing only.")
PHP = os.environ.get("TATEM_TEST_PHP", "/usr/bin/php")
subprocess.run([PHP, "tests/backend-db.php"], input='{"action":"inspect"}',
               text=True, check=True, stdout=subprocess.DEVNULL)
credentials = json.loads((ROOT.parent / "tatem-test-credentials.json").read_text())
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
base = "http://127.0.0.1:8877"
csrf = None
checks = 0


def request(data=None, expected=200):
    global csrf, checks
    headers = {"Content-Type": "application/json", "X-CSRF-Token": csrf or ""}
    req = urllib.request.Request(base + "/api/index.php", headers=headers,
                                 data=json.dumps(data).encode() if data else None)
    try:
        response = opener.open(req)
    except urllib.error.HTTPError as error:
        response = error
    result = json.loads(response.read())
    assert response.status == expected, result.get("error")
    checks += 1
    if expected == 200:
        csrf = result["csrf"]
    return result


request()
request({"action": "login", "user": credentials["user"], "password": credentials["password"]})
png = subprocess.check_output([PHP, "-r", "$i=imagecreatetruecolor(2,2); imagepng($i);"])
cover = "data:image/png;base64," + base64.b64encode(png).decode()
fields = {"name": "Repeatable image smoke", "desc": "", "prize": "Local testing only",
          "price": 1, "date": "", "count": 1, "minimum": 50, "cover": cover}
created = request({"action": "campaign-save", "campaign": fields, "create": True})
campaign = next(row for row in created["campaigns"] if row["name"] == fields["name"])
assert campaign["cover"] == cover
checks += 1
bad = "data:image/png;base64," + base64.b64encode(b"not an image").decode()
request({"action": "campaign-save", "campaign": {**fields, "cover": bad}, "create": True}, 422)
broken = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6bmQAAAAASUVORK5CYII="
request({"action": "campaign-save", "campaign": {**fields, "cover": broken}, "create": True}, 422)
request({"action": "campaign-delete", "id": campaign["id"]})
before = subprocess.check_output([PHP, "tests/backend-db.php"], input=b'{"action":"inspect"}')
env = dict(os.environ, TATEM_ADMIN_USER=credentials["user"], TATEM_ADMIN_PASSWORD=credentials["password"])
installed = subprocess.run([PHP, "bin/install.php"], env=env, text=True, capture_output=True)
assert installed.returncode == 1 and "Already installed" in installed.stderr
after = subprocess.check_output([PHP, "tests/backend-db.php"], input=b'{"action":"inspect"}')
assert before == after
checks += 2
for path in ["/api/config.example.php", "/api/schema.sql", "/api/service.php",
             "/bin/install.php", "/.backend-local/packages.log", "/tests/backend-db.php"]:
    try:
        opener.open(base + path)
    except urllib.error.HTTPError as error:
        assert error.code == 404
        checks += 1
    else:
        raise AssertionError("Private source was accessible")
print(f"OK: {checks} repeatable live image/privacy/installer checks")
