---
name: Pick quality gate (don't force picks)
description: chat.ts SYSTEM_PROMPT "PICK QUALITY GATE" — selectivity/reject rules and why it must defer to fixed-count request types.
---

# Pick quality gate — don't force picks

chat.ts SYSTEM_PROMPT has a "PICK QUALITY GATE" block (after PLAYER PERFORMANCE PROJECTIONS, before the BUILD-A-PARLAY format rules). It governs BOTH web + mobile AI picks via POST /api/chat. It does NOT touch pickScore.ts — consistency/volatility is reasoned in-prompt from the real game-log spread, not a new numeric score.

## The reject filters are keyed to REAL fields only (honesty rule)
- INJURY → matchupInjuries
- LOW VOLUME / OPPORTUNITY → thin playerHistory sample / low-falling minutesTrend (NBA/WNBA)
- HIGH VOLATILITY / INCONSISTENCY → spread of playerHistory.recent game log (boom/bust = weak even if avg clears)
- BLOWOUT RISK → large realOdds pregame spread (heuristic: NBA/WNBA -14+, NFL -10.5+, college wider)
- LOW CONFIDENCE / NO REAL EDGE → no projected-vs-implied edge; "the price is fine" is NOT an edge
No-feed factors stay BANNED (line movement/steam/RLM, public bet%/money%, usage rate, NFL snap/route/target/RZ share, NHL ice-time/PP/goalie, soccer xG/xA/set-piece/possession, opp-rank-vs-position) — never invent them to justify OR reject a pick.

## Why the precedence clause is mandatory (the bug to avoid)
**Rule:** a selectivity/quality gate MUST carry an explicit precedence clause stating it refines WHICH legs and HOW selective — and does NOT override (a) the REQUEST TYPES leg counts/payout targets or (b) the higher-precedence PROP/STAT DISCOVERY rule (stats-first rundown, ZERO PICK/ALT lines).

**Why:** the first draft put "hot picks"/"what should I bet"/"prop discovery" in the "return 1-2 or none" bucket. Those intents are ALREADY hard-mapped elsewhere (hot picks → 3-4 picks; discovery → stats-first, no PICK lines). Two mandatory-style rules with no precedence bridge → model output oscillates between counts/formats. Architect review flagged this as the material failure.

**How to apply:** the "1-2 plays or nothing clears the bar" latitude is scoped to GENUINELY OPEN-ENDED value questions with NO size and NO named type ("any value tonight?", "see anything you love?"). For sized/named types, keep the type's count+format and only shorten via the existing honesty-short rule.

## Don't re-add a grade floor
The gate removes only genuinely weak legs; it must NOT reintroduce a letter/grade floor that trims requested N-leg counts (that floor was deliberately removed — see chat-bplus-grade-floor.md). Honesty-short still governs count.

## Op note
api-server has NO watcher — restart "artifacts/api-server: API Server" after any prompt edit or it serves stale compiled code.
