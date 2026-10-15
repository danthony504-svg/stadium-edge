# NCAAF Phase E — acceptance checklist (do not flip P0)

**Holdout:** ESPN scoreboard 2023–2024 (`test/fixtures/ncaaf-phase-e-games.json`, 1739 games).  
**Engine under test:** coach `nfl-drive` (`ncaafPhaseEHoldoutCalibration.ts`).  
**Form inputs:** venue split blended with L10 via `blendVenueAndL10` (production `footballGameSimInputs` parity).  
**Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false` until every restore criterion is PASS + human sign-off.

## Latest calibration report (2024 holdout, `ppg-per-drive-v1`)

Source: `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json`  
Generated: 2026-10-15T09:24:12.267Z. Engine: `nfl-drive:ppg-per-drive-v1`. Selection-time venue/L10 form (arrays update after each game).

The 2026-10-14 E2a **PASS** is **WITHDRAWN**. That report used the same `nfl-drive` engine with points per game passed in as points per drive, then multiplied NCAAF inputs by 0.48, at 1,500 sims (Brier 0.199, bias ≈ +0.020, 865 games). The 0.48 scale was a patch on that unit mismatch. `priorE2aClaim.restored` stays `false`. A later numeric result does not restore the withdrawn claim.

Official measurement uses the precommitted primary seed **20241015** (first of `20241015, 7, 42, 99, 123456789`). Seeds were listed before the run. The 0.45/0.55 cohort bounds and the 0.70 cover cap are unchanged. An earlier unseeded `Math.random` run on this engine recorded dog cover 0.704 (n=108) and is superseded by this seeded protocol.

| Metric | Value |
|--------|-------|
| Holdout games scored | 865 (6 skipped thin form) |
| Sims / game | **10000** |
| Calibration seed | **20241015** (primary) |
| Form methodology | venue_split + L10 blend (no invented HFA constant) |
| Brier (engine) | **0.19857** |
| Brier (coin) | 0.250 |
| Log loss | 0.57618 |
| ECE (10-bin) | **0.05054** |
| meanP / meanY (home ML) | **0.67407 / 0.63699** (bias ≈ **+0.03708**, within 0.08) |
| Official dog cohort, pHome in (0.45, 0.55), away +7.5 | **0.6727** (n=110) |
| Dog-cover range across the five seeds | **0.6727–0.7019** (mean 0.6868). Seed 123456789 is 0.7019 (n=104) and stays in the set |
| Games within 0.01 of 0.45 or 0.55 | **48** |
| E2a (`E2_outcomeVsCoin`) | **PASS** on the primary seed (new measurement) |
| Closing-line CLV (E2b) | **INSUFFICIENT_DATA** (archive absent; no prior E2b PASS) |
| Injury segments | **INSUFFICIENT_DATA** |

### Cohort boundaries (diagnostic; thresholds unchanged)

| Window | n | Away +7.5 cover |
|--------|---|-----------------|
| (0.43, 0.57) | 146 | 0.685 |
| (0.44, 0.56) | 129 | 0.698 |
| (0.45, 0.55) official | 110 | 0.673 |
| (0.46, 0.54) | 85 | 0.659 |
| (0.47, 0.53) | 62 | 0.645 |

### Home-win bias

An older FAIL used **combined L10 only** (no home/away venue splits) and showed home-win underprediction (meanP ≈ 0.49 vs meanY ≈ 0.61). This holdout uses the venue blend. On `ppg-per-drive-v1` the home-win bias is about **+0.037**. The primary-seed dog cover is 0.673, inside the 0.70 cap. Seed 123456789 is 0.702 and was kept. Rates were not adjusted, and the seed list was not reordered, to obtain the PASS.

## Criterion board

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| E1 | Sensitivity ±3 ppg / QB-out ≥2pp | **PASS (unit)** | `ncaafGameLineSimValidation.test.ts` |
| E2a | Outcome calibration vs coin (Brier, ECE, dog pathology, bias) | **PASS (primary seed)** | New 10k measurement on seed 20241015: Brier 0.199, ECE 0.051, bias ≈ +0.037, dog cover 0.673 (n=110). The 2026-10-14 PASS stays WITHDRAWN. Seed 123456789 dog cover 0.702 is recorded |
| E2b | Closing-line / market CLV | **INSUFFICIENT_DATA** | `ncaaf-phase-e-closing-lines.json` is absent. Usable joined rows: 0 |
| E3 | Exact-line binder | **PASS (unit)** | `gameSimQualityGates.test.ts` |
| E4 | Injury conservatism | **INSUFFICIENT_DATA** | Scoreboard cache has no QB/injury flags |
| E5 | Props / other-sport P0 regressions | **PASS (unit suite)** | Re-run before any flag flip |
| E6 | Human sign-off | **OPEN** | Required after E2b/E4 PASS |

**Restore readiness:** **NO** — E2a on primary seed 20241015 is a new PASS, and E2b + E4 + E6 remain open. College game lines stay P0-blocked. `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false`. Do not flip.

## Unavailable data — exact dependencies

| Gap | Dependency |
|-----|------------|
| E2b closing lines | The file `artifacts/api-server/test/fixtures/ncaaf-phase-e-closing-lines.json` does not exist in git history or on disk. `ODDS_API_KEY` is unset. ESPN completed scoreboard `odds` and summary `pickcenter` are empty. `CLOSING_LINE_ARCHIVE.md` at `f494c3a5` is a design note and is not on this branch. Prior reports set E2b to INSUFFICIENT_DATA; no E2b PASS exists. A usable row needs `eventId`, finite `closeSpreadHome`, and finite `closeMlHome`. With 0 joins the verdict stays INSUFFICIENT_DATA. A future archive of ≥200 joins stays `OPEN_NEEDS_AGREED_TOLERANCE` until a numeric CLV tolerance is written down. Supply `ODDS_API_KEY` with **The Odds API historical odds** for `americanfootball_ncaaf`, **or** that frozen JSON, **or** a CSV at `NCAAF_PHASE_E_FIXTURE` with columns `gameId,season,home,away,closeSpreadHome,closeMlHome,homeScore,awayScore,injuryKnown` |
| E4 injury / QB | Same CSV `injuryKnown` (+ optional `qbOut`) per game, **or** historical ESPN injury snapshots keyed by `eventId`/`teamId` before kickoff. Live ESPN `/injuries` (current season only) is **not** a historical holdout archive. |

### Credential probe (Cloud Agent, 2026-10-14)

| Secret / source | Status |
|-----------------|--------|
| Injected secrets | **`EXPO_TOKEN` only** (`CLOUD_AGENT_INJECTED_SECRET_NAMES`) |
| `ODDS_API_KEY` | **Missing** — `GET /v4/historical/sports/americanfootball_ncaaf/odds` → `MISSING_KEY` |
| ESPN injuries (live) | Public 200 — **current** teams only; no pregame 2023–2024 archive in repo |
| `NCAAF_PHASE_E_FIXTURE` | Unset |

### Leakage audit (E2a venue/L10)

- Form arrays update **after** each game is scored (chrono season→week→kickoff).
- Unit proof: `test/ncaafPhaseEHoldoutLeakage.test.ts` — every contributing kickoff `<` evaluated game key.
- Untouched 2024 holdout (report): **865** scored games, kickoffs **2024-08-24 → 2024-12-08**, E2a **PASS** on primary seed 20241015 (`ppg-per-drive-v1`, 10,000 sims), bias ≈ +0.037, E2b **INSUFFICIENT_DATA**, flag remains **false**. The 2026-10-14 PASS on the mismatched engine is withdrawn.
- The leakage harness counts **796** games where both teams already have at least two prior games. The other **69** scored games use `venue_thin` (one prior game at that venue, L10 still under two). Form for those games is still written after the kickoff. The report drops **0** ties. Six holdout games stay skipped because neither venue nor L10 produced an input.

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
