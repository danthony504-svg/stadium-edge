# Simulator V2 Phase B Correct — Chronological OOS Report

Generated: 2026-10-08T19:02:04.395Z

## Scope

- Corrected generative model (`football.joint.phase_b_correct` v0.3.0).
- Train-frozen HFA/overdispersion knobs only (see `trainFrozenParams.ts`).
- Holdout untouched for fitting. V2 remains shadow-only; production gates closed.
- No Coach / P0 / PR #649 / OTA changes.

## NFL

| Fold | Label | n games |
|------|-------|---------|
| train | NFL 2022 | 220 |
| val | NFL 2023 | 285 |
| holdout | NFL 2024 | 285 |

Frozen train params: HFA=2.55, gameΓ=22, marginσ=0.22, blowoutP=0.05 (from 2022, n=220).

### VAL — NFL 2023

Joint conservation: correct=100.00%, v0=100.00%

#### Scoring diagnostics

| Model | Bias total | Bias margin | Var ratio (pred/act) | MAE total | Tail cov @P90 |
|-------|------------|-------------|----------------------|-----------|---------------|
| v2_correct | 2.18 | -0.48 | 1.34 | 11.43 | 0.18 |
| v2_v0 | 0.67 | -3.05 | 0.57 | 11.19 | 0.09 |

#### FG family calibration (game-clustered SE)

| Family | Engine | n | Brier±SE | LogLoss | ECE±SE | bias |
|--------|--------|---|----------|---------|--------|------|
| ml | v2_correct | 285 | 0.2445±0.0085 | 0.6818 | 0.0714±0.0222 | -0.0134 |
| ml | v2_v0 | 285 | 0.2634±0.0119 | 0.7341 | 0.1397±0.0248 | -0.0928 |
| ml | v1_frac | 285 | 0.2500±0.0096 | 0.6968 | 0.0931±0.0230 | -0.0756 |
| ml | baseline_hist | 285 | 0.2529±0.0042 | 0.7641 | 0.0486±0.0250 | -0.0439 |
| ml | team_strength | 285 | 0.2817±0.0141 | 0.8005 | 0.1711±0.0263 | -0.0722 |
| spread | v2_correct | 1710 | 0.1920±0.0084 | 0.5711 | 0.0365±0.0110 | -0.0081 |
| spread | v2_v0 | 1710 | 0.2050±0.0132 | 0.6880 | 0.1115±0.0197 | -0.1049 |
| spread | v1_frac | 1710 | 0.1970±0.0113 | 0.6819 | 0.0696±0.0180 | -0.0687 |
| spread | baseline_hist | 1710 | 0.2006±0.0092 | 0.6544 | 0.0296±0.0151 | -0.0197 |
| spread | team_strength | 1710 | 0.2102±0.0116 | 0.6394 | 0.0929±0.0159 | -0.0311 |
| total | v2_correct | 1425 | 0.2327±0.0063 | 0.6591 | 0.0581±0.0193 | 0.0477 |
| total | v2_v0 | 1425 | 0.2425±0.0093 | 0.6943 | 0.0985±0.0171 | 0.0319 |
| total | v1_frac | 1425 | 0.2417±0.0077 | 0.7141 | 0.0822±0.0159 | 0.0303 |
| total | baseline_hist | 1425 | 0.2284±0.0063 | 0.7130 | 0.0306±0.0161 | -0.0282 |
| total | team_strength | 1425 | 0.2442±0.0096 | 0.6948 | 0.0957±0.0191 | 0.0370 |
| team_total | v2_correct | 2280 | 0.2252±0.0042 | 0.6438 | 0.0459±0.0104 | 0.0101 |
| team_total | v2_v0 | 2280 | 0.2400±0.0058 | 0.7085 | 0.1045±0.0100 | 0.0091 |
| team_total | v1_frac | 2280 | 0.2398±0.0060 | 0.7766 | 0.0905±0.0103 | 0.0148 |
| team_total | baseline_hist | 2280 | 0.2254±0.0036 | 0.7063 | 0.0167±0.0092 | -0.0082 |
| team_total | team_strength | 2280 | 0.2500±0.0000 | 0.6931 | 0.0575±0.0167 | 0.0575 |

