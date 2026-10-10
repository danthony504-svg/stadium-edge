#!/usr/bin/env bash
# Verify production OTA env vars before any manual publish (CI or local).
set -euo pipefail

REQUIRED=(
  EXPO_PUBLIC_DOMAIN
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
  EXPO_PUBLIC_APP_REVIEW_MODE
  EXPO_PUBLIC_OTA_BOOTSTRAP
  EXPO_PUBLIC_GIT_COMMIT
  EXPO_PUBLIC_DEPLOY_MESSAGE
)

MISSING=0
for key in "${REQUIRED[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "MISSING: $key"
    MISSING=1
  else
    echo "OK: $key=${!key:0:40}…"
  fi
done

# Global App Review Mode must never unlock production soft-premium.
MODE_NORM="$(printf '%s' "${EXPO_PUBLIC_APP_REVIEW_MODE:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if [[ "$MODE_NORM" == "true" ]]; then
  echo "INVALID: EXPO_PUBLIC_APP_REVIEW_MODE must be false in production (got '${EXPO_PUBLIC_APP_REVIEW_MODE}')."
  echo "Premium access is StoreKit / admin / designated review account only."
  MISSING=1
elif [[ -n "${EXPO_PUBLIC_APP_REVIEW_MODE:-}" ]]; then
  echo "OK: EXPO_PUBLIC_APP_REVIEW_MODE is not a global unlock ($MODE_NORM)."
fi

if [[ "$MISSING" -ne 0 ]]; then
  echo ""
  echo "Set all EXPO_PUBLIC_* vars (see eas.json production profile + publish scripts)."
  exit 1
fi

echo ""
echo "All required production env vars present."
