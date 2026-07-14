#!/usr/bin/env bash
# Republish a known-good update group to production (no new JS bundle).
# Use when recent OTAs crash on boot — gives channel a fresh update id with stable bytes.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

# Home premium layout (b9f60bc32) — last publish before bootstrap auto-reload crash chain.
STABLE_UPDATE_GROUP="${STABLE_UPDATE_GROUP:-09ff8dbc-98bf-4270-9cbe-8cb62cb7aebc}"
STABLE_UPDATE_ID_REF="${STABLE_UPDATE_ID_REF:-019f5e93-79ad-7711-858f-a7cf8387c7fd}"
STABLE_GIT_SHORT="${STABLE_GIT_SHORT:-b9f60bc32}"
MESSAGE="${1:-ROLLBACK stable OTA ${STABLE_GIT_SHORT} (republish group ${STABLE_UPDATE_GROUP})}"

export EAS_NO_VCS=1

echo "══ Republish stable production OTA ══"
echo "Source group:  ${STABLE_UPDATE_GROUP}"
echo "Reference id:  ${STABLE_UPDATE_ID_REF}"
echo "Message:       ${MESSAGE}"
echo ""

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

echo ""
echo "Republishing stable update group to production channel…"
pnpm exec eas update:republish \
  --group "$STABLE_UPDATE_GROUP" \
  --channel production \
  --platform ios \
  --message "$MESSAGE" \
  --non-interactive

echo ""
echo "Verifying production channel manifest…"
MANIFEST=$(curl -sS \
  -H "expo-channel-name: production" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-platform: ios" \
  -H "accept: multipart/mixed,application/expo+json,application/json" \
  "https://u.expo.dev/9af36ab9-f953-4879-9dd2-82807ef7430c")

NEW_ID=$(echo "$MANIFEST" | rg -o '"id":"[0-9a-f-]{36}"' | head -1 | cut -d'"' -f4 || true)
echo "Production channel now serves update id: ${NEW_ID:-unknown}"
echo "Stable reference id was: ${STABLE_UPDATE_ID_REF}"