#### Per-period calibration (V2 correct)

| Period | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| fg | 5700 | 0.2180 | 0.0406 | 0.0129 |
| h1 | 855 | 0.2493 | 0.0925 | -0.0135 |
| q2 | 570 | 0.2443 | 0.1074 | 0.0171 |

#### Extreme alt spreads (|line|≥14)

| Engine | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| v2_correct | 570 | 0.1528 | 0.0509 | -0.0281 |
| v2_v0 | 570 | 0.1669 | 0.1361 | -0.1262 |
| v1_frac | 570 | 0.1577 | 0.0801 | -0.0721 |
| baseline_hist | 570 | 0.1558 | 0.0267 | -0.0144 |

### HOLDOUT — NFL 2024

Joint conservation: correct=100.00%, v0=100.00%

#### Scoring diagnostics

| Model | Bias total | Bias margin | Var ratio (pred/act) | MAE total | Tail cov @P90 |
|-------|------------|-------------|----------------------|-----------|---------------|
| v2_correct | 1.80 | 0.33 | 1.53 | 10.78 | 0.23 |
| v2_v0 | 0.21 | -2.27 | 0.62 | 10.60 | 0.14 |

#### FG family calibration (game-clustered SE)

| Family | Engine | n | Brier±SE | LogLoss | ECE±SE | bias |
|--------|--------|---|----------|---------|--------|------|
| ml | v2_correct | 285 | 0.2338±0.0089 | 0.6634 | 0.0395±0.0173 | 0.0053 |
| ml | v2_v0 | 285 | 0.2471±0.0136 | 0.7111 | 0.1076±0.0248 | -0.0711 |
| ml | v1_frac | 285 | 0.2380±0.0104 | 0.6831 | 0.0630±0.0196 | -0.0507 |
| ml | baseline_hist | 285 | 0.2538±0.0043 | 0.7656 | 0.0416±0.0228 | -0.0149 |
| ml | team_strength | 285 | 0.2567±0.0155 | 0.7686 | 0.1401±0.0253 | -0.0536 |
| spread | v2_correct | 1710 | 0.1793±0.0079 | 0.5352 | 0.0243±0.0122 | 0.0210 |
| spread | v2_v0 | 1710 | 0.1899±0.0125 | 0.6057 | 0.0980±0.0167 | -0.0757 |
| spread | v1_frac | 1710 | 0.1841±0.0108 | 0.5708 | 0.0546±0.0163 | -0.0450 |
| spread | baseline_hist | 1710 | 0.1943±0.0093 | 0.6388 | 0.0471±0.0151 | -0.0301 |
| spread | team_strength | 1710 | 0.1948±0.0111 | 0.5969 | 0.0759±0.0157 | 0.0000 |
| total | v2_correct | 1425 | 0.2292±0.0057 | 0.6503 | 0.0294±0.0138 | 0.0124 |
| total | v2_v0 | 1425 | 0.2366±0.0077 | 0.6761 | 0.0768±0.0147 | 0.0109 |
| total | v1_frac | 1425 | 0.2370±0.0082 | 0.6808 | 0.0679±0.0149 | 0.0026 |
| total | baseline_hist | 1425 | 0.2287±0.0042 | 0.7141 | 0.0318±0.0159 | -0.0265 |
| total | team_strength | 1425 | 0.2380±0.0097 | 0.6859 | 0.0827±0.0172 | 0.0036 |
| team_total | v2_correct | 2280 | 0.2158±0.0043 | 0.6214 | 0.0190±0.0076 | -0.0014 |
| team_total | v2_v0 | 2280 | 0.2266±0.0058 | 0.6596 | 0.0849±0.0096 | 0.0083 |
| team_total | v1_frac | 2280 | 0.2279±0.0059 | 0.6997 | 0.0699±0.0106 | 0.0103 |
| team_total | baseline_hist | 2280 | 0.2285±0.0036 | 0.7139 | 0.0324±0.0120 | -0.0268 |
| team_total | team_strength | 2280 | 0.2500±0.0000 | 0.6931 | 0.0145±0.0134 | 0.0145 |

