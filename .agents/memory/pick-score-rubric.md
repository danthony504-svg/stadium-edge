---
name: 5-component pick rubric (AI Grade / Confidence / Edge)
description: How the Matchup/Trend/Line Value/Injury/Line-Shopping pick scores are built, surfaced, and kept honest across mobile surfaces.
---

# 5-component pick rubric

Five 1–10 sub-scores, each **nullable**, combined into AI Grade (A+..F),
Confidence %, and Edge %. Weights: lineValue .3 / matchup .25 / trend .2 /
injury .15 / lineShopping .1, **renormalized over the present (non-null) scores**.
`edgePct` is the REAL line-value edge passed through, never re-derived.

**Why:** app-wide HONESTY rule — betting data must be real-from-feed or omitted.
A score must never appear from absent/incomplete data.

## Where it lives
- `lib/pickScore.ts` — pure scorers + `combinePickScore` (124 tests in `pickScore.test.ts`).
- `components/ScoreBreakdown.tsx` — `full` (detail pages) + `compact` (cards) variants; render gated on `composite != null`.
- `lib/pickScoreContext.ts` — `attachPickScores(picks, {realOdds, propPool, matchupHistory, matchupInjuries})`. Game picks: re-find backing `realOdds` row by EXACT game+market+pick → lineValue/lineShopping/edgePct + matchup(mlLean)/trend(streak,L10)/injury. Prop picks: match `propPool` by game+player+side(+line) → lineValue/lineShopping only; matchup/trend/injury **null** (no per-player game log in card context).

## Surfaces
- Coach/Props/Slip cards: `coach.tsx` calls `attachPickScores` right before `setMessages`; flows through `setAiPicks` → Props/Slip inherit. `PickCard` renders compact ScoreBreakdown when `pick.scores`, else falls back to EdgeReadout grid.
- `app/game/[id].tsx`: attach scores to parsed AI picks, render FULL breakdown for `picks[0]` (gated on composite).
- `app/prop/[id].tsx`: nav params carry NO edge/eventId, so a chained `getOdds → match game label → getProps → match player/market/line` query (`propMetaQ`) re-resolves THIS prop's real edge + bookSpread, **fail-closed null**. Edge only valid on `match.evSide === side`; bookSpread is side-specific (`isUnder ? underSpread : overSpread`). Trend from real game log via `playerTrendMomentum`; injury from opponent key-injury count (`summarizeTeamInjuries(...).highCount`); matchup null.

## Honesty gotcha (cost a code-review cycle)
`gameInjuryEdge` in pickScoreContext: the favored side comes from the report's
real edge string, but the **magnitude** must come from BOTH sides' weighted
key-injury counts. If either side can't be name-mapped to away/home, return
**null** — do NOT default magnitude to a "leans modestly" constant, or you
surface an invented Injury Impact contribution. Fail closed.

## Server inputs (api-server)
`routes/odds.ts` + `routes/props.ts` add `edge` + `bookSpread` per two-way
outcome (median de-vig fair + best-vs-median book spread); PCT POINTS. api-server
has NO watcher — restart the workflow after editing routes or it serves stale
compiled code. Mobile changes ship via OTA.
