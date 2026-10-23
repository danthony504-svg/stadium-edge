# Coach game-model loss audit and numerical repair

Audit date: 2026-10-22. Source baseline: main `e271747887161d8630abd9a00b9324878189faad`.

The user's screenshot contains seven settled legs: three wins and four losses. MIL/WAS Under 238.5 lost at 244; CHI +14.5 and Q1 +7.5 lost; TOR team Under 124.5 lost at 135. MIL Q1 +5.5, CHA/BKN Under 219.5, and BKN +8.5 won. The original per-leg forecasts, inputs, prices at recommendation, and model snapshots have not been recovered. A losing outcome alone does not establish a software defect or miscalibration. The defects below were established independently from source and controlled simulations; these are not reconstructed historical forecasts.

## Fixed in this change

| Issue | Evidence | Repair |
| --- | --- | --- |
| NBA/WNBA scoring level cancels | Seeded 10,000-draw old-engine probes with all four scoring averages set to 100, 110, 120, or 130 produced identical 108.48 home / 108.53 away scores. Points per game were treated as efficiency ratings; the derived pace saturated at 108. | Replace this conversion with the existing score-distribution sampler. Offense and opponent defense set the mean directly; recent scores supply variance with the existing variance floor. Require positive finite scoring averages and at least five usable recent scores per side. |
| NCAAB missing-data fallback | NCAAB dispatched through the generic engine, whose fallback mean is 4.5. | Dispatch college basketball through the same guarded basketball sampler. Missing history produces no model result. |
| Basketball periods/races inferred from full-game draws | Quarter/half scores are fractions of the full-game draw plus small noise, rather than observed period distributions. | Do not emit basketball period or race-to hit rates. The client rejects direct, fuzzy, derived and ML fallback grades for these requests. This deliberately reduces available recommendations. |
| Legacy basketball model reuse | Old server results can remain in client maps. | New `nba-score-v2`, `wnba-score-v2`, `ncaab-score-v2` identifiers; client scoring rejects old/missing identifiers for basketball. Bump simulator result fingerprint. |
| Milestone pseudo-success prior | With zero triple-doubles in three games, Beta(1,1) smoothing produced 20%, creating an apparent +10.7 percentage point edge against +975 odds (9.3% break-even). | DD/TD need at least ten complete binary game logs and evidence of both outcomes. Otherwise withhold the estimate. Use weighted observed frequency without a pseudo-success; apply the same rule to local fallback. Version milestone distribution cache to v2; preserve other prop keys. |
| Generic ticket concentration grows just to fill | Top-up could progressively raise the game-line cap; game-lines-only requests implicitly assumed two games even without that constraint. | Generic requests keep their normal cap and report shortfall. Explicit few-game requests retain their override. Existing college-specific stack policy remains unchanged. This is a concentration safeguard, not a joint probability model. |

Numerical correction does not establish predictive calibration. The replacement basketball engine uses independent team score draws and the existing standard-deviation floor (12% of projected mean). It does not model possessions, lineup minutes, joint score covariance, overtime settlement rules, or rare-event population rates. Labels now describe it as an observed-score distribution. The 52% and C+ recommendation floors remain unchanged; no extra data requests are introduced. The existing NCAAF lock is not lifted.

## Other confirmed issues still open

