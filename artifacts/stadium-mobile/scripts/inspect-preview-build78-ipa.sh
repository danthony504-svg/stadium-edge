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

# Channel: prefer Expo.plist / EXConstants via plistlib (handles binary plists).
CHANNEL="$(
  python3 - <<'PY' "$APP"
import pathlib, plistlib, json, sys
app = pathlib.Path(sys.argv[1])
candidates = [
    app / "Expo.plist",
    app / "EXConstants.plist",
    *sorted(app.glob("expo-*.json")),
]
for f in candidates:
    if not f.is_file():
        continue
    data = f.read_bytes()
    try:
        pl = plistlib.loads(data)
    except Exception:
        try:
            pl = json.loads(data)
        except Exception:
            continue
    headers = None
    if isinstance(pl, dict):
        headers = pl.get("EXUpdatesRequestHeaders") or pl.get("requestHeaders")
        if isinstance(headers, dict) and headers.get("expo-channel-name"):
            print(str(headers["expo-channel-name"]).strip())
            raise SystemExit(0)
        # nested expo.updates style
        updates = pl.get("updates") if isinstance(pl.get("updates"), dict) else None
        if updates:
            headers = updates.get("requestHeaders") or {}
            if headers.get("expo-channel-name"):
                print(str(headers["expo-channel-name"]).strip())
                raise SystemExit(0)
print("UNKNOWN")
PY
)"

# ClerkExpoPasskeys traces
PATH_HITS="$(find "$APP" \( -iname '*ClerkExpoPasskeys*' -o -iname '*clerk*passkey*' \) 2>/dev/null || true)"
CONTENT_HITS="$(grep -RIl 'ClerkExpoPasskeys' "$APP" 2>/dev/null | head -30 || true)"
BIN_HIT=""
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
