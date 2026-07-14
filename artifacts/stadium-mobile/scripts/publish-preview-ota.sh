#!/usr/bin/env bash
# Publish a JS-only OTA to the preview channel (TestFlight / internal testers).
# Must pass verify-ota-candidate.sh on preview before promoting to production.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

MESSAGE="${1:-PREVIEW $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo main) $(date -u +%Y-%m-%dT%H:%MZ)}"
export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_GIT_COMMIT="${EXPO_PUBLIC_GIT_COMMIT:-$(git -C "$(dirname "$0")/../.." rev-parse HEAD 2>/dev/null || echo unknown)}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${EXPO_PUBLIC_DEPLOY_MESSAGE:-PREVIEW $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null)-$(date -u +%Y%m%d-%H%M%S)}"

echo "Linking preview channel → preview branch…"
pnpm exec eas channel:edit preview --branch preview --non-interactive

echo "Publishing OTA to preview channel (runtime from app.json appVersion policy)…"
pnpm exec eas update \
  --channel preview \
  --platform ios \
  --environment preview \
  --message "$MESSAGE" \
  --non-interactive

echo ""
echo "Preview OTA published. Verify on TestFlight before promoting to production."
