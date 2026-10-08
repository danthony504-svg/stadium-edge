# Phase C.2 — Football player prop chronological OOS

Shadow-only. No serve / allowlist changes.

# Football prop chronological OOS (nfl)

- Holdout label: NFL 2024
- Holdout games attempted: 40
- Games with ESPN leaders: 40
- Settled prop observations: 82
- Draws/game: 2000 (CI contract uses 10000)
- Mean runtime/game: 241.4 ms (proxy; not full p95 bench)
- Serve/allowlist: **off** / empty

| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 82 | 0.1875 | 0.5610 | 0.1117 |
| pass_yds | 40 | 0.3140 | 0.8761 | 0.2497 |
| rush_yds | 20 | 0.0917 | 0.3333 | 0.0931 |
| rec_yds | 22 | 0.0447 | 0.1952 | 0.0355 |

## Notes / defects
- Leader-vs-line is a **proxy** identity (game leader, not named book player). Full name matching remains a blocker.
- Grid lines (−110) are not closing lines (archive not ingested).
- Gate minOosSample=500: **NOT MET** (n=82).
- Production allowlist unchanged.

# Football prop chronological OOS (ncaaf)

- Holdout label: NCAAF 2024 weeks 8–15
- Holdout games attempted: 40
- Games with ESPN leaders: 40
- Settled prop observations: 84
- Draws/game: 2000 (CI contract uses 10000)
- Mean runtime/game: 210.5 ms (proxy; not full p95 bench)
- Serve/allowlist: **off** / empty

| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 84 | 0.1875 | 0.5821 | 0.1270 |
| pass_yds | 40 | 0.3436 | 1.0022 | 0.3113 |
| rush_yds | 26 | 0.0721 | 0.2778 | 0.0228 |
| rec_yds | 18 | 0.0071 | 0.0881 | 0.0843 |

## Notes / defects
- Leader-vs-line is a **proxy** identity (game leader, not named book player). Full name matching remains a blocker.
- Grid lines (−110) are not closing lines (archive not ingested).
- Gate minOosSample=500: **NOT MET** (n=84).
- Production allowlist unchanged.
