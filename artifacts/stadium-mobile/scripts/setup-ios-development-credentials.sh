#!/usr/bin/env bash
# One-time interactive setup for iOS development / internal-distribution credentials.
#
# Run on a machine where you can answer Apple Developer prompts (2FA) and open
# links on your iPhone. Requires eas-cli (pnpm install in repo root first).
#
# After this completes, GitHub Actions "Build iOS development" can run
# non-interactively with --refresh-ad-hoc-provisioning-profile.
#
# Usage (from repo root):
#   cd artifacts/stadium-mobile
#   bash scripts/setup-ios-development-credentials.sh
#
# Or with an existing Expo token (no eas login prompt):
#   EXPO_TOKEN=... bash scripts/setup-ios-development-credentials.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUNDLE_ID="com.stadiumedge.app"
PROFILE="development"

echo "=== Stadium Edge — iOS development credentials (one-time) ==="
echo "Bundle ID: $BUNDLE_ID"
echo "EAS profile: $PROFILE (internal distribution, development client)"
echo ""

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install dependencies from the monorepo root first."
  exit 1
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "Step 0: Log in to Expo (or export EXPO_TOKEN before running this script)"
  pnpm exec eas whoami 2>/dev/null || pnpm exec eas login
else
  export EXPO_TOKEN
  echo "Step 0: Using EXPO_TOKEN for Expo auth"
  pnpm exec eas whoami
fi

echo ""
echo "Step 1: Register your iPhone with EAS / Apple Developer"
echo "  - Choose 'Website' and open the registration URL on your iPhone, OR"
echo "  - Choose 'Input' and paste your device UDID."
echo ""
pnpm exec eas device:create

echo ""
echo "Step 2: Confirm the device is registered"
pnpm exec eas device:list

echo ""
echo "Step 3: Create EAS-managed distribution certificate + ad hoc provisioning profile"
echo "  When prompted:"
echo "  - Log in to your Apple Developer account"
echo "  - Let EAS generate a new Apple Distribution Certificate (if asked)"
echo "  - Select your registered iPhone for the ad hoc profile"
echo "  - Save credentials remotely (EAS-managed, not local)"
echo ""
pnpm exec eas credentials:configure-build \
  --platform ios \
  --profile "$PROFILE"

echo ""
echo "Step 4 (optional sanity check): list iOS credentials for this app"
pnpm exec eas credentials --platform ios

echo ""
echo "=== Done ==="
echo "Credentials are stored on EAS for $BUNDLE_ID."
echo "Re-run GitHub Actions: Build iOS development (branch cursor/ota-redesign-e67e)."
echo "CI uses --refresh-ad-hoc-provisioning-profile so future device registrations"
echo "are picked up without another interactive build."
