#!/usr/bin/env bash
# Publish minimal OTA TEST 002 — title change + Home diagnostics only.
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
MESSAGE="PLAYER PROPS — OTA TEST 002 ${GIT_SHORT} ${STAMP}"
RUNTIME="$(node -e "console.log(require('./app.json').expo.runtimeVersion)")"

export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_GIT_COMMIT="${GIT_FULL}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${MESSAGE}"

echo "════════════════════════════════════════════════════════════"
echo " PRE-PUBLISH (required facts)"
echo "════════════════════════════════════════════════════════════"
bash scripts/pre-publish-ota-check.sh

echo ""
echo "════════════════════════════════════════════════════════════"
echo " PUBLISH OTA TEST 002"
echo "════════════════════════════════════════════════════════════"
echo "Publish dir: $(pwd)"
echo "Git commit:  ${GIT_FULL}"
echo "Message:     ${MESSAGE}"
echo "Runtime:     ${RUNTIME}"
echo "Channel:     production"
echo "Branch:      production"
echo "Platform:    ios"
echo ""

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

echo ""
echo "Publishing update…"
pnpm exec eas update \
  --channel production \
  --platform ios \
  --environment production \
  --message "${MESSAGE}" \
  --non-interactive

echo ""
echo "── Post-publish channel head ──"
pnpm exec eas channel:view production --non-interactive 2>&1 || true

echo ""
echo "── Post-publish branch head ──"
pnpm exec eas branch:view production --non-interactive 2>&1 | head -40 || true

echo ""
echo "OTA TEST 002 publish step finished."
