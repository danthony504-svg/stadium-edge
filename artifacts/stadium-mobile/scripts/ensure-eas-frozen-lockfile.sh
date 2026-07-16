#!/usr/bin/env bash
# Ensure EAS development builds use pnpm install --frozen-lockfile.
#
# EAS skips frozen lockfile when EAS_NO_FROZEN_LOCKFILE is any non-empty value
# (including "0" or "false") in eas.json or Expo project/account env vars.
# developmentClient: true auto-selects the EAS "development" environment.
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="${1:-all}"

verify_eas_json() {
  node - <<'NODE'
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("eas.json", "utf8"));
const profiles = Object.keys(cfg.build ?? {});
for (const profile of profiles) {
  const value = cfg.build?.[profile]?.env?.EAS_NO_FROZEN_LOCKFILE;
  if (value === undefined) continue;
  console.error(
    `eas.json build.${profile}.env.EAS_NO_FROZEN_LOCKFILE must be removed (got ${JSON.stringify(value)}).`
  );
  process.exit(1);
}
NODE
  echo "eas.json: EAS_NO_FROZEN_LOCKFILE absent from all build profiles."
}

delete_remote_var() {
  local environment="$1"
  local scope="$2"
  local scope_flag="--scope project"
  if [[ "$scope" == "account" ]]; then
    scope_flag="--scope account"
  fi

  if ! pnpm exec eas env:delete "$environment" \
    --variable-name EAS_NO_FROZEN_LOCKFILE \
    $scope_flag \
    --non-interactive 2>&1; then
    return 0
  fi
}

purge_remote_eas_no_frozen_lockfile() {
  if [[ -z "${EXPO_TOKEN:-}" ]]; then
    echo "EXPO_TOKEN not set; skipping remote Expo environment cleanup."
    return 0
  fi

  local deleted=0
  for environment in development preview production; do
    for scope in project account; do
      if output="$(pnpm exec eas env:delete "$environment" \
        --variable-name EAS_NO_FROZEN_LOCKFILE \
        --scope "$scope" \
        --non-interactive 2>&1)"; then
        echo "Deleted EAS_NO_FROZEN_LOCKFILE from Expo $scope/$environment environment."
        deleted=1
      elif [[ "$output" != *'not found'* && "$output" != *'Variable "EAS_NO_FROZEN_LOCKFILE" not found'* ]]; then
        if [[ -n "$output" ]]; then
          echo "$output"
        fi
      fi
    done
  done

  if [[ "$deleted" -eq 0 ]]; then
    echo "Expo project/account environments: EAS_NO_FROZEN_LOCKFILE not found (already absent)."
  fi
}

audit_remote_eas_no_frozen_lockfile() {
  if [[ -z "${EXPO_TOKEN:-}" ]]; then
    echo "EXPO_TOKEN not set; skipping remote Expo environment audit."
    return 0
  fi

  local found=0
  export NO_COLOR=1
  for environment in development preview production; do
    for scope in project account; do
      if pnpm exec eas env:get "$environment" \
        --variable-name EAS_NO_FROZEN_LOCKFILE \
        --scope "$scope" \
        --non-interactive \
        --format short >/dev/null 2>&1; then
        echo "FOUND: Expo $scope/$environment still defines EAS_NO_FROZEN_LOCKFILE"
        found=1
      fi
    done
  done

  if [[ "$found" -ne 0 ]]; then
    return 1
  fi
  echo "Expo project/account environments: EAS_NO_FROZEN_LOCKFILE absent."
}

case "$MODE" in
  --remote-only)
    purge_remote_eas_no_frozen_lockfile
    audit_remote_eas_no_frozen_lockfile
    ;;
  --verify-json-only)
    verify_eas_json
    ;;
  all)
    verify_eas_json
    purge_remote_eas_no_frozen_lockfile
    audit_remote_eas_no_frozen_lockfile
    echo "EAS will use pnpm install --frozen-lockfile for SDK 54 / RN 0.81.5 development builds."
    ;;
  *)
    echo "Usage: $0 [--remote-only|--verify-json-only]" >&2
    exit 1
    ;;
esac
