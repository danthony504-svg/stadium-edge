---
name: Baseball innings period markets
description: How F5 / 1st-inning game-level markets were added mirroring the quarters/halves period system
---

Baseball innings markets are GAME-LEVEL only — true per-inning PLAYER props do NOT exist on the Odds API. So an "innings parlay" is built solely from game lines, never player props.

Markets + friendly labels (keep server↔web↔mobile↔prompt IN SYNC):
- `h2h_1st_5_innings` → "F5 Moneyline"
- `spreads_1st_5_innings` → "F5 Run Line"
- `totals_1st_5_innings` → "F5 Total"
- `totals_1st_1_innings` → "1st Inning Total"
(F5 = first five innings. These are per-event on /api/sports/odds; odds.ts periodMarketsFor(sportKey) is sport-aware, baseball→innings.)

**Why it mirrors quarters/halves but is NOT identical:** the typed `periodIntents` Set (q1-q4/h1/h2) was deliberately NOT extended to baseball. Plain "F5 parlay" enforcement = prompt + client emit only — the SAME effective level as a plain "Q2/Q3 parlay", because server-side period STRIPPING of full-game markets only runs inside the `lockedMarket` block, which never applies to innings (there are no inning props to market-lock). Extending the typed Set would force `_f5`/`_i1` suffix mapping that doesn't match the real market keys.

**How to apply (a new innings market or period needs all of these):**
- odds.ts: periodMarketsFor + per-event fetch list + merge filter + emit-order loop; bump cache key.
- chat.ts: PERIOD_KEY_TO_LABEL entry; "mlb" stays in QH_PERIOD_SPORTS (drives the same-game injection that harvests period markets via PERIOD_KEY_TO_LABEL); SYSTEM_PROMPT labels + intent keywords.
- Web ParlayBuilder buildPicksFromOdds: dedicated innings emit block (separate from the q1/h1 loop, different market keys); periodOrSgpIntent regex keywords.
- Mobile api.ts buildRealOdds: innings emit block; format.ts wantsPeriodMarkets keywords; PickCard marketFamily period prefix ("f5:" via the period regex, "1i:" for "1st inning") so an innings leg can't collapse onto the full-game family.

Intent keywords used everywhere: `f5`, `first 5 innings`, `first five innings`, `1st 5 innings`, `1st inning`, `first inning`.

api-server has NO file-watcher — restart the API workflow after chat.ts/odds.ts edits or it serves stale compiled code + stale odds cache.
