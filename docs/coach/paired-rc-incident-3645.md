# Paired release candidates — greenfield-179224 incident (2026-10-17)

**No server deploy / no OTA.** Production freeze armed. NCAAF blocked. Voice paused.

## Baselines (not main)

| Role | Full SHA |
|------|----------|
| **Live server baseline** | `e607f131898daebaecd08602558905b96f738122` |
| **Server candidate tip** | `4afe0cae040fbb968ff89a31ccfe841985a6d8e3` |
| **Preview mobile baseline** | `54b89f32efc81fe3cf56cee50388816054484600` |
| **Mobile candidate tip** | `176c3f131ddb26303e0588d5b3e0a111369d26a5` |
| **Preview export launch hash** | `A2T7XAuvveHL3vg2GKJ7QGUfLC3CEBhZcV1wjDOM1Qw` |
| Branches | `cursor/server-rc-incident-3645` · `cursor/mobile-rc-incident-3645` |

## Preserved from baselines

| Layer | Preserved |
|-------|-----------|
| Server | Opponent-cache `defenseIndex` identity (`propDistributionCache`); `ppg-per-drive-v1` / `gameSimEngineVersion`; digest denominator |
| Mobile | Delivery-commit success counting (`deliveryCommitted`); stamp reject (`gameDrawEngineAccepted`); opponent context pipeline (`propContextPipeline`) |

## Incident ports (this pair)

Delivery grounding gate; MLB abbr cover-query bind; finite matching-side ML fallback (never 0.5 / opposite); `GAME_SIMS_STAMP_REJECTED` split; reliability enrichment (`updateId`/`channel`/`bakedSha`/`requestScope`/`candidateIds`/`gameIds`/`simFailureReason`).

## Diffs vs baselines

### Server (`e607f131` → tip)

```
4 files, +197 / −7
coachReliabilityIngest.ts, Sanitize.ts, Store.ts, docs/coach/server-rc-incident-3645.md
```

### Mobile (`54b89f32` → tip)

```
22 files, +1378 / −34
(delivery gate, abbr bind, stamp split, enrichment, E2E fixtures, docs)
```

## Verification

| Suite | Result |
|-------|--------|
| Mobile E2E + grounding/stamp/delivery/reporter/scoring | **67/67 pass** |
| Server coachReliability | **18/18 pass** |
| Server propDistributionCache (defenseIndex) | **10 cases in combined 28/28** |
| ML fallback | TB ML → `awayWinProbability` only; missing/wrong stamp → null |
| Preview export | `expo export --platform ios`; launch hash `A2T7XAuvveHL3vg2GKJ7QGUfLC3CEBhZcV1wjDOM1Qw` (**not published**) |

## Preview publish (when authorized — not executed)

```bash
export EXPO_PUBLIC_GIT_COMMIT=176c3f131ddb26303e0588d5b3e0a111369d26a5
pnpm exec expo export --platform ios --output-dir dist
# verify launch hash == A2T7XAuvveHL3vg2GKJ7QGUfLC3CEBhZcV1wjDOM1Qw
pnpm exec eas update --channel preview --platform ios \
  --skip-bundler --input-dir dist \
  --message "incident RC 176c3f131ddb26303e0588d5b3e0a111369d26a5"
```
