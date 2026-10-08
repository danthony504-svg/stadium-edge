# Simulator V2 Phase B — Historical Validation Report

Generated: 2026-10-08T18:49:10.382Z

## Scope & constraints

- Walk-forward only: team form from games strictly before kickoff.
- V2 remains shadow-only; no Coach / P0 / OTA changes.
- Closing market lines unavailable from ESPN historical scoreboard → market baseline omitted; historical-frequency + coin baselines used.
- NFL and NCAAF evaluated separately.

## NFL

### Dataset provenance & coverage

| Field | Value |
|-------|-------|
| Source | `espn_site_api_scoreboard` |
| Fingerprint | `dfaa31f4085a1255` |
| Raw completed games | 854 |
| Eligible (min 4 prior/side) | 790 |
| Evaluated | 790 |
| Cold-start skipped | 64 |
| OT rate | 5.8% |
| Target ≥500 | YES |
| Form window | L4 pre-kickoff |
| Cache | `/workspace/artifacts/simulator-v2/eval/cache/nfl_6a4784085a8a.json` (fromCache=false) |

### Joint consistency

| Engine | Metric | Value |
|--------|--------|-------|
| V2 joint | games with zero period-sum violations | 100.00% |
| V1 frac | mean per-draw period-sum break rate | 99.98% |

### Full-game scoring accuracy (MAE total)

| Engine | Period | MAE total | RMSE total | MAE home | MAE away | n |
|--------|--------|-----------|------------|----------|----------|---|
| v2_joint | fg | 10.94 | 13.83 | 7.77 | 7.69 | 790 |
| v2_joint | q2 | 5.65 | 7.04 | 4.54 | 4.37 | 790 |
| v2_joint | h1 | 7.36 | 9.13 | 5.73 | 5.56 | 790 |
| v1_frac | fg | 10.89 | 13.81 | 7.79 | 7.64 | 790 |
| v1_frac | q2 | 6.04 | 7.58 | 4.74 | 4.09 | 790 |
| v1_frac | h1 | 7.11 | 8.96 | 5.65 | 5.29 | 790 |

### Probability calibration (all eval markets pooled)

| Engine | n | Brier | Log loss | ECE | bias (p̄−ȳ) |
|--------|---|-------|----------|-----|-------------|
| v2_joint | 19750 | 0.2303 | 0.6857 | 0.0982 | -0.0188 |
| v1_frac | 19750 | 0.2265 | 0.6912 | 0.0710 | -0.0029 |
| baseline_hist | 19750 | 0.2216 | 0.6571 | 0.0157 | -0.0131 |
| baseline_coin | 19750 | 0.2500 | 0.6931 | 0.0511 | 0.0511 |

### Extreme alternate spreads (|line| ≥ 14)

| Engine | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| v2 | 1580 | 0.1494 | 0.1177 | -0.1088 |
| v1 | 1580 | 0.1421 | 0.0702 | -0.0596 |
| hist | 1580 | 0.1426 | 0.0203 | -0.0097 |

### Acceptance gates (V2 FG families)

Thresholds: minOos=500, maxEce=0.04, integrityRejectRate=0, shadowSoak required.

| Family | n | Brier | LogLoss | ECE | Accepted? | Fail reasons |
|--------|---|-------|---------|-----|-----------|--------------|
| nfl:ml | 790 | 0.2497 | 0.7090 | 0.0982 | FAIL | ece_0.09822278481012661_gt_0.04; shadow_soak_incomplete |
| nfl:spread | 4740 | 0.1914 | 0.6401 | 0.0961 | FAIL | ece_0.09610812236286911_gt_0.04; shadow_soak_incomplete |
| nfl:total | 3950 | 0.2390 | 0.6846 | 0.0857 | FAIL | ece_0.08568506329113935_gt_0.04; shadow_soak_incomplete |
| nfl:team_total | 6320 | 0.2301 | 0.6697 | 0.0866 | FAIL | ece_0.08663243670886071_gt_0.04; shadow_soak_incomplete |

## NCAAF

### Dataset provenance & coverage

| Field | Value |
|-------|-------|
| Source | `espn_site_api_scoreboard` |
| Fingerprint | `561caad07bb1ab93` |
| Raw completed games | 1739 |
| Eligible (min 4 prior/side) | 1278 |
| Evaluated | 1278 |
| Cold-start skipped | 461 |
| OT rate | 4.1% |
| Target ≥500 | YES |
| Form window | L4 pre-kickoff |
| Cache | `/workspace/artifacts/simulator-v2/eval/cache/ncaaf_9ac26272eaa7.json` (fromCache=false) |

### Joint consistency

| Engine | Metric | Value |
|--------|--------|-------|
| V2 joint | games with zero period-sum violations | 100.00% |
| V1 frac | mean per-draw period-sum break rate | 99.92% |

### Full-game scoring accuracy (MAE total)

