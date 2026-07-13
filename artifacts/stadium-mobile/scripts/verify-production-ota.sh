#!/usr/bin/env bash
# Print EAS Update deployment state for App Store debugging.
# Requires EXPO_TOKEN. Run locally or via .github/workflows/verify-production-ota.yml
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

export EAS_NO_VCS=1
RUNTIME_VERSION="${RUNTIME_VERSION:-1.0.0}"
PROJECT_ID="9af36ab9-f953-4879-9dd2-82807ef7430c"
UPDATE_URL="https://u.expo.dev/${PROJECT_ID}"
GIT_HEAD="$(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "════════════════════════════════════════════════════════════"
echo "Stadium Edge — production OTA deployment verification"
echo "Git HEAD (repo): ${GIT_HEAD}"
echo "Expected runtime: ${RUNTIME_VERSION}"
echo "Expected project: ${PROJECT_ID}"
echo "Expected update URL: ${UPDATE_URL}"
echo "════════════════════════════════════════════════════════════"
echo

echo "── Production channel ──"
pnpm exec eas channel:view production --non-interactive || true
echo

echo "── Latest iOS production builds (newest first) ──"
pnpm exec eas build:list --platform ios --limit 8 --non-interactive --json 2>/dev/null \
  | node -e "
const chunks=[]; process.stdin.on('data',d=>chunks.push(d)); process.stdin.on('end',()=>{
  try {
    const rows=JSON.parse(Buffer.concat(chunks).toString());
    for (const b of rows.slice(0,8)) {
      console.log([
        'build#' + (b.appBuildVersion ?? '?'),
        'appVersion=' + (b.appVersion ?? '?'),
        'profile=' + (b.buildProfile ?? '?'),
        'channel=' + (b.channel ?? b.releaseChannel ?? '?'),
        'runtime=' + (b.runtimeVersion ?? '?'),
        'status=' + (b.status ?? '?'),
        'id=' + (b.id ?? '?'),
      ].join(' | '));
    }
  } catch (e) { console.log('(parse error)', e.message); }
});
" || pnpm exec eas build:list --platform ios --limit 8 --non-interactive
echo

echo "── Latest updates on production branch ──"
pnpm exec eas update:list --branch production --limit 6 --non-interactive 2>/dev/null || true
echo

echo "── App config (app.json) ──"
node -e "
const j=require('./app.json').expo;
console.log('app version:', j.version);
console.log('runtimeVersion:', j.runtimeVersion);
console.log('updates.url:', j.updates?.url);
console.log('updates.channel header:', j.updates?.requestHeaders?.['expo-channel-name']);
console.log('checkAutomatically:', j.updates?.checkAutomatically);
console.log('fallbackToCacheTimeout:', j.updates?.fallbackToCacheTimeout);
"
echo
echo "Done. Compare device OTA Debug screen to the latest iOS update ID above."
