# MLB discrimination audit — v0.2 vs v0.3

Shadow-only. Identical frozen chronological holdout (`MLB_AB_HOLDOUT_GAMES.json`).
VAL fold is diagnostic for default-profile decision; **never tune on holdout**.
`SIM_V2_SERVE` off. Thresholds unchanged: minOos=500, maxEce=0.04.

## Setup

- Games: 3939; chrono 55/20/25 → train 2166 / val 788 / holdout 985
- Frozen holdout graded: 560 (ids match A/B freeze); used v0.2=560 v0.3=560
- VAL diagnostic graded: 560; used v0.2=560 v0.3=560
- Profiles: v0.2 = shrink0 / σ0 / HFA0.1; v0.3 = shrink0.4 / σ0.18 / HFA0.05
- Pregame baselines (TRAIN only, leak-free): coin p=0.5; empirical home-win rate=0.5199 (n_train=2166)

## Decision policy

- Do **not** accept ECE gains that are only shrink-to-50.
- Require discrimination (separation / AUC), variance, tails, and pregame baseline beat where applicable.
- VAL ML: shrink=ok, discriminationWorse=true, ECE=0.1021
- VAL team_total: shrink=FLAG, discriminationWorse=false, ECE=0.0428
- **Option B** selected: VAL ML separation worsened (sep Δ<−0.01) → default profile changed to **v0.3.1** (shrink 0.2 / σ0.22 / HFA 0.07).
- Default params changed: **YES → baseballProfileLevers default v0.3.1**
- VAL reject ship for ml: true; team_total: true

### VAL confirmation — v0.3.1 (not holdout-tuned)

| Family | n | ECE | Brier | LogLoss | sep | AUC | mad½ | vs v0.3 sepΔ | vs v0.3 madΔ |
|--------|---|-----|-------|---------|-----|-----|-------|--------------|--------------|
| ml | 560 | 0.0985 | 0.2523 | 0.6989 | 0.0300 | 0.5900 | 0.0910 | 0.0060 | 0.0111 |
| team_total | 560 | 0.0449 | 0.2435 | 0.6800 | 0.0130 | 0.5355 | 0.0894 | 0.0013 | 0.0139 |
| f5 | 1680 | 0.0473 | 0.2465 | 0.6869 | 0.0121 | 0.5394 | 0.0984 | n/a | n/a |

- v0.3.1 within-draw total var (VAL): 10.52; between-game varRatio: 0.024
- v0.3.1 still **not accepted** for production serve; ml/team_total remain MODIFY until holdout re-audit clears shrink-to-50 + separation.

## Discrimination table — HOLDOUT (frozen identical)

| Family | n | ECE v0.2 | ECE v0.3 | Brier v0.2 | Brier v0.3 | LogLoss v0.2 | LogLoss v0.3 | ECE_SE v0.3 | sep v0.2 | sep v0.3 | AUC v0.2 | AUC v0.3 | mad½ v0.2 | mad½ v0.3 | shrink | discΔ |
|--------|---|----------|----------|------------|------------|--------------|--------------|-------------|----------|----------|----------|----------|-----------|-----------|--------|-------|
| ml | 560 | 0.1437 | 0.1101 | 0.2613 | 0.2578 | 0.7179 | 0.7093 | 0.0219 | 0.0243 | 0.0134 | 0.5549 | 0.5525 | 0.1096 | 0.0752 | FLAG | -0.0024 |
| spread | 1120 | 0.0691 | 0.0568 | 0.2183 | 0.2171 | 0.6330 | 0.6266 | 0.0172 | 0.0377 | 0.0250 | 0.5935 | 0.5918 | 0.2369 | 0.2327 | ok | -0.0017 |
| total | 1120 | 0.0712 | 0.0492 | 0.2475 | 0.2426 | 0.6928 | 0.6799 | 0.0110 | 0.0495 | 0.0407 | 0.5877 | 0.5886 | 0.1489 | 0.1289 | ok | 0.0009 |
| team_total | 560 | 0.1177 | 0.0627 | 0.2637 | 0.2539 | 0.7225 | 0.7012 | 0.0160 | -0.0027 | -0.0022 | 0.4890 | 0.4849 | 0.0980 | 0.0653 | FLAG | -0.0041 |
| f5 | 1680 | 0.0674 | 0.0468 | 0.2562 | 0.2515 | 0.7073 | 0.6967 | 0.0099 | 0.0118 | 0.0108 | 0.5300 | 0.5361 | 0.1025 | 0.0890 | ok | 0.0062 |
| main_all | 3360 | 0.0871 | 0.0623 | 0.2552 | 0.2506 | 0.7054 | 0.6947 | 0.0105 | 0.0258 | 0.0188 | 0.5501 | 0.5506 | 0.1142 | 0.0885 | ok | 0.0005 |
| alt_all | 1680 | 0.0718 | 0.0590 | 0.2312 | 0.2273 | 0.6606 | 0.6485 | 0.0133 | 0.0219 | 0.0170 | 0.5526 | 0.5560 | 0.2005 | 0.1999 | ok | 0.0034 |

