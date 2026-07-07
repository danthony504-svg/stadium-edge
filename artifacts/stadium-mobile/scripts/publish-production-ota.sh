#!/usr/bin/env bash
# Publish a JS-only OTA to the production channel. Requires EXPO_TOKEN.
# eas update does NOT inherit eas.json build env — export EXPO_PUBLIC_* before bundling.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required. Create one at https://expo.dev/settings/access-tokens"
  exit 1
fi

MESSAGE="${1:-Restore new UI $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo main)}"
export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"

export const ROLLBACK_EMBEDDED="${ROLLBACK_EMBEDDED:-0}"

if [[ "$ROLLBACK_EMBEDDED" == "1" ]]; then
  echo "Rolling back production iOS channel to embedded bundle before publishing fix…"
  pnpm exec eas update:roll-back-to-embedded \
    --branch production \
    --platform ios \
    --message "Rollback corrupt OTA before: $MESSAGE" \
    --non-interactive
fi

pnpm exec eas update \
  --branch production \
  --message "$MESSAGE" \
  --non-interactive

echo "OTA published. Users on TestFlight will pick it up within ~12s of next app open."
