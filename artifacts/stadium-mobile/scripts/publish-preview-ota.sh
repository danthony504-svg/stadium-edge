#!/usr/bin/env bash
# Publish a JS-only OTA to the preview channel.
# Run only after Phase 1 passes and preview-ota build is on TestFlight.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
if [[ ! -f "$REPO_ROOT/.ota-phase1-verified" ]] && [[ "${OTA_SKIP_PHASE_GATE:-}" != "1" ]]; then
  echo "WARNING: Phase 1 not signed off (.ota-phase1-verified missing)."
  echo "Publish preview OTA only after development + TestFlight (OTA off) pass."
  echo "Continue anyway with OTA_SKIP_PHASE_GATE=1 if intentional."
  exit 1
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

MESSAGE="${1:-PREVIEW $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo main) $(date -u +%Y-%m-%dT%H:%MZ)}"
export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_OTA_ENABLED="${EXPO_PUBLIC_OTA_ENABLED:-true}"
export EXPO_PUBLIC_OTA_CHANNEL="${EXPO_PUBLIC_OTA_CHANNEL:-preview}"
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
