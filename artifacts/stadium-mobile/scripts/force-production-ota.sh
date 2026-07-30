#!/usr/bin/env bash
# Legacy entry point. All production OTA publishing now uses the release gate.
set -euo pipefail
cd "$(dirname "$0")/.."

exec bash scripts/publish-production-ota.sh "${1:-Production JavaScript OTA}"
