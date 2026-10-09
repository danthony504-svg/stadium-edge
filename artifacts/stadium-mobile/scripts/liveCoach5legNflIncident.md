# LIVE Coach incident — “5 leg NFL live” → 3-leg Bucs@DAL stack

**Path:** LIVE Coach only (`buildLiveCoachRecommendations`) — not pregame `buildParlay`.  
**Fixes (this branch):** intent count parse, same-event correlation guard, honest poll-age label.  
**Not done:** merge / Render / OTA / native build.

## Reproduction (live feed @ ~2026-10-09T01:40Z)

| Stage | Count | Detail |
|-------|------:|--------|
| Live NFL games `state=in` | 1 | Buccaneers @ Cowboys (ESPN `401872980`) |
| Live odds rows | 6 | ML×2, Spread×2, Total×2 — **no player props** |
| Normalized / eligible | 6 / 6 | All mains pass eligibility |
| Graded qualify | 3 | Bucs ML, Under 49.5, Bucs +8.5 (other 3 fail edge/EV) |
| Seated (ask as typed) | **3** | intent.count was **3** (bug) |
| Seated (“5 leg live NFL”) | **3** | count=5 but only 3 qualify + 1 event |

Exact seated (matched phone): Buccaneers ML +380, Under 49.5 -110, Buccaneers +8.5 -102.

## Root causes

### 1. Intent count defaulted to 3 (primary UI “3-Leg parlay”)

`parseLiveCoachIntent("5 leg NFL live")` → `{ sport: "nfl", count: 3 }`  
Regex required `N legs? live` with nothing between; sport token between `leg` and `live` missed.  
`coach.tsx` finishes with `requestedLegs = liveResult.intent.count` → **3-Leg** header.

**File:** `lib/liveCoach/liveCoachIntent.ts`  
**Fix:** accept `N legs? SPORT live`.

### 2. Legs 4–5 never existed on the board

Even with count=5: one live NFL event, six mains, three grade-qualify. No 4th/5th independent live market. Honest shortfall — do **not** pad.

### 3. Same-team ML + spread seated together

Live seating: one-per-event first, then same-event fill with **no** pregame `maxLegsPerGame` / correlation. Shortfall fill stacked Bucs ML + Bucs +8.5 (overlapping team outcome).

**File:** `lib/liveCoach/buildLiveCoach.ts`  
**Fix:** `liveTicketCorrelation.ts` blocks same-event ML/ML, spread/spread, over/under, and same-team ML+spread. Total + one side still allowed.

### 4. Live props / + milestones unsupported

By design Phase 2/3 mains-only (`isLivePhase2aMarket` rejects prop/alt/period). Feed has no player props. Remaining-game sim grades ML/spread/total only. **No pregame odds substituted.**

### 5. “0s fresh”

`providerLastUpdate: null` on ESPN pickcenter rows; freshness falls back to `fetchedAt` (poll assembly) → ageMs≈0 → PickCard “0s fresh”. Not a sportsbook quote timestamp.

**Fix:** label `Ns poll` when ageSource is fetchedAt / provider missing.

## Cross-sport audit (same window)

| Sport | Live games | Eligible mains | “5 leg SPORT live” intent (before fix) | Seated | Distinct events |
|-------|----------:|---------------:|---------------------------------------:|-------:|----------------:|
| NFL   | 1 | 6 | 3 | 3 | 1 |
| NBA   | 4 | 24 | 3 | 3 | 3 |
| NHL   | 6 | 36 | 3 | 3 | 3 |
| WNBA  | 0 | 0 | 3 | 0 | 0 |

Same intent-count bug on NBA/NHL/WNBA phrasing. Multi-game sports preferred distinct events when count=3.

## OTA (already published; device load unverified)

| Field | Value |
|-------|-------|
| Workflow | https://github.com/danthony504-svg/stadium-edge/actions/runs/37870145127 **success** |
| Published commit | `c8d6fe6980be775768076766e97da1f65468f101` (trigger on tip `b5c9e800`) |
| Update group ID | `288b0401-6f2c-42cc-b02d-ec9a1e321d66` |
| iOS update ID | `01a11e4b-3f65-7c3a-ab9c-f6a4c07c96a2` |
| Channel / runtime | production / **1.1.0** |
| Device loaded? | **Not verified** — compare phone `Updates.updateId` (Ota Diagnostics / ota-debug) to `01a11e4b-…` |

## Smallest safe fixes (this branch)

1. Intent parse — `liveCoachIntent.ts`  
2. Same-event correlation — `liveTicketCorrelation.ts` + seating in `buildLiveCoach.ts`  
3. Poll-age label — `PickCard.tsx` + `ageSource` on `liveCoach`  

**Not changed:** sim model, grade thresholds, P0, pregame caps, force-fill to 5.
