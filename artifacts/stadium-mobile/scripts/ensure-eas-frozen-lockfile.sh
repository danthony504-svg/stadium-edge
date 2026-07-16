#!/usr/bin/env bash
# Ensure EAS development builds use pnpm install --frozen-lockfile.
#
# EAS skips frozen lockfile when EAS_NO_FROZEN_LOCKFILE is any non-empty value
# (including "0") in eas.json or the linked EAS "development" environment.
# developmentClient: true auto-selects the development environment on EAS servers.
set -euo pipefail

cd "$(dirname "$0")/.."

EAS_JSON="eas.json"
PROFILE="development"

bad_eas_json() {
  node - <<'NODE'
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("eas.json", "utf8"));
const value = cfg.build?.development?.env?.EAS_NO_FROZEN_LOCKFILE;
if (value === undefined) {
  process.exit(0);
}
if (value === "1" || value === 1) {
  console.error("eas.json development.env.EAS_NO_FROZEN_LOCKFILE must not be \"1\".");
  process.exit(1);
}
if (String(value).length > 0) {
  console.error(
    "eas.json development.env.EAS_NO_FROZEN_LOCKFILE must be removed (any non-empty value disables frozen lockfile, including \"0\")."
  );
  process.exit(1);
}
NODE
}

bad_eas_json
echo "eas.json development profile: EAS_NO_FROZEN_LOCKFILE is not set."

if [[ -n "${EXPO_TOKEN:-}" ]]; then
  if pnpm exec eas env:list development --format short 2>/dev/null | grep -q '^EAS_NO_FROZEN_LOCKFILE='; then
    echo "Removing EAS_NO_FROZEN_LOCKFILE from EAS project development environment..."
    pnpm exec eas env:delete development \
      --variable-name EAS_NO_FROZEN_LOCKFILE \
      --non-interactive
    echo "Deleted EAS_NO_FROZEN_LOCKFILE from EAS development environment."
  else
    echo "EAS development environment: EAS_NO_FROZEN_LOCKFILE not present."
  fi
else
  echo "EXPO_TOKEN not set; skipping remote EAS environment cleanup."
fi

echo "EAS will use pnpm install --frozen-lockfile for SDK 54 / RN 0.81.5 development builds."
