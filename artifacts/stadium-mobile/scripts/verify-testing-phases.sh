#!/usr/bin/env bash
# Phased OTA testing plan — human sign-off required between phases.
# Production OTA stays frozen until every step in Phase 1 and Phase 2 passes.
set -euo pipefail
cd "$(dirname "$0")/.."

PHASE="${1:-all}"

print_phase1() {
  cat <<'EOF'
════════════════════════════════════════════════════════════
 PHASE 1 — OTA DISABLED (must pass before any OTA build)
════════════════════════════════════════════════════════════

Expo Go is a basic JavaScript smoke test only.
The iOS development build and TestFlight build are the real tests
(native config + Expo Updates runtime, with OTA still off).

── 1a. Expo Go (JS smoke only) ──
  [ ] pnpm exec expo start → open in Expo Go
  [ ] Home, Coach, Props, +500 Steals open
  [ ] No redbox / crash on first navigation

── 1b. iOS development build (EAS profile: development) ──
  [ ] eas build --profile development --platform ios
  [ ] Install dev client, connect to Metro
  [ ] Cold launch succeeds twice in a row
  [ ] Home, Coach, Props, +500 Steals all open
  [ ] App stays open ≥ 1 minute — no crash or reload loop
  [ ] Account has NO "App update" link (OTA disabled)

── 1c. TestFlight build with OTA disabled (EAS profile: preview) ──
  [ ] eas build --profile preview --platform ios
  [ ] Submit to TestFlight (internal)
  [ ] Cold launch ×2 on device
  [ ] Home, Coach, Props, +500 Steals all open
  [ ] App stays open ≥ 1 minute — no crash or reload loop
  [ ] Account has NO "App update" link

After Phase 1: touch .ota-phase1-verified (repo root) to record sign-off.
  echo "phase1-$(date -u +%Y-%m-%dT%H:%MZ)" > ../../.ota-phase1-verified

EOF
}

print_phase2() {
  cat <<'EOF'
════════════════════════════════════════════════════════════
 PHASE 2 — PREVIEW OTA ENABLED (separate build only)
════════════════════════════════════════════════════════════

Requires .ota-phase1-verified in repo root.

── 2a. Build preview-ota binary (OTA ON, preview channel) ──
  [ ] eas build --profile preview-ota --platform ios
  [ ] Install on TestFlight / internal — opens from embedded bundle
  [ ] isEmbeddedLaunch: true on first open
  [ ] Account shows "App update" link

── 2b. Publish preview OTA (workflow: Publish preview OTA) ──
  [ ] bash scripts/publish-preview-ota.sh
  [ ] Preview channel serves update for this runtime version

── 2c. Manual update flow on device ──
  [ ] Account → App update → Check for update → update detected
  [ ] Download update → succeeds
  [ ] Restart now → app restarts exactly once (no reload loop)
  [ ] After restart: isEmbeddedLaunch: false
  [ ] updateId changed from embedded

── 2d. Cold launch after OTA apply ──
  [ ] Force-quit, cold launch again
  [ ] OTA bundle loads (isEmbeddedLaunch: false)
  [ ] No updatePreviouslyFailed / emergency rollback
  [ ] Home, Coach, Props, +500 Steals still open

After Phase 2: touch .ota-phase2-verified (repo root).
  echo "phase2-$(date -u +%Y-%m-%dT%H:%MZ)" > ../../.ota-phase2-verified

EOF
}

print_production_block() {
  cat <<'EOF'
════════════════════════════════════════════════════════════
 PRODUCTION — BLOCKED until Phase 2 verified
════════════════════════════════════════════════════════════

Do NOT:
  • eas build --profile production (OTA still off until promotion)
  • Publish production OTA workflow
  • Promote preview OTA to production workflow

Production promotion requires .ota-phase2-verified in repo root.
Only then enable EXPO_PUBLIC_OTA_ENABLED=true on production profile
and run staged promote-preview-to-production.sh.

EOF
}

case "$PHASE" in
  1|phase1) print_phase1 ;;
  2|phase2) print_phase2 ;;
  production|prod) print_production_block ;;
  all|*)
    print_phase1
    echo ""
    print_phase2
    echo ""
    print_production_block
    ;;
esac

REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
if [[ -f "$REPO_ROOT/.ota-phase1-verified" ]]; then
  echo "Status: Phase 1 signed off — $(cat "$REPO_ROOT/.ota-phase1-verified")"
else
  echo "Status: Phase 1 NOT signed off"
fi
if [[ -f "$REPO_ROOT/.ota-phase2-verified" ]]; then
  echo "Status: Phase 2 signed off — $(cat "$REPO_ROOT/.ota-phase2-verified")"
else
  echo "Status: Phase 2 NOT signed off — production OTA blocked"
fi
