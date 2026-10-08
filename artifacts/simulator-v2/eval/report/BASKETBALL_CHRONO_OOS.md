# Basketball E.2 chronological OOS

Shadow-only. Separate sport sections — NBA pass does not enable WNBA/NCAAB.

## NBA (separate gates)
- Train n=0, hold n=0, used=0, obs=0
- Mean runtime/game: 0.0 ms
| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 0 | n/a | n/a | n/a |
| ml_home | 0 | n/a | n/a | n/a |
| spread_home_-3.5 | 0 | n/a | n/a | n/a |
| total | 0 | n/a | n/a | n/a |
- Gate n≥500: **NOT MET**

## WNBA (separate gates)
- Train n=0, hold n=0, used=0, obs=0
- Mean runtime/game: 0.0 ms
| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 0 | n/a | n/a | n/a |
| ml_home | 0 | n/a | n/a | n/a |
| spread_home_-3.5 | 0 | n/a | n/a | n/a |
| total | 0 | n/a | n/a | n/a |
- Gate n≥500: **NOT MET**

## NCAAB (separate gates)
- Train n=3597, hold n=3796, used=60, obs=180
- Mean runtime/game: 5.2 ms
| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 180 | 0.2351 | 0.6619 | 0.0903 |
| ml_home | 60 | 0.2142 | 0.6134 | 0.0894 |
| spread_home_-3.5 | 60 | 0.2262 | 0.6412 | 0.1926 |
| total | 60 | 0.2649 | 0.7312 | 0.2315 |
- Gate n≥500: **NOT MET**
