# MLB A/B holdout: baseball.joint v0.2.0 vs v0.3.0

Shadow-only independent OOS. Identical chronological holdout games/markets/odds (−110 grid).
`SIM_V2_SERVE` off. No allowlist / Coach / P0 changes.

## Setup

- Games fetched: 3939 (2023=1980, 2024=1959)
- Chrono split 55/20/25 → train 2166 / val 788 / holdout 985
- **Frozen holdout graded:** 560 games (ids in `MLB_AB_HOLDOUT_GAMES.json`)
- Graded with form: v0.2 used=560, v0.3 used=560
- Profiles: **v0.2** = no shrink, no lognormal shock, HFA 0.1, version 0.2.0; **v0.3** = shrink 0.4 / σ0.18 / HFA 0.05 / version 0.3.0
- Thresholds (unchanged): minOos=500, maxEce=0.04
- Closing-line benchmark: **INSUFFICIENT_DATA** (no licensed archive)
- Named props: ESPN athlete id required; attempted 120, ok 120, fetch_fail 0, rejected_no_id 0
- p95 runtime proxy (team markets/game): v0.2=1.2 ms, v0.3=1.6 ms

## Before/after by family (v0.2 → v0.3)

| Family | n | games | ECE v0.2 | ECE v0.3 | ΔECE | Brier v0.2 | Brier v0.3 | ΔBrier | LogLoss v0.2 | LogLoss v0.3 | ΔLogLoss | meanAbsDev½ v0.2 | meanAbsDev½ v0.3 | Verdict v0.2 | Verdict v0.3 |
|--------|---|-------|----------|----------|------|------------|------------|--------|--------------|--------------|----------|------------------|------------------|--------------|--------------|
| ml | 560 | 560 | 0.1278 | 0.1110 | -0.0168 | 0.2614 | 0.2582 | -0.0032 | 0.7180 | 0.7100 | -0.0080 | 0.1089 | 0.0760 | **FAIL** | **FAIL** |
| spread | 1120 | 560 | 0.0654 | 0.0569 | -0.0085 | 0.2189 | 0.2167 | -0.0022 | 0.6344 | 0.6256 | -0.0089 | 0.2365 | 0.2328 | **FAIL** | **FAIL** |
| total | 1120 | 560 | 0.0711 | 0.0507 | -0.0204 | 0.2470 | 0.2420 | -0.0050 | 0.6917 | 0.6783 | -0.0133 | 0.1497 | 0.1297 | **FAIL** | **FAIL** |
| team_total | 560 | 560 | 0.1139 | 0.0508 | -0.0631 | 0.2631 | 0.2526 | -0.0104 | 0.7213 | 0.6986 | -0.0227 | 0.0979 | 0.0651 | **FAIL** | **FAIL** |
| f5 | 1680 | 560 | 0.0680 | 0.0397 | -0.0283 | 0.2562 | 0.2507 | -0.0055 | 0.7073 | 0.6950 | -0.0123 | 0.1025 | 0.0891 | **FAIL** | **PASS** |
| main_all | 3360 | 560 | 0.0880 | 0.0576 | -0.0304 | 0.2551 | 0.2499 | -0.0052 | 0.7051 | 0.6932 | -0.0119 | 0.1139 | 0.0886 | **FAIL** | **FAIL** |
| alt_all | 1680 | 560 | 0.0699 | 0.0605 | -0.0094 | 0.2314 | 0.2269 | -0.0045 | 0.6610 | 0.6475 | -0.0134 | 0.2011 | 0.2006 | **FAIL** | **FAIL** |
| player_prop_named | 2880 | 120 | 0.0918 | 0.0917 | -0.0001 | 0.2092 | 0.2094 | +0.0002 | 0.6229 | 0.6237 | +0.0008 | 0.2804 | 0.2806 | **FAIL** | **FAIL** |

## Extended metrics (per family × profile)

