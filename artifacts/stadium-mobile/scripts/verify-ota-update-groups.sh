#!/usr/bin/env bash
# Read-only: list production updates and compare candidate rollback groups.
# Does NOT republish, rollback, or mark any group known-good.
# Requires EXPO_TOKEN. Runtime from app.json (fail closed on mismatch).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required for EAS GraphQL / CLI listing"
  exit 1
fi

# shellcheck disable=SC1091
source scripts/lib/resolve-runtime-version.sh
RUNTIME_VERSION="$(resolve_production_runtime_version)"
export RUNTIME_VERSION
export EAS_NO_VCS=1

GROUP_A="${GROUP_A:-a7b53936-b3a8-4f5a-bc7d-ffe39e373d20}"
GROUP_B="${GROUP_B:-09ff8dbc-98bf-4270-9cbe-8cb62cb7aebc}"

echo "════════════════════════════════════════════════════════════"
echo " OTA UPDATE GROUP VERIFICATION (read-only)"
echo "════════════════════════════════════════════════════════════"
echo "app.json runtimeVersion: ${RUNTIME_VERSION}"
echo "Candidate A: ${GROUP_A}"
echo "Candidate B: ${GROUP_B} (repo history: b9f60bc32 Home premium; script previously hardcoded manifest probe at 1.0.0)"
echo ""
echo "Neither group is known-good until it appears below for runtime ${RUNTIME_VERSION}"
echo "and a device cold-launch on that update succeeds."
echo ""

echo "── Production channel ──"
pnpm exec eas channel:view production --non-interactive 2>&1 || true
echo ""

echo "── Recent production updates (ios) ──"
pnpm exec eas update:list --channel production --platform ios --limit 15 --non-interactive 2>&1 || true
echo ""

echo "── Branch production (recent) ──"
pnpm exec eas branch:view production --non-interactive 2>&1 || true
echo ""

echo "── Manifest probe (runtime ${RUNTIME_VERSION} only) ──"
MANIFEST=$(curl -sS \
  -H "expo-channel-name: production" \
  -H "expo-runtime-version: ${RUNTIME_VERSION}" \
  -H "expo-platform: ios" \
  -H "accept: multipart/mixed,application/expo+json,application/json" \
  "https://u.expo.dev/9af36ab9-f953-4879-9dd2-82807ef7430c" || true)
echo "$MANIFEST" | head -c 2000
echo ""
echo ""
echo "Search the listings above for both group IDs."
echo "If a group only exists under runtime 1.0.0 / 1.0.3, it is NOT a safe 1.1.0 rollback target."
echo "Prefer: eas update:roll-back-to-embedded --runtime-version ${RUNTIME_VERSION} (see rollback-production-ota.sh)."
