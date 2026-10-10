#!/usr/bin/env bash
# Republish an existing update group to production (no new JS bundle).
# Runtime is ALWAYS resolved from app.json via resolve-runtime-version.sh (fail closed).
# Do NOT assume any default group is known-good — pass STABLE_UPDATE_GROUP explicitly
# after verifying the group against the current runtime (see verify-ota-update-groups.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

# shellcheck disable=SC1091
source scripts/lib/resolve-runtime-version.sh
RUNTIME_VERSION="$(resolve_production_runtime_version)"
export RUNTIME_VERSION

if [[ -z "${STABLE_UPDATE_GROUP:-}" ]]; then
  echo "FAIL: STABLE_UPDATE_GROUP is required (no implicit known-good default)." >&2
  echo "Verify candidates with: bash scripts/verify-ota-update-groups.sh" >&2
  echo "Documented candidates (unverified until listed against runtime ${RUNTIME_VERSION}):" >&2
  echo "  a7b53936-b3a8-4f5a-bc7d-ffe39e373d20" >&2
  echo "  09ff8dbc-98bf-4270-9cbe-8cb62cb7aebc  (git b9f60bc32 / Home premium era — historically 1.0.0)" >&2
  exit 1
fi

STABLE_UPDATE_ID_REF="${STABLE_UPDATE_ID_REF:-}"
STABLE_GIT_SHORT="${STABLE_GIT_SHORT:-unknown}"
MESSAGE="${1:-ROLLBACK republish group ${STABLE_UPDATE_GROUP} runtime ${RUNTIME_VERSION}}"

export EAS_NO_VCS=1

echo "══ Republish production OTA ══"
echo "Runtime:       ${RUNTIME_VERSION} (from app.json; mismatches fail closed)"
echo "Source group:  ${STABLE_UPDATE_GROUP}"
echo "Reference id:  ${STABLE_UPDATE_ID_REF:-"(unset)"}"
echo "Git short:     ${STABLE_GIT_SHORT}"
echo "Message:       ${MESSAGE}"
echo ""

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

echo ""
echo "Republishing update group to production channel…"
pnpm exec eas update:republish \
  --group "$STABLE_UPDATE_GROUP" \
  --destination-channel production \
  --platform ios \
  --message "$MESSAGE" \
  --non-interactive

echo ""
echo "Verifying production channel manifest for runtime ${RUNTIME_VERSION}…"
MANIFEST=$(curl -sS \
  -H "expo-channel-name: production" \
  -H "expo-runtime-version: ${RUNTIME_VERSION}" \
  -H "expo-platform: ios" \
  -H "accept: multipart/mixed,application/expo+json,application/json" \
  "https://u.expo.dev/9af36ab9-f953-4879-9dd2-82807ef7430c" || true)

NEW_ID=$(echo "$MANIFEST" | grep -oE '"id":"[0-9a-f-]{36}"' | head -1 | cut -d'"' -f4 || true)
echo "Production channel now serves update id: ${NEW_ID:-unknown}"
if [[ -n "$STABLE_UPDATE_ID_REF" ]]; then
  echo "Stable reference id was: ${STABLE_UPDATE_ID_REF}"
fi
if [[ -z "$NEW_ID" ]]; then
  echo "WARN: Could not parse update id from manifest (check Expo auth / channel)." >&2
fi
