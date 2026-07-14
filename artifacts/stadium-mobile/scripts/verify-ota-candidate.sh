#!/usr/bin/env bash
# Pre-publish checklist for OTA candidates (preview or production promotion).
# Human verification on a real device is required — this script prints the gate.
set -euo pipefail
cd "$(dirname "$0")/.."

CHANNEL="${OTA_CHANNEL:-preview}"
RUNTIME="${OTA_RUNTIME:-$(node -e "const v=require('./app.json').expo.version; console.log(v)")}"

echo "════════════════════════════════════════════════════════════"
echo " OTA CANDIDATE VERIFICATION GATE"
echo "════════════════════════════════════════════════════════════"
echo "Channel:          ${CHANNEL}"
echo "Runtime version:  ${RUNTIME} (appVersion policy)"
echo "Git commit:       $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo ""
echo "Before promoting to production, confirm on TestFlight / preview build:"
echo ""
echo "  [ ] Cold launch succeeds twice in a row"
echo "  [ ] App stays open for at least 1 minute without crash"
echo "  [ ] Home tab loads"
echo "  [ ] Coach tab loads"
echo "  [ ] Props tab loads"
echo "  [ ] +500 Steals tab loads"
echo "  [ ] Production environment variables (pk_live Clerk, stadium-edge.onrender.com)"
echo "  [ ] No startup errors or reload loops in OTA diagnostics"
echo ""
echo "Promotion flow:"
echo "  1. bash scripts/publish-preview-ota.sh"
echo "  2. Test on preview/TestFlight channel"
echo "  3. PREVIEW_UPDATE_GROUP=<uuid> ROLLOUT_PERCENTAGE=10 bash scripts/promote-preview-to-production.sh"
echo "  4. Increase rollout in stages (10% → 25% → 50% → 100%)"
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
