#!/usr/bin/env bash
# Point the production channel at the embedded TestFlight bundle (clears a bad OTA).
# Targets app.json runtimeVersion (currently 1.1.0) — never hardcodes 1.0.3.
# Requires EXPO_TOKEN. Fast — no JS bundling.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required. Create one at https://expo.dev/settings/access-tokens"
  exit 1
fi

# shellcheck disable=SC1091
source scripts/lib/resolve-runtime-version.sh
RUNTIME_VERSION="$(resolve_production_runtime_version)"
export RUNTIME_VERSION

MESSAGE="${1:-Rollback to embedded bundle — fix corrupt OTA}"

export EAS_NO_VCS=1

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

echo "Rolling back production (runtime ${RUNTIME_VERSION}) to embedded…"
echo "NOTE: This clears OTA for runtime ${RUNTIME_VERSION} only — not for 1.0.3 devices."
pnpm exec eas update:roll-back-to-embedded \
  --channel production \
  --runtime-version "$RUNTIME_VERSION" \
  --platform ios \
  --message "$MESSAGE" \
  --non-interactive

echo "Rollback complete for runtime ${RUNTIME_VERSION}."
