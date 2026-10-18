#!/usr/bin/env bash
# Export an iOS preview OTA dist with forced public auth + SHA bake.
# Does NOT publish. Production stays frozen — this is preview-only prep.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(cd ../.. && pwd)"
MOBILE_SHA="${EXPO_PUBLIC_GIT_COMMIT:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
# Force overwrite any stale shell bake (see launch-asset SHA reconcile docs).
export EXPO_PUBLIC_GIT_COMMIT="$MOBILE_SHA"
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
# Public publishable key only — never CLERK_SECRET_KEY / sk_*.
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"

# Refuse secret leakage into the client env before Metro runs.
unset CLERK_SECRET_KEY CLERK_SECRET EXPO_PUBLIC_CLERK_SECRET_KEY EXPO_PUBLIC_CLERK_SECRET || true

echo "══ export-preview-ota ═══════════════════════════════════════"
echo "EXPO_PUBLIC_GIT_COMMIT=${EXPO_PUBLIC_GIT_COMMIT}"
echo "EXPO_PUBLIC_DOMAIN=${EXPO_PUBLIC_DOMAIN}"
echo "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:0:12}…"

node scripts/prepublish-export-auth-check.mjs

# Metro can cache empty EXPO_PUBLIC_* inlines from a prior bad export — always clear.
rm -rf dist .expo/metro-cache node_modules/.cache
pnpm exec expo export --platform ios --output-dir dist --clear

node scripts/prepublish-export-auth-check.mjs --dist dist

BUNDLE="$(find dist/_expo/static/js/ios -name 'entry-*.hbc' -print -quit)"
HASH="$(openssl dgst -sha256 -binary "$BUNDLE" | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
echo "launch_asset=$BUNDLE"
echo "launch_hash=$HASH"
echo "baked_sha=$EXPO_PUBLIC_GIT_COMMIT"
# Sanity: empty-key startup sentinel must be DCE'd when key is baked at the
# expression RootLayoutContent reads (see STARTUP_AUTH_KEY_MISSING_SENTINEL).
if rg -a -q "STARTUP_AUTH_KEY_MISSING_SENTINEL" "$BUNDLE"; then
  echo "FAIL: launch asset still contains STARTUP_AUTH_KEY_MISSING_SENTINEL — key not inlined at startup." >&2
  exit 1
fi
if ! rg -a -q "$EXPO_PUBLIC_GIT_COMMIT" "$BUNDLE"; then
  echo "FAIL: forced EXPO_PUBLIC_GIT_COMMIT not present in launch asset." >&2
  exit 1
fi
echo "$HASH" > dist/LAUNCH_HASH.txt
echo "$EXPO_PUBLIC_GIT_COMMIT" > dist/BAKED_SHA.txt
echo "Export ready."
echo ""
echo "IMPORTANT: Hermes .hbc bytes are non-deterministic across clean exports of the"
echo "same source SHA. openssl launch_hash will change if you re-export. After this"
echo "hash is authorized, freeze dist/ (e.g. copy to .ota-publish-input-*/) and"
echo "publish ONLY that frozen directory with --skip-bundler — never re-bundle."
echo ""
echo "Verify frozen input: bash scripts/verify-frozen-ota-publish-input.sh <dir> --expect-sha \$EXPO_PUBLIC_GIT_COMMIT --expect-hash $HASH"
echo "Publish: eas update --channel preview --platform ios --skip-bundler --input-dir <frozen-dir>"
