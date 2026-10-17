#!/usr/bin/env bash
# $0 ESPN CFB injury freeze — cron entrypoint.
# Does not flip NCAAF gates. Does not touch frozen moneyline model.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/artifacts/api-server"
export NCAAF_INJURY_COLLECTOR_ACTIVE="${NCAAF_INJURY_COLLECTOR_ACTIVE:-1}"
export NCAAF_INJURY_SNAPSHOT_DIR="${NCAAF_INJURY_SNAPSHOT_DIR:-$ROOT/artifacts/api-server/var/ncaaf-injury-snapshots}"
mkdir -p "$NCAAF_INJURY_SNAPSHOT_DIR"
exec node --import ./test/register-hooks.mjs ./scripts/ncaafPregameInjurySnapshotCollector.ts
