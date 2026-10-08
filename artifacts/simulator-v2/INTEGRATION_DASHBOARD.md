# Simulator V2 — Integration Dashboard

**Updated:** 2026-10-08  
**Policy:** `SIM_V2_SERVE=off` · `SIM_V2_ACCEPTED_FAMILIES=[]` · Coach/P0 unchanged · PR #649 HOLD · no deploy/OTA  
**Acceptance:** No model merges to production serve without a separate review.

| Stream | Branch | PR | Milestone | Markets complete (shadow) | Missing deps | Unit tests | Chrono OOS / gates | Prod ready |
|--------|--------|-----|-----------|---------------------------|--------------|------------|--------------------|------------|
| Football B+C | `cursor/simulator-v2-phase-b-correct-def8` | #651 | **C.1** props on joint tensor | FG/Q/H ml-spread-total-tt; core skill props + alt ladder builders | Prop chrono OOS ≥500; DST/QH props; Coach path audit | footballJoint + footballPlayerProps | B holdout partial; C calib **N** | **N** |
| Hockey | `cursor/sim-v2-nhl-scaffold-def8` | #653 | **D.1** joint P1–P3 + props | ml/total + goals/ast/pts/sog (+ alt keys) | Spread/team_total builders; hist OOS; OT/SO layer | hockeyJoint | **N** | **N** |
| Basketball | `cursor/sim-v2-basketball-scaffold-def8` | #652 | **E.1** joint Q/H + props | totals + points/reb/ast/threes alts; NBA/WNBA/NCAAB params | ml/spread builders; per-sport OOS | basketballJoint | **N** | **N** |
| Baseball | `cursor/sim-v2-mlb-scaffold-def8` | #654 | **F.1** F5⊆FG + props | FG/F5 totals; batter/pitcher props + alts | Spread/ML; starter confirmation features; OOS | baseballJoint | **N** | **N** |
| Soccer | — | — | P2 contract pending | — | League settlePaths; BTTS/DNB/DC; sparse props | — | — | **N** |
| Tennis | — | — | P2 contract pending | — | Set/game coupling; dynamic keys | — | — | **N** |
| Combat | — | — | P2 contract pending | — | Method×rounds exclusion | — | — | **N** |
| Backlog | — | — | P3 | tabletennis / cricket / golf | Real data + markets | — | — | **N** |
| Foundation | *(this dashboard + settle period defaults + shadow registry)* | via #651 / sport PRs | — | — | Closing-line ingest (license) | coverageMatrix | — | **N** |

## Performance notes (milestone targets)

| Stream | Draws in CI contract | Markets simulated in milestone tests | Resource note |
|--------|----------------------|--------------------------------------|---------------|
| Football C.1 | 10_000 | 1 game tensor + 3-rung pass-yds ladder + batch alts | Props attach O(players×draws) |
| NHL D.1 | 10_000 | FG total + 1 SOG alt prop | Period conservation checked |
| Basketball E.1 | 10_000 (NBA) | 1 points alt; WNBA/NCAAB smoke | Separate sport means |
| MLB F.1 | 10_000 | F5 total + hits alt | F5≤FG asserted |

## Blockers (cross-cutting)

1. Closing-line archive not ingested (design only) — market-implied baselines unavailable.
2. Production allowlist must stay empty until per-`sport:family` acceptance review.
3. Coach qualification / correlation / no-filler remain V1 — V2 only supplies shadow settle today.
4. PR #649 remains HOLD (unvalidated period spreads).
