#!/usr/bin/env bash
# FINAL_EVAL ML archive only — h2h close + T-24h; caps 2100+2100<=4200.
# Does not score FINAL_EVAL, deploy, OTA, unlock, or touch TUNING.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f /tmp/.odds_api_key_env ]]; then
  # shellcheck disable=SC1091
  set -a; . /tmp/.odds_api_key_env; set +a
fi
if [[ -z "${ODDS_API_KEY:-}" ]]; then
  echo "ODDS_API_KEY: ABSENT" >&2
  exit 2
fi
echo "ODDS_API_KEY: PRESENT (len=${#ODDS_API_KEY})"
export NCAAF_FINAL_EVAL_PULL=1
export NCAAF_FINAL_EVAL_PULL_PHASE="${NCAAF_FINAL_EVAL_PULL_PHASE:-both}"
exec python3 -u scripts/ncaafCleanFinalEvalMlArchivePull.py
