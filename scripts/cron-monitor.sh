#!/bin/bash
# -----------------------------------------------------------------------------
# Cron heartbeat monitor / pager.
#
# Every time-based feature (notification pushes, the abandoned-Coach-build
# sweeper, cache pre-warming) depends on the Scheduled Deployments that POST to
# the secured cron endpoints. If that schedule ever stops firing (missing
# schedule, expired NOTIFY_CRON_KEY, bad deploy) the whole pipeline goes dark
# SILENTLY. Task #24 added a heartbeat + health endpoint
# (GET /api/notifications/cron/status) that returns 503 when no cron run has
# happened in the last ~35 min — but nothing polls it, so a human still has to
# look. This script IS that poller: run it as its own Scheduled Deployment on a
# few-minute interval and it pages a human channel the moment the cron stalls.
#
# It hits the status endpoint with the shared-secret header. On a healthy 200 it
# exits 0 quietly. On any non-200 (503 stalled / 500 error / 403 wrong key) it
# posts an alert to a Slack-compatible incoming webhook AND exits non-zero, so
# the Scheduled Deployment run is also marked failed (visible in deployment
# logs / Replit's own deploy-failure notifications) as a second line of defense.
#
# Configuration (all optional, sensible defaults baked in):
#   MONITOR_STATUS_URL      full URL to GET. Defaults to the published api-server.
#   MONITOR_CRON_KEY        shared secret. Falls back to NOTIFY_CRON_KEY.
#   MONITOR_ALERT_WEBHOOK_URL  Slack-compatible incoming webhook to page. When
#                           unset the script still exits non-zero on a stall, it
#                           just can't post to chat (the failed run is the alert).
#   MONITOR_ALERT_LABEL     prefix for the alert text (e.g. "[prod]"). Optional.
#
# Key rotation: this script reuses NOTIFY_CRON_KEY, the SAME shared secret the
# cron endpoints already use. To rotate without breaking the monitor, update
# NOTIFY_CRON_KEY everywhere it lives (the api-server deployment AND every
# Scheduled Deployment that reads it: notifications, pre-warming, and THIS
# monitor) in one go, then redeploy. There is no separate key to forget. If you
# prefer an independent secret for the monitor, set MONITOR_CRON_KEY explicitly
# and it takes precedence over NOTIFY_CRON_KEY.
# -----------------------------------------------------------------------------
set -uo pipefail

URL="${MONITOR_STATUS_URL:-https://stadium-edge-1.replit.app/api/notifications/cron/status}"
KEY="${MONITOR_CRON_KEY:-${NOTIFY_CRON_KEY:-}}"
WEBHOOK="${MONITOR_ALERT_WEBHOOK_URL:-}"
LABEL="${MONITOR_ALERT_LABEL:-}"

if [ -z "$KEY" ]; then
  echo "cron-monitor: missing MONITOR_CRON_KEY / NOTIFY_CRON_KEY" >&2
  exit 1
fi

# Capture the body and the HTTP status code in one request. The trailing
# "\n<code>" lets us split the status off the last line.
RESP="$(curl -sS -m 30 -w $'\n%{http_code}' -H "x-cron-key: $KEY" "$URL" 2>&1)"
CODE="$(printf '%s' "$RESP" | tail -n1)"
BODY="$(printf '%s' "$RESP" | sed '$d')"

echo "cron-monitor: GET $URL -> ${CODE:-no-response}"
[ -n "$BODY" ] && echo "cron-monitor: $BODY"

if [ "$CODE" = "200" ]; then
  echo "cron-monitor: cron healthy"
  exit 0
fi

# --- Unhealthy: page a human ------------------------------------------------
PREFIX=""
[ -n "$LABEL" ] && PREFIX="$LABEL "
ALERT="${PREFIX}:rotating_light: Stadium Edge cron is DOWN — status check returned ${CODE:-no-response}. Time-based pushes / sweepers are stalled. Endpoint: ${URL}. Detail: ${BODY:-<none>}"

echo "cron-monitor: ALERT $ALERT" >&2

if [ -n "$WEBHOOK" ]; then
  # JSON-escape the alert into a string value using only sed (no jq/python
  # dependency): backslashes first, then double-quotes, then flatten any
  # newlines/tabs to spaces so the payload stays valid one-line JSON.
  # Slack/Mattermost read "text"; for a Discord webhook append /slack to its URL
  # so it accepts this same Slack-style payload.
  ESCAPED="$(printf '%s' "$ALERT" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r\t' '   ')"
  if curl -fsS -m 30 -H "Content-Type: application/json" \
      -X POST -d "{\"text\": \"$ESCAPED\"}" "$WEBHOOK" >/dev/null; then
    echo "cron-monitor: alert posted to webhook"
  else
    echo "cron-monitor: FAILED to post alert to webhook" >&2
  fi
else
  echo "cron-monitor: MONITOR_ALERT_WEBHOOK_URL unset — relying on failed-run notification" >&2
fi

# Exit non-zero so the Scheduled Deployment run is marked failed too.
exit 1
