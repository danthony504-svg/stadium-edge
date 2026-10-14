# shellcheck shell=bash
# Source from production publish scripts (after cd to artifacts/stadium-mobile).
# Exits 1 when repo-root .ota-production-freeze is present.
# Do NOT source from rollback-production-ota.sh — embedded rollback stays available.

REPO_ROOT="$(cd ../.. && pwd)"
FREEZE_FILE="$REPO_ROOT/.ota-production-freeze"

if [[ -f "$FREEZE_FILE" ]]; then
  echo "PRODUCTION OTA FROZEN (.ota-production-freeze present)."
  echo "────────────────────────────────────────────────────────"
  cat "$FREEZE_FILE"
  echo "────────────────────────────────────────────────────────"
  echo "Blocked: new production JS (publish / force / heal / republish / bootstrap / ota-test)."
  echo "Allowed: diagnose / verify workflows; embedded rollback via rollback-production-ota."
  echo "See docs/build78-ips-crash-diagnosis.md"
  exit 1
fi
