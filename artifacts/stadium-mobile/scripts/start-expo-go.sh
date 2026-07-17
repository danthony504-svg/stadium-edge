#!/usr/bin/env bash
# Start Stadium Edge in Expo Go for Phase 1a smoke testing (OTA disabled).
# Run this on your Mac — cloud-hosted tunnels cannot authenticate Expo Go reliably.
set -euo pipefail
cd "$(dirname "$0")/.."

unset CI EXPO_NO_INTERACTIVE 2>/dev/null || true

# shellcheck source=scripts/export-dev-public-env.sh
source "$(dirname "$0")/export-dev-public-env.sh"
# OTA must stay off for Phase 1 — do not set EXPO_PUBLIC_OTA_ENABLED=true

echo "══ Stadium Edge — Expo Go (Phase 1a) ══"
bash scripts/verify-dev-no-ota.sh
echo ""
echo "Starting Metro with tunnel…"
echo "When prompted, choose: Proceed anonymously"
echo ""

exec pnpm exec expo start --tunnel
