#!/usr/bin/env bash
# Force-publish a clean production OTA (no rollback, no native build).
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
MESSAGE="${1:-Force latest Stadium Edge UI ${GIT_SHORT} ${STAMP}}"

export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_GIT_COMMIT="${GIT_FULL}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${MESSAGE}"

echo "Publish dir: $(pwd)"
echo "Git commit: ${GIT_FULL}"
echo "Message: ${MESSAGE}"

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

pnpm exec eas update \
  --channel production \
  --platform ios \
  --environment production \
  --message "${MESSAGE}" \
  --non-interactive

echo "Force OTA published."
