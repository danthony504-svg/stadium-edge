#!/usr/bin/env bash
# Inspect a finished IPA: require preview channel + no ClerkExpoPasskeys.
# Usage: bash scripts/inspect-preview-build78-ipa.sh /path/to/app.ipa
# Works on Linux CI / Cloud Agent (no macOS plutil required).
set -euo pipefail
IPA="${1:?ipa path required}"
test -f "$IPA"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "══ IPA inspection: $IPA ══"
unzip -q "$IPA" -d "$WORKDIR"
APP="$(find "$WORKDIR" -maxdepth 3 -name '*.app' -type d | head -1)"
test -n "$APP"
echo "OK: app bundle=$(basename "$APP")"

# Channel: search Expo.plist / EXConstants / embedded manifests for expo-channel-name
CHANNEL="UNKNOWN"
for f in "$APP/Expo.plist" "$APP/EXConstants.plist" "$APP/expo-*.json"; do
  [[ -f "$f" ]] || continue
  if grep -q 'expo-channel-name' "$f" 2>/dev/null; then
    # plist often stores key then <string>value</string>
    CHANNEL="$(tr '\n' ' ' <"$f" | sed -n 's/.*expo-channel-name[^<]*<string>\([^<]*\)<.*/\1/p' | head -1)"
    [[ -n "$CHANNEL" ]] && break
  fi
done
if [[ "$CHANNEL" == "UNKNOWN" || -z "$CHANNEL" ]]; then
  # broad strings scan limited to app payload
  HIT="$(grep -Raaob 'expo-channel-name' "$APP" 2>/dev/null | head -1 || true)"
  if [[ -n "$HIT" ]]; then
    FILE="$(echo "$HIT" | cut -d: -f1)"
    CHANNEL="$(strings "$FILE" 2>/dev/null | awk '/expo-channel-name/{getline; print; exit}')"
  fi
fi
CHANNEL="$(echo "${CHANNEL:-UNKNOWN}" | tr -d '[:space:]')"

# ClerkExpoPasskeys traces
PATH_HITS="$(find "$APP" \( -iname '*ClerkExpoPasskeys*' -o -iname '*clerk*passkey*' \) 2>/dev/null || true)"
CONTENT_HITS="$(grep -RIl 'ClerkExpoPasskeys' "$APP" 2>/dev/null | head -30 || true)"
BIN_HIT=""
MAIN="$(ls "$APP"/* 2>/dev/null | head -1)"
# Prefer Mach-O named like the app
CAND="$(find "$APP" -maxdepth 1 -type f ! -name '*.plist' ! -name '*.json' ! -name '*.png' | head -5)"
for b in $CAND; do
  if strings "$b" 2>/dev/null | grep -q 'ClerkExpoPasskeys'; then
    BIN_HIT="$b"
    break
  fi
done

echo "channel_detected=$CHANNEL"
echo "passkey_path_hits<<EOF"
echo "$PATH_HITS"
echo "EOF"
echo "passkey_content_file_count=$(echo "$CONTENT_HITS" | grep -c . || true)"
echo "passkey_binary_hit=${BIN_HIT:-none}"

FAIL=0
if [[ "$CHANNEL" != "preview" ]]; then
  echo "FAIL: expo-channel-name must be preview (got '$CHANNEL')"
  FAIL=1
else
  echo "PASS: channel=preview"
fi
if [[ -n "${PATH_HITS// }" || -n "${CONTENT_HITS// }" || -n "$BIN_HIT" ]]; then
  echo "FAIL: ClerkExpoPasskeys native traces present — refuse install"
  FAIL=1
else
  echo "PASS: no ClerkExpoPasskeys native module traces"
fi
exit "$FAIL"
