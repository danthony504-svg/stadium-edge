# NCAAF restoration candidate — evidence pack

**Branch:** `cursor/ncaaf-phase-e-restore-8b51`  
**Engine:** `nfl-drive:ppg-per-drive-v1.1` (candidate; live Render still `e607f131` / `ppg-per-drive-v1`)  
**Product gate:** `NCAAF_GAME_LINE_SIM_VALIDATED = false` — **do not flip**  
**Ops:** No publish/deploy; voice paused; production OTA freeze armed.

## Verdict: restore readiness **NO** (no market enabled)

Per-market readiness is **independent**. Passing ML calibration does **not** enable spreads, totals, or ALTs.

| Market | Untouched holdout (kickoff ≥ 2024-10-15) | vs coin | vs market | Restore? |
|--------|------------------------------------------|---------|-----------|----------|
| **Moneyline** | n=411; Brier **0.210** | **beats** | **loses** to close-ML (0.189) | **NO** — CLV criteria FAIL; E4/E6 OPEN |
| **Spreads** | n=384; Brier **0.264** | **fails** | N/A (no spread juice) | **NO** — discrimination weak; settlement CLEARED |
| **Totals** | over@proj Brier 0.250 beats coin; MAE ≈13 | engine-only | **no close totals** | **NO** — missing archive |
| **ALTs** | synthetic lines measured | mixed | **no posted ALT prices** | **NO** — missing archive |

## 1) Spread settlement + calibration

Source: `ncaaf-phase-e-spread-settlement-audit.json`, `ncaaf-phase-e-spread-margin-diag.json`

| Check | Result |
|-------|--------|
| Engine vs archive home-line sign | **CLEARED** |
| Probability extraction inverted (1−p) | **CLEARED** |
| Pushes | Excluded (`adj==0`); unit-tested vs `coverQueryHits` |
| Form timing | `walkHoldoutGames` pre-kickoff only |
| Pre-cutoff underdispersion (pre-v1.1) | residual/sim SD ≈ **1.50**; home-margin bias ≈ **+2.2** |
| v1.1 locks (pre-cutoff only; untouched unused) | `FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD=14.5`, `FOOTBALL_NCAAF_HOME_MARGIN_SHRINK=2.0` |
| Post-v1.1 pre-cutoff diag | residual ratio ≈ **1.01**; mean bias ≈ **+0.13** |
| Untouched ATS vs coin | Brier **0.264 ≥ 0.25** → **OPEN_MODEL** (bias fixed; **corr(p,y)≈0.05** — weak discrimination) |
| Uncertainty | No closing spread juice ⇒ market ATS baseline unavailable; coin only |

**No settlement code defect.** Thresholds not lowered. Residual fix improved bias/dispersion; ATS still fails coin on discrimination.

## 2) Coach ML CLV

Criteria locked in [`ncaaf-e2b-clv-acceptance-criteria.md`](./ncaaf-e2b-clv-acceptance-criteria.md) **before** scoring (C2 `meanClv≥0` — no negative floor).

Selection remediations **R1–R4** locked before remeasure:
- R1 fixture = home ML only (no vig-free away invent)
- R2 away ML requires `odds-early-cache`
- R3 `0 < edgePct ≤ 12`
- R4 record `priceSource`

| Metric | Prior (v1 uncapped) | Remeasure (v1.1 + R1–R4) |
|--------|---------------------|---------------------------|
| nMlWithClv | 69 | **15** (C1 FAIL) |
| meanClvProbPoints | −0.00568 | **−0.00404** (C2 FAIL) |
| pctBeatClose | 0.348 | **0.40** (C3 FAIL) |
| earlyCachePicks | 0 | **0** (cache empty; `ODDS_API_KEY` unset) |

Verdict: **FAIL_LOCKED_CRITERIA** / `COMPUTED_NO_PASS_LABEL`. Under R1–R3 with fixture-only prices, C1 is unreachable until two-sided early snaps exist — **not** a reason to loosen C2.

## 3) Historical data search

See [`ncaaf-historical-data-availability.md`](./ncaaf-historical-data-availability.md).

| Data | Status |
|------|--------|
| Close ML + spread | Vendored (Odds historical `h2h,spreads`) |
| Close totals | **Absent** — builder never requested `totals`; sample odds fixtures on odds-api branch are h2h/spreads extracts only |
| Posted ALT prices | **Absent** — never requested `alternate_spreads` |
| Pre-kickoff injury 2024 | **Absent** — archive columns all null; ESPN live is current-only |
| Forward injury snapshot | 2026-10-16 ESPN freeze — **must not** join into 2024 fixtures |

## 4) What remains (before any human sign-off request)

1. Spread **discrimination** (ATS Brier &lt; coin) beyond residual/bias fix — or keep spreads disabled.  
2. Two-sided Odds early snapshots (`ODDS_API_KEY`) so Coach CLV can meet C1 under R1–R4, then meanClv ≥ 0.  
3. Closing archive refill with `totals` + `alternate_spreads`.  
4. Timestamped injury archive joinable to holdout (`captureTimestamp < kickoff`).  
5. Then E6 named sign-off on a **flag-only** PR — **not requested yet**.

## Fixtures / scripts

- `scripts/ncaafPhaseESpreadSettlementAudit.ts`
- `scripts/ncaafPhaseESpreadMarginDiag.ts` (pre-cutoff only)
- `scripts/ncaafPhaseEMarketFamilies.ts` (untouched + coin/market)
- `scripts/ncaafPhaseECoachPickClv.ts` (R1–R4 + locked C1–C6)
- `scripts/ncaafPregameInjurySnapshotCollector.ts`
- `scripts/ncaafPhaseE2bClosingLines.py` (`NCAAF_E2B_MARKETS` for totals/alts when keyed)