| Priority | Issue and source | Reproduction / impact | Existing protection and next work |
| --- | --- | --- | --- |
| High | NFL/NCAAF points-per-game passed as points-per-drive (`src/lib/sportSim/nflDriveSim.ts`) | With all four averages 20 or 35 and seed 719, 10,000 draws return exactly 41.60 home / 42.53 away in both cases. TD and FG rates saturate at ordinary PPG. | Existing P0 blocks NFL/NCAAF totals and all NCAAF game-side grades. NFL game-side markets remain open under the existing policy; they need a separate repair and validation. Do not reopen NCAAF. |
| High | NFL side-order bias (same file) | Every home drive runs before every away drive. The home trailing bonus compares against away score zero, while the away bonus compares against the completed home score. | Alternate drives or remove the unsupported state adjustment during a separately validated engine repair; test home/away swap symmetry. |
| High | NHL goals discounted twice (`src/lib/sportSim/nhlShiftSim.ts`) | Goals/game are divided by 60 then multiplied by a fabricated `(1-savePct)` factor. Equal 3.1 inputs produce 0.28 / 0.29 goals in the seeded probe. | Existing P0 blocks NHL totals. Other NHL game-side grades remain open under the existing policy; replace the invalid rate conversion and validate all settlements before claiming an edge. |
| Medium | MLB fatigue reverses its stated effect (`src/lib/sportSim/mlbInningSim.ts`) | Late innings multiply scoring by 0.94 / 0.90. Equal 4.5 inputs yield 4.34 / 4.35 runs; the weighted factor is 8.68/9. No actual pitcher/bullpen input drives this adjustment. | Remove unsupported adjustment or ground it in verified inputs and validate the resulting distribution. |
| Medium | MLB artificial run floor (same file) | Minimum 0.15 per inning creates 1.37 / 1.35 runs from zero scoring inputs. | Distinguish genuinely observed zero, missing history, and valid rates; withhold unsupported estimates rather than substituting a floor. |
| Medium | Soccer artificial shot floor (`src/lib/sportSim/soccerXgSim.ts`) | Zero goal means still yield 0.20 / 0.19 goals because each shot has a minimum 2% scoring chance. Possession and xG are derived from goals/game rather than measured possession or xG. | Remove misleading signal claims and validate rate conversion/zero support. The equal 1.4 fixture happens to preserve its mean; that does not validate the tails or asymmetric matchups. |
| High | Missing-data means in remaining sport engines | NFL 22, NHL 3.1, MLB 4.5, soccer 1.4 fallback means can manufacture forecasts when both sources are absent. | Apply an explicit evidence policy to each remaining engine, with failure reasons and tests. Basketball now withholds instead. |

Seeded probes above use `createPropSimRng(719)`, 10,000 draws, equal home/away `ptsFor`/`ptsAgainst`, and recent scores `[mean-1, mean, mean+1, mean-1, mean+1]`. They isolate arithmetic rather than evaluate betting performance. Corrected basketball outputs with those fixtures are 100.19 / 99.91 at input 100, 130.25 / 129.88 at input 130, and WNBA 80.15 / 79.93 at input 80.

## Validation and observability gaps

- Held-out, time-correct backtests for probability calibration, spread/total residuals and price-relative value are still required. Ten thousand simulations reduce sampling noise; they do not improve the quality of three history games.
- Same-game legs share outcomes. Individual grades and soft correlation penalties do not establish a parlay's joint hit probability. This change limits generic concentration; explicit same-game asks still require a defensible joint model.
- Game-score inputs do not contain a lineup/minutes scoring adjustment. Separate injury grading cannot be assumed to correct the score distribution.
- A durable per-leg audit snapshot was not recovered for the user's ticket. Record recommendation time, exact event/market/side/line/odds/book, model version, input timestamps/sample sizes, hit estimate, rejection reasons and eventual settlement to support future diagnosis. Reliability `parlay_fulfilled` events alone are insufficient.
- The historical 83.9s and 201.7s waits include long gaps beyond the logged individual API response times. Those logs do not identify the entire client/LLM wait. The earlier assembly performance repair is separate; this change adds no network calls.

## Rollout and acceptance

Merge only after review and CI. Deploy the API commit on Render first, then publish the Build 78 compatible **preview** OTA from main (`publish-coach-preview-ota.yml`, `PREVIEW_ONLY`). An OTA cannot replace the Render deployment. No native build or dependency change is required. Do not use the TEST001/TEST002 workflows as preview: they publish to production.

On the phone, start a fresh Coach conversation. Check a full-game basketball total, a quarter request (must not receive a simulation-backed quarter recommendation), a generic deep ticket (honest shortfall rather than automatic over-stacking), DD/TD with thin evidence (unavailable rather than a fabricated chance), and supported mixed-evidence milestones. Simulator and Coach should agree on exact line/side hit rates and odds. These phone checks and held-out calibration have not been performed by this patch.

Local verification: 629 critical checks passed, including the new basketball mean/variance/evidence and period guards; 41 additional scoring/recommendation checks passed. API/mobile TypeScript checks and API build passed. The additional suite exposed an existing positive-recommendation fixture with no sport; it also failed against the unchanged scorer. That fixture now explicitly supplies its MLB identity, preserving the existing missing-sport safeguard. No live wagers, original historical forecast replay, device verification, or new held-out backtest was performed.
