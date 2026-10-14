#!/usr/bin/env bash
# Prepare / publish preview-channel device test at a pinned commit.
# - Never prints EXPO_TOKEN
# - Refuses production channel / production publish scripts
# - Does not start an EAS build (approve builds separately)
set -euo pipefail

# scripts/ → stadium-mobile/ → artifacts/ → repo root
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
PINNED="${1:-0d10cce7fab76d0c36180f11b80fb282a1078117}"

cd "$REPO_ROOT"

if [[ ! -f .ota-production-freeze ]]; then
  echo "ERROR: .ota-production-freeze missing at $REPO_ROOT — refusing to proceed."
  exit 1
fi
echo "OK: production OTA freeze armed"

# Verify preview profile channel without publishing.
python3 - <<'PY'
import json,sys
eas=json.load(open("artifacts/stadium-mobile/eas.json"))
ch=eas["build"]["preview"].get("channel")
dist=eas["build"]["preview"].get("distribution")
print(f"OK: eas.json preview.channel={ch!r} distribution={dist!r}")
if ch != "preview":
  sys.exit("preview profile must target channel=preview only")
prod=eas["build"]["production"].get("channel")
print(f"OK: production.channel={prod!r} (untouched by this script)")
PY

git cat-file -e "${PINNED}^{commit}"
git merge-base --is-ancestor 4738df08db5fc3425bc1fd317431c52bc5b9c0a8 "$PINNED"
echo "OK: pinned commit ${PINNED} contains college-sim ancestor 4738df08"

# Autolink proof: preview native tree includes ClerkExpoPasskeys → Build 78 UNVERIFIED
if [[ -d "$MOBILE/node_modules" ]] || [[ -d "$REPO_ROOT/node_modules" ]]; then
  if (cd "$MOBILE" && pnpm exec expo-modules-autolinking resolve --platform ios 2>/dev/null | grep -q "ClerkExpoPasskeys"); then
    echo "NOTE: @clerk/expo-passkeys autolinks ClerkExpoPasskeys into preview binaries."
    echo "      Build 78 crash compatibility: UNVERIFIED on a new preview IPA."
  fi
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "BLOCKED: EXPO_TOKEN is not set in this environment."
  echo "         Export EXPO_TOKEN (do not paste into chat logs), then re-run:"
  echo "         bash artifacts/stadium-mobile/scripts/prepare-preview-test.sh ${PINNED}"
  echo "         Optional publish: PUBLISH_PREVIEW_OTA=1 bash …"
  exit 3
fi

# Token present — never echo it.
echo "OK: EXPO_TOKEN is set (value not printed)"

if [[ "${PUBLISH_PREVIEW_OTA:-}" != "1" ]]; then
  echo "Prep complete. To publish JS tip to preview only:"
  echo "  git checkout ${PINNED}"
  echo "  PUBLISH_PREVIEW_OTA=1 bash artifacts/stadium-mobile/scripts/prepare-preview-test.sh ${PINNED}"
  exit 0
fi

git checkout --detach "$PINNED"
cd "$MOBILE"
# shellcheck disable=SC1091
# publish-preview-ota.sh reads EXPO_TOKEN from env; does not print it.
bash scripts/publish-preview-ota.sh \
  "PR736 $(git -C "$REPO_ROOT" rev-parse --short HEAD) device test — preview only"

echo "Verify preview channel only:"
pnpm exec eas channel:view preview --non-interactive || true
echo "DONE: preview OTA published. Production channel untouched."
