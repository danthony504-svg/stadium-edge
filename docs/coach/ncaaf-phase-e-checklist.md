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
| Closing-line CLV (joined) | **PASS** — n=713; marketBrier **0.179**, engineBrier **0.219**, both &lt; coin; mean(engine−market)≈**+0.019** |
| Injury segments | **INSUFFICIENT_DATA** (null ≠ no-injury) |

### Home-win bias root cause (fixed in calibration)

Prior FAIL used **combined L10 only** (no home/away venue splits) → meanP ≈ 0.49 vs meanY ≈ 0.61 (home-win underprediction). Production sims already used venue blends; holdout now matches that path. Residual bias ≈ +0.02 (slight overprediction) — within threshold.

## Criterion board

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| E1 | Sensitivity ±3 ppg / QB-out ≥2pp | **PASS (unit)** | `ncaafGameLineSimValidation.test.ts` |
| E2a | Outcome calibration vs coin (Brier, ECE, dog pathology, bias) | **PASS** | Venue-aware holdout; \|bias\|≈0.020 ≤ 0.08 |
| E2b | Closing-line / market CLV | **PASS** | True pre-kickoff Odds closes + finals join; see below |
| E3 | Exact-line binder | **PASS (unit)** | `gameSimQualityGates.test.ts` |
| E4 | Injury conservatism | **INSUFFICIENT_DATA** | Needs SportsDataIO box-score injury archive — [`ncaaf-e4-injury-provider.md`](./ncaaf-e4-injury-provider.md) |
| E5 | Props / other-sport P0 regressions | **PASS (unit suite)** | Re-run before any flag flip |
| E6 | Human sign-off | **OPEN** | Required after E4 PASS |

**Restore readiness:** **NO** — E4 + E6 still open (`E2_readyForRestore=OPEN_NEEDS_E4_E6`). College game lines stay P0-blocked.

## E2b closing-line archive (2024 holdout)

Built by `scripts/ncaafPhaseE2bClosingLines.py` → `test/fixtures/ncaaf-phase-e-closing-lines.json`.

**Closing definition:** for each game, Odds API historical odds with `date=kickoff` (closest snapshot ≤ commence). Midday slate files (`ncaaf-historical-odds-2024-09-14*.json`) are **not** closes — e.g. 16z snap still has **58/69** events kicking off &gt;2h later.

| Join / QA | Count |
|-----------|------:|
| Holdout games (2024) | 871 |
| Kickoff buckets fetched | 327 |
| Matched with close prices | **778** |
| Full spread+ML + finals | **717** (calibration join with close ML on scored sims: **713**) |
| Missing | **93** (92 `no_odds_match` — mostly FCS/unlisted; 1 post-commence reject) |
| Pre-commence closes | **778/778** (median **262s** before commence; 757 within 10 min) |

Market-only (full-price rows): Brier **0.178** vs coin 0.25; home ATS cover excl. push **0.495** (n=703).

## E4 dependency (verified before requesting keys)

See [`ncaaf-e4-injury-provider.md`](./ncaaf-e4-injury-provider.md). **Do not request CFBD** — no injury family in CFBD data-availability. **SportsDataIO** documents historical injuries inside **CFB box scores** (`PlayerGame.InjuryStatus` from 2018) via Vault-enabled stats endpoints; live `InjuredPlayers` is current-only. Missing box-score injury rows stay `injuryKnown=null`.

### Durable Odds secret (separate from E2b work)

Exact server env name: **`ODDS_API_KEY`**. Entry steps: [`odds-api-key-cloud-agent.md`](./odds-api-key-cloud-agent.md). Historical entitlement already proven; inject via Cursor Secrets for new runs — do not paste into chat.

### Leakage audit (E2a venue/L10)

- Form arrays update **after** each game is scored (chrono season→week→kickoff).
- Unit proof: `test/ncaafPhaseEHoldoutLeakage.test.ts` — every contributing kickoff `<` evaluated game key.
- Untouched 2024 holdout (report): **865** scored games, kickoffs **2024-08-24 → 2024-12-08**, E2a **PASS**, bias ≈ +0.020, flag remains **false**.

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
NCAAF_PHASE_E_SIMS=1500 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseEHoldoutCalibration.ts

# Unit gates
node --import ./test/register-hooks.mjs --test \
  test/ncaafGameLineSimValidation.test.ts \
  test/ncaafPhaseEGates.test.ts
```