| Profile | Family | n | games | effN | meanP | meanY | meanAbsDev½ | oc80 n/hit | oc90 n/hit | oc95 n/hit | p95 ms | ECE_SE |
|---------|--------|---|-------|------|-------|-------|-------------|------------|------------|------------|--------|--------|
| v0.2 | ml | 560 | 560 | 560.0 | 0.4404 | 0.5482 | 0.1089 | 0/n/a | 0/n/a | 0/n/a | 1.2 | 0.0194 |
| v0.2 | spread | 1120 | 560 | 560.0 | 0.2651 | 0.3241 | 0.2365 | 0/n/a | 0/n/a | 0/n/a | 1.2 | 0.0163 |
| v0.2 | total | 1120 | 560 | 560.0 | 0.4261 | 0.4304 | 0.1497 | 2/0.500 | 0/n/a | 0/n/a | 1.2 | 0.0117 |
| v0.2 | team_total | 560 | 560 | 560.0 | 0.4726 | 0.4571 | 0.0979 | 0/n/a | 0/n/a | 0/n/a | 1.2 | 0.0182 |
| v0.2 | f5 | 1680 | 560 | 560.0 | 0.4547 | 0.4625 | 0.1025 | 0/n/a | 0/n/a | 0/n/a | 1.2 | 0.0104 |
| v0.2 | main_all | 3360 | 560 | 560.0 | 0.4585 | 0.4786 | 0.1139 | 2/0.500 | 0/n/a | 0/n/a | 1.2 | 0.0127 |
| v0.2 | alt_all | 1680 | 560 | 560.0 | 0.3028 | 0.3435 | 0.2011 | 0/n/a | 0/n/a | 0/n/a | 1.2 | 0.0106 |
| v0.2 | player_prop_named | 2880 | 120 | 120.0 | 0.4089 | 0.3979 | 0.2804 | 54/0.444 | 0/n/a | 0/n/a | 1.2 | 0.0074 |
| v0.3 | ml | 560 | 560 | 560.0 | 0.4372 | 0.5482 | 0.0760 | 0/n/a | 0/n/a | 0/n/a | 1.6 | 0.0194 |
| v0.3 | spread | 1120 | 560 | 560.0 | 0.2672 | 0.3241 | 0.2328 | 0/n/a | 0/n/a | 0/n/a | 1.6 | 0.0194 |
| v0.3 | total | 1120 | 560 | 560.0 | 0.4157 | 0.4304 | 0.1297 | 0/n/a | 0/n/a | 0/n/a | 1.6 | 0.0103 |
| v0.3 | team_total | 560 | 560 | 560.0 | 0.4583 | 0.4571 | 0.0651 | 0/n/a | 0/n/a | 0/n/a | 1.6 | 0.0169 |
| v0.3 | f5 | 1680 | 560 | 560.0 | 0.4474 | 0.4625 | 0.0891 | 0/n/a | 0/n/a | 0/n/a | 1.6 | 0.0102 |
| v0.3 | main_all | 3360 | 560 | 560.0 | 0.4508 | 0.4786 | 0.0886 | 0/n/a | 0/n/a | 0/n/a | 1.6 | 0.0119 |
| v0.3 | alt_all | 1680 | 560 | 560.0 | 0.2995 | 0.3435 | 0.2006 | 0/n/a | 0/n/a | 0/n/a | 1.6 | 0.0124 |
| v0.3 | player_prop_named | 2880 | 120 | 120.0 | 0.4089 | 0.3979 | 0.2806 | 60/0.550 | 0/n/a | 0/n/a | 1.6 | 0.0074 |

## Shrink-to-50 diagnosis

ECE improvements that coincide with large drops in `meanAbsDevFromHalf` (|p−0.5|) are flagged as possible shrink-to-50 artifacts.

- **ml**: SHRINK_TO_50_SUSPECT: ΔECE=-0.0168 but meanAbsDevFromHalf 0.1089→0.0760 (drop 30.2%) — ECE gain may be from probs collapsing toward 0.5
- **spread**: ok: ΔECE=-0.0085, meanAbsDevFromHalf 0.2365→0.2328 (Δ=-0.0036, 1.5% drop)
- **total**: ok: ΔECE=-0.0204, meanAbsDevFromHalf 0.1497→0.1297 (Δ=-0.0200, 13.4% drop)
- **team_total**: SHRINK_TO_50_SUSPECT: ΔECE=-0.0631 but meanAbsDevFromHalf 0.0979→0.0651 (drop 33.5%) — ECE gain may be from probs collapsing toward 0.5
- **f5**: ok: ΔECE=-0.0283, meanAbsDevFromHalf 0.1025→0.0891 (Δ=-0.0134, 13.1% drop)
- **main_all**: ok: ΔECE=-0.0304, meanAbsDevFromHalf 0.1139→0.0886 (Δ=-0.0253, 22.2% drop)
- **alt_all**: ok: ΔECE=-0.0094, meanAbsDevFromHalf 0.2011→0.2006 (Δ=-0.0004, 0.2% drop)
- **player_prop_named**: ok: ΔECE=-0.0001, meanAbsDevFromHalf 0.2804→0.2806 (Δ=0.0002, -0.1% drop)

**Flagged families (2):** ml, team_total

## Scoring distribution (actual vs sim mean)

