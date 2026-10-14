# Reliability Center — ops model (Phases 1–3)

Extends Phase A crash Telegram with **90-minute health monitoring** and
**AI Coach fulfillment / integrity** alerts. Observe-only for Coach — no
selection, grading, simulation, or UI logic changes.

## Why the daily digest had 0 GitHub Actions runs

| Fact | Detail |
|------|--------|
| Workflow | `.github/workflows/reliability-digest-cron.yml` |
| GitHub state | `active` on default branch `main` |
| Schedule | `0 13 * * *` UTC (+ `workflow_dispatch`) |
| Landed on main | 2026-10-10 ~19:19 UTC (`1080dd8e`) — **after** that day's 13:00 slot |
| First scheduled fire | Next 13:00 UTC **on or after** the day the workflow reached `main` |
| Manual dispatch | Requires repo `actions: write` — cloud agent token got HTTP 403 |

So zero runs was **not** a missing secret or disabled workflow — the first
cron slot had not occurred yet after merge. This PR also hardens the workflow
(`permissions`, `concurrency`, longer curl timeout) and adds the 90m health cron.

## Schedules

| Job | Workflow | Cadence | Endpoint |
|-----|----------|---------|----------|
| Daily digest + prune | `reliability-digest-cron.yml` | 13:00 UTC daily | `POST /api/reliability/cron/digest` |
| Health monitor | `reliability-health-cron.yml` | every ~90 min | `POST /api/reliability/cron/health` |

Both require header `x-cron-key: $NOTIFY_CRON_KEY` (Actions secret / Render env).
Optional URL overrides: `vars.RELIABILITY_DIGEST_URL`, `vars.RELIABILITY_HEALTH_URL`.

### Cron auth contract (must stay in sync)

| Layer | Expectation |
|-------|-------------|
| Header | `x-cron-key: <secret>` (also accepts `Authorization: Bearer <secret>`) |
| Env | Render `NOTIFY_CRON_KEY` (trimmed) |
| GitHub Actions | repository secret `NOTIFY_CRON_KEY` **identical** to Render |
| Unauthorized body | `403` with safe diag: `authHeaderPresent`, `expectedSecretConfigured`, `authSchemeRecognized`, `fingerprintMatch`, `rejectionLayer` — **never** the secret |

If Actions secret is empty, workflows fail closed before calling production.
If Actions/Replit key ≠ Render key, production returns `403` with `fingerprintMatch: false`.

## 90-minute health checks

| Check id | What |
|----------|------|
| `website` | `https://stadiumedge.app` HTTP |
| `api` | `/api/healthz` (loopback then public) |
| `ssl` | TLS handshake via HTTPS healthz |
| `response_time` | healthz latency vs budget (default 12s) |
| `database` | `select 1` |
| `odds_feed` | `/api/sports/odds?sport=nfl` |
| `player_props` | `/api/sports/props` after odds event id |
| `ai_coach` | healthz `ai` + `chat` probes |
| `game_simulator` | `POST /api/sports/simulate/game-outcome` |
| `steals_scanner` | `/api/sports/live-steals` (+500 scanner) |

Telegram: **fail** and **recovery** only (fingerprint-deduped, 30m quiet window).
Daily digest is a **received-telemetry** summary — health cron does not spam "all OK".

### Digest must not conflate three signals

| Section | Meaning | What zero means |
|---------|---------|-----------------|
| Server health (probes) | website / API / DB / odds / Coach healthz / … | Probes passed — **not** client crash-free |
| Device crash telemetry | Rows ingested via `POST /reliability/crashes` (JS handlers) | **0 received reports** — **not** 0 actual crashes |
| Coach activity | Rows from server `POST /chat` + mobile `coach-events` | **0 received events** — **not** verified zero Coach usage |

**Coverage gap (Build 78 tip-boot):** Expo `ErrorRecovery` / `markFailedLaunchForUpdate` runs **before** JS `installGlobalCrashHandlers` / `reportCrash`. Those fatals appear in device `.ips` / `expo-error.log` but **never** increment digest crash counts. Do not treat an empty digest as verified app health.

### Production-safe Telegram proof (prefer this)

Do **not** use health cron `synthetic_fail` / `syntheticFail` against production —
that forces real check ids (website, api, database, …) into a failed state.

Use the dedicated probe instead (same Telegram + PG dedupe path, isolated
fingerprint `health|telegram_probe|fail`):

| | |
|--|--|
| Endpoint | `POST /api/reliability/cron/telegram-probe` |
| Auth | `x-cron-key: $NOTIFY_CRON_KEY` |
| Body (full proof) | `{"phases":["fail","dedupe","recover"]}` |
| Workflow | `.github/workflows/reliability-telegram-probe.yml` (`workflow_dispatch` only) |
| Optional URL override | `vars.RELIABILITY_TELEGRAM_PROBE_URL` |

Expected JSON: `probe.delivery`, `probe.dedupe`, `probe.recovery` all `true`,
plus Telegram messages labeled `check: telegram_probe` /
`PRODUCTION-SAFE TELEGRAM PROBE — not a real outage`.

Staging-only: health workflow `synthetic_fail` JSON → `{ "syntheticFail": … }`.

## Coach monitoring

| Source | Events |
|--------|--------|
| Server `POST /chat` | parlay request/fulfill/underfill/zero, timeout, exception, Q&A |
| Mobile board scan | grounding, odds mismatch, ALT/props empty, sim failure, scan freeze |

Underfill with real odds present → `legitimate_underfill` (**digest only**).
System failures page Telegram with `requestId`, `category`, `sport`, optional
`affectedGame`, sanitized `rootCause` — no emails / Clerk ids / raw asks.

Mobile POST: `POST /api/reliability/coach-events` (rate-limited). Uses the same
RN/test gate as crash reporting — Node unit tests never hit production.

Test fixtures (`requestId=reliability-synthetic`, `testFixture: true`) are
accepted with `202` but **never** Telegram-alerted.

## Env

| Env | Purpose |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | Bot API token (server only) |
| `TELEGRAM_CHAT_ID` | Destination chat |
| `RELIABILITY_TELEGRAM_ENABLED` | `0` disables sends |
| `NOTIFY_CRON_KEY` | Cron auth (server + Actions) |
| `RELIABILITY_PUBLIC_API_BASE` | Override API host for probes |
| `RELIABILITY_PUBLIC_WEBSITE_URL` | Override marketing site |
| `RELIABILITY_RESPONSE_TIME_BUDGET_MS` | Latency budget (default 12000) |

## Deploy note

Server routes + workflows take effect after **API deploy** + merge to `main`.
Mobile Coach scan reporting needs an **OTA** (gated — do not publish without approval).
Until OTA, server chat-path Coach monitoring still works once the API is deployed.
