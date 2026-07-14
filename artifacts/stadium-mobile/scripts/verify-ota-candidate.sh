#!/usr/bin/env bash
# Pre-publish checklist — Phase 2 preview OTA or blocked production promotion.
set -euo pipefail
cd "$(dirname "$0")/.."

CHANNEL="${OTA_CHANNEL:-preview}"
RUNTIME="${OTA_RUNTIME:-$(node -e "const v=require('./app.json').expo.version; console.log(v)")}"
REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "════════════════════════════════════════════════════════════"
echo " OTA VERIFICATION GATE"
echo "════════════════════════════════════════════════════════════"
echo "Channel:          ${CHANNEL}"
echo "Runtime version:  ${RUNTIME} (appVersion policy)"
echo "Git commit:       $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo ""

bash "$(dirname "$0")/verify-testing-phases.sh" all

echo ""
if [[ "$CHANNEL" == "production" ]]; then
  if [[ ! -f "$REPO_ROOT/.ota-phase2-verified" ]]; then
    echo "BLOCKED: Production channel — Phase 2 not signed off."
    exit 1
  fi
  echo "Production promotion allowed only after Phase 2 sign-off (marker present)."
else
  if [[ ! -f "$REPO_ROOT/.ota-phase1-verified" ]]; then
    echo "WARNING: Phase 1 not signed off — publish preview OTA only after Phase 1 passes."
  fi
  echo "Preview OTA publish: use after preview-ota build is on TestFlight."
fi

echo ""
echo "Native changes (packages, plugins, native APIs) require a new App Store build — not OTA."

if [[ -n "${EXPO_TOKEN:-}" ]]; then
  echo ""
  echo "── ${CHANNEL} channel manifest ──"
  PROJECT_ID="9af36ab9-f953-4879-9dd2-82807ef7430c"
  curl -sS \
    -H "expo-channel-name: ${CHANNEL}" \
    -H "expo-runtime-version: ${RUNTIME}" \
    -H "expo-platform: ios" \
    -H "accept: multipart/mixed,application/expo+json,application/json" \
    "https://u.expo.dev/${PROJECT_ID}" | head -c 2000 || true
  echo ""
fi
