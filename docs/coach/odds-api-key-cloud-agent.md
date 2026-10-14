# `ODDS_API_KEY` — Cloud Agent secret entry (Phase E historical)

## Exact server variable name

Every Odds API call site on the API server reads **only**:

```ts
process.env["ODDS_API_KEY"]
```

Confirmed in `artifacts/api-server/src/routes/odds.ts`, `props.ts`, `golf.ts`, and `lib/sports.ts` / `stealFeedDiagnostics.ts`.

There is no alternate name (`THE_ODDS_API_KEY`, `ODDS_KEY`, etc.) in server code.

Historical closing lines for Phase E E2b use The Odds API:

`GET https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds`

(paid usage plan required; free plans return `HISTORICAL_UNAVAILABLE_ON_FREE_USAGE_PLAN`).

## Runtime for this agent

| Fact | Value |
|------|--------|
| Host | **Cursor Cloud Agent VM** (not GitHub Actions, not Render) |
| Environment | [8c5427d9-a490-11f1-a7d1-d6b4613131ce](https://cursor.com/dashboard/cloud-agents/environments/e/8c5427d9-a490-11f1-a7d1-d6b4613131ce) |
| Injected secrets (verified) | `EXPO_TOKEN` only (`CLOUD_AGENT_INJECTED_SECRET_NAMES` / `CLOUD_AGENT_ALL_SECRET_NAMES`) |
| `ODDS_API_KEY` in this VM | **Still unset** as an injected secret — must be added to Cursor Secrets for durable access |
| Historical entitlement (ephemeral probe) | **SUCCESS** — paid historical NCAAF odds returned 200; fixtures saved under `artifacts/api-server/test/fixtures/ncaaf-historical-odds-*.json` |

A **GitHub Actions secret** or **Render env var** with the same name is **not** injected into this VM.

## Agent vs Render (what was verified)

| Surface | Verified here | Not accessible from this agent |
|---------|---------------|--------------------------------|
| Cloud Agent env | `ODDS_API_KEY` **absent**; only `EXPO_TOKEN` injected | — |
| Historical Odds API from agent | Cannot call with a real key → `MISSING_KEY` | — |
| Production API (`stadium-edge.onrender.com`) | `GET /api/sports/odds?sport=ncaaf` returns **live** NCAAF books (200) → Render **has some working Odds key at runtime** | Render dashboard / secret values / plan tier / whether that key includes **historical** quota |
| Render API / CLI | `RENDER_API_KEY` unset | Listing or reading Render env vars |

**Do not assume** the Render live key automatically unlocks historical endpoints — that requires a paid Odds API plan. After injecting `ODDS_API_KEY` into Cursor Secrets, re-probe historical from a **new** agent run.

## Secure configuration (pick one)

1. **Preferred — Cursor environment secret**  
   Open this environment → **Secrets** → add `ODDS_API_KEY` (same value as the paid The Odds API key used for production, if that plan includes historical):  
   https://cursor.com/dashboard/cloud-agents/environments/e/8c5427d9-a490-11f1-a7d1-d6b4613131ce  
   Get/manage the key at https://the-odds-api.com/account/ (do **not** paste it into chat).  
   After saving, **start a new agent run** so `process.env.ODDS_API_KEY` is present — existing pods often do not see secrets added mid-run.

2. **Session-only (manual)**  
   In the agent shell (value never pasted into chat):
   ```bash
   export ODDS_API_KEY=…   # from The Odds API account portal
   ```

3. **Not sufficient for this agent**  
   - Render service env alone  
   - GitHub repo secret alone  
   - `.env` committed to git  
   - Printing the key in logs / PR bodies  

## Verify without leaking

```bash
python3 -c 'import os; print("ODDS_API_KEY_configured=", bool(os.environ.get("ODDS_API_KEY","").strip()))'
# Expect after injection: ODDS_API_KEY_configured= True
```

Historical smoke (never echo the key):

```bash
python3 <<'PY'
import os, json, urllib.request, urllib.error
key = os.environ.get("ODDS_API_KEY","").strip()
assert key, "ODDS_API_KEY missing"
url = (
  "https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds"
  f"?apiKey={key}&regions=us&markets=h2h,spreads&oddsFormat=american&date=2024-09-14T18:00:00Z"
)
try:
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.loads(r.read())
        events = data.get("data") if isinstance(data, dict) else data
        print("historical_ok=True events=", len(events) if isinstance(events, list) else "?")
except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8", errors="replace")[:240]
    print("historical_ok=False status=", e.code, "body=", body.replace(key, "***"))
PY
```

## After the key lands

1. Confirm `ODDS_API_KEY_configured= True` (boolean only).  
2. Run the historical smoke above — expect 200 + events, or a clear plan error (`HISTORICAL_UNAVAILABLE_ON_FREE_USAGE_PLAN`).  
3. Wire closing lines into Phase E E2b (still **do not** flip `NCAAF_GAME_LINE_SIM_VALIDATED`).  
4. E4 injury/QB remains a **separate** dependency (see `ncaaf-phase-e-checklist.md`).
