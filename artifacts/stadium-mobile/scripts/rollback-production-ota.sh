#!/usr/bin/env bash
# Roll back production OTA to the JS bundle embedded in the native TestFlight build.
# Use this if the current OTA hid Home during App Review and the embedded bundle is older/correct.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required. Create one at https://expo.dev/settings/access-tokens"
  exit 1
fi

export EAS_NO_VCS=1
RUNTIME_VERSION="${RUNTIME_VERSION:-1.0.0}"

pnpm exec eas update:roll-back-to-embedded \
  --branch production \
  --runtime-version "$RUNTIME_VERSION" \
  --platform ios \
  --non-interactive

echo "Rolled back to embedded bundle. Force-quit and reopen the app."
