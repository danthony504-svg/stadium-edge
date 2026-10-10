# Reliability Phase A — ops model

## Production Render assumptions (verified from public surface 2026-10-10)

| Fact | Evidence |
|------|----------|
| Public API host | `https://stadium-edge.onrender.com` (`/api/healthz` → 200) |
| Platform | Render (`x-render-origin-server: Render`) behind Cloudflare |
| Instance count | **Not exposed publicly.** Treat as **single web instance** unless ops confirms horizontal scale. |
| `REDIS_URL` | **Secret — not readable from this agent.** Repo policy: optional. Without it, IP rate limits are in-memory per process. |
| New paid Redis | **Not introduced by Phase A.** Do not add Upstash/Redis Cloud without explicit approval. |

## Security model

| Control | Scope | Multi-instance safe? |
|---------|-------|----------------------|
| Per-IP crash rate limits (10/10m, 30/h) | Redis if `REDIS_URL`, else in-memory | Only with Redis |
| Fingerprint dedupe + Telegram quiet window (30m) | PostgreSQL `reliability_events` | Yes |
| Hourly occurrence budget (≤500) | PostgreSQL | Yes |
| Crash body size (~8 KB) | Pre-`express.json` middleware | Yes |
| Severity | Server-hardcoded `critical` | N/A |

**Single-instance (default assumption):** in-memory IP limits + PG dedupe/budget are sufficient.

**Multi-instance without Redis:** IP limits multiply by instance count; PG budget + fingerprint dedupe still bound DB writes and Telegram alerts. Prefer setting existing `REDIS_URL` (if already provisioned) before scaling — do not purchase Redis solely for Phase A without approval.

Crash ingest rate limiting **fails closed** (503) if the limiter store errors. Hourly budget check **fails closed** (429 shed) if Postgres is unavailable.

## Daily maintenance

- Workflow: `.github/workflows/reliability-digest-cron.yml` (`0 13 * * *` UTC + `workflow_dispatch`)
- Endpoint: `POST /api/reliability/cron/digest` with header `x-cron-key: $NOTIFY_CRON_KEY`
- Server always runs **14-day prune** before Telegram; Telegram may skip when disabled/`RELIABILITY_TELEGRAM_ENABLED=0`
- `NOTIFY_CRON_KEY` is a server/Actions secret only — never `EXPO_PUBLIC_*`

## Telegram

| Env | Purpose |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | Bot API token (server only) |
| `TELEGRAM_CHAT_ID` | Destination chat |
| `RELIABILITY_TELEGRAM_ENABLED` | `0` disables sends (default allow when credentials present) |

Alerts require a successful PostgreSQL dedupe path. **DB outage / missing table → no Telegram** (suppress, do not storm).
