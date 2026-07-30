#!/usr/bin/env bash
# Deprecated test entry point. Production channel updates use the release gate.
set -euo pipefail
cd "$(dirname "$0")/.."

exec bash scripts/publish-production-ota.sh "${1:-Production JavaScript OTA}"
