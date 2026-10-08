# NHL D.2 chronological OOS (team markets)

Shadow-only. Grid lines (−110), not closing lines.

- Train seasons fetched: 2023 (n=1312), 2024 (n=1312)
- Holdout games used: 80
- Observations: 240
- Mean runtime/game: 2.0 ms

| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 240 | 0.2533 | 0.7020 | 0.0999 |
| ml_home | 80 | 0.2541 | 0.7047 | 0.1262 |
| total_over_5.5 | 80 | 0.2614 | 0.7170 | 0.1018 |
| puck_home_-1.5 | 80 | 0.2444 | 0.6844 | 0.1106 |

- Gate minOosSample=500: **NOT MET** (n=240)
- Serve/allowlist unchanged.