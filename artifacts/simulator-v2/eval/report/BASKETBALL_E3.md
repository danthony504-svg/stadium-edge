# Basketball E.3 — league-specific one-factor holdout

Promote only if ECE **and** Brier **and** LogLoss improve vs v0.2 on identical holdout.
Default remains v0.2 unless promotion YES. Leagues independent. Shadow-only.

## NBA
- Holdout games: 309; candidate: `nba_e3` (one factor)
- v0.2 → candidate: ECE 0.0613 → 0.0703 (Δ0.0090)
- Brier 0.2270 → 0.2284; LogLoss 0.6481 → 0.6499
- **Promote: NO** — blocked eceOk=false brierOk=false llOk=false

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nba:main_all:v0.2 | **FAIL** | 927 | 309 | 309.0 | 0.2270 | 0.6481 | 0.0613 | 0.0144 | -0.043 | ece_0.0613_gt_0.04 |
| nba:main_all:nba_e3 | **FAIL** | 927 | 309 | 309.0 | 0.2284 | 0.6499 | 0.0703 | 0.0163 | -0.046 | ece_0.0703_gt_0.04 |
| nba:ml:v0.2 | **INSUFFICIENT_DATA** | 309 | 309 | 309.0 | 0.2150 | 0.6205 | 0.0738 | 0.0192 | -0.003 | oos_sample_309_lt_500; ece_0.0738_gt_0.04 |
| nba:ml:nba_e3 | **INSUFFICIENT_DATA** | 309 | 309 | 309.0 | 0.2181 | 0.6272 | 0.0610 | 0.0207 | -0.002 | oos_sample_309_lt_500; ece_0.0610_gt_0.04 |
| nba:spread:v0.2 | **INSUFFICIENT_DATA** | 309 | 309 | 309.0 | 0.2322 | 0.6574 | 0.1769 | 0.0231 | -0.177 | oos_sample_309_lt_500; ece_0.1769_gt_0.04 |
| nba:spread:nba_e3 | **INSUFFICIENT_DATA** | 309 | 309 | 309.0 | 0.2346 | 0.6620 | 0.1798 | 0.0243 | -0.177 | oos_sample_309_lt_500; ece_0.1798_gt_0.04 |
| nba:total:v0.2 | **INSUFFICIENT_DATA** | 309 | 309 | 309.0 | 0.2340 | 0.6665 | 0.0674 | 0.0188 | 0.052 | oos_sample_309_lt_500; ece_0.0674_gt_0.04 |
| nba:total:nba_e3 | **INSUFFICIENT_DATA** | 309 | 309 | 309.0 | 0.2324 | 0.6603 | 0.0438 | 0.0216 | 0.041 | oos_sample_309_lt_500; ece_0.0438_gt_0.04 |

## WNBA
- Holdout games: 178; candidate: `wnba_e3` (one factor)
- v0.2 → candidate: ECE 0.0612 → 0.0612 (Δ0.0000)
- Brier 0.2232 → 0.2232; LogLoss 0.6378 → 0.6378
- **Promote: NO** — no_candidate_factor

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| wnba:main_all:v0.2 | **FAIL** | 531 | 177 | 177.0 | 0.2232 | 0.6378 | 0.0612 | 0.0171 | -0.013 | ece_0.0612_gt_0.04 |
| wnba:main_all:wnba_e3 | **FAIL** | 531 | 177 | 177.0 | 0.2232 | 0.6378 | 0.0612 | 0.0171 | -0.013 | ece_0.0612_gt_0.04 |
| wnba:ml:v0.2 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2151 | 0.6204 | 0.1295 | 0.0267 | 0.011 | oos_sample_177_lt_500; ece_0.1295_gt_0.04 |
| wnba:ml:wnba_e3 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2151 | 0.6204 | 0.1295 | 0.0296 | 0.011 | oos_sample_177_lt_500; ece_0.1295_gt_0.04 |
| wnba:spread:v0.2 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2302 | 0.6545 | 0.1327 | 0.0295 | -0.133 | oos_sample_177_lt_500; ece_0.1327_gt_0.04 |
| wnba:spread:wnba_e3 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2302 | 0.6545 | 0.1327 | 0.0276 | -0.133 | oos_sample_177_lt_500; ece_0.1327_gt_0.04 |
| wnba:total:v0.2 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2242 | 0.6384 | 0.0922 | 0.0293 | 0.084 | oos_sample_177_lt_500; ece_0.0922_gt_0.04 |
| wnba:total:wnba_e3 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2242 | 0.6384 | 0.0922 | 0.0286 | 0.084 | oos_sample_177_lt_500; ece_0.0922_gt_0.04 |

## NCAAB
- Holdout games: 400; candidate: `ncaab_e3` (one factor)
- v0.2 → candidate: ECE 0.0534 → 0.0485 (Δ-0.0049)
- Brier 0.2224 → 0.2227; LogLoss 0.6335 → 0.6347
- **Promote: NO** — blocked eceOk=true brierOk=false llOk=false

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| ncaab:main_all:v0.2 | **FAIL** | 1188 | 396 | 396.0 | 0.2224 | 0.6335 | 0.0534 | 0.0146 | -0.043 | ece_0.0534_gt_0.04 |
| ncaab:main_all:ncaab_e3 | **FAIL** | 1188 | 396 | 396.0 | 0.2227 | 0.6347 | 0.0485 | 0.0132 | -0.045 | ece_0.0485_gt_0.04 |
| ncaab:ml:v0.2 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2130 | 0.6120 | 0.0323 | 0.0157 | -0.028 | oos_sample_396_lt_500 |
| ncaab:ml:ncaab_e3 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2136 | 0.6151 | 0.0571 | 0.0171 | -0.024 | oos_sample_396_lt_500; ece_0.0571_gt_0.04 |
| ncaab:spread:v0.2 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2315 | 0.6532 | 0.1963 | 0.0219 | -0.196 | oos_sample_396_lt_500; ece_0.1963_gt_0.04 |
| ncaab:spread:ncaab_e3 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2318 | 0.6545 | 0.1992 | 0.0235 | -0.196 | oos_sample_396_lt_500; ece_0.1992_gt_0.04 |
| ncaab:total:v0.2 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2226 | 0.6353 | 0.0945 | 0.0204 | 0.094 | oos_sample_396_lt_500; ece_0.0945_gt_0.04 |
| ncaab:total:ncaab_e3 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2227 | 0.6345 | 0.0998 | 0.0217 | 0.086 | oos_sample_396_lt_500; ece_0.0998_gt_0.04 |

## Promotion board
| League | Candidate | Promote | Reason |
|--------|-----------|---------|--------|
| nba | nba_e3 | **NO** | blocked eceOk=false brierOk=false llOk=false |
| wnba | wnba_e3 | **NO** | no_candidate_factor |
| ncaab | ncaab_e3 | **NO** | blocked eceOk=true brierOk=false llOk=false |

Defaults stay v0.2 unless YES — update `E3_PROMOTED` in jointBasketball.ts accordingly.
- Serve/allowlists unchanged.