## Discrimination table — VAL (diagnostic only)

| Family | n | ECE v0.2 | ECE v0.3 | Brier v0.2 | Brier v0.3 | LogLoss v0.2 | LogLoss v0.3 | ECE_SE v0.3 | sep v0.2 | sep v0.3 | AUC v0.2 | AUC v0.3 | mad½ v0.2 | mad½ v0.3 | shrink | discΔ |
|--------|---|----------|----------|------------|------------|--------------|--------------|-------------|----------|----------|----------|----------|-----------|-----------|--------|-------|
| ml | 560 | 0.0984 | 0.1021 | 0.2559 | 0.2525 | 0.7084 | 0.6988 | 0.0188 | 0.0374 | 0.0240 | 0.5804 | 0.5913 | 0.1141 | 0.0799 | ok | 0.0109 |
| spread | 1120 | 0.0713 | 0.0691 | 0.2196 | 0.2189 | 0.6373 | 0.6304 | 0.0197 | 0.0505 | 0.0341 | 0.6125 | 0.6154 | 0.2413 | 0.2345 | ok | 0.0029 |
| total | 1120 | 0.0617 | 0.0403 | 0.2344 | 0.2285 | 0.6647 | 0.6492 | 0.0114 | 0.0450 | 0.0430 | 0.5861 | 0.5936 | 0.1648 | 0.1379 | ok | 0.0075 |
| team_total | 560 | 0.0714 | 0.0428 | 0.2477 | 0.2417 | 0.6889 | 0.6763 | 0.0168 | 0.0161 | 0.0117 | 0.5322 | 0.5433 | 0.1046 | 0.0755 | FLAG | 0.0111 |
| f5 | 1680 | 0.0654 | 0.0358 | 0.2487 | 0.2457 | 0.6924 | 0.6847 | 0.0086 | 0.0146 | 0.0111 | 0.5392 | 0.5395 | 0.1098 | 0.0925 | ok | 0.0003 |
| main_all | 3360 | 0.0656 | 0.0463 | 0.2518 | 0.2483 | 0.6991 | 0.6901 | 0.0103 | 0.0238 | 0.0159 | 0.5525 | 0.5477 | 0.1119 | 0.0871 | ok | -0.0048 |
| alt_all | 1680 | 0.0636 | 0.0417 | 0.2157 | 0.2121 | 0.6280 | 0.6160 | 0.0097 | 0.0170 | 0.0131 | 0.5480 | 0.5501 | 0.2297 | 0.2184 | ok | 0.0021 |

## Pregame baselines vs model ML (holdout)

