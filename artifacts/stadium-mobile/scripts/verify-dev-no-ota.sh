#!/usr/bin/env bash
# Confirm OTA is disabled for local dev / Expo Go before building TestFlight.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════════"
echo " DEV / EXPO GO — OTA MUST BE OFF"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Gate: EXPO_PUBLIC_OTA_ENABLED must NOT be 'true' for local dev."
echo "Current shell: EXPO_PUBLIC_OTA_ENABLED=${EXPO_PUBLIC_OTA_ENABLED:-<unset>}"
echo ""

if [[ "${EXPO_PUBLIC_OTA_ENABLED:-}" == "true" ]]; then
  echo "FAIL: Unset EXPO_PUBLIC_OTA_ENABLED or set it to false for Expo Go / dev client testing."
  exit 1
fi

echo "Resolved expo config (OTA should be disabled):"
CFG=$(EXPO_PUBLIC_OTA_ENABLED= pnpm exec expo config --type public --json 2>/dev/null)
ENABLED=$(echo "$CFG" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(j.updates?.enabled ?? 'undefined')")
CHECK=$(echo "$CFG" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(j.updates?.checkAutomatically ?? 'undefined')")
echo "  updates.enabled: $ENABLED"
echo "  updates.checkAutomatically: $CHECK"

if [[ "$ENABLED" == "true" ]] || [[ "$CHECK" == "ON_LOAD" ]]; then
  echo ""
  echo "FAIL: expo config still has OTA enabled without EXPO_PUBLIC_OTA_ENABLED=true"
  exit 1
fi

echo ""
echo "Verify manually:"
echo "  1. pnpm exec expo start  → open in Expo Go"
echo "  2. eas build --profile development → install dev client"
echo "  3. Cold launch ×2, open Home / Coach / Props / Steals"
echo "  4. Account screen should NOT show 'App update' link"
echo ""
echo "PASS: OTA disabled for dev. Do not build TestFlight until the above passes."
