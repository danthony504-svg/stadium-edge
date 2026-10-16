# NCAAF restoration candidate — evidence pack

**Branch:** `cursor/ncaaf-phase-e-restore-8b51`  
**Engine:** `nfl-drive:ppg-per-drive-v1` (Render `e607f131`)  
**Product gate:** `NCAAF_GAME_LINE_SIM_VALIDATED = false` — **do not flip**  
**Ops:** No publish/deploy; voice paused; production OTA freeze armed.

## Verdict: restore readiness **NO** (no market enabled)

Per-market readiness is **independent**. Passing ML calibration does **not** enable spreads, totals, or ALTs.

| Market | Untouched holdout (kickoff ≥ 2024-10-15) | vs coin | vs market | Restore? |
|--------|------------------------------------------|---------|-----------|----------|
| **Moneyline** | n=411; Brier **0.208** | **beats** | **loses** to close-ML (0.189) | **NO** — CLV criteria FAIL; E4/E6 OPEN |
| **Spreads** | n=384; Brier **0.284** | **fails** | N/A (no spread juice) | **NO** — model calibration; settlement audit CLEARED |
| **Totals** | over@proj Brier 0.248 beats coin; MAE ≈13 | engine-only | **no close totals** | **NO** — missing archive |
| **ALTs** | synthetic lines measured | mixed | **no posted ALT prices** | **NO** — missing archive |

## 1) Spread settlement audit (blocker investigation)

Source: `ncaaf-phase-e-spread-settlement-audit.json`

| Check | Result |
|-------|--------|
| Engine vs archive home-line sign | **CLEARED** (flipped settlement Brier worse) |
| Probability extraction inverted (1−p) | **CLEARED** on untouched |
| corr(p,y) | **+0.04** untouched (not anti-correlated) |
| Pushes | Excluded (`adj==0`); unit-tested vs `coverQueryHits` |
| Form timing | `walkHoldoutGames` pre-kickoff only (credible stamp / kickoff+4h) |
| Untouched ATS vs coin | Brier **0.284 ≥ 0.25** → **OPEN_MODEL** (not a sign bug) |
| Uncertainty | No closing spread prices ⇒ market ATS baseline unavailable; coin only |

Short-spread band (|line|≤3.5): meanP **0.61** vs meanY **0.48** — overconfident home covers; magnitude table in `/opt/cursor/artifacts/ncaaf-spread-brier-by-magnitude.json`.

**No settlement code defect confirmed.** Thresholds not lowered.

## 2) Coach ML CLV (negative mean)

Criteria locked in [`ncaaf-e2b-clv-acceptance-criteria.md`](./ncaaf-e2b-clv-acceptance-criteria.md) **before** scoring:

- C2: `meanClv ≥ 0` (no negative floor)
- C3: `pctBeatClose ≥ 0.45`

Measured (10k sims, 69 ML picks): mean **−0.00568**, pct beat close **0.348** → **FAIL_LOCKED_CRITERIA**.  
Away picks hit 62% but still lose CLV (steam). Home-blanket true-CLV baseline was −0.0019; Coach is worse.

## 3) Historical data search

See [`ncaaf-historical-data-availability.md`](./ncaaf-historical-data-availability.md).

| Data | Status |
|------|--------|
| Close ML + spread | Vendored (Odds historical `h2h,spreads`) |
| Close totals | **Absent** — builder never requested `totals`; `ODDS_API_KEY` unset here |
| Posted ALT prices | **Absent** — never requested `alternate_spreads` |
| Pre-kickoff injury 2024 | **Absent** — archive columns all null; ESPN live is current-only |
| Forward injury snapshot | Collected 2026-10-16 for future slates only — **must not** join into 2024 fixtures |

## 4) What remains (before any human sign-off request)

1. Spread **model** calibration so untouched ATS Brier &lt; coin (settlement already audited).  
2. Coach selection/CLV process that meets locked C1–C6 (mean CLV ≥ 0).  
3. `ODDS_API_KEY` refill of closes with `totals` + `alternate_spreads`.  
4. Timestamped injury archive joinable to holdout (`captureTimestamp < kickoff`).  
5. Then E6 named sign-off on a **flag-only** PR — **not requested yet**.

## Fixtures / scripts

- `scripts/ncaafPhaseESpreadSettlementAudit.ts`
- `scripts/ncaafPhaseEMarketFamilies.ts` (untouched + coin/market)
- `scripts/ncaafPhaseECoachPickClv.ts`
- `scripts/ncaafPregameInjurySnapshotCollector.ts`
- `scripts/ncaafPhaseE2bClosingLines.py` (`NCAAF_E2B_MARKETS` for totals/alts when keyed)
