# Football milestone C.1 — Joint player props (shadow)

## Files
- `src/models/football/playerProps.ts` — attach skill stats to Phase B tensor
- `src/models/football/markets.ts` — `buildFootballPlayerPropMarket`, alt ladder, `PHASE_C_FOOTBALL_FAMILIES`
- `src/validation/modelSupportRegistry.ts` — shadow settle includes `player_prop`
- `test/footballPlayerProps.test.ts`

## Tests
- 10k draws + Q/H conservation after prop attach
- Main + `_alternate` ladder settle with real American odds
- Missing player → unsupported; default flags → Coach V1

## Blockers
- Chrono OOS for `nfl:player_prop` / `ncaaf:player_prop` (n≥500)
- DST / QH prop columns
- End-to-end Coach eligibility audit (no wiring yet)
- Acceptance review before any allowlist entry
