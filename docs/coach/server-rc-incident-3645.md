# Server RC — incident 3645

## Base

Branch `cursor/server-rc-incident-3645` starts at **`e607f131`** (`docs(coach): resume release review with paired candidate SHAs`).

That tip already carries opponent-cache / stamp / digest reliability work, including:

- `gameSimEngineVersion` / stamp acceptance in `artifacts/api-server/src/lib/sportSim/gameSimEngineVersion.ts`
- `defenseIndex` in `propHistoryFingerprint` (`artifacts/api-server/src/lib/propDistributionCache.ts`)
- Digest aggregation via `coachReliabilityDigest` (kept; not reverted)

## What changed (this RC)

Ported **client reliability enrichment** from workspace tip `676f941d` into the coach reliability ingest/store path **without** removing the e607f131 stamp/digest/opponent-cache fixes.

| File | Change |
|------|--------|
| `coachReliabilityIngest.ts` | `parseEnrichment` (`updateId`, `channel`, `bakedSha`, `requestScope`, `candidateIds`, `gameIds`, `simFailureReason`); `COACH_EVENT_MAX_BODY_BYTES` → `8192` |
| `coachReliabilitySanitize.ts` | Enrichment fields on `CoachReliabilityMeta` + serialize/parse; `GAME_SIMS_STAMP_REJECTED` → `missing_sim_output` in `mapScanFailureCode` |
| `coachReliabilityStore.ts` | `RecordCoachEventInput` + `buildMeta` enrichment; insert prefers client `updateId` / `channel` / `bakedSha` (fallback `server` / `api`) |

## Explicitly not changed

- NCAAF tuning / phase work
- Digest rewrite that inlines stats and drops `coachReliabilityDigest` (workspace-only drift)
- Opponent-cache, stamp, or `defenseIndex` fingerprint behavior

## Source

Enrichment behavior matched from `/workspace` at `676f941d`.
