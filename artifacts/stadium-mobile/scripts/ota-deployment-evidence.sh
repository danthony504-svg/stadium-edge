#!/usr/bin/env bash
# Read-only EAS deployment evidence — no publish.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

export EAS_NO_VCS=1
REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
GIT_FULL="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"

run_cmd() {
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo " $*"
  echo "════════════════════════════════════════════════════════════"
  "$@" 2>&1 || true
}

{
  echo "# OTA deployment evidence"
  echo "Timestamp (UTC): $(date -u +%Y-%m-%dT%H:%MZ)"
  echo "Git HEAD: ${GIT_FULL}"
  echo ""

  run_cmd pnpm exec eas build:list --platform ios --status finished --limit 10 --non-interactive
  run_cmd pnpm exec eas channel:list --non-interactive
  run_cmd pnpm exec eas channel:view production --non-interactive
  run_cmd pnpm exec eas branch:list --non-interactive
  run_cmd pnpm exec eas update:list --channel production --platform ios --non-interactive
  run_cmd pnpm exec expo config --type public
} | tee /tmp/ota-evidence.txt

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo '```' >> "$GITHUB_STEP_SUMMARY"
  cat /tmp/ota-evidence.txt >> "$GITHUB_STEP_SUMMARY"
  echo '```' >> "$GITHUB_STEP_SUMMARY"
fi

cat /tmp/ota-evidence.txt