### v0.2
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| mlb_total_v0.2 | 560 | 9.03 | 9.06 | 0.03 | 18.64 | 0.82 | 0.04 | 14.0 | 10.2 |
| mlb_margin_v0.2 | 560 | 0.06 | 0.04 | -0.03 | 19.23 | 0.88 | 0.05 | 5.0 | 1.2 |
- Mean within-draw sim var (totals): 9.08; (margins): 9.09

### v0.3
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| mlb_total_v0.3 | 560 | 9.03 | 8.98 | -0.05 | 18.64 | 0.30 | 0.02 | 14.0 | 9.7 |
| mlb_margin_v0.3 | 560 | 0.06 | 0.01 | -0.06 | 19.23 | 0.32 | 0.02 | 5.0 | 0.7 |
- Mean within-draw sim var (totals): 10.33; (margins): 10.33

## Closing line

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| mlb:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |

## Gate tables by profile

### v0.2.0 (pre-correction)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| mlb:ml:v0.2 | **FAIL** | 560 | 560 | 560.0 | 0.2614 | 0.7180 | 0.1278 | 0.0194 | -0.108 | ece_0.1278_gt_0.04 |
| mlb:spread:v0.2 | **FAIL** | 1120 | 560 | 560.0 | 0.2189 | 0.6344 | 0.0654 | 0.0163 | -0.059 | ece_0.0654_gt_0.04 |
| mlb:total:v0.2 | **FAIL** | 1120 | 560 | 560.0 | 0.2470 | 0.6917 | 0.0711 | 0.0117 | -0.004 | ece_0.0711_gt_0.04 |
| mlb:team_total:v0.2 | **FAIL** | 560 | 560 | 560.0 | 0.2631 | 0.7213 | 0.1139 | 0.0182 | 0.015 | ece_0.1139_gt_0.04 |
| mlb:f5:v0.2 | **FAIL** | 1680 | 560 | 560.0 | 0.2562 | 0.7073 | 0.0680 | 0.0104 | -0.008 | ece_0.0680_gt_0.04 |
| mlb:main_all:v0.2 | **FAIL** | 3360 | 560 | 560.0 | 0.2551 | 0.7051 | 0.0880 | 0.0127 | -0.020 | ece_0.0880_gt_0.04 |
| mlb:alt_all:v0.2 | **FAIL** | 1680 | 560 | 560.0 | 0.2314 | 0.6610 | 0.0699 | 0.0106 | -0.041 | ece_0.0699_gt_0.04 |
| mlb:player_prop_named:v0.2 | **FAIL** | 2880 | 120 | 120.0 | 0.2092 | 0.6229 | 0.0918 | 0.0074 | 0.011 | ece_0.0918_gt_0.04 |

### v0.3.0 (corrected)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| mlb:ml:v0.3 | **FAIL** | 560 | 560 | 560.0 | 0.2582 | 0.7100 | 0.1110 | 0.0194 | -0.111 | ece_0.1110_gt_0.04 |
| mlb:spread:v0.3 | **FAIL** | 1120 | 560 | 560.0 | 0.2167 | 0.6256 | 0.0569 | 0.0194 | -0.057 | ece_0.0569_gt_0.04 |
| mlb:total:v0.3 | **FAIL** | 1120 | 560 | 560.0 | 0.2420 | 0.6783 | 0.0507 | 0.0103 | -0.015 | ece_0.0507_gt_0.04 |
| mlb:team_total:v0.3 | **FAIL** | 560 | 560 | 560.0 | 0.2526 | 0.6986 | 0.0508 | 0.0169 | 0.001 | ece_0.0508_gt_0.04 |
| mlb:f5:v0.3 | **PASS** | 1680 | 560 | 560.0 | 0.2507 | 0.6950 | 0.0397 | 0.0102 | -0.015 | — |
| mlb:main_all:v0.3 | **FAIL** | 3360 | 560 | 560.0 | 0.2499 | 0.6932 | 0.0576 | 0.0119 | -0.028 | ece_0.0576_gt_0.04 |
| mlb:alt_all:v0.3 | **FAIL** | 1680 | 560 | 560.0 | 0.2269 | 0.6475 | 0.0605 | 0.0124 | -0.044 | ece_0.0605_gt_0.04 |
| mlb:player_prop_named:v0.3 | **FAIL** | 2880 | 120 | 120.0 | 0.2094 | 0.6237 | 0.0917 | 0.0074 | 0.011 | ece_0.0917_gt_0.04 |

- F5⊆FG conserved in both profiles (unit-tested).
- Same seed → different tensors only via profile levers.
