#!/usr/bin/env bash
# Publish a JS-only OTA to the production channel. Requires EXPO_TOKEN.
# eas update does NOT inherit eas.json build env — export EXPO_PUBLIC_* before bundling.
# Always test on preview/TestFlight first; use promote-preview-to-production.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required. Create one at https://expo.dev/settings/access-tokens"
  exit 1
fi

MESSAGE="${1:-DEPLOY-VERIFY $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo main) $(date -u +%Y-%m-%dT%H:%MZ)}"
ROLLOUT="${ROLLOUT_PERCENTAGE:-10}"
export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_GIT_COMMIT="${EXPO_PUBLIC_GIT_COMMIT:-$(git -C "$(dirname "$0")/../.." rev-parse HEAD 2>/dev/null || echo unknown)}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${EXPO_PUBLIC_DEPLOY_MESSAGE:-DEPLOY-VERIFY $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null)-$(date -u +%Y%m%d-%H%M%S)}"

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

echo "Publishing OTA to production @ ${ROLLOUT}% rollout (runtime from appVersion policy)…"
pnpm exec eas update \
  --channel production \
  --platform ios \
  --environment production \
  --rollout-percentage "$ROLLOUT" \
  --message "$MESSAGE" \
  --non-interactive

echo "OTA published at ${ROLLOUT}% rollout. Increase gradually after verification."
