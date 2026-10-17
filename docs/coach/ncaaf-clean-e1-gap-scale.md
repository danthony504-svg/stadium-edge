# E1 gap-scale results (research-only)

**Stamp:** `ncaaf-score-margin-v1-research`  
**Generated:** 2026-10-17T11:58:52.168Z  
**Protocol (frozen pre-scores):** `ncaaf-clean-e1-eval-protocol.md`  
**α grid:** {1.15, 1.25} — **no expansion**  
**E1 status:** **PASS_RESEARCH_CANDIDATE** — Further research only on α=1.15 (both {1.15,1.25} PASS_RESEARCH; preference → 1.15). Does not replace M3/S2, injury validation, or final review. FINAL_EVAL not advanced. A0 remains frozen baseline until a later research lock.
**Ops:** FINAL_EVAL untouched · NCAAF blocked · injury OPEN · freeze · voice paused · no spend/deploy/OTA

## Adoption scope

PASS_RESEARCH = further research permission only. **Does not** replace locked M3/S2, injury validation, or final review.

## Location metric definitions

| ID | Definition |
|----|------------|
| **L_W1** | Week-1 `meanResidual`; improve iff `meanRes_A0 − meanRes_α ≥ 1 SE_paired` |
| **L_LG** | Large (`abs(closeSpreadHome)>14`) `meanCompressionVsLine = mean(|spread| − |marginMean|)`; improve iff `comp_A0 − comp_α ≥ 1 SE_paired` |

## Absolute metrics (identical-334)

### A0 (α=1)

| Slice | nML / nATS | mean resid ± SE | compression ± SE | ML Δ vs mkt | ATS Brier | M3* | S2* |
|-------|------------|----------------:|-----------------:|------------:|----------:|:---:|:---:|
| overall | 334 / 326 (push 8) | 2.935±0.91 | 2.974±0.34 | 0.0210 | 0.2604 | false | false |
| week1 | 47 / 47 (push 0) | 3.988±2.62 | 6.318±1.10 | 0.0723 | 0.2432 | false | true |
| large_gt14 | 94 / 94 (push 0) | 7.077±1.65 | 8.880±0.64 | 0.0484 | 0.2672 | false | false |

### E1 α=1.15

| Slice | nML / nATS | mean resid ± SE | compression ± SE | ML Δ vs mkt | ATS Brier | M3* | S2* |
|-------|------------|----------------:|-----------------:|------------:|----------:|:---:|:---:|
| overall | 334 / 326 (push 8) | 2.892±0.91 | 1.923±0.35 | 0.0188 | 0.2603 | true | false |
| week1 | 47 / 47 (push 0) | 3.663±2.60 | 5.595±1.09 | 0.0697 | 0.2433 | false | true |
| large_gt14 | 94 / 94 (push 0) | 6.371±1.63 | 7.200±0.70 | 0.0412 | 0.2633 | false | false |

### E1 α=1.25

| Slice | nML / nATS | mean resid ± SE | compression ± SE | ML Δ vs mkt | ATS Brier | M3* | S2* |
|-------|------------|----------------:|-----------------:|------------:|----------:|:---:|:---:|
| overall | 334 / 326 (push 8) | 2.864±0.92 | 1.215±0.36 | 0.0178 | 0.2609 | true | false |
| week1 | 47 / 47 (push 0) | 3.447±2.60 | 5.104±1.09 | 0.0682 | 0.2435 | false | true |
| large_gt14 | 94 / 94 (push 0) | 5.900±1.62 | 6.080±0.75 | 0.0372 | 0.2619 | false | false |

\*M3/S2 descriptive only — not E1 adoption and not locked acceptance.

## Paired adoption clauses vs A0

### E1_a115 — PASS_RESEARCH = **true**

Failed clauses: (none)

| Clause | Result | Δ ± SE_paired | Detail |
|--------|--------|---------------|--------|
| L_W1 | **PASS** | 0.3242 ± 0.1402 | meanRes 3.988 → 3.663 |
| L_LG | **PASS** | 1.6800 ± 0.0987 | comp 8.880 → 7.200 |
| M_ALL | **PASS** | -0.0021 ± 0.0009 | Δmkt 0.0210 → 0.0188 (Δworse=α−A0) |
| S_ALL | **PASS** | -0.0001 ± 0.0015 | ATS 0.2604 → 0.2603 |

### E1_a125 — PASS_RESEARCH = **true**

Failed clauses: (none)

| Clause | Result | Δ ± SE_paired | Detail |
|--------|--------|---------------|--------|
| L_W1 | **PASS** | 0.5403 ± 0.2337 | meanRes 3.988 → 3.447 |
| L_LG | **PASS** | 2.8000 ± 0.1645 | comp 8.880 → 6.080 |
| M_ALL | **PASS** | -0.0032 ± 0.0014 | Δmkt 0.0210 → 0.0178 (Δworse=α−A0) |
| S_ALL | **PASS** | 0.0005 ± 0.0024 | ATS 0.2604 → 0.2609 |

## Time-ordered week folds (absolute)

