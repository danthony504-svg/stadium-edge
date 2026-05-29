---
name: Live dead-market guard
description: Live parlay picks must respect the scoreboard — never recommend a moneyline/spread the current score+clock has already decided.
---

# Live "dead market" guard

A live parlay must never recommend a bet the current score has effectively decided
(real books LOCK the market). Reported failure: the live builder picked the Thunder
moneyline while OKC was down 84–110 in Q4 with 4:34 left (book had that ML padlocked).

**Why a soft penalty wasn't enough:** the client live analyzer
(`buildBestParlayForLiveRealGame`) scored a trailing-team ML with only a capped
`-20` penalty (margin beyond ~13 made no difference), and the "drop weak legs"
filter (`_score < 45`) only kicked in once 2+ legs were already on the ticket. So
on a thin ticket a hopeless ML could still be selected. The fix is a HARD EXCLUSION,
not a score nudge.

**How it works now (two paths must stay in sync):**
1. **Client analyzer** — `isDeadDeficit(deficitAgainst)` helper inside
   `buildBestParlayForLiveRealGame`. Per-sport final-period deficit thresholds
   (NBA/NCAAB 12, NFL 16, NCAAF 19, NHL 3, MLB 4, soccer 3) that TIGHTEN as the
   period clock runs down (parsed from ESPN's live clock string `mm:ss`);
   penultimate period only excludes 2× blowouts; UFC/unknown sports opt out
   (no scoreboard-margin concept). Applied to BOTH the Moneyline branch
   (`deficitAgainst = isHomeML ? -margin : margin`, margin = home − away) AND the
   Spread branch (out-of-reach cover: `adj < 0 && isDeadDeficit(-adj)`; a
   near-pick'em live cover like down-26 on +25.5 stays live). Dead legs return
   `_score:-999, _dead:true`; the selection loop skips `_dead || _score<=0`
   regardless of ticket size. If everything's dead it falls through to the
   existing honest "couldn't find 2 strong live legs" message.
   **GOTCHA:** `buildPicksFromOdds` emits market label `"Alt Spread"` (not just
   `"Spread"`). The spread scoring branch must match BOTH or alt-spread legs fall
   into the player-prop `else` branch and bypass the dead guard entirely. Don't
   gate the spread dead-check with an extra `inFinalPeriod &&` — `isDeadDeficit`
   already scopes itself to final/penultimate, and the extra gate silently drops
   penultimate-blowout exclusion for spreads.
2. **Chat AI path** — the AI was blind because client `liveOdds` context only
   carried `{game,market,pick,odds,startsAt}`. Fix: join real
   `awayScore/homeScore/periodLabel/clock` from `homeLiveGames` onto each
   `liveOdds` entry (by game label), AND a "LIVE GAME STATE — HARD RULE" block in
   chat.ts SYSTEM_PROMPT telling the AI to factor score+time, never back a
   trailing team's ML/out-of-reach spread late, prefer still-live markets, and
   return shorter honest tickets.

**How to apply:** any new live-pick path (or new live market family) must run the
same dead-market check; keep the client thresholds and the chat.ts prompt
thresholds roughly aligned so the two paths don't disagree. Pre-game / no-score
states must NEVER dead-filter (`!hasScores` short-circuits to false).
