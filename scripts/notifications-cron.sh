#!/bin/bash
# -----------------------------------------------------------------------------
# Notifications + background-build cron entry point.
#
# The api-server deploys as AUTOSCALE, so an in-process setInterval can't be
# trusted to run. This script is the command a Replit **Scheduled Deployment**
# runs on a recurring schedule: it POSTs to the public /api/notifications/cron
# endpoint, which drives EVERY time-based feature on the live instance:
#   - the abandoned-AI-Coach-build SWEEPER (finalizes background parlay builds
#     whose handler died on autoscale, so a user who closed the app still gets a
#     definite outcome + push — see artifacts/api-server/src/lib/coachBuild.ts),
#   - the four push triggers (game-start reminders, bet-results, daily picks
#     nudge, odds/line movement),
#   - terminal-record retention pruning.
# Without this schedule running, NONE of those fire and a parlay built while the
# app is closed never sends its "ready"/"couldn't finish" notification.
#
# Mirrors the pre-warming cron (POST /api/prebuild/cron) — same shared-secret
# header, just a different endpoint and a looser schedule (~every 15 min; the
# heartbeat freshness window in /api/notifications/cron/status is ~35 min).
#
# Configuration (all optional, sensible defaults baked in):
#   NOTIFY_CRON_URL  full URL to POST. Defaults to the published api-server.
#   NOTIFY_CRON_KEY  shared secret (the same generated env var the endpoint reads).
# -----------------------------------------------------------------------------
set -euo pipefail

URL="${NOTIFY_CRON_URL:-https://stadium-edge-1.replit.app/api/notifications/cron}"
KEY="${NOTIFY_CRON_KEY:-}"

if [ -z "$KEY" ]; then
  echo "notifications-cron: missing NOTIFY_CRON_KEY" >&2
  exit 1
fi

echo "notifications-cron: POST $URL"
# -f makes curl exit non-zero on HTTP >= 400 so the scheduled run is marked
# failed (and shows up in deployment logs) instead of silently succeeding.
curl -fsS --max-time 120 -X POST -H "x-cron-key: $KEY" "$URL"
echo
echo "notifications-cron: done"
