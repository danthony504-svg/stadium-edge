# Phase C.2 — Football player prop chronological OOS

Shadow-only. No serve / allowlist changes.

# Football prop chronological OOS (nfl)

- Holdout label: NFL 2024
- Holdout games attempted: 40
- Games with ESPN leaders: 0
- Settled prop observations: 0
- Draws/game: 2000 (CI contract uses 10000)
- Mean runtime/game: 216.3 ms (proxy; not full p95 bench)
- Serve/allowlist: **off** / empty

| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 0 | n/a | n/a | n/a |
| pass_yds | 0 | n/a | n/a | n/a |
| rush_yds | 0 | n/a | n/a | n/a |
| rec_yds | 0 | n/a | n/a | n/a |

## Notes / defects
- Leader-vs-line is a **proxy** identity (game leader, not named book player). Full name matching remains a blocker.
- Grid lines (−110) are not closing lines (archive not ingested).
- Gate minOosSample=500: **NOT MET** (n=0).
- Production allowlist unchanged.

# Football prop chronological OOS (ncaaf)

- Holdout label: NCAAF 2024 weeks 8–15
- Holdout games attempted: 40
- Games with ESPN leaders: 0
- Settled prop observations: 0
- Draws/game: 2000 (CI contract uses 10000)
- Mean runtime/game: 226.2 ms (proxy; not full p95 bench)
- Serve/allowlist: **off** / empty

| Slice | n | Brier | LogLoss | ECE |
|-------|---|-------|---------|-----|
| overall | 0 | n/a | n/a | n/a |
| pass_yds | 0 | n/a | n/a | n/a |
| rush_yds | 0 | n/a | n/a | n/a |
| rec_yds | 0 | n/a | n/a | n/a |

## Notes / defects
- Leader-vs-line is a **proxy** identity (game leader, not named book player). Full name matching remains a blocker.
- Grid lines (−110) are not closing lines (archive not ingested).
- Gate minOosSample=500: **NOT MET** (n=0).
- Production allowlist unchanged.
