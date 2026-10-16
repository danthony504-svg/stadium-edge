# Coach prop-context pipeline audit

**Date:** 2026-10-16  
**Scope:** Opponent D, weather, venue/field, injuries/lineups across supported sports.  
**Constraints:** No publish / deploy / native build / production freeze lift.

## Pipeline (ordered)

1. Prefetch (parallel, board-level — not per-player fan-out beyond capped history): injuries, opp team-defense packs, MLB platoon/park env, football park weather, matchup history.
2. `simPropPoolUntilQualified` → `fetchPropSimulations` → server `runPropSims` (Opportunity Shift + Venue + Opponent Matchup + optional weatherImpact/defenseIndex).
3. `attachPickScores` / `buildFinalAiScore` (holistic grading + qualification).
4. Staging / ALT / backfill from **already-qualified** scored legs (same context scores; no re-sim).

## Factor matrix

| Factor | Fetched? | Freshness | Used in projection? | Used in grading/display? | Missing policy |
|--------|----------|-----------|---------------------|--------------------------|----------------|
| Opponent defense | Yes — `GET /sports/team-defense` via `loadFootballOppRushDefense` | ~60m server cache | **Yes (fixed)** — `defenseIndexByFamily` now passed into `/sports/simulate/props` from board packs | Holistic Opponent Tendency (display-only when projection applied); hard Over blocks unchanged | No pack/sample → omit index (matchup 1.0) |
| Weather | MLB: probables/park + OWM; NFL/NCAAF: `/weather/parks` | Wx ~10m | **MLB yes (fixed)** — `weatherImpact` from env into MC; NFL/NCAAF stay holistic-only (MC only applies weather for `mlb`) | Holistic Weather factor (temp/wind/precip/dome/surface) | Dome → null impact; no readings → unknown |
| Field/venue | MLB parks static + venue series; football surface heuristic | Static / history | Venue shift in preSim (home/away series); park HR index nudges MLB weatherImpact | Holistic park/surface bits | Missing series → no venue shift |
| Injuries/lineups | ESPN injuries; MLB probables; minutes from history | Injuries ~10m | Opportunity Shift (OUT/doubtful only); key-injury soft weights; minutes L5/season | Injury rubric / Match | Empty status → `unknown` vacancy 0; ambiguous name → unknown (**never healthy**) |

## Double-count fix

Previously opponent D could tilt **post-sim hit** and again in **holistic Opponent Tendency** while never entering MC.

Now:
1. Pack → `defenseIndexByFamily` → MC matchup shift (projection).
2. Post-sim `adjustSimHitForOppDefenseTilt` **skipped** for those games.
3. Holistic Opponent Tendency keeps **display**, score suppressed when projection owned D.

Soft vs-opp blend in `buildProjectionMean` already suppresses when formal matchup/defenseIndex applied.

## ALT / backfill / replacements

- ALT rungs share the same Monte Carlo distribution and the same per-game `weatherImpact` / `defenseIndexByFamily` on the request.
- Backfill/replacements only seat from already-qualified scored legs (same attached scores/context).

## Remaining limitations (no server/native required for this fix)

| Limitation | Notes |
|------------|-------|
| Football weather in MC | `buildProjectionMean` only multiplies `weatherImpact` for `sport===mlb`. Football Wx remains holistic by design. |
| `defenseIndex` quality | Coarse team rates (yards/pts/ERA/GAA) — not positional “allows X 3PM” invents. Thin samples omitted. |
| `expectedTargets` | Still null on QB coupling hot path (no new I/O). |
| Server slate worker | Still forces `weatherImpact: null` unless separately wired — greenfield Coach path is fixed. |
| Surface | Football surface often inferred from park name when API omits it (heuristic, documented). |
| Per-player injury “healthy” | Not on injury report ≠ confirmed healthy — status stays unused/unknown. |

## Tests

- `lib/propContextPipeline.test.ts` — indices, weather, traces up/down, double-count guard, injury honesty, cold/warm sync timing.
- `api-server/test/propContextInjuryHonesty.test.ts` — vacancy unknown ≠ OUT/healthy.

## College / NCAAF game-line interaction (ongoing)

Bare asks like `8 leg college` never reach prop Monte Carlo: they parse as
`gameLinesOnly` + NCAAF lock, then exit under `NCAAF_GAME_LINE_SIM_VALIDATED=false`
before slate sims. Opponent D / weather / injury wiring above still applies to
**eligible** prop and NFL game-line paths; it does not reopen P0-blocked NCAAF
team markets. See `COACH_8_LEG_COLLEGE_AUDIT.md`.

College player props remain a separate, opt-in surface (`askAllowsNcaafPlayerProps`)
and are not treated as “failed the quality bar” when the bare college ask never
loads them.

## No ops changes

Production OTA freeze remains armed. No publish, deploy, or native build for this audit.
Voice stays paused.
