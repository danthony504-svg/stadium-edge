#!/usr/bin/env bash
# Verify production OTA env vars before any manual publish (CI or local).
set -euo pipefail

REQUIRED=(
  EXPO_PUBLIC_DOMAIN
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
  EXPO_PUBLIC_APP_REVIEW_MODE
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

if [[ "$MISSING" -ne 0 ]]; then
  echo ""
  echo "Set all EXPO_PUBLIC_* vars (see eas.json production profile + publish scripts)."
  exit 1
fi

echo ""
echo "All required production env vars present."
