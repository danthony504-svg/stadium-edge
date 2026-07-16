#!/usr/bin/env bash
# Ensure EAS development builds use pnpm install --frozen-lockfile.
#
# Sources of --no-frozen-lockfile on EAS workers:
# 1. EAS_NO_FROZEN_LOCKFILE set in Expo project/account env vars (any non-empty value)
# 2. Legacy default iOS builder post-prebuild install (hardcoded in eas-cli prebuildAsync)
#    — fixed by development-ios.yml custom workflow using eas/prebuild + eas/install_node_modules
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="${1:-all}"

verify_eas_json() {
  node - <<'NODE'
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("eas.json", "utf8"));
for (const profile of Object.keys(cfg.build ?? {})) {
  const frozen = cfg.build?.[profile]?.env?.EAS_NO_FROZEN_LOCKFILE;
  if (frozen !== undefined) {
    console.error(
      `eas.json build.${profile}.env.EAS_NO_FROZEN_LOCKFILE must be removed (got ${JSON.stringify(frozen)}).`
    );
    process.exit(1);
  }
  const runtimeVersion = cfg.build?.[profile]?.runtimeVersion;
  if (runtimeVersion !== undefined) {
    console.error(
      `eas.json build.${profile}.runtimeVersion is not allowed (got ${JSON.stringify(runtimeVersion)}). ` +
        "Set expo.runtimeVersion in app.json or app.config.js instead."
    );
    process.exit(1);
  }
}
const appJson = JSON.parse(fs.readFileSync("app.json", "utf8"));
const runtimeVersion = appJson.expo?.runtimeVersion;
if (!runtimeVersion) {
  console.error("app.json expo.runtimeVersion is required (e.g. { policy: \"appVersion\" }).");
  process.exit(1);
}
NODE
  echo "eas.json: EAS_NO_FROZEN_LOCKFILE and runtimeVersion absent from all build profiles."
  echo "app.json: expo.runtimeVersion policy is set."
}

verify_custom_ios_workflow() {
  if [[ ! -f ".eas/build/development-ios.yml" ]]; then
    echo "ERROR: missing .eas/build/development-ios.yml custom workflow" >&2
    exit 1
  fi
  if ! node -e "
    const fs = require('fs');
    const cfg = require('./eas.json');
    const config = cfg.build?.development?.ios?.config;
    if (config !== 'development-ios.yml') {
      console.error('eas.json development.ios.config must be development-ios.yml (got ' + config + ')');
      process.exit(1);
    }
    const workflow = fs.readFileSync('.eas/build/development-ios.yml', 'utf8');
    if (/^\s*-\s+eas\/prebuild\b/m.test(workflow)) {
      console.error('development-ios.yml must not use eas/prebuild step (it re-runs install after prebuild)');
      process.exit(1);
    }
    if (!workflow.includes('expo prebuild --no-install')) {
      console.error('development-ios.yml must run expo prebuild --no-install');
      process.exit(1);
    }
    if (!workflow.includes('git checkout -- package.json')) {
      console.error('development-ios.yml must restore package.json after prebuild');
      process.exit(1);
    }
    if (/^\s*env:\s*$/m.test(workflow)) {
      console.error('development-ios.yml run steps must use inputs, not env (EAS custom builds do not support run.env)');
      process.exit(1);
    }
    const installIdx = workflow.indexOf('eas/install_node_modules');
    const prebuildIdx = workflow.indexOf('expo prebuild --no-install');
    if (installIdx < 0 || prebuildIdx < 0 || installIdx > prebuildIdx) {
      console.error('development-ios.yml must install node_modules before prebuild');
      process.exit(1);
    }
  "; then
    exit 1
  fi
  echo "eas.json: development iOS uses custom workflow development-ios.yml (install before prebuild, no post-prebuild install)."
}

purge_remote_eas_no_frozen_lockfile() {
  if [[ -z "${EXPO_TOKEN:-}" ]]; then
    echo "EXPO_TOKEN not set; skipping remote Expo environment cleanup."
    return 0
  fi

  export EXPO_NO_DOTENV=1
  local deleted=0
  for environment in development preview production; do
    for scope in project account; do
      set +e
      output="$(pnpm exec eas env:delete "$environment" \
        --variable-name EAS_NO_FROZEN_LOCKFILE \
        --scope "$scope" \
        --non-interactive 2>&1)"
      status=$?
      set -e
      if [[ "$status" -eq 0 ]]; then
        echo "Deleted EAS_NO_FROZEN_LOCKFILE from Expo $scope/$environment environment."
        deleted=1
      elif [[ "$output" == *'not found'* ]]; then
        :
      else
        echo "$output" >&2
        echo "ERROR: failed to delete EAS_NO_FROZEN_LOCKFILE from Expo $scope/$environment" >&2
        exit 1
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

  export EXPO_NO_DOTENV=1 NO_COLOR=1
  local found=0
  for environment in development preview production; do
    for scope in project account; do
      set +e
      output="$(pnpm exec eas env:get "$environment" \
        --variable-name EAS_NO_FROZEN_LOCKFILE \
        --scope "$scope" \
        --non-interactive \
        --format short 2>&1)"
      status=$?
      set -e
      if [[ "$output" =~ ^EAS_NO_FROZEN_LOCKFILE= ]]; then
        echo "FOUND: Expo $scope/$environment still defines EAS_NO_FROZEN_LOCKFILE" >&2
        found=1
      elif [[ "$status" -ne 0 ]] || [[ "$output" == *'not found'* ]]; then
        :
      else
        echo "$output" >&2
        echo "ERROR: unexpected eas env:get output for Expo $scope/$environment" >&2
        return 1
      fi
    done
  done

  if [[ "$found" -ne 0 ]]; then
    echo "ERROR: delete EAS_NO_FROZEN_LOCKFILE from expo.dev project/account env vars" >&2
    return 1
  fi
  echo "Expo project/account environments: EAS_NO_FROZEN_LOCKFILE absent."
}

case "$MODE" in
  --remote-only)
    verify_custom_ios_workflow
    purge_remote_eas_no_frozen_lockfile
    audit_remote_eas_no_frozen_lockfile
    ;;
  --verify-json-only)
    verify_eas_json
    verify_custom_ios_workflow
    ;;
  all)
    verify_eas_json
    verify_custom_ios_workflow
    purge_remote_eas_no_frozen_lockfile
    audit_remote_eas_no_frozen_lockfile
    echo "EAS will use pnpm install --frozen-lockfile for SDK 54 / RN 0.81.5 development builds."
    ;;
  *)
    echo "Usage: $0 [--remote-only|--verify-json-only]" >&2
    exit 1
    ;;
esac
