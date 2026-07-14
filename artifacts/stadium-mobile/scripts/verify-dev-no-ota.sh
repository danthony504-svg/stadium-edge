#!/usr/bin/env bash
# Confirm OTA is disabled for local dev / Expo Go before Phase 1 builds.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════════"
echo " PHASE 1 GATE — OTA MUST BE OFF"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Expo Go = basic JS smoke test only."
echo "Real tests = iOS development build + TestFlight (preview profile)."
echo ""
echo "Gate: EXPO_PUBLIC_OTA_ENABLED must NOT be 'true' for local dev."
echo "Current shell: EXPO_PUBLIC_OTA_ENABLED=${EXPO_PUBLIC_OTA_ENABLED:-<unset>}"
echo ""

if [[ "${EXPO_PUBLIC_OTA_ENABLED:-}" == "true" ]]; then
  echo "FAIL: Unset EXPO_PUBLIC_OTA_ENABLED for Expo Go / development / preview builds."
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
echo "Full checklist: bash scripts/verify-testing-phases.sh 1"
echo ""
echo "PASS: OTA disabled for Phase 1. Next:"
echo "  1. Expo Go smoke test"
echo "  2. eas build --profile development --platform ios"
echo "  3. eas build --profile preview --platform ios  (TestFlight, OTA off)"
