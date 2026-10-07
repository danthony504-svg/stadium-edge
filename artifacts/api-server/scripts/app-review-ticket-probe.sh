#!/usr/bin/env bash
# Local positive-case probe for production /api/auth/app-review-ticket.
# Prompts for email + code on your machine — never writes them to disk,
# GitHub, source, or the client bundle. Prints only PASS / FAIL.
set -euo pipefail

ENDPOINT="${APP_REVIEW_TICKET_URL:-https://stadium-edge.onrender.com/api/auth/app-review-ticket}"

# Prompt (code is silent). Values stay in this shell only.
printf "APP_REVIEW_EMAIL: "
read -r REVIEW_EMAIL
printf "APP_REVIEW_CODE: "
# Prefer silent read when a TTY is available.
if [ -t 0 ]; then
  # shellcheck disable=SC2162
  read -rs REVIEW_CODE
  printf "\n"
else
  read -r REVIEW_CODE
fi

if [ -z "${REVIEW_EMAIL}" ] || [ -z "${REVIEW_CODE}" ]; then
  echo "FAIL: missing email or code"
  exit 1
fi

BODY="$(REVIEW_EMAIL="$REVIEW_EMAIL" REVIEW_CODE="$REVIEW_CODE" python3 - <<'PY'
import json, os
print(json.dumps({
  "email": os.environ["REVIEW_EMAIL"],
  "code": os.environ["REVIEW_CODE"],
}))
PY
)"

# Clear shell copies as soon as the JSON body is built.
unset REVIEW_EMAIL REVIEW_CODE

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

HTTP="$(curl -sS -o "$TMP" -w "%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$BODY")"
unset BODY

python3 - "$HTTP" "$TMP" <<'PY'
import json, sys
status = int(sys.argv[1])
raw = open(sys.argv[2], "r", encoding="utf-8").read()
try:
    data = json.loads(raw) if raw else {}
except json.JSONDecodeError:
    print(f"FAIL: {status}")
    sys.exit(1)
has_ticket = isinstance(data.get("ticket"), str) and len(data["ticket"]) > 0
if status == 200 and data.get("ok") is True and has_ticket:
    print("PASS: HTTP 200 + ticket generated")
    sys.exit(0)
print(f"FAIL: {status}")
sys.exit(1)
PY