#### Per-period calibration (V2 correct)

| Period | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| fg | 5700 | 0.2091 | 0.0169 | 0.0091 |
| h1 | 855 | 0.2491 | 0.0875 | 0.0040 |
| q2 | 570 | 0.2495 | 0.1342 | 0.0433 |

#### Extreme alt spreads (|line|≥14)

| Engine | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| v2_correct | 570 | 0.1367 | 0.0306 | -0.0038 |
| v2_v0 | 570 | 0.1514 | 0.1182 | -0.1057 |
| v1_frac | 570 | 0.1444 | 0.0783 | -0.0614 |
| baseline_hist | 570 | 0.1460 | 0.0372 | -0.0337 |

#### Acceptance gate status (V2 correct, holdout FG) — production remain CLOSED

| Family | n | ECE | ECE≤0.04? | n≥500? | Metric gates | Production |
|--------|---|-----|-----------|--------|--------------|------------|
| ml | 285 | 0.0395 | yes | no | FAIL (n) | **CLOSED** |
| spread | 1710 | 0.0243 | yes | yes | PASS* | **CLOSED** |
| total | 1425 | 0.0294 | yes | yes | PASS* | **CLOSED** |
| team_total | 2280 | 0.0190 | yes | yes | PASS* | **CLOSED** |

\*Metric PASS does not open production — `SIM_V2_SERVE` off, `ACCEPTED_FAMILIES` empty, shadow soak incomplete.

## NCAAF

| Fold | Label | n games |
|------|-------|---------|
| train | NCAAF 2023 | 531 |
| val | NCAAF 2024 weeks 1–7 | 343 |
| holdout | NCAAF 2024 weeks 8–15 | 404 |

Frozen train params: HFA=2.87, gameΓ=28, marginσ=0.24, blowoutP=0.05 (from 2023, n=531).

### VAL — NCAAF 2024 weeks 1–7

Joint conservation: correct=100.00%, v0=100.00%

#### Scoring diagnostics

| Model | Bias total | Bias margin | Var ratio (pred/act) | MAE total | Tail cov @P90 |
|-------|------------|-------------|----------------------|-----------|---------------|
| v2_correct | 2.61 | -1.93 | 1.17 | 13.12 | 0.21 |
| v2_v0 | 1.40 | -4.81 | 0.65 | 13.00 | 0.15 |

#### FG family calibration (game-clustered SE)

