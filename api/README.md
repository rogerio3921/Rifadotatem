# Production backend (PHP 8.2+ / MySQL)

Prepared for future activation only. Adding these files does not publish or
activate the backend, and does not change the existing public demo.

This is separate from the browser-only GitHub Pages demo. Pages cannot execute PHP.
There is **no automatic import of demo/localStorage data**. Start with an empty
database. Do not upload real database credentials or participant data to GitHub.

Payments are manual: the configured Pix key is displayed by the frontend; the
organizer checks payment independently and confirms pending orders in admin.
There is no Pix/bank API, automatic settlement, automatic refund, or WhatsApp
delivery. Campaign cancellation records the reason and the organizer's explicit
responsibility for manual refunds; it never declares that a refund occurred.
This infrastructure does not establish authorization to operate a raffle.
Verify applicable legal, consumer, privacy and tax requirements before operation.

## Hostinger deployment

1. Back up existing website files and any database before uploading. Keep the
   GitHub Pages demo unchanged; use a separate production domain/site.
2. In hPanel select PHP **8.2 or newer**, enable `pdo_mysql`, `fileinfo`, `session`
   and `gd` (PNG/JPEG/WebP support), and preferably `mbstring`. Covers are actually
   decoded, not merely trusted by MIME prefix. Use MySQL 8+ or MariaDB 10.6+ with InnoDB and
   utf8mb4. Create a dedicated database and user in **Databases → Management**.
3. Upload the production frontend plus `api/` to `public_html/`. Upload `bin/`
   for SSH installation/recovery (its `.htaccess` denies HTTP access); it can be
   removed after installation. Keep hidden `.htaccess` files when uploading.
4. Copy `api/config.example.php` to **outside `public_html`**, normally
   `../tatem-config.php`, and fill the DSN/database credentials and exact origin
   (`https://your-domain`, no trailing slash or path). The default lookup is
   `dirname(public_html)/tatem-config.php`; alternatively set `TATEM_CONFIG` in
   the PHP environment to an absolute external file path. A config inside the
   web root is explicitly rejected. Restrict file access to the hosting account
   (for example `chmod 600 ../tatem-config.php`).
5. Enable TLS and force HTTPS for the **entire production website** in hPanel.
   Keep `allow_http=false`. Do not trust forwarded headers as proof of HTTPS:
   PHP must receive `HTTPS=on` from the hosting TLS setup. Do not expose the site
   through an HTTP reverse proxy unless TLS detection is correctly configured.
6. Via Hostinger SSH, from `public_html`, run:

   ```sh
   php -v
   php -m
   php bin/install.php
   ```

   Choose an admin username and a unique **12–72 byte** password. The terminal
   prompts for the password without echo and asks for confirmation. There is no
   default password and credentials are never accepted as command-line arguments.
   Check that SSH's PHP version/extensions match the selected web PHP version.
   The installer executes `api/schema.sql`, creates the single admin and default
   settings, and seeds **no campaigns**. Re-running never resets existing data or
   replaces an admin. Schema DDL needs CREATE privileges; after installation the
   runtime account can be restricted to SELECT/INSERT/UPDATE/DELETE.
7. Log in through the production frontend. Configure the real Pix key, organizer,
   contact, rules, message and expiry before creating/accepting reservations.
   The placeholder `CHAVE-NAO-CONFIGURADA` (and demo `CHAVE-DE-TESTE`) blocks new
   reservations. Test with your own test campaign before public operation.
8. Verify HTTP requests to `/api/schema.sql`, `/api/config.example.php`,
   `/api/service.php` and `/bin/install.php` are denied. On Apache/LiteSpeed,
   supplied `.htaccess` rules provide this; on other servers configure equivalent
   denial rules. PHP's built-in development server ignores `.htaccess` and
   **must never be used as the public production server**.

