#!/usr/bin/env bash
# Start Metro for the iOS/Android development client (EAS development profile).
# Injects EXPO_PUBLIC_* so Clerk and API_BASE resolve when the dev build loads JS from Metro.
set -euo pipefail
cd "$(dirname "$0")/.."

unset CI EXPO_NO_INTERACTIVE 2>/dev/null || true
# EXPO_NO_DOTENV=1 skips .env loading; dev client needs public env from this script instead.
unset EXPO_NO_DOTENV 2>/dev/null || true

# shellcheck source=scripts/export-dev-public-env.sh
source "$(dirname "$0")/export-dev-public-env.sh"

node "$(dirname "$0")/ensure-dev-env-local.mjs" >/dev/null 2>&1 || true

echo "══ Stadium Edge — development client (Metro) ══"
echo "EXPO_PUBLIC_DOMAIN=${EXPO_PUBLIC_DOMAIN}"
echo "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:0:12}…"
echo ""
echo "Connect your EAS development build to this Metro server, then reload."
echo ""

exec pnpm exec expo start "$@"