| Variant | Week | nML | mean resid | ML Δ | ATS Brier |
|---------|-----:|----:|-----------:|-----:|----------:|
| A0 | W1 | 47 | 3.988 | 0.0723 | 0.2432 |
| A0 | W2 | 41 | 3.072 | 0.0301 | 0.2693 |
| A0 | W3 | 45 | 5.098 | 0.0121 | 0.2772 |
| A0 | W4 | 46 | 0.619 | -0.0139 | 0.2527 |
| A0 | W5 | 50 | 0.610 | 0.0182 | 0.2539 |
| A0 | W6 | 49 | 4.593 | 0.0251 | 0.2767 |
| A0 | W7 | 56 | 2.741 | 0.0060 | 0.2526 |
| α=1.15 | W1 | 47 | 3.663 | 0.0697 | 0.2433 |
| α=1.15 | W2 | 41 | 2.700 | 0.0261 | 0.2674 |
| α=1.15 | W3 | 45 | 5.371 | 0.0104 | 0.2803 |
| α=1.15 | W4 | 46 | 0.323 | -0.0157 | 0.2497 |
| α=1.15 | W5 | 50 | 0.897 | 0.0140 | 0.2541 |
| α=1.15 | W6 | 49 | 4.573 | 0.0249 | 0.2769 |
| α=1.15 | W7 | 56 | 2.816 | 0.0050 | 0.2530 |
| α=1.25 | W1 | 47 | 3.447 | 0.0682 | 0.2435 |
| α=1.25 | W2 | 41 | 2.453 | 0.0237 | 0.2662 |
| α=1.25 | W3 | 45 | 5.553 | 0.0098 | 0.2830 |
| α=1.25 | W4 | 46 | 0.127 | -0.0165 | 0.2484 |
| α=1.25 | W5 | 50 | 1.088 | 0.0119 | 0.2551 |
| α=1.25 | W6 | 49 | 4.560 | 0.0251 | 0.2780 |
| α=1.25 | W7 | 56 | 2.866 | 0.0049 | 0.2542 |


## Preference among PASS_RESEARCH

Both α=1.15 and α=1.25 met all four clauses. Per frozen protocol: prefer smaller overall ML/ATS regression → **α=1.15** for further research only.

| α | ML Δworse (α−A0) | ATS Δworse (α−A0) | regressionScore |
|--:|-----------------:|------------------:|----------------:|
| 1.15 | -0.002150 | -0.000099 | 0.000000 |
| 1.25 | -0.003152 | 0.000492 | 0.000492 |

**A0 remains the frozen baseline.** PASS_RESEARCH ≠ M3/S2 ≠ release. No further α sweep. No FINAL_EVAL.


## Descriptive M3/S2 failures (not E1 adoption)

| Variant | Slice | M3* | S2* | ML Δ | ATS |
|---------|-------|:---:|:---:|-----:|----:|
| A0 | overall | False | False | 0.0210 | 0.2604 |
| A0 | week1 | False | True | 0.0723 | 0.2432 |
| A0 | large_gt14 | False | False | 0.0484 | 0.2672 |
| A0 | W1 | False | True | 0.0723 | 0.2432 |
| A0 | W2 | False | False | 0.0301 | 0.2693 |
| A0 | W3 | True | False | 0.0121 | 0.2772 |
| A0 | W4 | True | False | -0.0139 | 0.2527 |
| A0 | W5 | True | False | 0.0182 | 0.2539 |
| A0 | W6 | False | False | 0.0251 | 0.2767 |
| A0 | W7 | True | False | 0.0060 | 0.2526 |
| α=1.15 | overall | True | False | 0.0188 | 0.2603 |
| α=1.15 | week1 | False | True | 0.0697 | 0.2433 |
| α=1.15 | large_gt14 | False | False | 0.0412 | 0.2633 |
| α=1.15 | W1 | False | True | 0.0697 | 0.2433 |
| α=1.15 | W2 | False | False | 0.0261 | 0.2674 |
| α=1.15 | W3 | True | False | 0.0104 | 0.2803 |
| α=1.15 | W5 | True | False | 0.0140 | 0.2541 |
| α=1.15 | W6 | False | False | 0.0249 | 0.2769 |
| α=1.15 | W7 | True | False | 0.0050 | 0.2530 |
| α=1.25 | overall | True | False | 0.0178 | 0.2609 |
| α=1.25 | week1 | False | True | 0.0682 | 0.2435 |
| α=1.25 | large_gt14 | False | False | 0.0372 | 0.2619 |
| α=1.25 | W1 | False | True | 0.0682 | 0.2435 |
| α=1.25 | W2 | False | False | 0.0237 | 0.2662 |
| α=1.25 | W3 | True | False | 0.0098 | 0.2830 |
| α=1.25 | W5 | True | False | 0.0119 | 0.2551 |
| α=1.25 | W6 | False | False | 0.0251 | 0.2780 |
| α=1.25 | W7 | True | False | 0.0049 | 0.2542 |

\*Descriptive only — locked M3/S2 unchanged; E1 PASS_RESEARCH is separate.

## Decision

**PASS_RESEARCH_CANDIDATE** — Further research only on α=1.15 (both {1.15,1.25} PASS_RESEARCH; preference → 1.15). Does not replace M3/S2, injury validation, or final review. FINAL_EVAL not advanced. A0 remains frozen baseline until a later research lock.

Baseline remains **A0_full** for production-research freeze. No σ/HFA/LR change. No further α sweep.

Fixture: `artifacts/api-server/test/fixtures/ncaaf-clean-e1-gap-scale.json`
