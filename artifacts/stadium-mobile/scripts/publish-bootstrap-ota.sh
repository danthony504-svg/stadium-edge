#!/usr/bin/env bash
# Deprecated compatibility entry point. Production updates now share one
# startup behavior and must pass the standard release-gated publish script.
set -euo pipefail
cd "$(dirname "$0")/.."

exec bash scripts/publish-production-ota.sh "${1:-Production JavaScript OTA}"
