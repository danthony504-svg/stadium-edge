# Paired release candidates — greenfield-179224 incident (2026-10-17)

**No server deploy / no OTA.** Production freeze armed. NCAAF blocked. Voice paused.

## Baselines (not main)

| Role | Full SHA |
|------|----------|
| **Live server baseline** | `e607f131898daebaecd08602558905b96f738122` |
| **Server candidate tip** | `ec2315920b845ec2d290b3e6eceb0a33c55624e0` |
| **Preview mobile baseline** | `54b89f32efc81fe3cf56cee50388816054484600` |
| **Mobile candidate tip** | `fd602b1103e319aec44a4fc27153144ae7e54694` |
| **Preview export launch hash** | `PCCfHTkp_N-E1A91qV14n84QEjdGPXvdzEPmMkm5Mw4` |
| **Export baked commit** | `fd602b1103e319aec44a4fc27153144ae7e54694` (`EXPO_PUBLIC_GIT_COMMIT`) |
| Branches | `cursor/server-rc-incident-3645` · `cursor/mobile-rc-incident-3645` |

## Preserved from baselines

| Layer | Preserved |
|-------|-----------|
| Server | Opponent-cache `defenseIndex` identity; `ppg-per-drive-v1` / `gameSimEngineVersion`; digest denominator |
| Mobile | Delivery-commit (`deliveryCommitted`); stamp reject (`gameDrawEngineAccepted`); opponent context pipeline |

## Incident ports

Delivery grounding gate; MLB abbr cover-query bind; finite matching-side ML fallback (never default 0.5 / opposite side); `GAME_SIMS_STAMP_REJECTED`; reliability enrichment fields.

## Diffs vs baselines

### Server (`e607f131` → tip): 5 files, +259 / −7

### Mobile (`54b89f32` → tip): 23 files, +1440 / −34

## Verification

| Suite | Result |
|-------|--------|
| Mobile incident regression (E2E/abbr/stamp/delivery/reporter/scoring) | **67/67** |
| Server coachReliability | **18/18** |
| Server propDistributionCache (+ reliability combined) | **28/28** |
| Preview export | `expo export --platform ios` → launch hash `PCCfHTkp_N-E1A91qV14n84QEjdGPXvdzEPmMkm5Mw4` (**not published**) |

## Preview publish (when authorized — not executed)

```bash
export EXPO_PUBLIC_GIT_COMMIT=fd602b1103e319aec44a4fc27153144ae7e54694
pnpm exec expo export --platform ios --output-dir dist
# confirm launch hash == PCCfHTkp_N-E1A91qV14n84QEjdGPXvdzEPmMkm5Mw4
pnpm exec eas update --channel preview --platform ios \
  --skip-bundler --input-dir dist \
  --message "incident RC fd602b1103e319aec44a4fc27153144ae7e54694"
```
