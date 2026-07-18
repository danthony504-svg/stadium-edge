#!/usr/bin/env bash
# Print resolved expo-updates config for a given EAS profile env (build-time bake).
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${1:-production}"
case "$PROFILE" in
  production)
    export EXPO_PUBLIC_OTA_ENABLED="${EXPO_PUBLIC_OTA_ENABLED:-true}"
    export EXPO_PUBLIC_OTA_CHANNEL="${EXPO_PUBLIC_OTA_CHANNEL:-production}"
    ;;
  preview-ota)
    export EXPO_PUBLIC_OTA_ENABLED="${EXPO_PUBLIC_OTA_ENABLED:-true}"
    export EXPO_PUBLIC_OTA_CHANNEL="${EXPO_PUBLIC_OTA_CHANNEL:-preview}"
    ;;
  *)
    export EXPO_PUBLIC_OTA_ENABLED="${EXPO_PUBLIC_OTA_ENABLED:-false}"
    export EXPO_PUBLIC_OTA_CHANNEL="${EXPO_PUBLIC_OTA_CHANNEL:-development}"
    ;;
esac

export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"

echo "══ Build-time OTA config (profile: ${PROFILE}) ══"
echo "EXPO_PUBLIC_OTA_ENABLED=${EXPO_PUBLIC_OTA_ENABLED}"
echo "EXPO_PUBLIC_OTA_CHANNEL=${EXPO_PUBLIC_OTA_CHANNEL}"
echo "expo-updates dependency: $(node -e "console.log(require('./package.json').dependencies['expo-updates'])")"
echo ""
pnpm exec expo config --type public --json 2>/dev/null | node -e "
const chunks=[]; process.stdin.on('data',d=>chunks.push(d)); process.stdin.on('end',()=>{
  const j=JSON.parse(Buffer.concat(chunks).toString());
  const rv=j.runtimeVersion?.policy==='appVersion'?j.version:j.runtimeVersion;
  console.log('app version:', j.version);
  console.log('runtimeVersion (resolved):', rv);
  console.log('updates:', JSON.stringify(j.updates, null, 2));
});
"
