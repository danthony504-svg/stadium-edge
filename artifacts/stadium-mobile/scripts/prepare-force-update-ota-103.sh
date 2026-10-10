#!/usr/bin/env bash
# Publish a JS-only OTA targeting Expo runtimeVersion 1.0.3 that shows the
# full-screen App Store "Update Required" gate.
#
# IMPORTANT:
# - Does NOT install a native update via OTA (App Store only).
# - 1.0.3 binaries only receive OTAs whose runtimeVersion is exactly "1.0.3".
# - Current app.json is 1.1.0 — this script temporarily overrides runtime for
#   the publish working tree (or use the workflow runtime_version input).
# - Keep purchases.ts NativeModules.RNPurchases guards — 1.0.3 lacks StoreKit.
# - Do NOT run without explicit approval (FORCE_PUBLISH=1).
#
# Usage (after approval):
#   FORCE_PUBLISH=1 EXPO_TOKEN=… bash scripts/prepare-force-update-ota-103.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${FORCE_PUBLISH:-0}" != "1" ]]; then
  cat <<'EOF'
Refusing to publish. This script is the approved path for a dedicated 1.0.3
force-update OTA after human approval.

Findings:
  • Installed 1.0.3 apps CAN receive an OTA if published with runtimeVersion=1.0.3
    on the production channel (exact runtime match required by expo-updates).
  • Publishing from current HEAD (runtime 1.1.0) will NOT reach 1.0.3 devices.
  • The update screen must not require RNPurchases / new native modules.

To publish after approval:
  FORCE_PUBLISH=1 EXPO_TOKEN=… \\
    EXPO_PUBLIC_FORCE_UPDATE_FLOOR=true \\
    RUNTIME_VERSION=1.0.3 \\
    bash scripts/prepare-force-update-ota-103.sh
EOF
  exit 1
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

# Runner-local runtime override — never commit.
node <<'NODE'
const fs = require("fs");
const path = "app.json";
const app = JSON.parse(fs.readFileSync(path, "utf8"));
app.expo.runtimeVersion = "1.0.3";
fs.writeFileSync(path, JSON.stringify(app, null, 2) + "\n");
console.log("Patched app.json runtimeVersion -> 1.0.3 (local only)");
NODE

export EXPO_PUBLIC_FORCE_UPDATE_FLOOR=true
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EAS_NO_VCS=1
export ROLLBACK_EMBEDDED="${ROLLBACK_EMBEDDED:-0}"

MSG="${1:-Force App Store update to 1.1.0 for runtime 1.0.3}"
bash scripts/publish-production-ota.sh "$MSG"
