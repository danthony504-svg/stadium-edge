#!/usr/bin/env bash
# Exit 1 if production OTA operations are frozen.
set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
FREEZE_FILE="$REPO_ROOT/.ota-production-freeze"

if [[ -f "$FREEZE_FILE" ]]; then
  echo "════════════════════════════════════════════════════════════"
  echo " PRODUCTION OTA FROZEN"
  echo "════════════════════════════════════════════════════════════"
  cat "$FREEZE_FILE"
  echo ""
  echo "No production OTA publish, republish, heal, force, promote, or rollback"
  echo "until TestFlight verification completes. See scripts/verify-stable-release.sh"
  exit 1
fi

if [[ ! -f "$REPO_ROOT/.ota-testflight-verified" ]]; then
  echo "BLOCKED: Missing .ota-testflight-verified — TestFlight must pass first."
  exit 1
fi

echo "Production OTA freeze lifted; TestFlight verified."
