# Basketball E.2 chronological OOS

Shadow-only. Separate sport sections — NBA pass does not enable WNBA/NCAAB.
Baseline: leakage-safe team form only; grid −110 (no closing-line archive).

## NBA (separate gates)
- Fetch: ESPN date-sample (week API empty for NBA/WNBA)
- Train n=439, hold n=482, used=97, obs=291, games_clustered=97
- Mean runtime/game: 4.9 ms
- p95 runtime/game (proxy mean×1.5): 7.3 ms
| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 291 | 0.2489 | 0.6925 | 0.0650 |
| ml_home | 97 | 0.2563 | 0.7082 | 0.0772 |
| spread_home_-3.5 | 97 | 0.2620 | 0.7203 | 0.1441 |
| total | 97 | 0.2284 | 0.6489 | 0.0466 |
- Gate n≥500: **NOT MET**

## WNBA (separate gates)
- Fetch: ESPN date-sample (week API empty for NBA/WNBA)
- Train n=89, hold n=97, used=54, obs=162, games_clustered=54
- Mean runtime/game: 3.9 ms
- p95 runtime/game (proxy mean×1.5): 5.8 ms
| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 162 | 0.2251 | 0.6416 | 0.0354 |
| ml_home | 54 | 0.2195 | 0.6296 | 0.0826 |
| spread_home_-3.5 | 54 | 0.2324 | 0.6587 | 0.1230 |
| total | 54 | 0.2236 | 0.6364 | 0.1220 |
- Gate n≥500: **NOT MET**

## NCAAB (separate gates)
- Fetch: ESPN week (week API empty for NBA/WNBA)
- Train n=3597, hold n=3796, used=99, obs=297, games_clustered=99
- Mean runtime/game: 4.9 ms
- p95 runtime/game (proxy mean×1.5): 7.4 ms
| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 297 | 0.2311 | 0.6551 | 0.0894 |
| ml_home | 99 | 0.2133 | 0.6149 | 0.0802 |
| spread_home_-3.5 | 99 | 0.2279 | 0.6466 | 0.1497 |
| total | 99 | 0.2522 | 0.7037 | 0.1369 |
- Gate n≥500: **NOT MET**

- Serve/allowlist unchanged (`SIM_V2_SERVE=off`).