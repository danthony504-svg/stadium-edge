#!/usr/bin/env bash
# Publish a JS-only OTA to the production channel. Requires EXPO_TOKEN.
# eas update does NOT inherit eas.json build env — export EXPO_PUBLIC_* before bundling.
set -euo pipefail
cd "$(dirname "$0")/.."

# Repo root is two levels above stadium-mobile (…/artifacts/stadium-mobile → …/).
REPO_ROOT="$(cd ../.. && pwd)"
if [[ -f "$REPO_ROOT/.ota-production-freeze" ]]; then
  echo "PRODUCTION OTA FROZEN (.ota-production-freeze present)."
  echo "Do not publish until a new TestFlight build is verified on device."
  echo "Subscriptions / StoreKit require a native EAS build (runtimeVersion 1.1.0), not OTA."
  exit 1
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required. Create one at https://expo.dev/settings/access-tokens"
  exit 1
fi

MESSAGE="${1:-DEPLOY-VERIFY $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo main) $(date -u +%Y-%m-%dT%H:%MZ)}"
export EAS_NO_VCS=1
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_OTA_BOOTSTRAP="${EXPO_PUBLIC_OTA_BOOTSTRAP:-true}"
export EXPO_PUBLIC_ADMIN_EMAILS="${EXPO_PUBLIC_ADMIN_EMAILS:-danthony504@gmail.com}"
export RUNTIME_VERSION="${RUNTIME_VERSION:-1.0.0}"
export EXPO_PUBLIC_GIT_COMMIT="${EXPO_PUBLIC_GIT_COMMIT:-$(git -C "$(dirname "$0")/../.." rev-parse HEAD 2>/dev/null || echo unknown)}"
export EXPO_PUBLIC_DEPLOY_MESSAGE="${EXPO_PUBLIC_DEPLOY_MESSAGE:-DEPLOY-VERIFY $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null)-$(date -u +%Y%m%d-%H%M%S)}"

echo "Linking production channel → production branch…"
pnpm exec eas channel:edit production --branch production --non-interactive

if [[ "${ROLLBACK_EMBEDDED:-1}" == "1" ]]; then
  echo "Clearing any corrupt OTA before publishing fresh bundle…"
  bash scripts/rollback-production-ota.sh "Pre-publish rollback $(git -C "$(dirname "$0")/../.." rev-parse --short HEAD 2>/dev/null || echo main)"
fi

pnpm exec eas update \
  --channel production \
  --platform ios \
  --environment production \
  --message "$MESSAGE" \
  --non-interactive

echo "OTA published. Devices on this runtimeVersion pick it up on next open."
echo "NOTE: runtime 1.0.3 binaries do NOT include RNPurchases — purchases.ts must"
echo "guard NativeModules.RNPurchases before require (see lib/purchases.ts)."
