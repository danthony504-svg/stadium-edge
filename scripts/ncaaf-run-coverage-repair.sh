#!/usr/bin/env bash
# Pinned research collectors; no gate changes or secret output.
set -euo pipefail
if [[ $# -eq 0 ]]; then
  echo '{"planOnly":true,"steps":["refresh_current_quotes","repair_matched_team_history"],"maximumPaidOddsRequests":1,"automaticUnlock":false}'
  exit 0
fi
if [[ $# -ne 1 || "$1" != '--execute' ]]; then
  echo 'Usage: bash ncaaf-run-coverage-repair.sh [--execute]' >&2
  exit 1
fi
NCAAF_REPAIR_TMP="$(mktemp -d /tmp/ncaaf-coverage.XXXXXX)"
trap 'rm -rf -- "$NCAAF_REPAIR_TMP"' EXIT
NCAAF_REPAIR_SOURCE='https://raw.githubusercontent.com/danthony504-svg/stadium-edge/2871a7cdccd36ff8b071eaca33256b542532aa76/scripts'
for NCAAF_REPAIR_FILE in ncaaf-capture-history.mjs ncaaf-capture-live-inputs.mjs ncaaf-repair-team-history.mjs; do
  curl -fsSL --connect-timeout 15 --max-time 45 "$NCAAF_REPAIR_SOURCE/$NCAAF_REPAIR_FILE" -o "$NCAAF_REPAIR_TMP/$NCAAF_REPAIR_FILE"
done
(
  cd "$NCAAF_REPAIR_TMP"
  printf '%s\n' \
    '9e6a77ecbcf1f0e7b76e0516c1fe759d7f3f84b6de7172faa795dfd884deff14  ncaaf-capture-history.mjs' \
    '7a0364333878a6b9da29ccbe610d8b893e410d9376f8f1bf76c155d9c323acc9  ncaaf-capture-live-inputs.mjs' \
    '6559507230251cd29f615d835bde9038a82c4cd56bbda721e511a0e9b4778207  ncaaf-repair-team-history.mjs' | sha256sum -c -
  node ncaaf-capture-live-inputs.mjs --execute
  node ncaaf-repair-team-history.mjs --execute
)