| Baseline | p | n | Brier | LogLoss | ECE | meanY |
|----------|---|---|-------|---------|-----|-------|
| coin_0.5 | 0.5000 | 560 | 0.2500 | 0.6931 | 0.0482 | 0.5482 |
| empirical_home_win_train | 0.5199 | 560 | 0.2485 | 0.6901 | 0.0284 | 0.5482 |
| model v0.2 ml | (varying) | 560 | 0.2613 | 0.7179 | 0.1437 | 0.5482 |
| model v0.3 ml | (varying) | 560 | 0.2578 | 0.7093 | 0.1101 | 0.5482 |

### Pregame baselines vs model ML (VAL)

| Baseline | p | n | Brier | LogLoss | ECE | meanY |
|----------|---|---|-------|---------|-----|-------|
| coin_0.5 | 0.5000 | 560 | 0.2500 | 0.6931 | 0.0411 | 0.5411 |
| empirical_home_win_train | 0.5199 | 560 | 0.2488 | 0.6907 | 0.0212 | 0.5411 |
| model v0.2 ml | (varying) | 560 | 0.2559 | 0.7084 | 0.0984 | 0.5411 |
| model v0.3 ml | (varying) | 560 | 0.2525 | 0.6988 | 0.1021 | 0.5411 |

## Variance & tails (totals)

### Holdout

| Profile | within-draw var (tot) | actual var (tot) | between-game varRatio | actP90 | simMeanP90 | actP95 | simMeanP95 | P(simMean≥actP90) | P(simMean≥actP95) |
|---------|----------------------|------------------|-----------------------|--------|------------|--------|------------|-------------------|-------------------|
| v0.2 | 9.08 | 18.64 | 0.045 | 14.0 | 10.2 | 17.0 | 10.6 | 0.000 | 0.000 |
| v0.3 | 10.35 | 18.64 | 0.016 | 14.0 | 9.7 | 17.0 | 9.9 | 0.000 | 0.000 |

| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| mlb_total_v0.2_holdout | 560 | 9.03 | 9.07 | 0.04 | 18.64 | 0.83 | 0.04 | 14.0 | 10.2 |
| mlb_margin_v0.2_holdout | 560 | 0.06 | 0.03 | -0.03 | 19.23 | 0.88 | 0.05 | 5.0 | 1.2 |
| mlb_total_v0.3_holdout | 560 | 9.03 | 8.99 | -0.03 | 18.64 | 0.30 | 0.02 | 14.0 | 9.7 |
| mlb_margin_v0.3_holdout | 560 | 0.06 | 0.01 | -0.06 | 19.23 | 0.31 | 0.02 | 5.0 | 0.7 |

### VAL

| Profile | within-draw var (tot) | actual var (tot) | between-game varRatio | actP90 | simMeanP90 | actP95 | simMeanP95 | P(simMean≥actP90) | P(simMean≥actP95) |
|---------|----------------------|------------------|-----------------------|--------|------------|--------|------------|-------------------|-------------------|
| v0.2 | 8.61 | 17.75 | 0.037 | 14.0 | 9.6 | 16.0 | 10.0 | 0.000 | 0.000 |
| v0.3 | 9.98 | 17.75 | 0.014 | 14.0 | 9.3 | 16.0 | 9.5 | 0.000 | 0.000 |

## F5 (PASSED) vs FG ML gap

- Holdout FG ML (slice ml_home): ECE v0.2=0.1437 → v0.3=0.1101; sep 0.0243→0.0134; AUC 0.5549→0.5525; mad½ 0.1096→0.0752; shrink=FLAG
- Holdout F5 ML (slice f5_ml_home): ECE v0.2=0.0694 → v0.3=0.0581; sep 0.0099→0.0041; AUC 0.5272→0.5200; mad½ 0.1019→0.0896; shrink=ok
- Holdout F5 family (all F5 markets): verdict v0.3=**FAIL** ECE=0.0468
- Gap hypothesis: F5 is 5/9 of the same Poisson innings — shorter horizon reduces cumulative form-overconfidence; FG ML integrates 9 innings of shrunk means + HFA so home-win probs collapse toward 0.5 under v0.3 shrink (shrink-to-50 on FG ML) while F5 ML retains usable separation and clears ECE.
- Starting pitcher participation: already **fail-closed** in `jointBaseball.ts` (non-starter pitcher → participateProb=0 → settle `missing_data`). Team FG/F5 ML still ignore SP identity — SP features are prop-path only today.

