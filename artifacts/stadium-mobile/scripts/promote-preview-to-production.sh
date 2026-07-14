#!/usr/bin/env bash
# Promote the exact preview update group tested on TestFlight to production.
# BLOCKED until Phase 2 preview OTA testing is signed off.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
PHASE2_MARKER="$REPO_ROOT/.ota-phase2-verified"

if [[ ! -f "$PHASE2_MARKER" ]] && [[ "${OTA_SKIP_PHASE_GATE:-}" != "1" ]]; then
  echo "BLOCKED: Production OTA promotion requires Phase 2 sign-off."
  echo "Complete every step in: bash scripts/verify-testing-phases.sh 2"
  echo "Then create: $PHASE2_MARKER"
  exit 1
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

PREVIEW_GROUP="${PREVIEW_UPDATE_GROUP:-}"
if [[ -z "$PREVIEW_GROUP" ]]; then
  echo "PREVIEW_UPDATE_GROUP is required (UUID from eas update:list on preview branch)"
  exit 1
fi

ROLLOUT="${ROLLOUT_PERCENTAGE:-10}"
MESSAGE="${1:-PROMOTE preview group ${PREVIEW_GROUP} @ ${ROLLOUT}% rollout}"

export EAS_NO_VCS=1

echo "══ Promote preview → production (staged) ══"
echo "Source group:     ${PREVIEW_GROUP}"
echo "Rollout:          ${ROLLOUT}%"
echo "Message:          ${MESSAGE}"
echo ""

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

echo ""
echo "Republishing tested preview group to production…"
pnpm exec eas update:republish \
  --group "$PREVIEW_GROUP" \
  --destination-channel production \
  --platform ios \
  --rollout-percentage "$ROLLOUT" \
  --message "$MESSAGE" \
  --non-interactive

echo ""
echo "Production channel now serves group ${PREVIEW_GROUP} at ${ROLLOUT}% rollout."
echo "Increase rollout with: ROLLOUT_PERCENTAGE=25 bash scripts/promote-preview-to-production.sh"
