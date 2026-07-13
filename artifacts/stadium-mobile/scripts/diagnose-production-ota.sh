#!/usr/bin/env bash
# Full EAS Update deployment diagnosis for App Store OTA path.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required"
  exit 1
fi

export EAS_NO_VCS=1
BRANCH="${PRODUCTION_BRANCH:-production}"
RUNTIME_VERSION="${RUNTIME_VERSION:-1.0.0}"
PROJECT_ID="9af36ab9-f953-4879-9dd2-82807ef7430c"
UPDATE_URL="https://u.expo.dev/${PROJECT_ID}"
REPO_ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
GIT_FULL="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
PUBLISH_DIR="$(pwd)"

{
  echo "# Stadium Edge — production OTA diagnosis"
  echo
  echo "- **Timestamp (UTC):** $(date -u +%Y-%m-%dT%H:%MZ)"
  echo "- **Git commit:** \`${GIT_FULL}\` (\`${GIT_SHORT}\`)"
  echo "- **Publish folder:** \`${PUBLISH_DIR}\`"
  echo "- **Expected runtime:** \`${RUNTIME_VERSION}\`"
  echo "- **Expected project:** \`${PROJECT_ID}\`"
  echo "- **Expected update URL:** \`${UPDATE_URL}\`"
  echo "- **Expected iOS platform:** ios"
  echo "- **Expected channel:** production"
  echo "- **Expected branch:** ${BRANCH}"
  echo

  echo "## 1. eas channel:view production"
  echo '```'
  pnpm exec eas channel:view production --non-interactive 2>&1 || true
  echo '```'
  echo

  echo "## 2. eas branch:list"
  echo '```'
  pnpm exec eas branch:list --non-interactive 2>&1 || true
  echo '```'
  echo

  echo "## 3. eas branch:view ${BRANCH}"
  echo '```'
  pnpm exec eas branch:view "${BRANCH}" --non-interactive 2>&1 || true
  echo '```'
  echo

  echo "## 4. app.json (bundled into OTA)"
  echo '```json'
  node -e "const j=require('./app.json').expo; console.log(JSON.stringify({version:j.version,runtimeVersion:j.runtimeVersion,projectId:j.extra?.eas?.projectId,updates:j.updates},null,2))"
  echo '```'
  echo

  echo "## 5. Latest iOS production builds"
  echo '```'
  pnpm exec eas build:list --platform ios --limit 5 --non-interactive 2>&1 || true
  echo '```'
} | tee /tmp/ota-diagnosis.md

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat /tmp/ota-diagnosis.md >> "$GITHUB_STEP_SUMMARY"
fi

cat /tmp/ota-diagnosis.md
