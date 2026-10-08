# Basketball milestone E.2 — Full team markets + combos (shadow)

## Coverage
- ML, spread, totals, team totals (FG + period where league allows)
- Props: points/reb/ast/threes (+alts), PRA/PR/PA/RA, points_q1 (NBA/WNBA only)
- NCAAB: halves only — quarter markets throw

## Gates
NBA / WNBA / NCAAB keep separate `sport:family` keys and OOS sections.

## Blockers
- Chrono n may be <500; ECE may exceed 0.04
- Closing lines; named player prop OOS
