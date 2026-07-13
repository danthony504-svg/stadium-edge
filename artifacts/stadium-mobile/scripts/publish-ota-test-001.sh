#!/usr/bin/env bash
# Publish minimal OTA TEST 001 — visible title only, coach startup disabled.
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
MESSAGE="PLAYER PROPS — OTA TEST 001 ${GIT_SHORT} ${STAMP}"

export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_GIT_COMMIT="${GIT_FULL}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${MESSAGE}"

echo "══ OTA TEST 001 publish ══"
echo "Publish dir: $(pwd)"
echo "Git commit: ${GIT_FULL}"
echo "Message: ${MESSAGE}"
echo "Runtime: 1.0.0"
echo "Channel: production"
echo "Branch: production"
echo "Platform: ios"

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
echo "Post-publish channel view:"
pnpm exec eas channel:view production --non-interactive 2>&1 || true

echo ""
echo "OTA TEST 001 published."
