#!/usr/bin/env bash
# Verify production API simulator endpoints are live after Render deploy.
set -euo pipefail
API="${API_BASE:-https://stadium-edge.onrender.com/api}"
echo "Checking $API ..."

fail=0
check() {
  local name="$1"
  local url="$2"
  local expect="$3"
  if curl -sf "$url" | grep -q "$expect"; then
    echo "OK  $name"
  else
    echo "FAIL $name ($url)"
    fail=1
  fi
}

check healthz "$API/healthz" '"status":"ok"'
check sim-api-version "$API/healthz" '"simApiVersion":2'
check game-roster "$API/sports/game-roster?sport=mlb&homeTeamId=15&awayTeamId=21" '"players"'
check player-history "$API/sports/player-history?sport=mlb&athleteId=41253" '"recent"'

sim=$(curl -sf -X POST "$API/sports/simulate/props" \
  -H 'Content-Type: application/json' \
  -d '{"sport":"mlb","tier":"quick","props":[{"player":"Yordan Alvarez","market":"batter_hits","line":1.5,"side":"Over","athleteId":"41253"}],"homeTeam":"Atlanta Braves","awayTeam":"New York Mets"}')
if echo "$sim" | grep -q '"hitProbability":[0-9]'; then
  echo "OK  simulate/props returns hitProbability"
else
  echo "FAIL simulate/props — hitProbability still null (deploy may be stale)"
  echo "$sim" | head -c 400
  fail=1
fi

games=$(curl -sf "$API/sports/games?sport=mlb&simulator=1")
count=$(echo "$games" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 999)
if [ "$count" -lt 50 ]; then
  echo "OK  simulator games filter ($count pregame)"
else
  echo "WARN simulator=1 not filtering ($count games) — stale deploy?"
fi

exit $fail
