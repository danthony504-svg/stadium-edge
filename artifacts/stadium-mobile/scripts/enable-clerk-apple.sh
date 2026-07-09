#!/usr/bin/env bash
# Enable Sign in with Apple on the active Clerk instance (Auth pane).
# Run from a machine with Clerk CLI auth — cannot be done from the mobile app.
#
# Dev instance (pk_test): Apple may not stick on Replit-managed dev — use production.
# Production: also add iOS bundle com.stadiumedge.app under Clerk → Native applications.
set -euo pipefail

echo "Enabling Apple SSO on the current Clerk instance…"
npx clerk@latest config patch --json '{"connection_oauth_apple":{"enabled":true}}'

echo "Done. Verify identification_strategies includes oauth_apple / oauth_token_apple:"
npx clerk@latest config get auth_config.identification_strategies 2>/dev/null || true
