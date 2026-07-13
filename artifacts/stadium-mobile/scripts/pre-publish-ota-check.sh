#!/usr/bin/env bash
# Print App Store build + production channel facts BEFORE publishing an OTA test.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

export EAS_NO_VCS=1
PROJECT_ID="9af36ab9-f953-4879-9dd2-82807ef7430c"
UPDATE_URL="https://u.expo.dev/${PROJECT_ID}"
APP_STORE_BUILD_ID="${APP_STORE_BUILD_ID:-98eb8a21-0149-457c-be6e-4e38159f4c11}"
REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
GIT_FULL="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "════════════════════════════════════════════════════════════"
echo " PRE-PUBLISH OTA CHECK"
echo "════════════════════════════════════════════════════════════"
echo "Git commit (publish source): ${GIT_FULL} (${GIT_SHORT})"
echo "Expo project ID:             ${PROJECT_ID}"
echo "Update URL (app.json):       ${UPDATE_URL}"
echo "Runtime version (app.json):  $(node -e "console.log(require('./app.json').expo.runtimeVersion)")"
echo "Channel header (app.json):   $(node -e "console.log(require('./app.json').expo.updates.requestHeaders['expo-channel-name'])")"
echo ""

echo "── App Store iOS build (EAS build:list, build #62) ──"
echo '```'
pnpm exec eas build:list --platform ios --limit 8 --non-interactive 2>&1 | head -80 || true
echo '```'
echo ""

echo "── Production channel → branch ──"
echo '```'
pnpm exec eas channel:view production --non-interactive 2>&1 || true
echo '```'
echo ""

echo "── Production branch (recent updates) ──"
echo '```'
pnpm exec eas branch:view production --non-interactive 2>&1 || true
echo '```'
