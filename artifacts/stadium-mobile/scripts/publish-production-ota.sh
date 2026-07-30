#!/usr/bin/env bash
# Publish a JS-only OTA to the production channel. Requires EXPO_TOKEN.
# This is intentionally limited to the release branch and fingerprint-compatible
# bundles; native/configuration changes require a new App Review binary instead.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${EXPO_TOKEN:-}" == "<token>" || "${EXPO_TOKEN:-}" == "<expo-token>" ]]; then
  unset EXPO_TOKEN
fi
if ! pnpm exec eas whoami --non-interactive >/dev/null 2>&1; then
  echo "Expo authentication is required. Run 'pnpm exec eas login' or set EXPO_TOKEN to a real Expo access token; do not use the literal <token> placeholder."
  exit 1
fi

RELEASE_BRANCH="release/stadium-edge-stabilization"
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$RELEASE_BRANCH" ]]; then
  echo "Refusing OTA publish from '$CURRENT_BRANCH'; publish only from '$RELEASE_BRANCH'."
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing OTA publish with uncommitted changes."
  exit 1
fi
if [[ -z "${EMBEDDED_BUILD_ID:-}" ]]; then
  echo "EMBEDDED_BUILD_ID is required so this update is traceable to its native fallback build."
  exit 1
fi

MESSAGE="${1:-DEPLOY-VERIFY $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo main) $(date -u +%Y-%m-%dT%H:%MZ)}"
export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
unset EXPO_PUBLIC_OTA_BOOTSTRAP
export EXPO_PUBLIC_GIT_COMMIT="${EXPO_PUBLIC_GIT_COMMIT:-$(git -C "$(dirname "$0")/../.." rev-parse HEAD 2>/dev/null || echo unknown)}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${EXPO_PUBLIC_DEPLOY_MESSAGE:-DEPLOY-VERIFY $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null)-$(date -u +%Y%m%d-%H%M%S)}"

RUNTIME_POLICY="$(node -p "require('./app.json').expo.runtimeVersion?.policy ?? ''")"
if [[ "$RUNTIME_POLICY" != "fingerprint" ]]; then
  echo "Refusing OTA publish: expected runtimeVersion.policy=fingerprint, got '$RUNTIME_POLICY'."
  exit 1
fi

echo "Running deterministic release gate before OTA publish…"
pnpm typecheck
pnpm test
pnpm exec expo export --platform ios --output-dir /tmp/stadium-mobile-ota-release

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

UPDATE_JSON="$(pnpm exec eas update \
  --channel production \
  --platform ios \
  --message "$MESSAGE" \
  --environment production \
  --json)"
UPDATE_RECORD="$(node - "$UPDATE_JSON" <<'NODE'
const root = JSON.parse(process.argv[2]);
const find = (value, key) => {
  if (!value || typeof value !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = find(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
};
console.log(JSON.stringify({
  updateId: find(root, "id") ?? find(root, "groupId") ?? "unknown",
  runtimeVersion: find(root, "runtimeVersion") ?? "unknown",
}));
NODE
)"

echo "OTA publish record: ${UPDATE_RECORD} channel=production embedded_build_id=${EMBEDDED_BUILD_ID} commit=${EXPO_PUBLIC_GIT_COMMIT}"
echo "OTA published. Compatible users download it after launch and apply it on their next reload."
