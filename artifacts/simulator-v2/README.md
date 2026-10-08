# @workspace/simulator-v2 (Phase B)

Isolated, versioned simulation platform for Stadium Edge.

**Phase A:** schemas, deterministic seeding, joint scenario tensor format, settle + alt-line batching, validation, shadow ledger, calibration metrics, feature flags, acceptance gates.

**Phase B:** joint NFL/NCAAF football model — one draw yields FG + Q1–Q4 + H1/H2 with exact period→FG conservation. Shadow diagnostics only under default flags.

**Not in Phase B:** Coach UI changes, P0 removal, production serve, OTA publish, other sports.

## Joint football model

| Property | Value |
|----------|--------|
| `modelId` | `football.joint.phase_b` |
| Sports | `nfl`, `ncaaf` |
| Families | `ml`, `spread`, `total`, `team_total` |
| Periods | `fg`, `q1`, `q2`, `q3`, `q4`, `h1`, `h2` |
| Conservation | `Q1+Q2+Q3+Q4 = H1+H2 = FG` per draw |
| RNG | Mulberry32 from string seed |

Periods are the generative process (Poisson quarter scoring + shared pace). There is **no** independent period probability overwrite that breaks joint consistency (the V1 failure mode).

## Defaults (safe)

| Flag | Default | Effect |
|------|---------|--------|
| `SIM_V2_ENABLED` | off | Master kill switch |
| `SIM_V2_SHADOW_ONLY` | on | Diagnostics only |
| `SIM_V2_SERVE` | off | No V2 hits to Coach |
| `SIM_V2_ACCEPTED_FAMILIES` | empty | No sport:family allowlist |
| `SIM_V2_FORCE_V1` | off | Emergency rollback clears serve/allowlist |

`selectProductionSimResult` + `resolveCoachSimHit` always return V1 under these defaults.

## Tests

```bash
pnpm --filter @workspace/simulator-v2 test
pnpm --filter @workspace/simulator-v2 typecheck
```
