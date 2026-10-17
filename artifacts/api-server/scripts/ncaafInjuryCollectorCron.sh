#!/usr/bin/env bash
# $0 ESPN CFB injury freeze — for cron only after human sets ACTIVE=1.
# Does not flip NCAAF gates. Does not touch frozen moneyline model.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/artifacts/api-server"
# Refuse unless explicitly activated in the environment (cron env or wrapper).
if [[ "${NCAAF_INJURY_COLLECTOR_ACTIVE:-}" != "1" ]]; then
  echo "{\"status\":\"INACTIVE\",\"reason\":\"NCAAF_INJURY_COLLECTOR_ACTIVE!=1\"}"
  exit 0
fi
exec node --import ./test/register-hooks.mjs ./scripts/ncaafPregameInjurySnapshotCollector.ts
