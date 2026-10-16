# Finalize two candidates for review

**Date:** 2026-10-16  
**Status:** Ready for review. **No deploy / no OTA / no preview publish executed.** Voice paused. Production freeze armed.

---

## 1. Full SHAs

| Role | Full SHA |
|------|----------|
| **Server candidate tip** | `5cfb614011cf9ca46cdcdd9bacb0e6a23a98569c` |
| Server code fix (cache identity) | `c0094c637747ac69b34cdeb24afe5e818270b45f` |
| Server base = **live Render** | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` |
| **Mobile candidate tip** | `6416d4cf61ebe111e17d0b82dc8b046f9921be34` |
| Mobile last code commit | `c55d99c39465afaf59bbffc41dedf60d4368e787` |
| Mobile base = **prod OTA baseline** | `b666165e8d21c85222ab2ff874b538394efac66a` |
| Verified engine stamp | **`ppg-per-drive-v1`** (preserved on server lineage) |
| Branches | `cursor/prop-dist-cache-identity-8b51` · `cursor/mobile-peropp-stamp-8b51` |

---

## 2. Exact runtime diffs

### Server (`ddeb4733` → tip) — api-server + docs

**Code-only (`c0094c63`):** **+295 / −9** across **7 files**

| File | +/− |
|------|-----|
| `monteCarlo.ts` | +6/−0 |
| `monteCarloBuild.ts` | +19/−1 |
| `propDistributionCache.ts` | +48/−3 |
| `propSharedDistribution.ts` | +12/−0 |
| `propSimCtxCache.ts` | +1/−0 |
| `propSimRunner.ts` | +7/−5 |
| `test/propDistributionCache.test.ts` | +202/−0 |

**Tip including docs:** **+439 / −9** (adds `docs/coach/two-candidate-verify.md` +67, `isolated-pair-verify.md` +77).

**Runtime (non-test) only:** +93/−9 · **Tests:** +202/−0 · **Docs:** +144/−0 · sum adds 93+202+144=**439** ✓

### Mobile (`b666165e` → tip)

**Grand tip:** **+2778 / −112** across **28 files**

| Category | +add | −del | Files | Reconcile |
|----------|------|------|-------|-----------|
| **Runtime** | **1372** | **111** | 14 | TS only, no `.test.` / `.md` |
| **Tests** | **941** | **1** | 9 | `*.test.ts` |
| **Docs** | **465** | **0** | 5 | `.md` under scripts/ + docs/coach |
| **Sum** | **2778** | **112** | **28** | 1372+941+465=2778; 111+1+0=112 ✓ |

**Prior “+2634/−112”:** tip before `two-candidate-verify.md` (+67) and `isolated-pair-verify.md` (+77).  
2634 + 67 + 77 = **2778** ✓ (same −112).

**Runtime file list (+1372/−111):**

| File | +/− |
|------|-----|
| `propContextPipeline.ts` | +532/−0 |
| `boardMarketScanner.ts` | +225/−5 |
| `coachAskSportScope.ts` | +156/−0 |
| `api.ts` | +102/−48 |
| `coachP0UnvalidatedTotals.ts` | +95/−5 |
| `gameSimEngineVersion.ts` | +85/−0 |
| `buildParlay.ts` | +63/−6 |
| `pickScoreContext.ts` | +34/−1 |
| `gameSimScoring.ts` | +31/−2 |
| `coachReliabilityClassify.ts` | +19/−1 |
| `coachGameMonteCarlo.ts` | +16/−42 |
| `propHolisticRecommendation.ts` | +10/−0 |
| `coachScanFailureReason.ts` | +3/−1 |
| `sanitizeCoachUserNote.ts` | +1/−0 |

**Confirmed absent from diff:** voice / speech / STT / TTS / expo-av · passkey · home shortcut UI.

---

## 3. Closed audit questions

### 3.1 MLB roof / indoor handling

| Input | Effect on prop MC `weatherImpact` |
|-------|-----------------------------------|
| `env.climateControlled === true` | **null** (no outdoor effect) |
| `env.park.dome === true` | **null** |
| Client board path | If park `dome`, weather blob set **null** and `climateControlled: true` stamped (`api.ts` mlbGameEnv build) |
| `MLB_PARKS[].dome` | Static reference: **fixed and retractable** roofs marked `dome: true` → treated weather-neutral |

**Evidence:** dome/climateControlled → null; outdoor hot → +0.45 (`injury-projection-up-down.json` / `propContextPipeline.test.ts`).

**UNSUPPORTED:** open-roof / roof-open-today branch for retractable parks — not implemented; retractables always indoor-neutral via `dome: true`.

### 3.2 Actual field / surface inputs

| Input | Where | Enters prop MC? |
|-------|-------|-----------------|
| **Venue H/A series** (`homeValues` / `awayValues` / recent venue) | Server `computeVenueShift` → `venueFamilyMult` | **Yes — distribution** |
| **MLB park `hrIndex`** | Nudges MLB `weatherImpact` score only | **Yes — via weatherImpact** (outdoor only) |
| **MLB `altitudeFt` / lat/lon** | Park metadata / weather fetch | Not a direct mean multiplier |
| **Football `surface` turf/grass** | `footballScanContext.surfaceFromParkName` heuristic | **No — display/holistic only** |
| **Football dome / climateControlled** | Same env merge | Holistic weather bits; prop MC weather null for NFL |

### 3.3 Injury adjustments — up and down, no double-count

Server `buildProjectionMean`:

```
mean *= clamp(1 + oppInj*0.015 - ownInj*0.02, 0.88, 1.12)
ownInj := 0 when opportunitySuppressOwnInjuries
```

Measured (same recentValues):

| Case | Mean | Direction |
|------|------|-----------|
| Neutral (0/0) | 11.38 | — |
| Opp injuries = 4 | **12.06** | **up** |
| Own injuries = 4 | **10.47** | **down** |
| Opp Shift owns + ownInj=4 suppressed | 12.518 | equals Opp Shift with ownInj=0 (**no double-count**) |

`keyInjuryWeight`: OUT/doubtful +2, questionable/day-to-day +1.  
Opp Shift vacancy already in `opportunityFamilyMult` → `suppressOwnKeyInjuries` skips own scalar.

**History:** vs-opp / season series already in fingerprint; injury scalars are separate additive context (re-keyed in server candidate cache). Not re-applied as post-sim tilt when projection owns defense.

### 3.4 Unsupported effects (explicit)

| Effect | Status |
|--------|--------|
| NFL/NCAAF prop MC weather | **Unsupported** (holistic only; `proposeFootballWeatherImpact` not live) |
| Retractable roof open/closed for MLB | **Unsupported** (always dome-neutral) |
| Football turf/grass in prop MC | **Unsupported** (display/holistic) |
| Football game-line weather/injury in `nflDriveSim` draws | **Unsupported** |
| Invent “healthy” from missing injury row | **Forbidden** |
| Flip `NCAAF_GAME_LINE_SIM_VALIDATED` | **Forbidden** until Phase E |

---

## 4. Prepare server deployment (not executed)

**Candidate:** `5cfb614011cf9ca46cdcdd9bacb0e6a23a98569c` (or merge `c0094c63` + docs).  
**Preserves:** `ppg-per-drive-v1`, existing Render behavior outside prop dist cache keys.

### Pre-deploy checklist
1. Confirm live still `ddeb4733` + stamp `ppg-per-drive-v1`
2. CI green on server candidate branch
3. Re-run `propDistributionCache` tests (boost≠suppress, reuse, missing≠supplied)
4. Smoke harness or staging: identical context cache hit; boost/suppress diverge
5. **Do not** ship tip hard-cap `nflDriveSim` lineage

### Deploy steps (when authorized)
1. Merge/promote server candidate to the Render deploy branch used for production
2. Deploy Render service; wait healthy `/api/healthz`
3. Verify `deploymentSha` == promoted SHA; NFL game-outcome `engineVersion` still `ppg-per-drive-v1`
4. Prop smoke: boost then suppress → different means; second identical → cached

### Rollback plan
1. Redeploy previous SHA **`ddeb4733348b98d7112748edc19c7e06fc6fc99a`**
2. Confirm healthz SHA + stamp `ppg-per-drive-v1`
3. Accept temporary return of defenseIndex cache collision until re-fix
4. No mobile OTA required for server-only rollback

---

## 5. Prepare preview-mobile export (not executed)

**Candidate:** `6416d4cf61ebe111e17d0b82dc8b046f9921be34`  
**Channel:** `preview` (`eas.json` profile `preview`) · points at `stadium-edge.onrender.com`  
**Prefer:** server candidate already live so per-opp defense + stamp reject align

### Pre-export checklist
1. `NCAAF_GAME_LINE_SIM_VALIDATED === false`
2. No voice/STT/TTS in diff
3. Passkey guards unchanged vs `b666165e`
4. Unit suites: prop defense, stamp, college honesty, passkeys
5. Prefer server deploy **before** or **with** preview so stamp + cache identity match

### Export / preview publish steps (when authorized)
1. Check out mobile tip; `eas build --profile preview` **or** `eas update --channel preview` if runtime matches installed preview binary
2. Record update group / build id in `docs/coach/`
3. Device smoke: NFL props both sides; college ask honesty empty; stamp reject path (unstamped draw dropped)

### Rollback plan
1. Republish previous preview update group **or** install prior preview tip `b666165e` / last good preview OTA recorded in docs
2. Production channel untouched (freeze still armed; this plan is preview-only)
3. If paired with server deploy and only mobile rolls back: server cache fix remains safe alone

### Production
**.ota-production-freeze** stays armed — **no production OTA** in this plan.

---

## 6. Invariants (still held)

- `FOOTBALL_DRIVE_ENGINE_VERSION` / live stamp **`ppg-per-drive-v1`**
- `NCAAF_GAME_LINE_SIM_VALIDATED = false`
- Voice paused
- Production freeze armed
- **No deploy or OTA performed in this session**
