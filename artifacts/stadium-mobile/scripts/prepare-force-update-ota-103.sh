#!/usr/bin/env bash
# Build & (optionally) publish the SMALLEST force-update OTA for native runtime 1.0.3.
#
# This is NOT "label HEAD as 1.0.3". It swaps Expo Router's `app/` for
# `app.forceUpdate/` so Metro never evaluates Clerk, StoreKit, Coach, or tabs.
#
# Does NOT install a native update via OTA — App Store only.
# Does NOT enable server 426 enforcement.
#
# Dry-run (default): prepare + verify bundle, then restore tree. No publish.
# Publish (after approval):
#   FORCE_PUBLISH=1 EXPO_TOKEN=… bash scripts/prepare-force-update-ota-103.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
APP_DIR="$ROOT/app"
FORCE_DIR="$ROOT/app.forceUpdate"
BACKUP_DIR="$ROOT/.app.full.backup.$$"
# Must match the *embedded* Updates.runtimeVersion on the native binary
# (not marketing CFBundleShortVersionString). Confirm on device before publish;
# App Store 1.0.3 submission commits used runtimeVersion "1.0.0", while later
# ops docs assume "1.0.3". Override: RUNTIME_TARGET=1.0.0 …
RUNTIME_TARGET="${RUNTIME_TARGET:-1.0.3}"
CHANNEL="production"

cleanup() {
  if [[ -d "$BACKUP_DIR" ]]; then
    rm -rf "$APP_DIR"
    mv "$BACKUP_DIR" "$APP_DIR"
    echo "Restored app/ from backup"
  fi
  # Restore app.json runtime if we patched it
  if [[ -f "$ROOT/app.json.forceupdate.bak" ]]; then
    mv "$ROOT/app.json.forceupdate.bak" "$ROOT/app.json"
    echo "Restored app.json"
  fi
}
trap cleanup EXIT

if [[ ! -d "$FORCE_DIR" ]]; then
  echo "Missing app.forceUpdate/ — aborting"
  exit 1
fi

echo "==> Swapping app/ → app.forceUpdate/ (runtime-compatible minimal tree)"
rm -rf "$BACKUP_DIR"
mv "$APP_DIR" "$BACKUP_DIR"
cp -R "$FORCE_DIR" "$APP_DIR"

echo "==> Patching app.json runtimeVersion → ${RUNTIME_TARGET} (local only)"
cp app.json app.json.forceupdate.bak
node <<NODE
const fs = require("fs");
const app = JSON.parse(fs.readFileSync("app.json", "utf8"));
const prev = app.expo.runtimeVersion;
app.expo.runtimeVersion = "${RUNTIME_TARGET}";
fs.writeFileSync("app.json", JSON.stringify(app, null, 2) + "\\n");
console.log("runtimeVersion:", prev, "→", app.expo.runtimeVersion);
NODE

export EXPO_PUBLIC_FORCE_UPDATE_ONLY=true
export EXPO_PUBLIC_FORCE_UPDATE_FLOOR=true
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EAS_NO_VCS=1
export ROLLBACK_EMBEDDED=0

OUT_DIR="${FORCE_UPDATE_EXPORT_DIR:-/tmp/stadium-edge-force-update-103}"
rm -rf "$OUT_DIR"
echo "==> Exporting iOS bundle to verify 1.0.3-safe graph → $OUT_DIR"
pnpm exec expo export --platform ios --output-dir "$OUT_DIR"

echo "==> Scanning Hermes/JS export for StoreKit / purchases markers"
# Hermes bytecode is binary — use strings(1) rather than ripgrep on source text.
STRINGS_DUMP="$(mktemp)"
find "$OUT_DIR" \( -name '*.hbc' -o -name '*.js' \) -print0 \
  | xargs -0 strings > "$STRINGS_DUMP" || true
if rg -n "react-native-purchases|RNPurchases|Purchases\.configure|SubscriptionProvider|ClerkProvider" "$STRINGS_DUMP" >/dev/null; then
  echo "FAIL: export still references purchases / Clerk / SubscriptionProvider"
  rg -n "react-native-purchases|RNPurchases|Purchases\.configure|SubscriptionProvider|ClerkProvider" "$STRINGS_DUMP" | head -20
  rm -f "$STRINGS_DUMP"
  exit 1
fi
if ! rg -n "id6776024127" "$STRINGS_DUMP" >/dev/null; then
  echo "FAIL: export missing App Store id 6776024127"
  rm -f "$STRINGS_DUMP"
  exit 1
fi
if ! rg -n "Update Required|requires version 1\.1\.0" "$STRINGS_DUMP" >/dev/null; then
  echo "FAIL: export missing Update Required copy"
  rm -f "$STRINGS_DUMP"
  exit 1
fi
rm -f "$STRINGS_DUMP"
echo "PASS: export free of StoreKit/Clerk markers; App Store CTA present"

echo "==> runtime + channel check"
node -e "const a=require('./app.json'); if(a.expo.runtimeVersion!=='${RUNTIME_TARGET}') process.exit(1); console.log('runtimeVersion:', a.expo.runtimeVersion); console.log('channel header:', a.expo.updates?.requestHeaders);"

if [[ "${FORCE_PUBLISH:-0}" != "1" ]]; then
  cat <<EOF

DRY-RUN complete. Bundle verified at:
  $OUT_DIR
  runtimeTarget: ${RUNTIME_TARGET}

Not published. To publish after approval (confirm device Updates.runtimeVersion first):
  FORCE_PUBLISH=1 EXPO_TOKEN=… RUNTIME_TARGET=${RUNTIME_TARGET} \\
    bash scripts/prepare-force-update-ota-103.sh

If devices report runtime 1.0.0 instead of 1.0.3, dry-run/publish with:
  RUNTIME_TARGET=1.0.0 bash scripts/prepare-force-update-ota-103.sh

Rollback if a published OTA crashes old installs:
  RUNTIME_VERSION=${RUNTIME_TARGET} bash scripts/rollback-production-ota.sh "Rollback force-update OTA"

Server 426 enforcement stays OFF unless MIN_IOS_VERSION_ENFORCEMENT=true.
EOF
  exit 0
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required for FORCE_PUBLISH=1"
  exit 1
fi

MSG="${1:-Force App Store update to 1.1.0 (minimal app.forceUpdate tree, runtime ${RUNTIME_TARGET})}"
echo "==> Publishing OTA (channel=${CHANNEL}, runtime=${RUNTIME_TARGET})"
pnpm exec eas channel:edit production --branch production --non-interactive || true
pnpm exec eas update \
  --channel production \
  --platform ios \
  --environment production \
  --message "$MSG" \
  --non-interactive

echo "Published. Devices on runtime ${RUNTIME_TARGET} / channel production pick this up on next launch."
echo "Server min-version enforcement is still disabled by default."
