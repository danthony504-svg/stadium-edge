#!/usr/bin/env bash
# Public EXPO_PUBLIC_* defaults for local Metro / iOS dev client.
# Publishable Clerk keys are client-side identifiers (not secrets); production
# builds still set these via eas.json or CI env.
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-stadium-edge.onrender.com}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-${CLERK_PUBLISHABLE_KEY:-pk_test_cHJvZm91bmQtcmFwdG9yLTkyLmNsZXJrLmFjY291bnRzLmRldiQ}}"
export EXPO_PUBLIC_APP_REVIEW_MODE="${EXPO_PUBLIC_APP_REVIEW_MODE:-false}"
export EXPO_PUBLIC_OTA_ENABLED="${EXPO_PUBLIC_OTA_ENABLED:-false}"
export EXPO_PUBLIC_OTA_CHANNEL="${EXPO_PUBLIC_OTA_CHANNEL:-development}"
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export EXPO_PUBLIC_GIT_COMMIT="${EXPO_PUBLIC_GIT_COMMIT:-$(git -C "${_SCRIPT_DIR}/../.." rev-parse HEAD 2>/dev/null || echo unknown)}"