| Family | Engine | n | Brier±SE | LogLoss | ECE±SE | bias |
|--------|--------|---|----------|---------|--------|------|
| ml | v2_correct | 343 | 0.2061±0.0102 | 0.6014 | 0.0436±0.0171 | -0.0212 |
| ml | v2_v0 | 343 | 0.2172±0.0129 | 0.6416 | 0.1148±0.0232 | -0.0844 |
| ml | v1_frac | 343 | 0.2098±0.0087 | 0.6093 | 0.0898±0.0243 | -0.0792 |
| ml | baseline_hist | 343 | 0.2485±0.0052 | 0.7445 | 0.0403±0.0216 | -0.0083 |
| ml | team_strength | 343 | 0.2372±0.0168 | 0.7781 | 0.1749±0.0239 | -0.0661 |
| spread | v2_correct | 2058 | 0.1925±0.0087 | 0.5708 | 0.0336±0.0136 | -0.0317 |
| spread | v2_v0 | 2058 | 0.2069±0.0110 | 0.6930 | 0.1168±0.0183 | -0.1093 |
| spread | v1_frac | 2058 | 0.1979±0.0087 | 0.5901 | 0.0641±0.0167 | -0.0625 |
| spread | baseline_hist | 2058 | 0.2300±0.0041 | 0.7055 | 0.0362±0.0168 | 0.0243 |
| spread | team_strength | 2058 | 0.2098±0.0125 | 0.7181 | 0.1193±0.0171 | -0.0399 |
| total | v2_correct | 1715 | 0.2097±0.0053 | 0.6072 | 0.0453±0.0155 | 0.0453 |
| total | v2_v0 | 1715 | 0.2115±0.0069 | 0.6170 | 0.0615±0.0127 | 0.0440 |
| total | v1_frac | 1715 | 0.2116±0.0052 | 0.6141 | 0.0334±0.0141 | 0.0328 |
| total | baseline_hist | 1715 | 0.2187±0.0043 | 0.6817 | 0.0302±0.0132 | -0.0255 |
| total | team_strength | 1715 | 0.2761±0.0128 | 0.8599 | 0.1846±0.0202 | 0.1276 |
| team_total | v2_correct | 2744 | 0.2040±0.0051 | 0.5942 | 0.0285±0.0098 | 0.0195 |
| team_total | v2_v0 | 2744 | 0.2132±0.0062 | 0.6301 | 0.0735±0.0115 | 0.0292 |
| team_total | v1_frac | 2744 | 0.2130±0.0055 | 0.6277 | 0.0472±0.0103 | 0.0298 |
| team_total | baseline_hist | 2744 | 0.2280±0.0044 | 0.7013 | 0.0296±0.0102 | -0.0228 |
| team_total | team_strength | 2744 | 0.2500±0.0000 | 0.6931 | 0.0448±0.0152 | 0.0448 |

#### Per-period calibration (V2 correct)

| Period | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| fg | 6860 | 0.2021 | 0.0182 | 0.0086 |
| h1 | 1029 | 0.2380 | 0.0832 | 0.0006 |
| q2 | 686 | 0.2414 | 0.1197 | 0.0058 |

#### Extreme alt spreads (|line|≥14)

| Engine | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| v2_correct | 686 | 0.1845 | 0.0691 | -0.0653 |
| v2_v0 | 686 | 0.2066 | 0.1602 | -0.1509 |
| v1_frac | 686 | 0.1904 | 0.0725 | -0.0660 |
| baseline_hist | 686 | 0.2132 | 0.0548 | 0.0409 |

### HOLDOUT — NCAAF 2024 weeks 8–15

Joint conservation: correct=100.00%, v0=100.00%

#### Scoring diagnostics

| Model | Bias total | Bias margin | Var ratio (pred/act) | MAE total | Tail cov @P90 |
|-------|------------|-------------|----------------------|-----------|---------------|
| v2_correct | 2.73 | -1.65 | 1.13 | 13.47 | 0.19 |
| v2_v0 | 1.28 | -4.51 | 0.59 | 13.31 | 0.12 |

#### FG family calibration (game-clustered SE)

