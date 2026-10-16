# E2b Coach pick CLV — acceptance criteria (locked before remeasure)

**Status:** Criteria locked **2026-10-16** on branch `cursor/ncaaf-phase-e-restore-8b51`.  
**Engine:** `nfl-drive:ppg-per-drive-v1`.  
**Rule:** Do **not** pick a negative floor to pass a measured mean. Gate stays false.

## What CLV measures here

For a selected American moneyline price at selection time (~T−24h) vs the E2b close on the **same side**:

```
mlClvProbPoints = implied(closeOdds) − implied(selectionOdds)
```

Positive ⇒ selection got a better price than the close (beat the close).  
Negative ⇒ selection was worse than the close.

Spread CLV (points) is reported separately and is **not** sufficient for an E2b PASS.

## Locked acceptance criteria (all required for `E2b_coachPickClv=PASS`)

| # | Criterion | Threshold | Rationale |
|---|-----------|-----------|-----------|
| C1 | Sample | `nMlWithClv ≥ 50` | Stable mean; current run has 69 |
| C2 | Mean ML CLV | `meanClvProbPoints ≥ 0` | Economic: Coach selections must not lose to the close on average |
| C3 | Beat-close rate | `pctSelectionsBeatClose ≥ 0.45` | Not a rare-tail artifact; majority need not beat close but ≥45% must |
| C4 | Side mix | `homeSelections ≥ 20` and `awaySelections ≥ 20` | Not blanket-home |
| C5 | Soft gates | Close-archive soft gates still `PASS_SOFT_GATES_ONLY` or better on same engine | Soft gates ≠ CLV but remain necessary |
| C6 | Label | Only then set `E2b_coachPickClv=PASS` | Otherwise `COMPUTED_NO_PASS_LABEL` or `FAIL` |

**Explicitly rejected:** any tolerance of the form `meanClv ≥ −0.01` (or similar) chosen to clear a measured −0.0057.

## Evaluation of the current measurement (criteria locked first)

Source: `artifacts/api-server/test/fixtures/ncaaf-phase-e-coach-pick-clv-report.json` (2026-10-16, 10k sims).

| Metric | Value | vs criteria |
|--------|-------|-------------|
| nMlWithClv | 69 | C1 PASS |
| meanClvProbPoints | **−0.00568** | **C2 FAIL** |
| pctSelectionsBeatClose | **0.348** | **C3 FAIL** |
| home/away ML mix | 32 / 37 | C4 PASS (overall picks 112H/88A) |
| Soft gates | PASS_SOFT_GATES_ONLY | C5 PASS |
| Verdict | **FAIL** (not PASS; remain `COMPUTED_NO_PASS_LABEL` until a future run meets C1–C5) | |

### Investigation notes (why negative)

- Away ML picks: hit rate **0.62** but mean CLV **−0.007** — wins that still lose to the close (steam / late money).  
- Home ML picks: hit rate **0.31**, mean CLV **−0.004**.  
- High-edge (≥10%) selections are slightly worse on CLV than low-edge.  
- Home-blanket true-CLV baseline (T−24h→close, not Coach) was **−0.0019** (`ncaaf-phase-e-true-clv-report.json`); Coach pick mean is **worse** than that baseline.

Remediation belongs in selection timing / qualification / price source — **not** in loosening C2.

## Locked selection remediations (2026-10-16, before remeasure)

These change **how** picks are formed. They do **not** change C1–C6.

| # | Rule | Rationale (precommitted) |
|---|------|--------------------------|
| R1 | Fixture fallback (`ncaaf-phase-e-selection-prices.json`) may qualify **home ML only** — never invent vig-free away ML | Fixture provenance is home-only early lines; no-vig away invents a non-traded price and inflates edge vs real books |
| R2 | Away ML requires `odds-early-cache` two-sided extraction | Real away American odds only |
| R3 | `0 < edgePct ≤ 12` (same ceiling as `edgeLock` / arbitrage `MAX_VALUE_PCT`) | Uncapped edge ranked the most overconfident sims (prior 10%+ band hit 0.289); product already rejects >12% as unbelieved |
| R4 | Record `priceSource` on every pick (`odds-early-cache` \| `selection-prices-fixture`) | Provenance for CLV audit |

**Still rejected:** any change to C2 of the form `meanClv ≥ −0.01` (or similar) chosen to clear −0.0057.

## Remeasure protocol

1. Keep C1–C6 unchanged; apply R1–R4.  
2. Re-run `ncaafPhaseECoachPickClv.ts` at `NCAAF_PHASE_E_SIMS≥10000`.  
3. Prefer Odds early-snapshot cache when available; document fixture fallback if used (home ML only under R1).  
4. Publish new report; apply C1–C6; do not edit thresholds after seeing the number.