If your hosting plan has no SSH, execute the CLI installer from a trusted PHP
environment with secure/private access to the database; do **not** create a web
installer. Another option is installing locally and transferring a database
backup through hPanel/phpMyAdmin. Importing schema alone does not initialize the
admin/settings; never insert a plaintext or shared default password manually.

For controlled automation, the CLI also accepts the explicitly provided
environment variables `TATEM_ADMIN_USER` and `TATEM_ADMIN_PASSWORD`. Prefer the
interactive prompt; do not paste secrets into shell history, URLs, arguments,
committed files or logs. Password recovery uses `php bin/change-password.php`
with the same prompt/environment convention and invalidates all admin sessions.

## API contract

Use same-origin requests with cookies (`credentials: "same-origin"`).
`GET api/index.php` returns:

```text
{campaigns, reservations, settings, occupancy, admin, csrf, ownOrderIds, serverNow}
```

POST JSON with `Content-Type: application/json` and `X-CSRF-Token` from GET.
Every successful POST returns the same state; `reserve` also returns `order`.
Errors return `{"error":"safe message"}` with 400/401/403/404/405/409/413/415/422/429
or generic 500. A 429 includes `Retry-After: 900`. Refresh GET after session expiry.

| Action | Input |
| --- | --- |
| `login` | `user`, `password` |
| `logout` | none |
| `password-change` | `currentPassword`, `password` (logs admin out) |
| `campaign-save` | `campaign`, `create` boolean |
| `campaign-delete` | `id` (only never-reserved, non-cancelled campaigns) |
| `campaign-cancel` | `id`, `reason`, `refundAcknowledged: true` |
| `reserve` | `campaignId`, `numbers`, `name`, `phone`, `expectedPrice`, `expectedHours`, `requestId` |
| `orders-update` | `ids`, `status: "sold"` or `"cancelled"` |
| `settings-save` | `settings` |

All actions except reserve/login/logout require admin authorization. On create,
campaign IDs come from the server; updates require the existing `campaign.id`.
Client lifecycle/security fields are ignored, never stored. Campaign fields:
name (80), description `desc` (300), prize (160), price (0.01–1,000,000, at most
two decimal places), date (valid YYYY-MM-DD or empty), count (1–1000), minimum
(0–100, default 50), cover (empty or actual PNG/JPEG/WebP data URI, **at most
700,000 encoded characters**, max 10,000 per dimension / 4M pixels).
Settings limits: pixKey 200, organizer 100, phone 0–15 digits, rules 10,000,
message 5,000, hours integer 1–168. Name max 80; phone normalized to 10–15 digits;
duplicate numbers are rejected. Numeric strings and fractional integer inputs
are rejected. Requests larger than 1 MiB are rejected.

`requestId` is 16–128 ASCII letters/digits/underscore/hyphen (use a UUID).
Keep the same ID and inputs when retrying an uncertain reserve response.
Replays return the original order, even if it subsequently expired/cancelled;
reuse with different inputs returns 409. This guarantee is per participant
cookie, not cross-device. New requests must carry the displayed price and hours.

Only owners see their participant details/orders; admin sees all. `ownOrderIds`
always identifies only the browser owner's orders, including when admin.
Public campaigns include active campaigns plus cancelled campaigns referenced
by that owner's history. `occupancy` contains only `{campaign, number, status}`
for sold or unexpired reserved numbers of non-cancelled campaigns, no personal
data. Orders retain `status:"reserved"` after expiry, as in the demo; determine
`expired` using server-generated `expires`. Cancelled campaign metadata is also
attached to its orders as `campaignCancellation`. Historical snapshot names,
prizes, totals, timestamps and sequential labels are server-generated.
`serverNow` is integer epoch milliseconds captured after acquiring the
transaction lock; use it to offset the browser clock for expiry displays.

Writes use a transaction and lock the singleton settings row, serializing
competing reservations, batch updates and campaign edits. Price locks persist
after the first reservation, even after expiry/cancellation. Capacity reductions
cannot remove occupied numbers. Batch confirmation is atomic and accepts only
unexpired pending orders on active campaigns; order cancellation accepts pending
or expired orders, never confirmed/cancelled ones. There is no production reset
or order-history deletion endpoint. Cancelled campaigns cannot be edited.

