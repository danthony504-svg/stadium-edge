# Slice A results — post-lean fill safe (no period-OD)

## Branch
`cursor/coach-post-lean-fill-safe-def8`

## Live probe (`7 leg NFL`, production API)

| Metric | Value |
|--------|------:|
| Final ticket | **5** |
| Target | 7 |
| Props | 2 |
| Period markets on ticket | 2 (pre-lean staged Q1/1H — not fill-added) |
| Fill-added | 1 × FG `Alt Spread` Buccaneers +21.5 |
| Qualified pool | 108 (period-blocked from fill: 49; FG alts: 53; props: 6) |
| Shortfall copy | `only 5 cleared` (matches final count) |
| Elapsed | ~99s |

Synthetic lean→fill on same pool: **4 → 5**, `addedPeriodBlocked=0`.

Production tip (pre-fix): **2–4**. Lean-preserve only (#649 mid): **4**. Slice A with FG-only fill: **5**.

## Tests
90/90 pass (`postLeanFinalFill`, `mlLeanEnforcement`, `coachPostLeanFillSafe`, shortfall/copy, staging, P0, correlation).

## Excluded from #649
- `d2264203` period-OD alignment
- Period markets from post-lean fill
