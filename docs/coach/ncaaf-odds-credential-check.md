# Odds API credential check — agent vs authorized server

**Checked:** 2026-10-16 · branch `cursor/ncaaf-phase-e-restore-8b51`  
**Rules:** No purchase / upgrade / historical batch. Key values never printed. Locked model params + FINAL_EVAL unchanged.

## Presence (no value exposure)

| Environment | `ODDS_API_KEY` | Evidence |
|-------------|----------------|----------|
| **This Cloud Agent** | **ABSENT** | `CLOUD_AGENT_INJECTED_SECRET_NAMES=EXPO_TOKEN` only; process env unset |
| **Authorized server (Render `stadium-edge`)** | **PRESENT** | Prod `GET /api/sports/live-steals` → `feed.oddsKeyConfigured: true`, `provider: the-odds-api`, 8/8 sports ok. Live `/api/sports/odds?sport=nfl\|ncaaf\|nba` returned HTTP 200 (not `502 ODDS_API_KEY not configured`) |

No secret value was read, logged, or written to fixtures.

## Lowest-cost remaining-credits / historical-plan check

| Check | Cost | Status this turn |
|-------|------|------------------|
| `GET /v4/sports` (official quota headers; **0 credits**) | Free | **Blocked** — requires agent-local key |
| Historical `/v4/historical/...` probe | Paid (10×) | **Not run** (would also start retrieval risk) |
| Remaining credits | — | **UNKNOWN** until key is injected into the agent and free `/v4/sports` is run |
| Historical-plan access | Paid plans only | **UNCONFIRMED** for this key (live odds on Render prove key works; free plans also serve live odds, so live success ≠ historical entitlement) |

## Credits consumed this turn

| Path | Credits |
|------|---------|
| Agent → `api.the-odds-api.com` (direct) | **0** |
| Historical batch | **0** (not started) |
| Prod presence probes (`/sports/live-steals`, `/sports/odds` ×3) | **Unknown** — may have spent **live** featured credits on the Render key on cache miss; not historical. Do not re-probe for quota. |

## Where to add the key securely (agent)

The Render service already has the secret. Add the **same** secret name to the Cloud Agent so offline scripts can run the free quota check (and later an approved batch):

1. Open the Cloud Agent environment:  
   https://cursor.com/dashboard/cloud-agents/environments/e/8c5427d9-a490-11f1-a7d1-d6b4613131ce  
2. **Secrets** → add `ODDS_API_KEY` (paste only in the secrets UI — never in chat, commits, or fixtures).  
3. Start a **new** agent run so the secret injects (`CLOUD_AGENT_INJECTED_SECRET_NAMES` should then include `ODDS_API_KEY`).  
4. Next authorized step (still no batch until you approve): agent runs `GET https://api.the-odds-api.com/v4/sports?apiKey=…` and reports only `x-requests-remaining` / `x-requests-used` / `x-requests-last` (0 credit cost). Historical entitlement is confirmed only if a later tiny paid historical call is explicitly approved — or via the Odds accounts portal.

Do **not** put the key in `.env`, `environment.json`, docs, or chat.

## Preserved

| Item | State |
|------|-------|
| Model params + M3/S2 | Locked — `ncaaf-model-params-locked.md` untouched |
| FINAL_EVAL fixtures | Still absent / untouched |
| Historical TUNING closes pull | Not started |
| Gate / OTA / deploy | Unchanged / freeze armed |

## Retrieval attempt (follow-up) — STOPPED

Authorized TUNING closes pull (hard cap 4500) was requested. Re-checked agent secrets: still **only `EXPO_TOKEN`**. No free `/v4/sports` probe, no first historical request, **0 credits** consumed. Cannot confirm historical-plan access without the agent key. Re-add `ODDS_API_KEY` to the environment Secrets UI and **start a new agent run** so injection applies; then resume first-request confirm → capped TUNING batch.
