# MLB F.5 acceptance — F5 family + FG ML rework

Shadow-only. `SIM_V2_SERVE=off`. **Still NOT production allowlist.**
Frozen chronological holdout (`MLB_AB_HOLDOUT_GAMES.json`). VAL for levers only; holdout applied once.
Thresholds: minOos=500, maxEce=0.04.

## Setup

- Games cache: 3939; chrono 55/20/25 → train 2166 / val 788 / holdout 985
- Frozen holdout graded: 560; VAL diagnostic: 560
- Prior default: **v0.3.1** ({"shrink":0.2,"sigma":0.22,"hfa":0.07,"strengthPreserve":0,"formResidual":0})
- Candidate: **v0.3.2** ({"shrink":0.1,"sigma":0.24,"hfa":0.08,"strengthPreserve":0.45,"formResidual":0.3})
- Resulting default after holdout gate: **v0.3.1** (promote=false)
- Settlement integrity: F5⊆FG conserved on every draw; unit test `test/baseballJoint.test.ts` asserts `assertBaseballF5Conserved` at `SIM_V2_DEEP_DRAWS=10000` (10k draws) for all profiles including v0.3.2
- SP / batting-order participation: **fail-closed** (unchanged)

## F5 family — frozen holdout (default profile)

| Family | Profile | n | games | effN | Brier | LogLoss | ECE | ECE_SE | Verdict |
|--------|---------|---|-------|------|-------|---------|-----|--------|---------|
| f5 | v0.3.1 | 1680 | 560 | 560.0 | 0.2531 | 0.7004 | 0.0486 | 0.0098 | **FAIL** |

- p95 runtime / game (team markets, 2k draws): **1.5 ms**
- Acceptance vs minOos=500 maxEce=0.04: **FAIL / NEAR-GATE**
- Reasons: ece_0.0486_gt_0.04
- Note: still **NOT** production allowlist / serve

### F5 slices (default profile)

| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| f5_total_4.5 | 560 | 0.2582 | 0.7101 | 0.0837 |
| f5_ml_home | 560 | 0.2530 | 0.7001 | 0.0552 |
| alt_f5_total_5.5 | 560 | 0.2481 | 0.6908 | 0.0851 |

## VAL diagnostics (not holdout-tuned)

| Family | Profile | n | ECE | Brier | LogLoss | sep | mad½ | AUC |
|--------|---------|---|-----|-------|---------|-----|-------|-----|
| ml | v0.3.1 | 560 | 0.0993 | 0.2532 | 0.7007 | 0.0277 | 0.0904 | 0.5823 |
| ml | v0.3.2 | 560 | 0.0974 | 0.2530 | 0.7010 | 0.0338 | 0.1002 | 0.5859 |
| team_total | v0.3.1 | 560 | 0.0607 | 0.2435 | 0.6801 | 0.0127 | 0.0887 | 0.5364 |
| team_total | v0.3.2 | 560 | 0.0643 | 0.2445 | 0.6822 | 0.0148 | 0.0994 | 0.5342 |
| f5 | v0.3.1 | 1680 | 0.0464 | 0.2469 | 0.6875 | 0.0113 | 0.0980 | 0.5372 |
| f5 | v0.3.2 | 1680 | 0.0572 | 0.2476 | 0.6896 | 0.0122 | 0.1035 | 0.5369 |

- VAL ML sep Δ (v0.3.2−v0.3.1): 0.0061
- VAL ML mad½ Δ: 0.0098
- VAL TT sep Δ: 0.0021

## Holdout once — FG ML / team_total promotion

| Family | v0.3.1 ECE | v0.3.2 ECE | ΔECE | v0.3.1 Brier | v0.3.2 Brier | v0.3.1 LL | v0.3.2 LL | mad½ 0.3.1→0.3.2 | sep 0.3.1→0.3.2 | shrink50? |
|--------|------------|------------|------|--------------|--------------|-----------|-----------|------------------|-----------------|-----------|
| ml | 0.1074 | 0.1163 | 0.0089 | 0.2577 | 0.2595 | 0.7094 | 0.7133 | 0.0859→0.0941 | 0.0183→0.0188 | ok |
| team_total | 0.0914 | 0.1033 | 0.0120 | 0.2568 | 0.2600 | 0.7073 | 0.7142 | 0.0789→0.0883 | -0.0020→-0.0038 | ok |
| f5 | 0.0486 | 0.0514 | 0.0028 | 0.2531 | 0.2544 | 0.7004 | 0.7032 | 0.0918→0.0956 | 0.0105→0.0105 | n/a |

### Promotion criteria (holdout ML)

- ECE improved vs v0.3.1: **false**
- shrink-to-50 FLAG: **false** (ok: ΔECE=0.0089, meanAbsDevFromHalf 0.0859→0.0941 (Δ=0.0082, -9.5% drop))
- Brier non-regression: **false**
- LogLoss non-regression: **false**
- **Promote default → v0.3.2: false**
- FG ML decision: **MODIFY**