| Engine | Period | MAE total | RMSE total | MAE home | MAE away | n |
|--------|--------|-----------|------------|----------|----------|---|
| v2_joint | fg | 13.22 | 16.59 | 10.26 | 9.55 | 1278 |
| v2_joint | q2 | 6.62 | 8.24 | 5.39 | 4.89 | 1278 |
| v2_joint | h1 | 8.83 | 11.20 | 7.13 | 6.67 | 1278 |
| v1_frac | fg | 13.14 | 16.54 | 10.29 | 9.50 | 1278 |
| v1_frac | q2 | 6.60 | 8.37 | 5.29 | 4.57 | 1278 |
| v1_frac | h1 | 8.51 | 10.84 | 7.03 | 6.36 | 1278 |

### Probability calibration (all eval markets pooled)

| Engine | n | Brier | Log loss | ECE | bias (p̄−ȳ) |
|--------|---|-------|----------|-----|-------------|
| v2_joint | 31950 | 0.2209 | 0.6614 | 0.0897 | -0.0220 |
| v1_frac | 31950 | 0.2130 | 0.6353 | 0.0356 | -0.0076 |
| baseline_hist | 31950 | 0.2280 | 0.6620 | 0.0073 | -0.0021 |
| baseline_coin | 31950 | 0.2500 | 0.6931 | 0.0233 | 0.0233 |

### Extreme alternate spreads (|line| ≥ 14)

| Engine | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| v2 | 2556 | 0.1908 | 0.1369 | -0.1339 |
| v1 | 2556 | 0.1768 | 0.0600 | -0.0568 |
| hist | 2556 | 0.1950 | 0.0196 | -0.0038 |

### Acceptance gates (V2 FG families)

Thresholds: minOos=500, maxEce=0.04, integrityRejectRate=0, shadowSoak required.

| Family | n | Brier | LogLoss | ECE | Accepted? | Fail reasons |
|--------|---|-------|---------|-----|-----------|--------------|
| ncaaf:ml | 1278 | 0.2172 | 0.6357 | 0.1014 | FAIL | ece_0.10135093896713615_gt_0.04; shadow_soak_incomplete |
| ncaaf:spread | 7668 | 0.2048 | 0.6531 | 0.1115 | FAIL | ece_0.11149008868022957_gt_0.04; shadow_soak_incomplete |
| ncaaf:total | 6390 | 0.2158 | 0.6288 | 0.0623 | FAIL | ece_0.06226369327073562_gt_0.04; shadow_soak_incomplete |
| ncaaf:team_total | 10224 | 0.2138 | 0.6290 | 0.0710 | FAIL | ece_0.07102601721439744_gt_0.04; shadow_soak_incomplete |

## Biases, gaps, and overconfidence

| Finding | Evidence |
|---------|----------|
| **Joint integrity (V2)** | 100% of games: Q1–Q4 and H1/H2 sum to FG on every draw. |
| **Joint integrity (V1)** | ~99.9% of draws break period→FG conservation (frac×noise). |
| **Extreme alt spreads** | V2 **under**-estimates large-margin covers: NFL bias −0.109 (p̄=0.061 vs ȳ=0.170); NCAAF bias −0.134 (p̄=0.128 vs ȳ=0.262). ECE worst in this slice (0.12 / 0.14). |
| **Period ML/spread** | Q2/H1 ECE worse than FG for both sports (period variance under-dispersed relative to outcomes). |
| **Scoring MAE** | V2 FG total MAE ≈ 10.9 (NFL) / 13.2 (NCAAF) — similar to V1 FG means; joint model does not yet beat V1 on point MAE. |
| **vs baselines** | Walk-forward historical frequency has best ECE; coin is weak. **Closing lines unavailable** from ESPN historical scoreboard — market/CLV baseline not computed. |
| **Data gaps** | L4 form only; no QB/rest/weather/market; OT finals used for FG while quarters are regulation-only (OT rate NFL 5.8%, NCAAF 4.1%). |
| **Acceptance** | Sample-size gate met (≥500). **All sport:family gates FAIL** on ECE>0.04 and incomplete shadow soak. |

### Reliability note (FG moneyline, V2)

NFL FG ML: ECE 0.098, bias −0.087 (under-favors home). NCAAF FG ML: ECE 0.101, bias −0.087. Full bucket tables live in `*_summary.json` → `byFamily` / `overall.*.reliability`.

## Recommended next steps

1. Ingest historical closing lines (Odds API archive / sportsdata vendor) for true market baselines and CLV.
2. Expand form features (rest, travel, QB availability) — current L4 means are thin.
3. Increase blowout / heavy-tail mass (or drive-based scoring) — extreme-alt cover rates are too low vs history.
4. Recalibrate period variance before trusting Q2/H1 probabilities.
5. Keep V2 shadow-only until each sport:family passes ECE≤0.04 on n≥500 with shadow soak.
6. Do not lift P0 blocks or merge OTA on the back of this report alone.