| Family | Engine | n | Brier±SE | LogLoss | ECE±SE | bias |
|--------|--------|---|----------|---------|--------|------|
| ml | v2_correct | 404 | 0.2085±0.0086 | 0.6026 | 0.0415±0.0154 | -0.0371 |
| ml | v2_v0 | 404 | 0.2248±0.0117 | 0.6552 | 0.1138±0.0204 | -0.1067 |
| ml | v1_frac | 404 | 0.2140±0.0094 | 0.6172 | 0.0888±0.0195 | -0.0888 |
| ml | baseline_hist | 404 | 0.2459±0.0058 | 0.7309 | 0.0410±0.0203 | 0.0198 |
| ml | team_strength | 404 | 0.2451±0.0157 | 0.7745 | 0.1705±0.0231 | -0.0994 |
| spread | v2_correct | 2424 | 0.1898±0.0067 | 0.5608 | 0.0313±0.0133 | -0.0299 |
| spread | v2_v0 | 2424 | 0.2071±0.0108 | 0.6697 | 0.1227±0.0175 | -0.1167 |
| spread | v1_frac | 2424 | 0.1964±0.0085 | 0.5945 | 0.0737±0.0182 | -0.0737 |
| spread | baseline_hist | 2424 | 0.2252±0.0046 | 0.6879 | 0.0255±0.0085 | 0.0015 |
| spread | team_strength | 2424 | 0.2120±0.0116 | 0.6767 | 0.1298±0.0156 | -0.0509 |
| total | v2_correct | 2020 | 0.2141±0.0053 | 0.6185 | 0.0411±0.0148 | 0.0371 |
| total | v2_v0 | 2020 | 0.2189±0.0071 | 0.6389 | 0.0682±0.0131 | 0.0313 |
| total | v1_frac | 2020 | 0.2165±0.0060 | 0.6328 | 0.0422±0.0117 | 0.0245 |
| total | baseline_hist | 2020 | 0.2210±0.0036 | 0.6781 | 0.0232±0.0105 | -0.0208 |
| total | team_strength | 2020 | 0.2571±0.0096 | 0.7648 | 0.1328±0.0152 | 0.0432 |
| team_total | v2_correct | 3232 | 0.2070±0.0043 | 0.6019 | 0.0228±0.0081 | 0.0133 |
| team_total | v2_v0 | 3232 | 0.2189±0.0059 | 0.6463 | 0.0799±0.0091 | 0.0215 |
| team_total | v1_frac | 3232 | 0.2188±0.0051 | 0.7082 | 0.0558±0.0094 | 0.0261 |
| team_total | baseline_hist | 3232 | 0.2282±0.0033 | 0.6934 | 0.0279±0.0083 | -0.0096 |
| team_total | team_strength | 3232 | 0.2500±0.0000 | 0.6931 | 0.0300±0.0131 | 0.0300 |

#### Per-period calibration (V2 correct)

| Period | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| fg | 8080 | 0.2037 | 0.0189 | 0.0038 |
| h1 | 1212 | 0.2479 | 0.0928 | 0.0003 |
| q2 | 808 | 0.2310 | 0.0887 | 0.0163 |

#### Extreme alt spreads (|line|≥14)

| Engine | n | Brier | ECE | bias |
|--------|---|-------|-----|------|
| v2_correct | 808 | 0.1702 | 0.0475 | -0.0417 |
| v2_v0 | 808 | 0.1913 | 0.1403 | -0.1377 |
| v1_frac | 808 | 0.1769 | 0.0702 | -0.0692 |
| baseline_hist | 808 | 0.1955 | 0.0302 | -0.0221 |

#### Acceptance gate status (V2 correct, holdout FG) — production remain CLOSED

| Family | n | ECE | ECE≤0.04? | n≥500? | Metric gates | Production |
|--------|---|-----|-----------|--------|--------------|------------|
| ml | 404 | 0.0415 | no | no | FAIL | **CLOSED** |
| spread | 2424 | 0.0313 | yes | yes | PASS* | **CLOSED** |
| total | 2020 | 0.0411 | no | yes | FAIL (ECE) | **CLOSED** |
| team_total | 3232 | 0.0228 | yes | yes | PASS* | **CLOSED** |

\*Metric PASS does not open production — `SIM_V2_SERVE` off, `ACCEPTED_FAMILIES` empty, shadow soak incomplete.

## Remaining failures / next

- Production gates stay **closed** (shadow soak + flags) even where holdout ECE≤0.04.
- NFL holdout ML fails n≥500 (285 games); NCAAF ML/total barely miss ECE≤0.04.
- Period (H1/Q2) ECE still elevated vs FG — further quarter variance work needed.
- Closing-line market baseline still unavailable from ESPN historical feed.
- Residual total bias (~+1.8 NFL / +2.7 NCAAF) and NCAAF margin bias (−1.65) remain.
