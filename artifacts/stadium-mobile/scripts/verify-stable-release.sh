#!/usr/bin/env bash
# Stable release checklist — device verification required between steps.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"

bash "$(dirname "$0")/ota-release-policy.sh"
echo ""

cat <<'EOF'
════════════════════════════════════════════════════════════
 STABLE RELEASE CHECKLIST
════════════════════════════════════════════════════════════

STEP 1 — iOS development build (OTA off)
  [ ] eas build --profile development --platform ios
  [ ] Install on physical iPhone
  [ ] App opens without red error screen
  [ ] Home, Coach, Props, +500 Steals open
  [ ] Authentication works (sign-in / session)
  [ ] Navigation stable (tabs, menu, back)
  [ ] Stays open ≥ 1 minute; cold launch ×2

STEP 2 — Fix all crashes found in Step 1
  [ ] No startup crash or reload loop
  [ ] Re-test development build after fixes

STEP 3 — TestFlight build (preview profile, OTA off)
  [ ] eas build --profile preview --platform ios
  [ ] Submit to TestFlight (internal)
  [ ] Same checklist as Step 1 on TestFlight binary

STEP 4 — Verify TestFlight BEFORE enabling OTA
  [ ] TestFlight build stable for 24h smoke on device
  [ ] echo "testflight-VERIFIED" > .ota-testflight-verified

STEP 5 — Preview OTA test (preview-ota profile + preview channel)
  [ ] eas build --profile preview-ota --platform ios
  [ ] Publish preview OTA only (never production yet)
  [ ] Manual update: check → download → restart once
  [ ] isEmbeddedLaunch: false after apply; cold launch without rollback

STEP 6 — Production OTA (only after Steps 1–5)
  [ ] Remove .ota-production-freeze
  [ ] Staged promote preview → production (10% rollout)

EOF

echo "Freeze status:"
if [[ -f "$REPO_ROOT/.ota-production-freeze" ]]; then
  echo "  PRODUCTION OTA: FROZEN"
else
  echo "  PRODUCTION OTA: freeze file removed"
fi
if [[ -f "$REPO_ROOT/.ota-testflight-verified" ]]; then
  echo "  TestFlight: VERIFIED — $(cat "$REPO_ROOT/.ota-testflight-verified")"
else
  echo "  TestFlight: NOT verified"
fi
