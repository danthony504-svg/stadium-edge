# NCAAF Phase E — acceptance checklist (do not flip P0)

**Holdout:** ESPN scoreboard 2023–2024 (`test/fixtures/ncaaf-phase-e-games.json`, 1739 games).  
**Engine under test:** coach `nfl-drive` (`ncaafPhaseEHoldoutCalibration.ts`).  
**Form inputs:** venue split blended with L10 via `blendVenueAndL10` (production `footballGameSimInputs` parity).  
**Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false` until every restore criterion is PASS + human sign-off.

## Latest calibration report (2024 holdout, venue-aware form)

Source: `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json`

| Metric | Value |
|--------|-------|
| Holdout games scored | 865 (6 skipped thin form) |
| Sims / game | 1500 |
| Form methodology | venue_split + L10 blend (no invented HFA constant) |
| Brier (engine) | **0.199** |
| Brier (coin) | 0.250 |
| Log loss | 0.577 |
| ECE (10-bin) | **0.042** |
| meanP / meanY (home ML) | **0.657 / 0.637** (bias ≈ **+0.020**, within 0.08) |
| Near-coin-flip ML + away +7.5 cover | 0.683 (n=139) — OK vs 0.70 cap |
| Close soft gates (not CLV) | **PASS** — n≈713+; marketBrier **~0.179**, engineBrier **~0.219**, both &lt; coin; mean(engine−market)≈**+0.019** prob. points |
| Coach pick CLV (10k sims) | **Computed — no PASS label** — `ncaaf-phase-e-coach-pick-clv-report.json` (selection-time sides, not blanket home) |
| Injury segments | **INSUFFICIENT_DATA** (null ≠ no-injury; collector started; no subscription on unverified timing) |

### Home-win bias root cause (fixed in calibration)

Prior FAIL used **combined L10 only** (no home/away venue splits) → meanP ≈ 0.49 vs meanY ≈ 0.61 (home-win underprediction). Production sims already used venue blends; holdout now matches that path. Residual bias ≈ +0.02 (slight overprediction) — within threshold.

## Criterion board

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| E1 | Sensitivity ±3 ppg / QB-out ≥2pp | **PASS (unit)** | `ncaafGameLineSimValidation.test.ts` |
| E2a | Outcome calibration vs coin (Brier, ECE, dog pathology, bias) | **PASS** | Venue-aware holdout; \|bias\|≈0.020 ≤ 0.08 |
| E2b | Close archive + soft gates | **PASS** (soft) | Criteria below — **not** Coach pick CLV |
| E2b′ | Coach pick CLV @ selection prices | **COMPUTED_NO_PASS_LABEL** | 10k sims; report metrics for E6 — **no CLV PASS** |
| E3 | Exact-line binder | **PASS (unit)** | `gameSimQualityGates.test.ts` |
| E4 | Injury conservatism | **INSUFFICIENT_DATA** | Forward ESPN snapshots only — [`ncaaf-e4-injury-provider.md`](./ncaaf-e4-injury-provider.md) |
| E5 | Props / other-sport P0 regressions | **PASS (unit suite)** | Re-run before any flag flip |
| E6 | Human sign-off | **OPEN** | Evidence pack: [`ncaaf-e6-signoff-evidence.md`](./ncaaf-e6-signoff-evidence.md) |

**Restore readiness:** **NO** — E4 + E6 still open (`E2_readyForRestore=OPEN_NEEDS_E4_E6`). College game lines stay P0-blocked.

## E2b — exact acceptance criteria (coded soft gates)

Each must hold on the close-joined scored holdout set:

1. `n ≥ 200` games with pre-kickoff close ML + engine home-ML sim + final scores  
2. `marketBrier(close ML) < 0.25` (beat coin)  
3. `engineBrier < 0.25` on the **same** games  
4. `|mean(engineP_home − marketP_home_at_close)| ≤ 0.15`

**Why it passed (1500-sim report):** n=713; marketBrier≈0.179; engineBrier≈0.219; mean(engine−market)≈**+0.019** (within 0.15).

### What `mean(engine−market)=+0.019` is

| | |
|--|--|
| **Symbol** | `(1/n) Σ_i (engineP_i − marketP_i)` |
| **Unit** | Probability points on **[0, 1]** (not percent; +0.019 ≈ +1.9 percentage points) |
| **engineP_i** | Coach `nfl-drive` home-ML hit rate for game *i* |
| **marketP_i** | Implied home win prob from the **closing** American ML |
| **Meaning** | Engine is, on average, **1.9 pp more bullish on home** than the closing market |
| **Not CLV** | Does not use an earlier selection price; does not measure beating the close |

### Coach pick CLV (selection-time sides — final validation)

Script: `scripts/ncaafPhaseECoachPickClv.ts` → `test/fixtures/ncaaf-phase-e-coach-pick-clv-report.json`.

Uses **unchanged** sim + qualification rules on historical data available at selection (~24h Odds snap): `simHit≥0.52`, conf≥52, edge/EV&gt;0, sim-favored side when \|Δp\|≥0.03. **Not** blanket home. Graded vs E2b close. **10,000 sims/game.**

| Metric | Value |
|--------|------:|
| Selected picks | **182** (107 home / 75 away; 43 ML / 139 spread) |
| Mean ML CLV | **−0.0234** probability points (n=43) |
| % ML picks that beat close | **20.9%** |
| Mean spread CLV | **−0.094** points |
| Hit rate (decided) | **0.497** (89–90; Wilson95 **0.425–0.570**) |
| Untouched-period market Brier | **0.189** (n=391 games after 2024-10-15; no Coach picks) |
| Verdict | **`COMPUTED_NO_PASS_LABEL`** — do **not** cite as CLV PASS |

Scope: Odds-listed FBS in the close archive. `injuryKnown` remains **null**. Flag stays **false**.

Legacy home-only T−24h study (`ncaaf-phase-e-true-clv-*`) is **not** Coach performance.

**Brier** = outcome calibration of a probability. **Δp (engine−market)** = model vs close disagreement. **Coach pick CLV** = selected side’s selection-time price vs close.

## E2b closing-line archive (2024 holdout)

Built by `scripts/ncaafPhaseE2bClosingLines.py` (+ alias rematch) → `test/fixtures/ncaaf-phase-e-closing-lines.json`.

**Closing definition:** Odds API historical odds with `date=kickoff` (closest snapshot ≤ commence). Midday slate files are **not** closes.

| Join / QA | Count |
|-----------|------:|
| Holdout games (2024) | 871 |
| Matched after alias rematch | **842** |
| Full spread+ML + finals | **774** |
| Still missing | **29** |
| Alias rematch recovered | **64** of original 93 |

### Missing-game coverage bias

Original 93 misses were mostly **name mismatches** (Hawaiʻi / Hawaii, San José / San Jose, UMass, Sam Houston State, …) plus FCS/unlisted. After rematch, **29** remain — dominated by **App State** (Odds: Appalachian State) and **Southern Miss** (Odds: Southern Mississippi) plus FCS/non-listed opponents (SE Louisiana, Houston Christian, East Texas A&M, LIU, Youngstown State, ETSU).

**Validation supports:** FBS regular-season games listed on The Odds API `americanfootball_ncaaf` with matchable names. **Does not support:** FCS-only coverage, or unlisted/unmatchable FBS aliases until rematched.

## E4 / E6 — precise remaining requirements

**E4** (see [`ncaaf-e4-injury-provider.md`](./ncaaf-e4-injury-provider.md)):

1. Prove pre-kickoff timing **or** accumulate forward snapshots (`ncaafPregameInjurySnapshotCollector.ts`) with `captureTimestamp < kickoffIso` — **do not purchase** SportsDataIO/ScoreTape on unverified archive timing.  
2. Join `injuryKnown=true|null` (+ optional `qbOut`); never coerce missing → false.  
3. Conservatism: mean \|edge\| on unknown **≤** mean \|edge\| on known; document n.  

**E6:** Exact pack in [`ncaaf-e6-signoff-evidence.md`](./ncaaf-e6-signoff-evidence.md). Named human approver + date + commit SHA in the flag-flip PR only (after E4 + E5 + E2E). Keep flag **false** in this draft.

### Durable Odds secret (ops only)

Exact server env name: **`ODDS_API_KEY`**. Entry steps: [`odds-api-key-cloud-agent.md`](./odds-api-key-cloud-agent.md).

### Leakage audit (E2a venue/L10)

- Form arrays update **after** each game is scored (chrono season→week→kickoff).
- Unit proof: `test/ncaafPhaseEHoldoutLeakage.test.ts` — every contributing kickoff `<` evaluated game key.
- Untouched 2024 holdout (report): **865** scored games, kickoffs **2024-08-24 → 2024-12-08**, E2a **PASS**, bias ≈ +0.020, flag remains **false**.

## Sign-off criteria before flipping `NCAAF_GAME_LINE_SIM_VALIDATED`

All of the following must be true in a single PR that only flips the flag:

1. **E2a PASS** — holdout report shows Brier < coin, ECE ≤ 0.12, \|meanP−meanY\| ≤ 0.08, near-coin +7.5 dog cover ≤ 0.70 (n≥30).
2. **E2b soft gates PASS** — frozen closing-line archive wired; market/engine Brier &lt; coin and \|mean(engine−market)\|≤0.15 on close-joined set (**not** a CLV PASS).
3. **Coach pick CLV reviewed** — 10k-sim selection-time report attached; human accept/reject (no automatic CLV PASS from soft gates or home-blanket studies).
4. **E4 PASS** — injury-known vs unknown segments: unknown must not show higher mean \|edge\| than known; `injuryKnown` null when unknown.
5. **E5 green** — `coachP0UnvalidatedTotals`, college mix proof, NFL/NHL totals P0 tests pass on that commit.
6. **E6** — named human approver + date + commit SHA recorded in the PR body (template in `ncaaf-e6-signoff-evidence.md`).
7. Totals (FG/team/period) remain on their separate P0 until totals recalibration — this flag only clears **game-side** NCAAF lines.
8. **E2E** — device/build returns valid, simulated NCAAF spread/ML picks (not early-exit empty notes alone).

## Commands

```bash
# Rebuild holdout report (keeps flag false; exits 2 while restore blocked)
cd artifacts/api-server
NCAAF_PHASE_E_SIMS=1500 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseEHoldoutCalibration.ts

# Coach pick CLV (10k sims; long-running; keeps flag false)
NCAAF_PHASE_E_SIMS=10000 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseECoachPickClv.ts

# E4 forward injury snapshot (does not finish E4 alone)
node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPregameInjurySnapshotCollector.ts

# Unit gates
node --import ./test/register-hooks.mjs --test \
  test/ncaafGameLineSimValidation.test.ts \
  test/ncaafPhaseEGates.test.ts
```
