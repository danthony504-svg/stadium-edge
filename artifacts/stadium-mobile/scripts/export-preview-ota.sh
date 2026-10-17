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

rm -rf dist
pnpm exec expo export --platform ios --output-dir dist

node scripts/prepublish-export-auth-check.mjs --dist dist

BUNDLE="$(find dist/_expo/static/js/ios -name 'entry-*.hbc' -print -quit)"
HASH="$(openssl dgst -sha256 -binary "$BUNDLE" | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
echo "launch_asset=$BUNDLE"
echo "launch_hash=$HASH"
echo "baked_sha=$EXPO_PUBLIC_GIT_COMMIT"
echo "$HASH" > dist/LAUNCH_HASH.txt
echo "$EXPO_PUBLIC_GIT_COMMIT" > dist/BAKED_SHA.txt
echo "Export ready. Publish with: eas update --channel preview --platform ios --skip-bundler --input-dir dist"
