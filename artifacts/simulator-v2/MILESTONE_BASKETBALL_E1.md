# Basketball milestone E.1 — Joint Q/H + props (shadow)

## Files
- `src/models/basketball/jointBasketball.ts`
- `src/models/basketball/markets.ts`
- `src/models/basketball/priors.ts`
- `test/basketballJoint.test.ts`

## Tests
- NBA 10k draws, Q1–Q4 + derived H1/H2 conservation
- NCAAB halves conservation; WNBA own sport params
- Settle points `_alternate` with provider odds

## Blockers
- Per-sport chrono OOS; ml/spread builders; independent WNBA/NCAAB acceptance
