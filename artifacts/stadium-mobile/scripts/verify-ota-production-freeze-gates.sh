#!/usr/bin/env bash
# Verify every production publish route sources the freeze gate; rollback must not.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(cd ../.. && pwd)"
FAIL=0

must_gate=(
  scripts/publish-production-ota.sh
  scripts/force-production-ota.sh
  scripts/heal-production-ota.sh
  scripts/republish-stable-production-ota.sh
  scripts/publish-bootstrap-ota.sh
  scripts/publish-ota-test-001.sh
  scripts/publish-ota-test-002.sh
  scripts/prepare-force-update-ota-103.sh
)

echo "Checking freeze gates (must source lib/require-ota-unfrozen.sh or check .ota-production-freeze)…"
for s in "${must_gate[@]}"; do
  if ! grep -qE 'require-ota-unfrozen\.sh|\.ota-production-freeze' "$s"; then
    echo "FAIL: $s has no freeze gate"
    FAIL=1
  else
    echo "OK:   $s"
  fi
done

echo ""
echo "Checking embedded rollback remains ungated…"
# Comments may mention the freeze; fail only on an active gate.
if grep -E '^[[:space:]]*(source |\. ).*require-ota-unfrozen\.sh|[[:space:]]*\[\[.*\.ota-production-freeze' \
  scripts/rollback-production-ota.sh >/dev/null; then
  echo "FAIL: rollback-production-ota.sh must NOT honor .ota-production-freeze"
  FAIL=1
elif grep -q 'Refuse when production OTA frozen' \
  "$REPO_ROOT/.github/workflows/rollback-production-ota.yml"; then
  echo "FAIL: rollback-production-ota.yml must not fail-fast on freeze"
  FAIL=1
else
  echo "OK:   scripts/rollback-production-ota.sh + workflow (ungated)"
fi

echo ""
echo "Checking workflow fail-fast steps…"
for wf in \
  ../../.github/workflows/publish-production-ota.yml \
  ../../.github/workflows/force-production-ota.yml \
  ../../.github/workflows/heal-production-ota.yml \
  ../../.github/workflows/republish-stable-production-ota.yml \
  ../../.github/workflows/bootstrap-ota.yml \
  ../../.github/workflows/ota-test-001.yml \
  ../../.github/workflows/ota-test-002.yml
do
  if [[ ! -f "$wf" ]]; then
    echo "FAIL: missing $wf"
    FAIL=1
    continue
  fi
  if ! grep -q 'ota-production-freeze' "$wf"; then
    echo "FAIL: $wf has no freeze fail-fast step"
    FAIL=1
  else
    echo "OK:   $(basename "$wf")"
  fi
done

echo ""
if [[ -f "$REPO_ROOT/.ota-production-freeze" ]]; then
  echo "Freeze file present at $REPO_ROOT/.ota-production-freeze"
else
  echo "WARN: freeze file absent (gates exist but freeze not armed on this ref)"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "verify-ota-production-freeze-gates: FAILED"
  exit 1
fi
echo ""
echo "verify-ota-production-freeze-gates: PASSED"
