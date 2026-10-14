#!/usr/bin/env bash
# Print-only: exact rollback / republish commands for Build 78 · runtime 1.1.0.
# Does NOT call EAS, does NOT dispatch GitHub Actions, does NOT publish PR #729.
set -euo pipefail

KNOWN_GOOD_UPDATE_ID="01a13019-8a5f-7f4d-bacb-31b1105de281"
KNOWN_GOOD_GROUP="804902bb-215e-48af-92ee-e17398c22bc1"
KNOWN_GOOD_GIT="0cb3be3c"

cat <<EOF
════════════════════════════════════════════════════════════
 Build 78 / runtime 1.1.0 — rollback commands (print only)
════════════════════════════════════════════════════════════
Last verified working OTA:
  updateId  ${KNOWN_GOOD_UPDATE_ID}
  group     ${KNOWN_GOOD_GROUP}
  git       ${KNOWN_GOOD_GIT}

DO NOT publish PR #729. Build 79 on hold.
Passkey ClerkExpoPasskeys is NOT asserted as the current fatal
(tip 01a136bb fail-softs that throw in agent reproduction).

── Step 1 (recommended): roll back channel to embedded ──
gh workflow run rollback-production-ota.yml \\
  -f message='Build 78 emergency rollback to embedded — clear bad 1.1.0 tip' \\
  -f runtime_version=''

# Or with EXPO_TOKEN locally:
# cd artifacts/stadium-mobile && bash scripts/rollback-production-ota.sh \\
#   'Build 78 emergency rollback to embedded — clear bad 1.1.0 tip'

── Step 2 (optional, after embedded boots): republish known-good group ──
gh workflow run republish-stable-production-ota.yml \\
  -f confirm_publish='REPUBLISH_STABLE' \\
  -f update_group='${KNOWN_GOOD_GROUP}' \\
  -f message='ROLLBACK republish 01a13019 group for Build 78 / 1.1.0'

Never republish: 01a131bc-… (updatePreviouslyFailed).
See scripts/OTA_BUILD78_ROLLBACK_PREP.md for how this reaches
devices that crash before Home.
════════════════════════════════════════════════════════════
EOF
