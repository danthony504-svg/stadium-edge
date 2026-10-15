# NCAAF Phase E — acceptance checklist (do not flip P0)

**Holdout:** ESPN scoreboard 2023–2024 (`test/fixtures/ncaaf-phase-e-games.json`, 1739 games).  
**Engine under test:** coach `nfl-drive` (`ncaafPhaseEHoldoutCalibration.ts`).  
**Form inputs:** venue split blended with L10 via `blendVenueAndL10` (production `footballGameSimInputs` parity).  
**Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false` until every restore criterion is PASS + human sign-off.

## Latest calibration report (2024 holdout, `ppg-per-drive-v1`)

Source: `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json`  
Generated: 2026-10-15. Engine: `nfl-drive:ppg-per-drive-v1`. Selection-time venue/L10 form (arrays update after each game).

The 2026-10-14 E2a **PASS** is **WITHDRAWN**. That report used the same `nfl-drive` engine with points per game passed in as points per drive, then multiplied NCAAF inputs by 0.48, at 1,500 sims (Brier 0.199, bias ≈ +0.020, 865 games). The 0.48 scale was a patch on that unit mismatch. A later numeric result does not restore the withdrawn claim.

| Metric | Value |
|--------|-------|
| Holdout games scored | 865 (6 skipped thin form) |
| Sims / game | **10000** |
| Form methodology | venue_split + L10 blend (no invented HFA constant) |
| Brier (engine) | **0.199** |
| Brier (coin) | 0.250 |
| Log loss | 0.577 |
| ECE (10-bin) | **0.051** |
| meanP / meanY (home ML) | **0.674 / 0.637** (bias ≈ **+0.037**, within 0.08) |
| Near-coin-flip ML + away +7.5 cover | **0.704** (n=108) — above the 0.70 cap |
| E2a (`E2_outcomeVsCoin`) | **FAIL** (dog cover only; Brier, ECE, and bias cleared) |
| Closing-line CLV (E2b) | **INSUFFICIENT_DATA** (this gate has no prior PASS) |
| Injury segments | **INSUFFICIENT_DATA** |

### Home-win bias

An older FAIL used **combined L10 only** (no home/away venue splits) and showed home-win underprediction (meanP ≈ 0.49 vs meanY ≈ 0.61). This holdout uses the venue blend. On `ppg-per-drive-v1` the home-win bias is about **+0.037**. The failing gate is the near-coin +7.5 dog cover, 0.704 vs a 0.70 cap. Rates were not adjusted to pull that cover under the cap.

## Criterion board

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| E1 | Sensitivity ±3 ppg / QB-out ≥2pp | **PASS (unit)** | `ncaafGameLineSimValidation.test.ts` |
| E2a | Outcome calibration vs coin (Brier, ECE, dog pathology, bias) | **FAIL** | 2026-10-14 PASS withdrawn. New 10k `ppg-per-drive-v1` run: dog cover 0.704 > 0.70. Bias ≈ +0.037 |
| E2b | Closing-line / market CLV | **INSUFFICIENT_DATA** | Needs licensed closing spreads/ML |
| E3 | Exact-line binder | **PASS (unit)** | `gameSimQualityGates.test.ts` |
| E4 | Injury conservatism | **INSUFFICIENT_DATA** | Scoreboard cache has no QB/injury flags |
| E5 | Props / other-sport P0 regressions | **PASS (unit suite)** | Re-run before any flag flip |
| E6 | Human sign-off | **OPEN** | Required after E2b/E4 PASS |

**Restore readiness:** **NO** — E2a FAIL, plus E2b + E4 + E6 still open. College game lines stay P0-blocked. `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false`.

## Unavailable data — exact dependencies

| Gap | Dependency |
|-----|------------|
| E2b closing lines | `ODDS_API_KEY` with **The Odds API historical scores** access for `americanfootball_ncaaf`, **or** frozen CSV at `NCAAF_PHASE_E_FIXTURE` with columns `gameId,season,home,away,closeSpreadHome,closeMlHome,homeScore,awayScore,injuryKnown` |
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
- Untouched 2024 holdout (report): **865** scored games, kickoffs **2024-08-24 → 2024-12-08**, E2a **FAIL** on `ppg-per-drive-v1` (10,000 sims), bias ≈ +0.037, flag remains **false**. The 2026-10-14 PASS on the mismatched engine is withdrawn.

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