## Full family table (holdout, both profiles)

| Family | Profile | n | games | effN | Brier | LogLoss | ECE | ECE_SE | sep | mad½ | Verdict |
|--------|---------|---|-------|------|-------|---------|-----|--------|-----|-------|---------|
| ml | v0.3.1 | 560 | 560 | 560.0 | 0.2577 | 0.7094 | 0.1074 | 0.0213 | 0.0183 | 0.0859 | **FAIL** |
| ml | v0.3.2 | 560 | 560 | 560.0 | 0.2595 | 0.7133 | 0.1163 | 0.0215 | 0.0188 | 0.0941 | **FAIL** |
| spread | v0.3.1 | 1120 | 560 | 560.0 | 0.2162 | 0.6251 | 0.0496 | 0.0148 | 0.0305 | 0.2258 | **FAIL** |
| spread | v0.3.2 | 1120 | 560 | 560.0 | 0.2175 | 0.6289 | 0.0525 | 0.0130 | 0.0301 | 0.2217 | **FAIL** |
| total | v0.3.1 | 1120 | 560 | 560.0 | 0.2428 | 0.6807 | 0.0540 | 0.0118 | 0.0436 | 0.1326 | **FAIL** |
| total | v0.3.2 | 1120 | 560 | 560.0 | 0.2439 | 0.6835 | 0.0602 | 0.0126 | 0.0446 | 0.1357 | **FAIL** |
| team_total | v0.3.1 | 560 | 560 | 560.0 | 0.2568 | 0.7073 | 0.0914 | 0.0178 | -0.0020 | 0.0789 | **FAIL** |
| team_total | v0.3.2 | 560 | 560 | 560.0 | 0.2600 | 0.7142 | 0.1033 | 0.0174 | -0.0038 | 0.0883 | **FAIL** |
| f5 | v0.3.1 | 1680 | 560 | 560.0 | 0.2531 | 0.7004 | 0.0486 | 0.0098 | 0.0105 | 0.0918 | **FAIL** |
| f5 | v0.3.2 | 1680 | 560 | 560.0 | 0.2544 | 0.7032 | 0.0514 | 0.0104 | 0.0105 | 0.0956 | **FAIL** |
| main_all | v0.3.1 | 3360 | 560 | 560.0 | 0.2513 | 0.6963 | 0.0670 | 0.0105 | 0.0216 | 0.0956 | **FAIL** |
| main_all | v0.3.2 | 3360 | 560 | 560.0 | 0.2529 | 0.6998 | 0.0721 | 0.0103 | 0.0218 | 0.1013 | **FAIL** |
| alt_all | v0.3.1 | 1680 | 560 | 560.0 | 0.2279 | 0.6504 | 0.0576 | 0.0118 | 0.0185 | 0.1945 | **FAIL** |
| alt_all | v0.3.2 | 1680 | 560 | 560.0 | 0.2293 | 0.6543 | 0.0609 | 0.0103 | 0.0179 | 0.1921 | **FAIL** |

## Named props — separate gates (even if FAIL)

- Boxscore attempted=120 ok=120 fail=0; aggregate named n=5040

| Gate | n | games | effN | Brier | LogLoss | ECE | ECE_SE | Verdict | reasons |
|------|---|-------|------|-------|---------|-----|--------|---------|---------|
| player_prop_named | 5040 | 120 | 120.0 | 0.1573 | 0.4801 | 0.0416 | 0.0054 | **FAIL** | ece_0.0416_gt_0.04 |
| prop_hits | 1200 | 120 | 120.0 | 0.2337 | 0.6603 | 0.0052 | 0.0092 | **PASS** | — |
| prop_hr | 1200 | 120 | 120.0 | 0.1372 | 0.4860 | 0.0965 | 0.0120 | **FAIL** | ece_0.0965_gt_0.04 |
| prop_k | 240 | 120 | 120.0 | 0.3242 | 0.8495 | 0.2993 | 0.0302 | **INSUFFICIENT_DATA** | oos_sample_240_lt_500; ece_0.2993_gt_0.04 |
| prop_rbi | 1200 | 120 | 120.0 | 0.2204 | 0.6331 | 0.0779 | 0.0159 | **FAIL** | ece_0.0779_gt_0.04 |
| prop_sb | 1200 | 120 | 120.0 | 0.0042 | 0.0671 | 0.0649 | 0.0002 | **FAIL** | ece_0.0649_gt_0.04 |

## Isolation / blockers

- Shadow-only; production allowlists empty; Coach / P0 / OTA untouched
- SP + batting-order fail-closed preserved
- Closing-line archive still unavailable (INSUFFICIENT)
- FG ML: **MODIFY** — keep default v0.3.1; v0.3.2 retained as A/B profile
- F5 family: not full PASS (ECE=0.0486, verdict=FAIL) — evidence package recorded; not allowlisted
