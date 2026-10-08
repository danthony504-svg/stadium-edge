# @workspace/simulator-v2 (Phase A)

Isolated, versioned simulation platform for Stadium Edge.

**Phase A scope:** schemas, deterministic seeding, joint scenario tensor format, settle + alt-line batching, validation, shadow ledger, calibration metrics, feature flags, acceptance gates.

**Not in Phase A:** sport-specific generative models (NFL/NBA/…), Coach UI changes, P0 removal, production serve.

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
```
