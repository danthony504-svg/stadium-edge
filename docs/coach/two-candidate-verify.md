# Two isolated candidates — verify report

**Date:** 2026-10-16  
**Constraints:** NCAAF gate false · voice paused · production freeze armed · **no deploy / no OTA**

## Full SHAs

| Candidate | Branch | Full SHA | Base |
|-----------|--------|----------|------|
| **Server** dist-cache identity | `cursor/prop-dist-cache-identity-8b51` | `c0094c637747ac69b34cdeb24afe5e818270b45f` | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` (live Render) |
| **Mobile** per-opp + stamp | `cursor/mobile-peropp-stamp-8b51` | `c55d99c39465afaf59bbffc41dedf60d4368e787` | `b666165e8d21c85222ab2ff874b538394efac66a` (prod OTA) |

Live Render (unchanged): `ddeb4733348b98d7112748edc19c7e06fc6fc99a` · stamp `ppg-per-drive-v1`.

## Release diffs

### Server (`ddeb4733` → `c0094c63`) — 7 files, +295/−9

- `propSharedDistribution.ts` — `defenseIndex` + `coupledReceivingMatchup` in shared key (null → empty slot)
- `propDistributionCache.ts` — fingerprint includes defenseIndex, pace, injuries, weather, pre-sim mults, suppress flags, isHome
- `monteCarlo.ts` / `monteCarloBuild.ts` / `propSimCtxCache.ts` / `propSimRunner.ts` — wire defense into ctx + recompute fingerprint after rebuild
- `test/propDistributionCache.test.ts` — boost≠suppress, identical reuse, missing≠supplied

**Preserved:** `FOOTBALL_DRIVE_ENGINE_VERSION = "ppg-per-drive-v1"` (no drive-engine file edits).

### Mobile (`b666165e` → `c55d99c3`) — 26 files, +2634/−112

- Per-opp defenseIndex: `propContextPipeline.ts`, `boardMarketScanner.ts`, `api.ts`, `pickScoreContext.ts`, tests
- Stamp reject: `gameSimEngineVersion.ts(+test)`, `coachGameMonteCarlo.ts`, `gameSimScoring.ts(+test)`
- College honesty (gate still **false**): `coachP0UnvalidatedTotals*`, `buildParlay*`, `coachAskSportScope.ts`, college audit
- **Untouched vs base:** `passkeyAuth.ts`, passkey tests; no home/shortcut UI; no voice; no api-server

## Tests

| Suite | Result |
|-------|--------|
| Server `propDistributionCache` + `propSimCtxCache` (+ nflDrive caps in same run) | **25 pass / 0 fail** |
| Mobile prop defense, stamp, pipeline, coachP0, college, passkeys | **75 pass / 0 fail** (filtered set; earlier full mobile suite 85/85) |
| Server cache identity integration script | boost/suppress/missing keys distinct; identical reuses; stamp still ppg-v1 |
| Cross-candidate stamp/key check | mobile accepts live `ppg-per-drive-v1`; rejects missing/wrong; opp keys distinct |

## Integration between exact candidates

1. **Mobile → server contract:** per-opp batches send one `defenseIndexByFamily` per `game@@opp:teamId`; server candidate keys dist by resolved scalar `defenseIndex` (+ other projection inputs).  
2. **Stamp:** mobile `COACH_GAME_SIM_ENGINE_VERSION=ppg-per-drive-v1` accepts live game-outcome; server candidate still emits that stamp.  
3. **Live caveat:** Render has **not** received the cache-identity fix yet — boost/suppress collision remains on production until server candidate deploys. Local unit/integration prove the fix on `c0094c63`.

## Full Coach scan cold/warm (not subset)

Measured on **mobile candidate** `c55d99c3` via `buildCoachParlay({ askText: "5 leg", requestedLegs: 5 })` against live API (`EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com`, `COACH_QA_RUN_PERF_MEASURE=1`).

| Pass | Wall | Legs | Notes |
|------|------|------|-------|
| **Cold** | **62 912 ms** | 5 | cache cleared; propPool posted 2612; gameSim stage ~78.6s miss wall (parallel accounted in wall) |
| **Warm** | **25 834 ms** | 5 | **188** context cache hits |

Baselines in harness: phase1 51.3s/20.3s; pre-phase2 42s/27.7s.

Artifact: `/opt/cursor/artifacts/coach-phase2-perf-measure.json`

## Explicit non-actions

- No Render deploy of server candidate  
- No OTA of mobile candidate  
- `.ota-production-freeze` remains armed  
- `NCAAF_GAME_LINE_SIM_VALIDATED=false`  
- Voice paused  
