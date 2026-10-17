# Paired release candidates — greenfield-179224 incident (2026-10-17)

**No server deploy / no OTA.** Production freeze armed. NCAAF blocked. Voice paused.

## Baselines (not main)

| Role | Full SHA |
|------|----------|
| **Live server baseline** | `e607f131898daebaecd08602558905b96f738122` |
| **Server candidate tip** | `d6d091aba9ff2c10a9b15a2de216e3038399430e` |
| **Preview mobile baseline** | `54b89f32efc81fe3cf56cee50388816054484600` |
| **Mobile candidate tip** | `(see post-commit tip; export re-baked after this docs sync)` |
| **Preview export launch hash** | `(re-baked after docs sync — see artifacts/paired-rc-report.json)` |
| Branches | `cursor/server-rc-incident-3645` · `cursor/mobile-rc-incident-3645` |

## Preserved from baselines

| Layer | Preserved |
|-------|-----------|
| Server | Opponent-cache `defenseIndex` identity; `ppg-per-drive-v1` / `gameSimEngineVersion`; digest denominator |
| Mobile | Delivery-commit (`deliveryCommitted`); stamp reject (`gameDrawEngineAccepted`); opponent context pipeline |

## Incident ports

Delivery grounding gate; MLB abbr cover-query bind; finite matching-side ML fallback (never default 0.5 / opposite side); `GAME_SIMS_STAMP_REJECTED`; reliability enrichment fields.

## Diffs vs baselines

### Server (`e607f131` → tip)

5 files changed, +259/−7 (reliability enrichment + docs) at code tip before docs churn; current tip includes this paired report.

### Mobile (`54b89f32` → tip)

23 files changed, +1440/−34 (delivery gate, abbr bind, stamp split, enrichment, E2E, docs).

## Verification

| Suite | Result |
|-------|--------|
| Mobile incident regression | **67/67** |
| Server coachReliability | **18/18** |
| Server propDistributionCache (+ reliability) | **28/28** |
| ML fallback | TB ML uses `awayWinProbability` only; CLE +1.5 home; stamp reject null |
| Preview export | Recorded in `/opt/cursor/artifacts/paired-rc-report.json` after final bake |

## Preview publish (when authorized — not executed)

```bash
export EXPO_PUBLIC_GIT_COMMIT=<mobileCandidate tip>
pnpm exec expo export --platform ios --output-dir dist
pnpm exec eas update --channel preview --platform ios \
  --skip-bundler --input-dir dist \
  --message "incident RC <mobileCandidate tip>"
```
