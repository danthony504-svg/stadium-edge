#!/bin/bash
# -----------------------------------------------------------------------------
# AI Coach 24/7 slate pre-analysis cron.
#
# Runs on a Scheduled Deployment (AUTOSCALE can't trust in-process timers).
# POSTs to /api/coach/v2/cron which runs the v2 background scan pipeline.
#
# Configuration:
#   COACH_SLATE_CRON_URL  full URL. Defaults to published api-server.
#   COACH_SLATE_CRON_KEY  shared secret. Falls back to PREBUILD/NOTIFY keys.
# -----------------------------------------------------------------------------
set -euo pipefail

URL="${COACH_SLATE_CRON_URL:-https://stadium-edge-1.replit.app/api/coach/v2/cron}"
KEY="${COACH_SLATE_CRON_KEY:-${PREBUILD_CRON_KEY:-${NOTIFY_CRON_KEY:-}}}"

if [ -z "$KEY" ]; then
  echo "coach-slate-cron: missing COACH_SLATE_CRON_KEY / PREBUILD_CRON_KEY / NOTIFY_CRON_KEY" >&2
  exit 1
fi

echo "coach-slate-cron: POST $URL"
curl -fsS --max-time 300 -X POST -H "x-cron-key: $KEY" "$URL"
echo
echo "coach-slate-cron: done"
