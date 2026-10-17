#!/usr/bin/env bash
# TUNING-only Odds historical closes pull. Hard credit cap 4500.
# Does not touch FINAL_EVAL, deploy, OTA, or NCAAF gate.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source /tmp/.odds_api_key_env
if [[ -z "${ODDS_API_KEY:-}" ]]; then
  echo "ERROR: ODDS_API_KEY unset" >&2
  exit 2
fi
echo "ODDS_API_KEY: PRESENT (len=${#ODDS_API_KEY})"
export NCAAF_E2B_FIXTURE=test/fixtures/ncaaf-tuning-2025-w1-7-games.json
export NCAAF_E2B_OUT_STEM=ncaaf-tuning-2025-w1-7-closing-lines
export NCAAF_E2B_CREDIT_CAP=4500
export NCAAF_E2B_CREDITS_ALREADY_SPENT="${NCAAF_E2B_CREDITS_ALREADY_SPENT:-20}"
export NCAAF_E2B_MARKETS=h2h,spreads
mkdir -p /opt/cursor/artifacts
exec python3 scripts/ncaafPhaseE2bClosingLines.py
