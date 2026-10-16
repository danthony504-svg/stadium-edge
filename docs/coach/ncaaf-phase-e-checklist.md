# NCAAF Phase E — acceptance checklist (do not flip P0)

**Holdout:** ESPN scoreboard 2023–2024 (`test/fixtures/ncaaf-phase-e-games.json`, 1739 games).  
**Engine under test:** coach `nfl-drive` (`ncaafPhaseEHoldoutCalibration.ts`).  
**Form inputs:** venue split blended with L10 via `blendVenueAndL10` (production `footballGameSimInputs` parity).  
**Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false` until every restore criterion is PASS + human sign-off.

## Latest calibration report (2024 holdout, `ppg-per-drive-v1`)

Source: `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json`  
Generated: 2026-10-15T10:37:48.628Z. Engine: `nfl-drive:ppg-per-drive-v1`. Selection-time venue/L10 form. A credible ESPN last-play stamp is used when it falls 2.5 to 12 hours after kickoff. Otherwise the input uses kickoff plus 4 hours, which is an availability assumption and not proof of completion. A sensitivity pass that drops every prior without a credible stamp scores 861 games (Brier 0.20091, ECE 0.04498, bias +0.03701). Primary metrics below still include the assumption.

The 2026-10-14 E2a **PASS** is **WITHDRAWN**. That report used the same `nfl-drive` engine with points per game passed in as points per drive, then multiplied NCAAF inputs by 0.48, at 1,500 sims (Brier 0.199, bias ≈ +0.020, 865 games). The 0.48 scale was a patch on that unit mismatch. `priorE2aClaim.restored` stays `false`. A later numeric result does not restore the withdrawn claim.

Official measurement uses the precommitted primary seed **20241015** (first of `20241015, 7, 42, 99, 123456789`). Seeds were listed before the run. The 0.45/0.55 cohort bounds and the 0.70 cover cap are unchanged. Form for a game includes only earlier games that were available at the evaluated kickoff: a credible last-play stamp when one exists, otherwise kickoff plus 4 hours. The evaluated game is not an input.

| Metric | Value |
|--------|-------|
| Holdout games scored | 865 (6 skipped thin form) |
| Sims / game | **10000** |
| Calibration seed | **20241015** (primary) |
| Form methodology | Kickoff order. Credible last-play stamp when available; otherwise kickoff + 4 hours (assumption). Venue split blends with L10 |
| Brier (engine) | **0.19860** |
| Brier (coin) | 0.250 |
| Log loss | 0.57632 |
| ECE (10-bin) | **0.05296** |
| meanP / meanY (home ML) | **0.67397 / 0.63699** (bias ≈ **+0.03698**, within 0.08) |
| Official dog cohort, pHome in (0.45, 0.55), away +7.5 | **0.6757** (n=111) |
| Dog-cover range across the five seeds | **0.6757–0.6990** (mean 0.6844). Seed 123456789 is 0.6990 (n=103) and stays in the set |
| Games within 0.01 of 0.45 or 0.55 | **39** |
| E2a (`E2_outcomeVsCoin`) | **PASS** on the primary seed (new measurement) |
| Closing-line CLV (E2b) | **OPEN_NEEDS_AGREED_TOLERANCE** (770 joins). No CLV PASS label |
| Close-archive soft gates | **PASS_SOFT_GATES_ONLY** on this engine (n=770, engine Brier 0.2165, market Brier 0.1768, mean gap +0.0366). Not CLV |
| Injury segments | **INSUFFICIENT_DATA** |

### Cohort boundaries (diagnostic; thresholds unchanged)

| Window | n | Away +7.5 cover |
|--------|---|-----------------|
| (0.43, 0.57) | 147 | 0.687 |
| (0.44, 0.56) | 127 | 0.701 |
| (0.45, 0.55) official | 111 | 0.676 |
| (0.46, 0.54) | 89 | 0.674 |
| (0.47, 0.53) | 66 | 0.636 |

### Home-win bias

An older FAIL used **combined L10 only** (no home/away venue splits) and showed home-win underprediction (meanP ≈ 0.49 vs meanY ≈ 0.61). This holdout uses the venue blend. On `ppg-per-drive-v1` the home-win bias is about **+0.037**. The primary-seed dog cover is 0.676, inside the 0.70 cap. Seed 123456789 is 0.699 and was kept. Rates were not adjusted, and the seed list was not reordered, to obtain the PASS.

## Criterion board

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| E1 | Sensitivity ±3 ppg / QB-out ≥2pp | **PASS (unit)** | `ncaafGameLineSimValidation.test.ts` |
| E2a | Outcome calibration vs coin (Brier, ECE, dog pathology, bias) | **PASS (primary seed)** | New 10k measurement on seed 20241015: Brier 0.199, ECE 0.053, bias ≈ +0.037, dog cover 0.676 (n=111). The 2026-10-14 PASS stays WITHDRAWN |
| E2b | Closing-line CLV | **OPEN** | Rows exist (770 joins). No agreed CLV tolerance and no CLV PASS label. Soft gates on this engine are PASS_SOFT_GATES_ONLY and are not the restore criterion |
| E3 | Exact-line binder | **PASS (unit)** | `gameSimQualityGates.test.ts` |
| E4 | Injury conservatism | **INSUFFICIENT_DATA** | Scoreboard cache has no QB/injury flags |
| E5 | Props / other-sport P0 regressions | **PASS (unit suite)** | Re-run before any flag flip |
| E6 | Human sign-off | **OPEN** | Required after E2b/E4 PASS |

**Restore readiness:** **NO**. Closing lines are loaded. The outstanding items are an agreed CLV validation result, pre-kickoff injury evidence, and human sign-off. College game lines stay P0-blocked. `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false`. Do not flip.

## Unavailable data — exact dependencies

| Gap | Dependency |
|-----|------------|
| E2b closing lines | The archive is vendored from PR 737 commit `7fbf065a` (see `docs/coach/ncaaf-e2b-closing-line-provenance.md`). 774 rows have a numeric home spread and moneyline; 68 lack a moneyline and are dropped. 770 of those rows joined the corrected-engine holdout. Soft gates published on that PR pass on this engine and are not a CLV PASS. Coach pick CLV on the old engine was `COMPUTED_NO_PASS_LABEL` (mean ML CLV −0.0234). This branch does not attach a CLV PASS label. `ODDS_API_KEY` is still unset, so the archive was not refetched |
| E4 injury / QB | Same CSV `injuryKnown` (+ optional `qbOut`) per game, **or** historical ESPN injury snapshots keyed by `eventId`/`teamId` before kickoff. Live ESPN `/injuries` (current season only) is **not** a historical holdout archive. |

### Credential probe (Cloud Agent, 2026-10-14)

| Secret / source | Status |
|-----------------|--------|
| Injected secrets | **`EXPO_TOKEN` only** (`CLOUD_AGENT_INJECTED_SECRET_NAMES`) |
| `ODDS_API_KEY` | **Missing** — `GET /v4/historical/sports/americanfootball_ncaaf/odds` → `MISSING_KEY` |
| ESPN injuries (live) | Public 200 — **current** teams only; no pregame 2023–2024 archive in repo |
| `NCAAF_PHASE_E_FIXTURE` | Unset |

### Leakage audit (E2a venue/L10)

- Games are ordered by kickoff. The evaluated event id is absent from its own form.
- Of 1,739 fixture games, 1,602 have a credible ESPN `meta.lastPlayWallClock` (2.5 to 12 hours after kickoff). 36 have no stamp. 101 stamps are unusable (too short or too long to be a final whistle). Across the walk, 1,599 inclusions used a credible stamp and 137 used the 4-hour assumption.
- That 4-hour figure is an availability assumption. It can treat a long game as finished early and a short game as unfinished late. A last-play clock is also not the official final whistle.
- The 2024 scored metrics did not move after the credible stamps were applied (Brier 0.19859952716763005, dog cover 0.6756756756756757, n=111).
- Unit proof: `test/ncaafPhaseEHoldoutLeakage.test.ts` checks the availability basis on every contributor (more than 1,000). The harness scores 796 games where both teams already have at least two prior games. The report scores 865 because 69 additional games use a thin venue sample (`venue_thin`) while L10 is still under two. Those extra games are still prior games, and the evaluated game is not among them.
- Untouched 2024 holdout (report): **865** scored games, kickoffs **2024-08-24 → 2024-12-08**, E2a **PASS** on primary seed 20241015 (`ppg-per-drive-v1`, 10,000 sims), bias ≈ +0.037, E2b CLV **OPEN_NEEDS_AGREED_TOLERANCE**, flag remains **false**. The 2026-10-14 E2a PASS on the mismatched engine is withdrawn. The PR 737 soft-gate PASS is a separate claim on that older engine and is not restored.

## Sign-off criteria before flipping `NCAAF_GAME_LINE_SIM_VALIDATED`

All of the following must be true in a single PR that only flips the flag:

1. **E2a PASS** — holdout report shows Brier < coin, ECE ≤ 0.12, \|meanP−meanY\| ≤ 0.08, near-coin +7.5 dog cover ≤ 0.70 (n≥30).
2. **E2b PASS** — frozen closing-line archive wired; engine CLV / market-Brier within agreed tolerance vs close (document numbers in the PR).
3. **E4 PASS** — injury-known vs unknown segments: unknown must not show higher mean \|edge\| than known.
4. **E5 green** — `coachP0UnvalidatedTotals`, college mix proof, NFL/NHL totals P0 tests pass on that commit.
5. **E6** — named human approver + date + commit SHA recorded in the PR body.
6. Totals (FG/team/period) remain on their separate P0 until totals recalibration — this flag only clears **game-side** NCAAF lines.
7. **E2E** — device/build returns valid, simulated NCAAF spread/ML picks (not early-exit empty notes alone).

## Commands

```bash
# Rebuild holdout report (keeps flag false; exits 2 while restore blocked)
cd artifacts/api-server
NCAAF_PHASE_E_SIMS=10000 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseEHoldoutCalibration.ts

# Unit gates
node --import ./test/register-hooks.mjs --test \
  test/ncaafGameLineSimValidation.test.ts \
  test/ncaafPhaseEGates.test.ts
```
