#!/usr/bin/env bash
# Minimal bootstrap OTA: embedded-like startup + diagnostics only.
# Rolls back to embedded first, then publishes a small bundle that must not crash on load.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null)"
GIT_FULL="$(git -C "$REPO_ROOT" rev-parse HEAD)"
GIT_SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
STAMP="$(date -u +%Y-%m-%dT%H:%MZ)"
MESSAGE="BOOTSTRAP OTA ${GIT_SHORT} ${STAMP}"
RUNTIME="$(node -e "console.log(require('./app.json').expo.runtimeVersion)")"

export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_OTA_BOOTSTRAP="true"
export EXPO_PUBLIC_GIT_COMMIT="${GIT_FULL}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${MESSAGE}"

echo "════════════════════════════════════════════════════════════"
echo " BOOTSTRAP OTA — rollback embedded, then publish minimal bundle"
echo "════════════════════════════════════════════════════════════"
echo "Git commit:  ${GIT_FULL}"
echo "Message:     ${MESSAGE}"
echo "Runtime:     ${RUNTIME}"
echo "Channel:     production"
echo ""

bash scripts/rollback-production-ota.sh "Pre-bootstrap rollback ${GIT_SHORT}"

echo ""
echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

echo ""
echo "Publishing bootstrap update…"
pnpm exec eas update \
  --channel production \
  --platform ios \
  --environment production \
  --message "${MESSAGE}" \
  --non-interactive

echo ""
pnpm exec eas channel:view production --non-interactive 2>&1 || true
echo ""
echo "Bootstrap OTA published."