Admin sessions expire after 30 minutes idle (configurable 60–86,400 seconds).
Password changes and CLI recovery invalidate all admin sessions. Login limits
are durable: 5 failures per account / 20 per IP in 15 minutes, with 15-minute
lockout; database identifiers are SHA-256 hashes, never raw IPs. Owner identity is
a random 256-bit, HttpOnly, SameSite=Lax, Secure, host-only cookie lasting one
year; only its SHA-256 hash is stored in the database. Losing the cookie means
public access to old orders is lost; admin history remains. CSRF is a separate
session-bound token. HTTPS uses `__Host-` cookie prefixes; local HTTP testing uses
unprefixed names. Configure access-log privacy separately at the hosting level.

## Backups and verification

Schedule encrypted database backups outside the public website with restricted
access; include external config separately and test restoration. Retain order
and cancellation history under an appropriate privacy/retention policy. Do not
replace a populated database with the demo. Record/resolve manual refunds outside
this interface; cancellation acknowledgements do not prove repayment.

Rule tests (no database needed; PHP GD/fileinfo required):

```sh
php tests/backend-rules.php
find api bin -name '*.php' -exec php -l {} \;
```

Integration tests require Python 3, PHP with `pdo_mysql`, and a dedicated,
**empty disposable** MySQL/MariaDB database with CREATE privileges. Configure
that test database in an external config, use a local PHP server with
`allow_http=true`, and run the harness documented in `tests/backend-integration.py`.
Never point it at production: it creates campaigns/orders, confirms payments
and changes the test admin password. It does not delete history.

For an isolated loopback-only development database (not the hosting server),
from the repository root:

```sh
mkdir -p .backend-local/sessions
TMPDIR="$PWD/.backend-local" mariadb-install-db --no-defaults \
  --datadir="$PWD/.backend-local/db" \
  --auth-root-authentication-method=socket --skip-test-db
```

Run the following MariaDB command in a separate terminal; it stays attached:

```sh
TMPDIR="$PWD/.backend-local" mariadbd --no-defaults --user="$(id -un)" \
  --datadir="$PWD/.backend-local/db" --socket=../mysql.sock \
  --pid-file="$PWD/.backend-local/mysql.pid" --tmpdir="$PWD/.backend-local" \
  --bind-address=127.0.0.1 --port=3307
```

The short socket path is relative to MariaDB's data directory. After verifying
`mariadb-admin --no-defaults --socket=.backend-local/mysql.sock -u root ping`,
run `python3 tests/backend-setup.py`. This refuses an existing test database or
external config. It writes private `../tatem-config.php` and
`../tatem-test-credentials.json` **outside the web root**, initializes the admin,
and sets an idle interval of 60 seconds for tests. The setup script uses
`/usr/bin/php`; adjust it if that is not the PHP installation with MySQL/GD.

Start the HTTP server in another attached terminal:

```sh
PHP_CLI_SERVER_WORKERS=4 TMPDIR="$PWD/.backend-local" /usr/bin/php \
  -d session.save_path="$PWD/.backend-local/sessions" \
  -S 127.0.0.1:8877 -t "$PWD" tests/backend-router.php
```

The test router denies private files and internal API/CLI/test sources, unlike
the default built-in server. Confirm GET `/api/index.php` returns empty state,
then run `TATEM_TEST_DISPOSABLE=yes python3 tests/backend-integration.py`.
Afterwards `TATEM_TEST_DISPOSABLE=yes python3 tests/backend-smoke.py` provides
repeatable live image-decoding, private-route and non-resetting installer checks.
This includes a 61-second idle-expiry check. Stop both servers when done;
delete only these disposable artifacts when no longer needed. Do not deploy
the development router, test helpers, test database or test credentials.