## Shrink-to-50 notes

- **ml** (holdout): SHRINK_TO_50_SUSPECT: ΔECE=-0.0336 but meanAbsDevFromHalf 0.1096→0.0752 (drop 31.4%) — ECE gain may be from probs collapsing toward 0.5
- **spread** (holdout): ok: ΔECE=-0.0123, meanAbsDevFromHalf 0.2369→0.2327 (Δ=-0.0042, 1.8% drop)
- **total** (holdout): ok: ΔECE=-0.0220, meanAbsDevFromHalf 0.1489→0.1289 (Δ=-0.0200, 13.4% drop)
- **team_total** (holdout): SHRINK_TO_50_SUSPECT: ΔECE=-0.0550 but meanAbsDevFromHalf 0.0980→0.0653 (drop 33.4%) — ECE gain may be from probs collapsing toward 0.5
- **f5** (holdout): ok: ΔECE=-0.0207, meanAbsDevFromHalf 0.1025→0.0890 (Δ=-0.0135, 13.2% drop)
- **main_all** (holdout): ok: ΔECE=-0.0248, meanAbsDevFromHalf 0.1142→0.0885 (Δ=-0.0257, 22.5% drop)
- **alt_all** (holdout): ok: ΔECE=-0.0128, meanAbsDevFromHalf 0.2005→0.1999 (Δ=-0.0006, 0.3% drop)

## Starting pitcher participation

- Status: **fail-closed** for non-confirmed starters (`confirmedStarter === false` ⇒ participateProb=0; settle returns `missing_data`).
- Batters without batting order / starter confirmation likewise fail closed.
- This does **not** yet inject SP quality into team FG/F5 ML means — gap vs F5 PASS is generative (innings horizon + shrink), not a participation-gate regression.

## Per-family decisions (see also MILESTONE_MLB_DECISION.md)

| Family | Decision | Rationale |
|--------|----------|-----------|
| ml | **MODIFY** | shrink-to-50 and/or weak discrimination on VAL/holdout — do not accept ECE-only gain (VAL mad½ 0.1141→0.0799; sep Δ=-0.0134) |
| spread | **MODIFY** | VAL discrimination worsened (disc Δ=0.0029, sep Δ=-0.0163); ECE-only not accepted |
| total | **MODIFY** | v0.3 improves ECE/Brier without shrink-to-50 but still FAIL gate (ECE=0.0492>0.04); need variance/tails work, not accept |
| team_total | **MODIFY** | shrink-to-50 and/or weak discrimination on VAL/holdout — do not accept ECE-only gain (VAL mad½ 0.1046→0.0755; sep Δ=-0.0044) |
| f5 | **KEEP** | v0.3 VAL ECE=0.0358≤0.04; A/B freeze holdout PASS; not shrink-to-50; disc audit holdout ECE=0.0468 (seed variance near gate) |
| main_all | **MODIFY** | v0.3 improves ECE/Brier without shrink-to-50 but still FAIL gate (ECE=0.0623>0.04); need variance/tails work, not accept |
| alt_all | **MODIFY** | v0.3 improves ECE/Brier without shrink-to-50 but still FAIL gate (ECE=0.0590>0.04); need variance/tails work, not accept |
| player_prop_named | **MODIFY** | holdout ECE still >0.04; starter participation fail-closed already in joint; needs prop-specific calibration (not shrink-to-50 for team markets) |
| closing_line | **INSUFFICIENT** | no licensed closing-line archive |

## Next milestone

- **MLB F.3**: re-freeze A/B with v0.2 / v0.3 / v0.3.1 on identical holdout; require ML separation ≥ v0.2 and clear shrink-to-50 before accept; add SP-quality into team means (participation already fail-closed); licensed closing-line archive still blocker.
