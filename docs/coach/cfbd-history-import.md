# CFBD server-side historical import

Requires CFBD_API_KEY in the API service/worker environment. No EXPO_PUBLIC
credential, mobile import, automatic Coach request hook or production flag lift.
The entry in Render must have the full name CFBD_API_KEY (not a truncated label).

After this change is merged into the branch deployed by Render and the API
build is Live, use Render Shell from the repository root:

    node artifacts/api-server/dist/cfbdHistoryImport.mjs 2025 1

If the service working directory is already artifacts/api-server, use:

    node dist/cfbdHistoryImport.mjs 2025 1

This makes two sequential calls, /games and /lines, for one regular-season
week, with an eight-second timeout per call and redirects rejected. No retry
loop. Use one representative historical week first to verify access/quota.
Do not paste credentials into the command. The CLI reads the environment.

The protected alternative is POST /api/coach/ncaaf/data-check with JSON
{"year":2025,"week":1} and the existing NOTIFY_CRON_KEY as x-cron-key.
It uses the shared timing-safe cron authorization. The CFBD key is not the
cron authentication secret. Public unauthenticated requests cannot import.
Concurrent/repeated web imports are bounded by one active batch and one-minute
process-local spacing. The endpoint is not a scheduled job.

Successful output contains only counts, rejected reasons, limitations and the
snapshot SHA. A successful connection does not imply sufficient data or a
validated model. HTTP 401/403 are reported as numeric provider failures without
provider bodies or token-bearing error strings; 429 has no automatic retry.

Normalized snapshots are written with mode 0600 under var/cfbd-history (or
CFBD_HISTORY_DIR) using exclusive timestamp/hash filenames. Configure that
folder on a persistent disk for durable research; an ephemeral Render filesystem
is not a durable archive. Data is gitignored. No raw provider payload/key is
returned in the protected response. Provider event IDs, team IDs, kickoff,
season/week and completed FBS scores must agree before lines are joined.

Important limitations in the documented /lines schema:

- Spread and game total numbers are provided, but their wager prices are not.
- Moneyline prices can be null; never insert a default -110 or fabricate odds.
- Team scoring totals are not supplied by this endpoint.
- Historical quote observation/closing timestamps are not supplied. ImportedAt
  is the time we retrieved the record, not the historical pregame quote time.
- Missing overtime line scores remain unknown, not regulation-only.
- This does not fabricate an earlier forecast from postgame data or feed the
  result directly into the frozen forecast audit. validationReady remains false.

References:
https://api.collegefootballdata.com/api/games
https://api.collegefootballdata.com/api/betting

Tests cover exact joins, incomplete/future rows, null odds, secret redaction,
credential-only server headers, private archive permissions and route auth.
Historical calibration and the existing NCAAF P0 remain separate.

## Research PostgreSQL storage
Set CFBD_HISTORY_DATABASE_URL to the QA/research connection without changing DATABASE_URL. Imports create only cfbd_history_archives and insert normalized JSON with a SHA-256 primary key. A separate one-connection pool closes after each import. No Coach request uses this storage. databaseArchived:true confirms insertion completed; configured storage failure fails the import with a sanitized error. Existing temporary files are not migrated: reimport Weeks 1 and 2 after deployment. No model gate or OTA change.
