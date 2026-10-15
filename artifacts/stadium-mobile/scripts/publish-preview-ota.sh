#!/usr/bin/env bash
# Publish a JS-only OTA to the **preview** channel only.
# Safe while .ota-production-freeze is armed — does NOT touch production.
#
# Prerequisites:
#   - EXPO_TOKEN
#   - A device binary built with eas.json profile `preview` or `preview-ota`
#     (those bake expo-channel-name=preview). Build 78 / production-channel
#     binaries will NOT see this update.
#
# Usage (from repo, on the commit under test):
#   EXPO_TOKEN=… bash artifacts/stadium-mobile/scripts/publish-preview-ota.sh \
#     'fixpack 6f7d4178 device test'
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(cd ../.. && pwd)"
if [[ -f "$REPO_ROOT/.ota-production-freeze" ]]; then
  echo "NOTE: production OTA freeze is armed — this script publishes preview only."
  echo "      Production channel is untouched."
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required. Create one at https://expo.dev/settings/access-tokens"
  exit 1
fi

SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
FULL="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
MESSAGE="${1:-PREVIEW device-test ${SHORT} $(date -u +%Y-%m-%dT%H:%MZ)}"

export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_OTA_BOOTSTRAP="${EXPO_PUBLIC_OTA_BOOTSTRAP:-true}"
export EXPO_PUBLIC_OTA_USER_BANNER="${EXPO_PUBLIC_OTA_USER_BANNER:-true}"
export EXPO_PUBLIC_GIT_COMMIT="${EXPO_PUBLIC_GIT_COMMIT:-$FULL}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${EXPO_PUBLIC_DEPLOY_MESSAGE:-$MESSAGE}"

# shellcheck disable=SC1091
source scripts/lib/resolve-runtime-version.sh
RUNTIME_VERSION="$(resolve_production_runtime_version)"
export RUNTIME_VERSION
echo "══ Preview OTA (non-production) ══"
echo "commit=${SHORT} runtimeVersion=${RUNTIME_VERSION} channel=preview"
echo "message=${MESSAGE}"

echo "Linking preview channel → preview branch…"
pnpm exec eas channel:edit preview --branch preview --non-interactive

# eas update rejects --channel and --branch together; channel already points at
# branch preview after channel:edit, so publish via --channel only.
pnpm exec eas update \
  --channel preview \
  --platform ios \
  --message "$MESSAGE" \
  --non-interactive

echo ""
echo "Preview OTA published for runtime ${RUNTIME_VERSION}."
echo "Only binaries built with channel=preview (preview / preview-ota profiles) will fetch it."
echo "Production / Build 78 channel=production binaries are unaffected."
echo ""
echo "Verify:"
echo "  pnpm exec eas channel:view preview --non-interactive"
echo "  pnpm exec eas branch:view preview --non-interactive | head -40"
