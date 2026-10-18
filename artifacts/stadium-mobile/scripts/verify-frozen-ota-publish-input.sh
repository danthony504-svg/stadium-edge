#!/usr/bin/env bash
# Verify a frozen OTA publish-input directory WITHOUT rebundling.
#
# Hermes .hbc bytes are non-deterministic across clean Metro exports of the
# same source SHA. Authorize + publish only from a frozen input whose openssl
# launch hash was recorded at freeze time — never re-run expo export after
# authorization.
#
# Usage:
#   bash scripts/verify-frozen-ota-publish-input.sh .ota-publish-input-stage3-atd \
#     --expect-sha 6ef4b8363e7e2d12d17c7df950196c5d55da4b20 \
#     --expect-hash wXUNVFsMriXpWxQ6hSkONEw3uh8YeOerh8b-uUUvNnk
set -euo pipefail
cd "$(dirname "$0")/.."

INPUT_DIR="${1:-}"
shift || true
EXPECT_SHA=""
EXPECT_HASH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-sha) EXPECT_SHA="${2:-}"; shift 2 ;;
    --expect-hash) EXPECT_HASH="${2:-}"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$INPUT_DIR" || ! -d "$INPUT_DIR" ]]; then
  echo "FAIL: input dir missing: ${INPUT_DIR:-<empty>}" >&2
  exit 1
fi

BUNDLE="$(find "$INPUT_DIR/_expo/static/js/ios" -name 'entry-*.hbc' -print -quit)"
if [[ -z "$BUNDLE" || ! -f "$BUNDLE" ]]; then
  echo "FAIL: no entry-*.hbc under $INPUT_DIR/_expo/static/js/ios" >&2
  exit 1
fi

HASH="$(openssl dgst -sha256 -binary "$BUNDLE" | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
RECORDED="$(tr -d '[:space:]' < "$INPUT_DIR/LAUNCH_HASH.txt")"
BAKED="$(tr -d '[:space:]' < "$INPUT_DIR/BAKED_SHA.txt")"
ENTRY_NAME="$(basename "$BUNDLE")"

echo "══ verify-frozen-ota-publish-input ══════════════════════════"
echo "input_dir=$INPUT_DIR"
echo "launch_asset=$BUNDLE"
echo "entry_name=$ENTRY_NAME"
echo "launch_hash=$HASH"
echo "recorded_hash=$RECORDED"
echo "baked_sha=$BAKED"

if [[ "$HASH" != "$RECORDED" ]]; then
  echo "FAIL: openssl hash != LAUNCH_HASH.txt (input mutated after freeze)" >&2
  exit 1
fi
if [[ -n "$EXPECT_HASH" && "$HASH" != "$EXPECT_HASH" ]]; then
  echo "FAIL: launch hash $HASH != authorized --expect-hash $EXPECT_HASH" >&2
  exit 1
fi
if [[ -n "$EXPECT_SHA" && "$BAKED" != "$EXPECT_SHA" ]]; then
  echo "FAIL: baked SHA $BAKED != --expect-sha $EXPECT_SHA" >&2
  exit 1
fi
# Reuse the Latin-1 launch-asset scanner (Hermes may not keep `pk_test_` as a
# contiguous UTF-8 needle for rg -a, but the full baked key is present).
export EXPO_PUBLIC_GIT_COMMIT="${EXPECT_SHA:-$BAKED}"
node scripts/prepublish-export-auth-check.mjs --dist "$INPUT_DIR"

META_BUNDLE="$(node -e "const m=require(require('path').resolve(process.argv[1])); console.log(m.fileMetadata.ios.bundle)" "$INPUT_DIR/metadata.json")"
if [[ "$META_BUNDLE" != *"$ENTRY_NAME" ]]; then
  echo "FAIL: metadata.json bundle path mismatch ($META_BUNDLE vs $ENTRY_NAME)" >&2
  exit 1
fi

echo "verify-frozen-ota-publish-input: pass"
echo "Publish ONLY with:"
echo "  eas update --branch preview --channel preview --platform ios --skip-bundler --input-dir $INPUT_DIR"
echo "Do NOT re-run scripts/export-preview-ota.sh after this verification."
