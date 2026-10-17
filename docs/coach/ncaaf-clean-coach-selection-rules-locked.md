# Coach selection rules — LOCKED before early/close price inspection

**Status:** **LOCKED** 2026-10-17 · clean E1 α=1.15 research path  
**Rule:** Do **not** edit R1–R4 or C1–C6 after seeing early vs close price differences.  
**This document locks selection process before any price-delta examination.**

## Locked acceptance (C1–C6) — unchanged

| # | Criterion | Threshold |
|---|-----------|-----------|
| C1 | Sample | `nMlWithClv ≥ 50` |
| C2 | Mean ML CLV | `meanClvProbPoints ≥ 0` (no negative floor) |
| C3 | Beat-close rate | `pctSelectionsBeatClose ≥ 0.45` |
| C4 | Side mix | home ≥ 20 and away ≥ 20 |
| C5 | Soft gates | PASS_SOFT_GATES_ONLY or better on **same** stamp |
| C6 | Label | Only then `E2b_coachPickClv=PASS` |

## Locked selection remediations (R1–R4) — unchanged

| # | Rule |
|---|------|
| R1 | Fixture fallback may qualify **home ML only** — never invent vig-free away ML |
| R2 | Away ML requires `odds-early-cache` two-sided extraction |
| R3 | `0 < edgePct ≤ 12` |
| R4 | Record `priceSource` = `odds-early-cache` \| `selection-prices-fixture` |

## Clean E1 application notes (locked process, not new thresholds)

| Item | Decision |
|------|----------|
| Engine stamp | `ncaaf-score-margin-v1-research` + frozen α=1.15 |
| Early snap market | `h2h` only for ML CLV path |
| Early as-of | kickoff − 24h (UTC minute bucket) |
| Close reference | same-side close ML from close-only `h2h` archive (eval-only) |
| Forbidden before lock review | Computing mean early−close or CLV distributions to retune R1–R4/C2 |

## Explicitly rejected

- Weakening C2 after seeing negative meanClv  
- Inventing away ML from vig-free invert  
- Using TUNING M3 to claim CLV PASS  

**Source of lock:** [`ncaaf-e2b-clv-acceptance-criteria.md`](./ncaaf-e2b-clv-acceptance-criteria.md) · applied to clean E1 without threshold edits.
