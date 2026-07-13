#!/usr/bin/env bash
# Publish a JS-only OTA to the production channel. Requires EXPO_TOKEN.
# eas update does NOT inherit eas.json build env — export EXPO_PUBLIC_* before bundling.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required. Create one at https://expo.dev/settings/access-tokens"
  exit 1
fi

MESSAGE="${1:-Stable pre-table-tennis OTA $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo main)}"
export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export RUNTIME_VERSION="${RUNTIME_VERSION:-1.0.0}"
export EXPO_PUBLIC_GIT_COMMIT="${EXPO_PUBLIC_GIT_COMMIT:-$(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo unknown)}"
export EXPO_PUBLIC_BUNDLE_STAMP="${EXPO_PUBLIC_BUNDLE_STAMP:-$(date -u +%Y-%m-%dT%H:%MZ)-${EXPO_PUBLIC_GIT_COMMIT}}"

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

if [[ "${ROLLBACK_EMBEDDED:-1}" == "1" ]]; then
  echo "Clearing any corrupt OTA before publishing fresh bundle…"
  bash scripts/rollback-production-ota.sh "Pre-publish rollback $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo main)"
fi

pnpm exec eas update \
  --channel production \
  --platform ios \
  --message "$MESSAGE" \
  --non-interactive

echo "OTA published. App Store + TestFlight users on runtime 1.0.0 pick it up on next open."
