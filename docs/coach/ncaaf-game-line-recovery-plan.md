# NCAAF game-line recovery plan

**Status:** Planning only — do **not** restore NCAAF spread/ML recommendations until every acceptance gate below passes.  
**Blocked today:** P0 `unvalidated_ncaaf_game_line_simulation` (PR #662).  
**Out of scope until approved:** Simulator V2, OTA publish, merge without explicit approval.

## Problem summary

1. `nfl-drive` TD/FG rates hard-cap at 0.42 / 0.28 once points-per-drive ≥ ~11.8 / ~11.2, so Iowa-style means are insensitive to offense/QB shocks.
2. Score draws use only venue `ptsFor` / `ptsAgainst` — rush/pass defense, sacks, O-line, pace, EPA, and injuries do not enter the distribution.
3. Sparse away splits (e.g. n=1) can dominate means over richer L10 samples.
4. Exact posted lines must bind prices (Iowa +2 must never inherit Iowa +3 odds).

## Phase A — Diagnose and correct scoring-rate caps

| Step | Action | Exit criteria |
|------|--------|---------------|
| A1 | Instrument `nflDriveScoringRates` saturation rate by sport/slate | Dashboard: % of NCAAF games with both sides saturated |
| A2 | Redesign rate map so ppd differences remain monotonic above 11.8 (no hard flat cap, or soft logistic) | Unit tests: +3 ppg and −6 QB proxy move cover by ≥2 pts when other inputs fixed |
| A3 | Recalibrate drive count / clock bonus so projected means match FBS scoring scales | Mean absolute error vs closing totals within agreed band (see Phase D) |
| A4 | Keep FG/team/period **totals** P0-blocked until A3 passes | No change to totals P0 |

## Phase B — Validated matchup adjustments (fail-closed)

Only apply when provider data exists; never invent.

| Signal | Source | Rule |
|--------|--------|------|
| Rush/pass yards allowed | `/sports/team-defense` packs, `sampleSize ≥ 2` | Bounded multiplier on **opposing** `ptsFor` (e.g. clamp ±8% vs league median) |
| Sacks / protection | Same packs when present | Optional secondary tilt inside same clamp; skip if null |
| Pace / EPA | Only if a verified NCAAF feed is wired | Skip entirely until feed + schema exist |
| Home field | Prefer venue splits already used; no extra constant unless backtest supports it | Document coefficient |

Fail closed when sample thin or pack missing — leave means unadjusted and **do not** restore grades on that game.

## Phase C — Injuries, QB status, sparse splits

| Case | Behavior |
|------|----------|
| Starting QB out/doubtful (ESPN injury report) | Documented `ptsFor` haircut for that team only |
| Injury feed empty / unknown | **No** health assumption; do not boost; may keep game ungraded |
| Away/home split `games < 2` | Fall back to L10 (or blend with explicit weights); log provenance |
| Conflicting L10 vs split | Prefer larger sample; never invent third source |

## Phase D — Backtest vs outcomes and closing lines

1. Historical universe: FBS regular-season games with posted closing spread/ML (multi-season holdout).
2. Metrics per market: Brier score, log loss, calibration slope/intercept, CLV vs close.
3. Segment by: home dog / road dog, spread magnitude, saturation flag, injury-known vs unknown.
4. Compare candidate engine vs (a) current nfl-drive, (b) market-implied baseline.

## Phase E — Acceptance criteria before restore

All must pass on a frozen out-of-sample window:

1. **Sensitivity:** Controlled ±3 ppg and QB-out proxies move cover ≥2 percentage points when not data-starved.
2. **Calibration:** Decile calibration error ≤ market baseline + agreed tolerance; no systematic 70%+ dog covers on +7.5 with ~50% ML.
3. **Exact-line:** 100% of graded spreads bind `point` + sportsbook price from the same outcome row; unposted lines (e.g. +2 when board is +3) stay ungraded.
4. **Injury conservatism:** Games with missing QB/injury data do not show higher average absolute edge than injury-known games.
5. **Props / other sports:** NCAAF props, NFL/NHL P0 totals, correlation caps unchanged in regression suite.
6. **Sign-off:** Explicit human approval to lift `P0_UNVALIDATED_NCAAF_GAME_LINE_*` — no silent restore.

## Phase F — Rollout

1. Feature flag / P0 lift on staging only.
2. Shadow-mode logging of would-be grades vs close for one slate week.
3. Production restore only after Phase E + staging review.
4. Simulator V2 remains isolated unless separately approved.

## Owners / artifacts

- Engine: `artifacts/api-server/src/lib/sportSim/nflDriveSim.ts`
- Gate: `artifacts/stadium-mobile/lib/coachP0UnvalidatedTotals.ts`
- Cap tests: `artifacts/api-server/test/nflDriveSimCaps.test.ts`
- Integrity PR: #662
