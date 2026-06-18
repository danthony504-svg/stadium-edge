---
name: Published Coach "lost connection building ticket" = missing Scheduled Deployment
description: Diagnose why parlay builds fail only on the published app with no server-side POST log.
---

# Symptom
On the PUBLISHED app, AI Coach build ("3 leg home run") fails with "Sorry — I lost the
connection while building your ticket. Check your signal and try again." — often twice in
a row — while smaller chat/discovery turns in the same session succeed. Deployment logs
show NO `POST /api/chat` for the failed builds (request never finished reaching the server),
and `/api/healthz` is 200.

# Cause
The api-server deploys as **autoscale**. With no traffic it scales to zero/cold. The
heavier build POST hits a cold container that takes longer to accept the connection than
the client's size-aware CONNECT_MS (12–30s) → client times out before the server logs
anything → retries hit a still-cold instance → "lost connection". The background-finish
safety net also can't recover it because the request never started server-side.

The deeper root cause: the **Scheduled Deployment cron was never created** at publish time.
Without it the autoscale instance is never kept warm, caches aren't pre-warmed, and the
abandoned-build sweeper never runs.

# Diagnose (decisive, one call)
`curl -H "x-cron-key: $NOTIFY_CRON_KEY" https://<prod>/api/notifications/cron/status`
- `{"everRan":false,...}` + HTTP 503 → cron has NEVER fired → Scheduled Deployment missing.
- 200 within ~35 min → cron is alive; look elsewhere (genuine weak signal, etc.).

# Fix (USER action — agent can't create Scheduled Deployments)
Scripts already exist and default URL→published api-server, key→`NOTIFY_CRON_KEY` env:
- `bash scripts/prebuild-cron.sh` on a TIGHT interval (~2–3 min) — keeps autoscale WARM +
  warms odds/games/props caches (~5 min TTL). This is what kills the cold-start build timeouts.
- `bash scripts/notifications-cron.sh` ~every 15 min — background-build sweeper + push triggers.
- (optional) `bash scripts/cron-monitor.sh` — pages if the schedule stalls.
Create each as a Replit **Scheduled Deployment** in the Publishing UI. `replit.md` "Scheduled
jobs (cron)" documents the full setup; no extra secret needed (prebuild falls back to NOTIFY_CRON_KEY).

**Why durable:** every publish of this app must be paired with these Scheduled Deployments or
the live Coach degrades to cold-start build failures even though dev works perfectly.
