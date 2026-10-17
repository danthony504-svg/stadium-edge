# Clean vs prior — identical IDs + ablations

**Stamp:** `ncaaf-score-margin-v1-research`  
**Generated:** 2026-10-17T11:45:26.585Z  
**Protocol predefined:** `ncaaf-clean-compare-ablation-protocol.md`  
**evaluableSupported ≠ production approval** (`productionReleaseApproved=false`)

## 14+ reconcile (94 vs 107)

| Item | Value |
|------|-------|
| Spread source | `closeSpreadHome` (TUNING Odds archive) |
| Prior identical-334 rule | **abs > 14** → n=**94** |
| Clean first screen rule | abs ≥ 14 → n=**107** |
| Exact abs==14 | **13** |
| Push handling | ATS pushes excluded; ML decisive only |

## Identical-334 compare (canonical large = abs>14)

### Clean A0 (venue sidecar)

| Slice | Metrics |
|-------|---------|
| All | nML=334 nATS=326 (pushEx=8) | ML 0.1976 Δ=0.0210 M3=false | ATS 0.2604 S2=false | resid 2.93±rmse 16.93 |
| Week 1 | nML=47 nATS=47 (pushEx=0) | ML 0.2093 Δ=0.0723 M3=false | ATS 0.2432 S2=true | resid 3.99±rmse 18.40 |
| Large abs>14 | nML=94 nATS=94 (pushEx=0) | ML 0.1225 Δ=0.0484 M3=false | ATS 0.2672 S2=false | resid 7.08±rmse 17.51 |
| Large abs≥14 (sensitivity) | nML=107 nATS=107 (pushEx=0) | ML 0.1389 Δ=0.0403 M3=false | ATS 0.2674 S2=false | resid 6.70±rmse 17.78 |

### Prior `locked_drive_teamMean`

| Slice | Metrics |
|-------|---------|
| All | nML=334 nATS=326 (pushEx=8) | ML 0.2267 Δ=0.0500 M3=false | ATS 0.2734 S2=false | resid -0.95±rmse 18.10 |
| Week 1 | nML=47 nATS=47 (pushEx=0) | ML 0.2326 Δ=0.0955 M3=false | ATS 0.2523 S2=false | resid 2.63±rmse 19.50 |
| Large abs>14 | nML=94 nATS=94 (pushEx=0) | ML 0.1688 Δ=0.0947 M3=false | ATS 0.2921 S2=false | resid 6.86±rmse 19.62 |

### Prior `ts_full` (archive)

| Slice | Metrics |
|-------|---------|
| All | nML=334 nATS=326 (pushEx=8) | ML 0.1955 Δ=0.0189 M3=true | ATS 0.2549 S2=false | resid 2.62±rmse 16.56 |
| Week 1 | nML=47 nATS=47 (pushEx=0) | ML 0.2082 Δ=0.0711 M3=false | ATS 0.2400 S2=true | resid 3.45±rmse 18.07 |
| Large abs>14 | nML=94 nATS=94 (pushEx=0) | ML 0.1270 Δ=0.0529 M3=false | ATS 0.2650 S2=false | resid 6.61±rmse 17.41 |

## Ablations (predefined — no retune)

| Ablation | All | Week1 | Large >14 |
|----------|-----|-------|-----------|
| A0_full | nML=334 nATS=326 (pushEx=8) | ML 0.1976 Δ=0.0210 M3=false | ATS 0.2604 S2=false | resid 2.93±rmse 16.93 | nML=47 nATS=47 (pushEx=0) | ML 0.2093 Δ=0.0723 M3=false | ATS 0.2432 S2=true | resid 3.99±rmse 18.40 | nML=94 nATS=94 (pushEx=0) | ML 0.1225 Δ=0.0484 M3=false | ATS 0.2672 S2=false | resid 7.08±rmse 17.51 |
| A1_no_hfa | nML=334 nATS=326 (pushEx=8) | ML 0.2048 Δ=0.0282 M3=false | ATS 0.2668 S2=false | resid 5.39±rmse 17.53 | nML=47 nATS=47 (pushEx=0) | ML 0.2194 Δ=0.0823 M3=false | ATS 0.2416 S2=true | resid 6.22±rmse 19.10 | nML=94 nATS=94 (pushEx=0) | ML 0.1336 Δ=0.0595 M3=false | ATS 0.2755 S2=false | resid 9.58±rmse 18.66 |
| A2_fixed_sigma | nML=334 nATS=326 (pushEx=8) | ML 0.1917 Δ=0.0151 M3=true | ATS 0.2686 S2=false | resid 2.93±rmse 16.93 | nML=47 nATS=47 (pushEx=0) | ML 0.1960 Δ=0.0589 M3=false | ATS 0.2576 S2=false | resid 3.99±rmse 18.40 | nML=94 nATS=94 (pushEx=0) | ML 0.1016 Δ=0.0274 M3=false | ATS 0.2826 S2=false | resid 7.08±rmse 17.51 |
| A3_no_prior_seed | nML=257 nATS=251 (pushEx=6) | ML 0.2203 Δ=0.0368 M3=false | ATS 0.2828 S2=false | resid 2.53±rmse 19.32 | nML=0 nATS=0 (pushEx=0) | ML undefined Δ=undefined M3=null | ATS undefined S2=null | resid undefined±rmse undefined | nML=65 nATS=65 (pushEx=0) | ML 0.1683 Δ=0.0888 M3=false | ATS 0.3415 S2=false | resid 6.43±rmse 21.80 |

## Time-ordered week folds (A0)

- **W1:** nML=47 nATS=47 (pushEx=0) | ML 0.2093 Δ=0.0723 M3=false | ATS 0.2432 S2=true | resid 3.99±rmse 18.40
- **W2:** nML=41 nATS=39 (pushEx=2) | ML 0.2007 Δ=0.0301 M3=false | ATS 0.2693 S2=false | resid 3.07±rmse 16.04
- **W3:** nML=45 nATS=44 (pushEx=1) | ML 0.1894 Δ=0.0121 M3=true | ATS 0.2772 S2=false | resid 5.10±rmse 19.24
- **W4:** nML=46 nATS=46 (pushEx=0) | ML 0.2099 Δ=-0.0139 M3=true | ATS 0.2527 S2=false | resid 0.62±rmse 17.07
- **W5:** nML=50 nATS=48 (pushEx=2) | ML 0.1833 Δ=0.0182 M3=true | ATS 0.2539 S2=false | resid 0.61±rmse 14.16
- **W6:** nML=49 nATS=49 (pushEx=0) | ML 0.1940 Δ=0.0251 M3=false | ATS 0.2767 S2=false | resid 4.59±rmse 14.78
- **W7:** nML=56 nATS=53 (pushEx=3) | ML 0.1980 Δ=0.0060 M3=true | ATS 0.2526 S2=false | resid 2.74±rmse 18.19

## Uncertainty note

Report **exact** `nMl` / `nAts` (and ATS push exclusions) with every Brier. Sample sizes on Week-1 (~47) and large (~94) are thin — treat slice M3/S2 flags as descriptive only, not acceptance.

FINAL_EVAL untouched · E4 open · no spend/deploy/OTA/unlock.
