#!/usr/bin/env bash
# Verify production OTA deployment, then publish to the App Store channel.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

export EAS_NO_VCS=1
REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
GIT_FULL="$(git -C "$REPO_ROOT" rev-parse HEAD)"
GIT_SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
CHANNEL="${OTA_CHANNEL:-production}"
BRANCH="${OTA_BRANCH:-production}"
MESSAGE="${OTA_MESSAGE:-Fix AI Coach scan final handoff}"
APP_VERSION="$(node -e "console.log(require('./app.json').expo.version)")"
RUNTIME_VERSION="$(node -e "
const rv = require('./app.json').expo.runtimeVersion;
if (typeof rv === 'string') console.log(rv);
else if (rv?.policy === 'appVersion') console.log(require('./app.json').expo.version);
else console.log(JSON.stringify(rv));
")"
PROJECT_ID="9af36ab9-f953-4879-9dd2-82807ef7430c"

section() {
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "$1"
  echo "════════════════════════════════════════════════════════════"
}

section "CONFIG (repo)"
echo "Git commit:        ${GIT_FULL} (${GIT_SHORT})"
echo "app.json version:  ${APP_VERSION}"
echo "runtimeVersion:    ${RUNTIME_VERSION} (appVersion policy → ${APP_VERSION})"
echo "Expected channel:  ${CHANNEL}"
echo "Expected branch:   ${BRANCH}"
echo "Project ID:        ${PROJECT_ID}"

section "1. eas channel:list"
pnpm exec eas channel:list --non-interactive 2>&1 || true

section "2. eas channel:view production"
pnpm exec eas channel:view production --non-interactive 2>&1 || true

section "3. eas update:list (production branch)"
pnpm exec eas update:list --branch production --limit 8 --non-interactive 2>&1 || true

section "4. Latest iOS builds (channel + runtime)"
pnpm exec eas build:list --platform ios --limit 10 --non-interactive --json 2>/dev/null \
  | node -e "
const chunks=[]; process.stdin.on('data',d=>chunks.push(d)); process.stdin.on('end',()=>{
  try {
    const raw = Buffer.concat(chunks).toString().trim();
    const start = raw.indexOf('[');
    const rows = JSON.parse(start >= 0 ? raw.slice(start) : raw);
    const prod = rows.filter(b => (b.channel || b.releaseChannel || '') === 'production' || b.buildProfile === 'production');
    const show = (prod.length ? prod : rows).slice(0, 6);
    for (const b of show) {
      console.log([
        'build#' + (b.appBuildVersion ?? '?'),
        'appVersion=' + (b.appVersion ?? '?'),
        'profile=' + (b.buildProfile ?? '?'),
        'channel=' + (b.channel ?? b.releaseChannel ?? '?'),
        'runtime=' + (b.runtimeVersion ?? '?'),
        'status=' + (b.status ?? '?'),
      ].join(' | '));
    }
  } catch (e) { console.log('(parse error)', e.message); }
});
" || pnpm exec eas build:list --platform ios --limit 6 --non-interactive 2>/dev/null || true

section "4b. Complete any in-progress rollout (blocks new publishes)"
ROLLING_GROUP="$(pnpm exec eas update:list --branch production --limit 1 --json --non-interactive 2>/dev/null \
  | node -e "
const chunks=[]; process.stdin.on('data',d=>chunks.push(d)); process.stdin.on('end',()=>{
  try {
    const raw = Buffer.concat(chunks).toString().trim();
    const start = raw.indexOf('[');
    const rows = JSON.parse(start >= 0 ? raw.slice(start) : raw);
    const g = rows[0];
    if (!g) return;
    const pct = g.rolloutPercentage ?? g.rollout?.percentage;
    if (pct != null && pct < 100) console.log(g.group ?? g.id ?? '');
  } catch {}
});
" || true)"
if [[ -n "${ROLLING_GROUP}" ]]; then
  echo "Completing rollout for group ${ROLLING_GROUP} → 100%…"
  pnpm exec eas update:edit "${ROLLING_GROUP}" --rollout-percentage 100 --non-interactive 2>&1 || true
else
  echo "No partial rollout on production branch."
fi

section "5. Publish OTA → channel ${CHANNEL}"
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_OTA_ENABLED="${EXPO_PUBLIC_OTA_ENABLED:-true}"
export EXPO_PUBLIC_OTA_CHANNEL="${CHANNEL}"
export EXPO_PUBLIC_GIT_COMMIT="${GIT_FULL}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${MESSAGE} ${GIT_SHORT} $(date -u +%Y-%m-%dT%H:%MZ)"

echo "Linking ${CHANNEL} channel → ${BRANCH} branch…"
pnpm exec eas channel:edit "${CHANNEL}" --branch "${BRANCH}" --non-interactive

pnpm exec eas update \
  --branch "${BRANCH}" \
  --platform ios \
  --environment production \
  --message "${MESSAGE}" \
  --non-interactive

echo "Re-linking ${CHANNEL} channel → ${BRANCH} branch after publish…"
pnpm exec eas channel:edit "${CHANNEL}" --branch "${BRANCH}" --non-interactive

section "6. Post-publish: eas update:list (production branch)"
pnpm exec eas update:list --branch production --limit 3 --non-interactive 2>&1 || true

section "7. Post-publish: eas channel:view production"
pnpm exec eas channel:view production --non-interactive 2>&1 || true

echo ""
echo "Published summary:"
echo "  channel:         ${CHANNEL}"
echo "  branch:          ${BRANCH}"
echo "  platform:        ios"
echo "  runtimeVersion:  ${RUNTIME_VERSION}"
echo "  commit:          ${GIT_FULL}"
echo "  message:         ${MESSAGE}"
