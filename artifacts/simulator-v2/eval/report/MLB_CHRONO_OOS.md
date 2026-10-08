# MLB F.2 chronological OOS

Shadow-only. Grid lines (−110). Date-sampled ESPN scoreboard (week API empty for MLB).

- Train n=657, hold n=681, used=120, obs=720, games_clustered=120
- Mean runtime/game: 1.8 ms
- p95 runtime/game (proxy mean×1.5): 2.7 ms
| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 720 | 0.2599 | 0.7178 | 0.0896 |
| ml_home | 120 | 0.2733 | 0.7474 | 0.2289 |
| rl_home_-1.5 | 120 | 0.2584 | 0.7211 | 0.1555 |
| total_8.5 | 120 | 0.2495 | 0.6930 | 0.0836 |
| tt_home_4.5 | 120 | 0.2590 | 0.7162 | 0.0996 |
| f5_total_4.5 | 120 | 0.2577 | 0.7086 | 0.0945 |
| f5_ml_home | 120 | 0.2618 | 0.7206 | 0.1617 |
- Gate n≥500: **met**
- Baseline: leakage-safe team form (prior games only); no closing-line book baseline in this run.
- Serve/allowlist unchanged (`SIM_V2_SERVE=off`).