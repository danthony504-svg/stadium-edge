# Production-mobile export bake — `54b89f32` (prep only, **not published**)

**Status:** EXPORT COMPLETE — freeze remains **armed** — **no production OTA**  
**Date:** 2026-10-17  
**Source tip:** preview-verified `54b89f32efc81fe3cf56cee50388816054484600`  
**Preview proof (export-equivalent):** update `01a146ed…` / hash `2ecBllWhtHVRT39CG_l8QAjlaiZMyZzlC54riVre4XM`

---

## Final bake identity

| Field | Value |
|------|--------|
| **Final SHA (forced bake)** | `54b89f32efc81fe3cf56cee50388816054484600` |
| **Launch hash (EAS file SHA256)** | `LdbIL3-seClcRehUomUTx6MHBX0huNbxEl3TFPI3VeE` |
| **Bundle** | `entry-d3077c65b8b7d897d934bbfe6288d32b.hbc` (9,551,781 bytes) |
| **contentSha256** | `2dd6c82f7fac78295c45e854a26513c7a307057d21b8d6f1125dd314f23755e1` |
| **Runtime** | `1.1.0` · iOS · **App Store Build 78** compatible (same runtime; `app.json` buildNumber `79` is next native only) |
| **Publish** | **NOT PUBLISHED** |
| **Freeze** | `.ota-production-freeze` **armed** |

Production bake **differs** from preview hash `2ecBll…` because production profile forces `EXPO_PUBLIC_OTA_BOOTSTRAP=true` and `EXPO_PUBLIC_OTA_USER_BANNER=true` (preview left those unset). Do not treat preview hash as the production launch asset.

---

## Production-configured env (forced)

| Var | Value |
|-----|--------|
| `EXPO_PUBLIC_GIT_COMMIT` | `54b89f32efc81fe3cf56cee50388816054484600` (full SHA) |
| `EXPO_PUBLIC_APP_REVIEW_MODE` | `false` |
| `EXPO_PUBLIC_OTA_BOOTSTRAP` | `true` |
| `EXPO_PUBLIC_OTA_USER_BANNER` | `true` |
| `EXPO_PUBLIC_DOMAIN` | `stadium-edge.onrender.com` |
| Clerk | `pk_test_…` (same as eas.json production) |

Artifact checks: `/opt/cursor/artifacts/production-export-54b89f32-checks.json`  
Dist (for future `--skip-bundler --input-dir`): `/opt/cursor/artifacts/production-export-54b89f32-dist`

---

## Included fixes (runtime `b666165e` → `54b89f32`)

| Commit | Fix |
|--------|-----|
| `2047571c` | Prop defense/weather into projection |
| `ecaed343` | College honesty empty path (P0; gate **false**) |
| `6309a532` | Per-opponent `defenseIndex` |
| `9e513b8f` / `c55d99c3` | Engine-stamp rejection (`ppg-per-drive-v1`) |
| `6d65af8d` | No false freeze-label on full ticket |
| `d1d06eab` | Delivery-commit `parlay_fulfilled` success |

### Bundle probes (PASS)

- `ppg-per-drive-v1` present  
- `parlay_fulfilled` present  
- `propOpponentDefenseKey` / opponent defense map present  
- `NCAAF_GAME_LINE_SIM_VALIDATED` present (const remains **false**)  
- **Absent:** `NCAAF_TEAM_STRENGTH_RESEARCH`, `ncaaf-team-strength-v0`  
- **Absent:** `expo-av`  
- Passkey guard + device-attestation UI symbols present  

### Explicitly out of this OTA

- NCAAF research / team-strength v0 / subdivision retag (api-server research branch only)  
- Voice / STT / TTS / expo-av  
- Home shortcuts UI  
- Passkey native module changes (guards **preserved**, not rewritten)  
- NCAAF gate unlock  
- FINAL_EVAL (untouched; not in this tip)

---

## Compatibility & integration checks

| Check | Result |
|-------|--------|
| App Store Build 78 / runtime `1.1.0` | **PASS** — OTA targets `1.1.0` |
| Hidden production diagnostics (`shouldShowDeviceAttestationUi` prod=false) | **PASS** — tip ≡ base for `navMenuAuth` / NavMenu / OtaHomeDiagnostics |
| Passkey guards (Build 78 missing `ClerkExpoPasskeys`) | **PASS** — tip ≡ base for `passkeyAuth`; unit suite green |
| Live server | **PASS** — `deploymentSha=e607f131898daebaecd08602558905b96f738122` (`/api/healthz`) |
| NCAAF blocked | **PASS** — gate false; research absent from tip/bundle |
| Voice paused | **PASS** — no voice imports / no voice diff vs production base |
| Unit guards | **PASS** — passkeyAuth, navMenuAuth, gameSimEngineVersion, coachEightLegCollegeAudit, propDefenseIndexTwoTeam (0 fail) |

---

## Rollback target (production channel — current live)

| Field | Value |
|-------|--------|
| **Rollback tip SHA** | `b666165e8d21c85222ab2ff874b538394efac66a` |
| **Production update ID** | `01a144bd-83bc-7ee4-8e43-3718b03c42b3` |
| **Production group** | `68de9f95-8f7b-40fb-825a-45ea830e665a` |
| **Export launch hash** | `YBbHBG0NwMh4KdPq3jCHpBc_73j0za_nZmTYVHMOeRw` |

Server rollback not required for a mobile-only revert (paired live remains `e607f131…`).

---

## Publication gate (still open)

1. Human authorization to lift `.ota-production-freeze`  
2. Publish with `eas update --skip-bundler --input-dir <this dist>` so published hash ≡ `LdbIL3…`  
3. Device: `Updates.updateId` + launch hash match; Build 78 / `1.1.0`  
4. Keep NCAAF blocked · voice paused · collector dry-run · FINAL_EVAL untouched  

**This document does not authorize production OTA.**
