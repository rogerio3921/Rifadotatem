#!/usr/bin/env python3
"""Real HTTP/PDO/MySQL integration checks; Python standard library only.

REQUIRES an EMPTY disposable DB installed by bin/install.php, PHP pdo_mysql,
and a PHP server with multiple workers for real concurrent requests.
NEVER run against production. Changes the test password, creates durable order
history and configures an obviously nonpayment Pix placeholder for testing.

From repository root, after tests/backend-setup.py and local server startup:
  TATEM_TEST_DISPOSABLE=yes python3 tests/backend-integration.py

Default URL http://127.0.0.1:8877/api/index.php; credentials read from private
../tatem-test-credentials.json (or TATEM_TEST_CREDENTIALS path). External
TATEM_CONFIG/default config must point to tatem_backend_test, allow_http=true,
admin_idle_seconds=60. Fixture subprocesses use TATEM_TEST_PHP=/usr/bin/php.
The password file is safely updated after CLI recovery for subsequent browser
tests. Test scripts are CLI-only; do not publish tests/ to a production site.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
if os.environ.get("TATEM_TEST_DISPOSABLE") != "yes":
    raise SystemExit("Set TATEM_TEST_DISPOSABLE=yes for the EMPTY disposable test database only.")
URL = os.environ.get("TATEM_TEST_URL", "http://127.0.0.1:8877/api/index.php")
if urllib.parse.urlsplit(URL).hostname not in ("127.0.0.1", "localhost"):
    raise SystemExit("Only loopback test URLs are allowed.")
CREDS_PATH = Path(os.environ.get("TATEM_TEST_CREDENTIALS", "../tatem-test-credentials.json"))
CREDS = json.loads(CREDS_PATH.read_text())
PHP = os.environ.get("TATEM_TEST_PHP", "/usr/bin/php")
CHECKS = 0


def check(condition, message):
    global CHECKS
    CHECKS += 1
    if not condition:
        raise AssertionError(message)


class Client:
    def __init__(self, owner=None):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        if owner is not None:
            import copy
            self.jar.set_cookie(copy.copy(owner))
        self.csrf = None
        self.state = None

    def request(self, data=None, code=200, headers=None, raw=None, method=None):
        actual_headers = {}
        if data is not None or raw is not None:
            actual_headers = {"Content-Type": "application/json", "X-CSRF-Token": self.csrf or ""}
        actual_headers.update(headers or {})
        body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
        request = urllib.request.Request(URL, data=body, headers=actual_headers, method=method)
        try:
            response = self.opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        result = json.loads(response.read())
        check(response.status == code, f"Expected HTTP {code}; got {response.status}: {result.get('error', '')}")
        check(response.headers.get("Cache-Control") == "no-store, private", "State must not be cacheable")
        if code == 200:
            check(isinstance(result["serverNow"], int) and abs(result["serverNow"] - time.time() * 1000) < 10000,
                  "Server epoch milliseconds supplied")
            self.csrf = result["csrf"]
            self.state = result
        else:
            check(list(result) == ["error"], "Errors must not leak internal state/config")
        return result

    def post(self, action, code=200, **fields):
        return self.request({"action": action, **fields}, code=code)

    def login(self, password=None):
        return self.post("login", user=CREDS["user"], password=password or CREDS["password"])

    def cookie(self, name):
        return next(cookie for cookie in self.jar if cookie.name == name)


def fixture(action, **fields):
    result = subprocess.run([PHP, "tests/backend-db.php"], input=json.dumps({"action": action, **fields}),
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def reserve(client, campaign, numbers, code=200, request_id=None, **changes):
    fields = {"campaignId": campaign["id"], "numbers": numbers, "name": "Local Test Participant",
              "phone": "+55 (11) 99999-9999", "expectedPrice": campaign["price"],
              "expectedHours": 24, "requestId": request_id or secrets.token_hex(16)}
    fields.update(changes)
    return client.post("reserve", code=code, **fields)


def campaign_by_id(state, identifier):
    return next(campaign for campaign in state["campaigns"] if campaign["id"] == identifier)


admin, participant, stranger = Client(), Client(), Client()
initial = admin.request()
check(not initial["campaigns"] and not initial["reservations"], "Refusing nonempty DB: initialize a fresh disposable database.")
check(initial["settings"]["pixKey"] == "CHAVE-NAO-CONFIGURADA", "Default key must block reservations")
participant.request()
stranger.request()
check(participant.csrf != stranger.csrf, "CSRF must be session-bound")
participant.post("settings-save", code=401, settings=initial["settings"])
participant.post("campaign-save", code=401, campaign={}, create=True)
participant.post("orders-update", code=401, ids=[], status="sold")
participant.request({"action": "logout"}, code=403, headers={"X-CSRF-Token": stranger.csrf})
participant.request({"action": "logout"}, code=403, headers={"Origin": "https://malicious.invalid"})
participant.request(raw=b"{", code=400)
participant.request(raw=b"[]", code=400)
participant.request(raw=b"x" * 1048577, code=413)
participant.request(raw=b"{}", code=415, headers={"Content-Type": "text/plain"})
participant.request(method="DELETE", code=405)
old_session = admin.cookie("TatemSession").value
admin.login()
check(admin.state["admin"], "Real login required")
check(admin.cookie("TatemSession").value != old_session, "Login must regenerate session")
check(admin.cookie("TatemSession").has_nonstandard_attr("HttpOnly"), "Session HttpOnly")
check(participant.cookie("TatemOwner").has_nonstandard_attr("HttpOnly"), "Owner HttpOnly")
check(participant.cookie("TatemOwner").expires > time.time() + 30000000, "Persistent owner cookie")
admin.post("reset", code=400)

campaign_input = {"name": "Local Test Campaign", "desc": "No real payments", "prize": "Test only",
                  "price": 12.34, "date": "", "count": 20, "minimum": 50, "cover": "",
                  "id": "forged", "priceLocked": True, "cancellation": {"reason": "forged"}}
state = admin.post("campaign-save", campaign=campaign_input, create=True)
campaign = state["campaigns"][0]
check(len(campaign["id"]) == 32 and campaign["id"] != "forged", "Server-generated campaign ID")
check(campaign["priceLocked"] is False and "cancellation" not in campaign, "Client security fields ignored")
reserve(participant, campaign, [1], code=409)
settings = {**initial["settings"], "pixKey": "LOCAL-TEST-ONLY-NOT-A-PAYMENT-KEY",
            "organizer": "Local test organizer", "rules": "Local tests only. No real payment.",
            "db_password": "must-not-be-stored", "admin": True}
admin.post("settings-save", settings=settings)
check(set(admin.state["settings"]) == {"pixKey", "organizer", "phone", "rules", "message", "hours"}, "Only public settings retained")
reserve(participant, campaign, [1], code=409, expectedPrice=12.35)
reserve(participant, campaign, [1], code=409, expectedHours=23)
reserve(participant, campaign, [1, 1], code=422)
reserve(participant, campaign, [21], code=422)
attempt = secrets.token_hex(16)
order = reserve(participant, campaign, [1, 2], request_id=attempt,
                total=0, unitPrice=0, created=0, expires=999999999999999, status="sold", id="forged")["order"]
check(order["status"] == "reserved" and order["total"] == 24.68 and order["unitPrice"] == 12.34, "Trusted totals/status")
check(order["id"] != "forged" and order["orderNumber"] == "000001", "Trusted identity and sequence")
check(86399900 <= order["expires"] - order["created"] <= 86400100, "Trusted expiry")
check(order["phone"] == "5511999999999", "Phone normalization")
same = reserve(participant, campaign, [2, 1], request_id=attempt)["order"]
check(same["id"] == order["id"], "Idempotent normalized reserve retry")
reserve(participant, campaign, [3], request_id=attempt, code=409)
reserve(stranger, campaign, [1], code=409)
public = stranger.request()
check(public["reservations"] == [] and public["ownOrderIds"] == [], "Public participant privacy")
check(len(public["occupancy"]) == 2 and all(set(item) == {"campaign", "number", "status"} for item in public["occupancy"]), "Minimal occupancy")
check(order["phone"] not in json.dumps(public), "No phone leaks in occupancy")
owned = participant.request()
check(owned["ownOrderIds"] == [order["id"]] and owned["reservations"][0]["id"] == order["id"], "Owner sees own history")
admin.request()
check(len(admin.state["reservations"]) == 1 and admin.state["ownOrderIds"] == [], "Admin visibility independent from ownership")
locked = campaign_by_id(admin.state, campaign["id"])
admin.post("campaign-save", code=409, campaign={**locked, "price": 13}, create=False)
admin.post("campaign-delete", code=409, id=campaign["id"])
admin.post("campaign-save", code=409, campaign={**locked, "count": 1}, create=False)

# Competing browsers must not allocate the same number, across actual workers.
racers = [Client(), Client()]
for racer in racers:
    racer.request()
barrier = threading.Barrier(2)


def race(client):
    barrier.wait()
    try:
        return reserve(client, campaign, [3])["order"]
    except AssertionError as error:
        if "got 409" not in str(error):
            raise
        return None


with ThreadPoolExecutor(max_workers=2) as pool:
    raced = list(pool.map(race, racers))
check(sum(row is not None for row in raced) == 1, "Exactly one concurrent reservation succeeds")

# Same owner, different sessions, same request: durable idempotency, not PHP session serialization.
copies = [Client(participant.cookie("TatemOwner")), Client(participant.cookie("TatemOwner"))]
for copy in copies:
    copy.request()
same_attempt = secrets.token_hex(16)
barrier = threading.Barrier(2)


def replay_race(client):
    barrier.wait()
    return reserve(client, campaign, [4], request_id=same_attempt)["order"]


with ThreadPoolExecutor(max_workers=2) as pool:
    replays = list(pool.map(replay_race, copies))
check(replays[0]["id"] == replays[1]["id"], "Concurrent idempotency across sessions")
check(fixture("inspect")["orderCount"] == 3, "No hidden duplicate reservation")

expired = reserve(participant, campaign, [5])["order"]
fixture("expire", id=expired["id"])
pending = reserve(participant, campaign, [6])["order"]
admin.post("orders-update", code=409, ids=[pending["id"], expired["id"]], status="sold")
check(next(row for row in admin.request()["reservations"] if row["id"] == pending["id"])["status"] == "reserved", "Failed confirmation batch is atomic")
check(not any(item["number"] == 5 for item in stranger.request()["occupancy"]), "Expired numbers released")
reused = reserve(stranger, campaign, [5])["order"]
admin.post("orders-update", ids=[expired["id"]], status="cancelled")
check(reserve(participant, campaign, [5], request_id=expired.get("requestId", "unused"), code=422).get("error"), "Short request IDs rejected")
admin.post("orders-update", ids=[order["id"], pending["id"]], status="sold")
sold = next(row for row in admin.state["reservations"] if row["id"] == order["id"])
check(sold["status"] == "sold" and sold["confirmed"] >= sold["created"], "Manual confirmation timestamp")
admin.post("orders-update", code=409, ids=[order["id"]], status="cancelled")
admin.post("orders-update", code=422, ids=[reused["id"], reused["id"]], status="sold")
admin.post("orders-update", code=409, ids=[reused["id"], "a" * 32], status="sold")

# Price lock survives cancellation/expiry and campaign cancellation keeps sold history.
admin.post("orders-update", ids=[reused["id"]], status="cancelled")
admin.post("campaign-save", code=409, campaign={**locked, "price": 13}, create=False)
admin.post("campaign-cancel", code=422, id=campaign["id"], reason="Test cancellation", refundAcknowledged=False)
admin.post("campaign-cancel", id=campaign["id"], reason="Local test; refunds remain manual", refundAcknowledged=True)
cancelled = campaign_by_id(admin.state, campaign["id"])
check(cancelled["cancellation"]["refundAcknowledged"] is True, "Cancellation responsibility recorded")
check(next(row for row in admin.state["reservations"] if row["id"] == order["id"])["status"] == "sold", "Cancellation preserves paid history")
admin.post("orders-update", code=409, ids=[replays[0]["id"]], status="sold")
reserve(stranger, campaign, [7], code=409)
check(stranger.request()["occupancy"] == [], "Cancelled campaign contributes no occupancy")
check(len(participant.request()["campaigns"]) == 1, "Cancelled campaign visible in own history")
unrelated = Client()
check(unrelated.request()["campaigns"] == [], "Unrelated browser cannot see cancelled campaign")
check(reserve(participant, campaign, [1, 2], request_id=attempt)["order"]["campaignCancellation"] == cancelled["cancellation"], "Idempotent historical replay includes cancellation")
session_before = participant.cookie("TatemSession").value
participant.post("logout")
check(participant.cookie("TatemSession").value != session_before, "Logout regenerates session")
check(order["id"] in participant.request()["ownOrderIds"], "Logout preserves participant history")

admin2 = Client()
admin2.request()
admin2.login()
new_password = secrets.token_urlsafe(24)
admin.post("password-change", code=401, currentPassword="wrong-password-value", password=new_password)
admin.post("password-change", currentPassword=CREDS["password"], password=new_password)
check(not admin.state["admin"], "Password change logs out current admin")
check(not admin2.request()["admin"], "Password change invalidates other sessions")
admin.login(new_password)
time.sleep(61)
check(not admin.request()["admin"], "Admin idle expiry enforced")
for _ in range(5):
    unrelated.post("login", code=401, user=CREDS["user"], password="wrong-test-password")
unrelated.post("login", code=429, user=CREDS["user"], password=new_password)
database = fixture("inspect")
check(database["limits"] and all(len(value) == 64 and value != "127.0.0.1" for value in database["limits"]), "Durable rate limit uses hashed identifiers")
owner = participant.cookie("TatemOwner").value
check(hashlib.sha256(owner.encode()).hexdigest() in database["participants"] and owner not in database["participants"], "Owner cookies hashed in DB")
check(database["adminHash"] not in (new_password, CREDS["password"]) and database["adminHash"].startswith("$2"), "Admin password securely hashed")
check(database["orderCount"] == database["sequence"], "Server sequence remains unique")

# Exercise CLI recovery and leave privately recorded test credentials usable for browser tests.
recovery_password = secrets.token_urlsafe(24)
env = dict(os.environ, TATEM_ADMIN_USER=CREDS["user"], TATEM_ADMIN_PASSWORD=recovery_password)
subprocess.run([PHP, "bin/change-password.php"], env=env, check=True, stdout=subprocess.DEVNULL)
CREDS["password"] = recovery_password
with CREDS_PATH.open("w") as out:
    json.dump(CREDS, out)
os.chmod(CREDS_PATH, 0o600)
admin.login()
check(admin.state["admin"], "CLI recovery succeeds without resetting history")
check(fixture("inspect")["orderCount"] == database["orderCount"], "Recovery preserves order history")
print(f"OK: {CHECKS} real MariaDB/PHP HTTP integration checks (privacy, locking races, lifecycle, manual confirmation, sessions, limits)")
