#!/usr/bin/env bash
# Heal corrupt OTA state: roll back to the embedded fallback, then publish a
# release-gated JavaScript update from the stabilization branch.
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP="$(date -u +%Y-%m-%dT%H:%MZ)"

echo "══ Step 1/2: Roll back production to the embedded fallback ══"
bash scripts/rollback-production-ota.sh "HEAL rollback to embedded ${STAMP}"

echo
echo "══ Step 2/2: Publish release-gated clean OTA ══"
exec bash scripts/publish-production-ota.sh "HEAL-CLEAN ${STAMP}"
