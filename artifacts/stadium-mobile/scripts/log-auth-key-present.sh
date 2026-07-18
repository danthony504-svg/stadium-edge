#!/usr/bin/env bash
# Safe Metro startup check — logs presence only, never the key value.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.local ] && grep -q '^EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=.\+' .env.local; then
  echo "AUTH_KEY_PRESENT=true"
elif [ -n "${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ]; then
  echo "AUTH_KEY_PRESENT=true"
else
  echo "AUTH_KEY_PRESENT=false"
fi
