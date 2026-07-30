#!/usr/bin/env bash
# Point the production channel at the embedded TestFlight bundle (clears a bad OTA).
# Requires EXPO_TOKEN. Fast — no JS bundling.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required. Create one at https://expo.dev/settings/access-tokens"
  exit 1
fi

RELEASE_BRANCH="release/stadium-edge-stabilization"
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$RELEASE_BRANCH" ]]; then
  echo "Refusing rollback from '$CURRENT_BRANCH'; run it from '$RELEASE_BRANCH'."
  exit 1
fi

RUNTIME_VERSION="${RUNTIME_VERSION:-}"
if [[ -z "$RUNTIME_VERSION" ]]; then
  echo "RUNTIME_VERSION is required. Copy it from the EAS production build or OTA publish record."
  exit 1
fi
MESSAGE="${1:-Rollback to embedded bundle — fix corrupt OTA}"

export EAS_NO_VCS=1

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

echo "Rolling back production (runtime ${RUNTIME_VERSION}) to embedded…"
pnpm exec eas update:roll-back-to-embedded \
  --channel production \
  --runtime-version "$RUNTIME_VERSION" \
  --platform ios \
  --message "$MESSAGE" \
  --non-interactive

echo "Rollback published. Users pick it up on next app open (force-quit + reopen)."
