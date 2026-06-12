#!/bin/bash
# -----------------------------------------------------------------------------
# Cache pre-warming cron entry point.
#
# The api-server deploys as AUTOSCALE, so an in-process setInterval can't be
# trusted to run. This script is the command a Replit **Scheduled Deployment**
# runs on a recurring schedule: it POSTs to the public /api/prebuild/cron
# endpoint, which makes the live autoscale instance warm its odds/games/props
# caches over loopback (see artifacts/api-server/src/lib/prebuildJobs.ts).
#
# Mirrors the notifications cron (POST /api/notifications/cron) — same shared
# secret header, just a different endpoint and a tighter schedule (the warmed
# caches have ~5 min TTLs, so run this every few minutes).
#
# Configuration (all optional, sensible defaults baked in):
#   PREBUILD_CRON_URL  full URL to POST. Defaults to the published api-server.
#   PREBUILD_CRON_KEY  shared secret. Falls back to NOTIFY_CRON_KEY.
# -----------------------------------------------------------------------------
set -euo pipefail

URL="${PREBUILD_CRON_URL:-https://stadium-edge-1.replit.app/api/prebuild/cron}"
KEY="${PREBUILD_CRON_KEY:-${NOTIFY_CRON_KEY:-}}"

if [ -z "$KEY" ]; then
  echo "prebuild-cron: missing PREBUILD_CRON_KEY / NOTIFY_CRON_KEY" >&2
  exit 1
fi

echo "prebuild-cron: POST $URL"
# -f makes curl exit non-zero on HTTP >= 400 so the scheduled run is marked
# failed (and shows up in deployment logs) instead of silently succeeding.
curl -fsS --max-time 120 -X POST -H "x-cron-key: $KEY" "$URL"
echo
echo "prebuild-cron: done"
