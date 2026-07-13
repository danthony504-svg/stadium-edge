#!/usr/bin/env bash
# Heal corrupt/mixed OTA state without a new App Store binary.
# 1) Roll back channel to the embedded JS in build #62 (AppHeader / wordmark)
# 2) Publish one clean OTA from current main on top
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export RUNTIME_VERSION="${RUNTIME_VERSION:-1.0.0}"
export EXPO_PUBLIC_GIT_COMMIT="${EXPO_PUBLIC_GIT_COMMIT:-$(git -C "$(dirname "$0")/../.." rev-parse HEAD 2>/dev/null || echo unknown)}"
STAMP="$(date -u +%Y-%m-%dT%H:%MZ)"
export EXPO_PUBLIC_DEPLOY_MESSAGE="HEAL-EMBEDDED ${EXPO_PUBLIC_GIT_COMMIT} ${STAMP}"

echo "══ Step 1/2: Roll back production to embedded (build #62 AppHeader) ══"
bash scripts/rollback-production-ota.sh "HEAL rollback to embedded ${STAMP}"

echo
echo "══ Step 2/2: Publish clean OTA on production branch ══"
pnpm exec eas channel:edit production --branch production --non-interactive
pnpm exec eas update \
  --channel production \
  --platform ios \
  --message "HEAL-CLEAN ${EXPO_PUBLIC_GIT_COMMIT} ${STAMP}" \
  --non-interactive

echo
echo "Heal complete. Users: force-quit → reopen TWICE (embedded, then clean OTA)."
