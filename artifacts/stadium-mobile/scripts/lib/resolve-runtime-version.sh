#!/usr/bin/env bash
# Resolve Expo runtimeVersion from app.json and fail closed on mismatches.
# Usage (from artifacts/stadium-mobile):
#   source scripts/lib/resolve-runtime-version.sh
#   RUNTIME_VERSION="$(resolve_production_runtime_version)"
#
# If RUNTIME_VERSION is already set and differs from app.json → exit 1
# (unless ALLOW_RUNTIME_MISMATCH=1, reserved for intentional legacy 1.0.x ops
#  via prepare-force-update-ota-103.sh — never for 1.1.0 production publish).

resolve_production_runtime_version() {
  local app_runtime
  app_runtime="$(node -e "const j=require('./app.json'); process.stdout.write(String(j.expo.runtimeVersion||''))")"
  if [[ -z "$app_runtime" ]]; then
    echo "FAIL: app.json expo.runtimeVersion is missing" >&2
    return 1
  fi

  if [[ -n "${RUNTIME_VERSION:-}" && "${RUNTIME_VERSION}" != "${app_runtime}" ]]; then
    if [[ "${ALLOW_RUNTIME_MISMATCH:-}" == "1" ]]; then
      echo "WARN: RUNTIME_VERSION=${RUNTIME_VERSION} != app.json ${app_runtime} (ALLOW_RUNTIME_MISMATCH=1)" >&2
      printf '%s' "${RUNTIME_VERSION}"
      return 0
    fi
    echo "FAIL: RUNTIME_VERSION=${RUNTIME_VERSION} does not match app.json runtimeVersion=${app_runtime}" >&2
    echo "Fail closed: do not publish/rollback a mismatched runtime for this tree." >&2
    echo "For legacy 1.0.3-only ops use scripts/prepare-force-update-ota-103.sh (not this path)." >&2
    return 1
  fi

  # Refuse accidental 1.0.3 rollback/publish when this tree targets 1.1.0.
  if [[ "$app_runtime" == "1.1.0" && "${RUNTIME_VERSION:-$app_runtime}" == "1.0.3" ]]; then
    echo "FAIL: refusing runtime 1.0.3 against app.json 1.1.0" >&2
    return 1
  fi

  printf '%s' "$app_runtime"
}
