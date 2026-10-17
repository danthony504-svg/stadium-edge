# Production-mobile candidate package — `54b89f32` (prep only)

**Status:** PRODUCTION EXPORT BAKED — **no production publication**  
**Date:** 2026-10-17  
**Freeze:** `.ota-production-freeze` remains **armed**  
**Preview:** export-equivalent update `01a146ed…` / hash `2ecBll…` (see [`preview-release-verification-54b89f32.md`](./preview-release-verification-54b89f32.md))  
**Production-configured bake:** launch hash `LdbIL3-seClcRehUomUTx6MHBX0huNbxEl3TFPI3VeE` (see [`production-mobile-export-54b89f32.md`](./production-mobile-export-54b89f32.md)) — differs from preview because `OTA_BOOTSTRAP`/`OTA_USER_BANNER` are forced true

---

## Exact candidate

| Role | Full SHA / ID |
|------|----------------|
| **Mobile candidate tip** | `54b89f32efc81fe3cf56cee50388816054484600` |
| **Branch** | `cursor/mobile-peropp-stamp-8b51` |
| **Base = current production OTA** | `b666165e8d21c85222ab2ff874b538394efac66a` |
| **Paired live server** | `e607f131898daebaecd08602558905b96f738122` (Render; stamp `ppg-per-drive-v1`; includes prop dist-cache `defenseIndex` identity) |
| **Preview proof update ID** (export-equivalent) | `01a146ed-1a89-71f5-9e5a-5909a432a38f` |
| **Preview group** | `dd669b36-2dfd-40fb-8970-63ac7b71f759` |
| **Published launch hash (= reviewed export)** | `2ecBllWhtHVRT39CG_l8QAjlaiZMyZzlC54riVre4XM` |
| **Superseded non-equivalent preview** | `01a14636…` / hash `jLOJwvr…` (rebundle; do not use for equivalence) |
| **Runtime** | `1.1.0` · iOS · existing IPA Build 79 |

---

## Included-fix list (`b666165e` → `54b89f32`)

Runtime commits (code, excluding docs-only):

| Commit | Fix |
|--------|-----|
| `2047571c` | Wire prop defense/weather into projection (OTA baseline port) |
| `ecaed343` | Honest empty path for 8-leg college under P0 gate (gate stays **false**) |
| `6309a532` | Scope prop `defenseIndex` **per opponent**, not per game |
| `9e513b8f` | Reject unstamped game draws (`ppg-per-drive-v1`) |
| `c55d99c3` | Reject unstamped draws in `gameSimHitForPick` |
| `6d65af8d` | Do not freeze-label full tickets after budget race (PR #747) |
| `d1d06eab` | Count success only after **delivery commit** (`parlay_fulfilled` once) |

Docs tip commits through `54b89f32` only adjust finalize tables — same JS tip lineage for publish bake.

### Runtime surface (high level)

- `propContextPipeline.ts` + `boardMarketScanner.ts` + `api.ts` + `pickScoreContext.ts` — per-opp defense batches / keys  
- `gameSimEngineVersion.ts` + `coachGameMonteCarlo.ts` + `gameSimScoring.ts` — stamp reject  
- `coachP0UnvalidatedTotals*` + `coachAskSportScope.ts` + `buildParlay.ts` — college honesty (gate false)  
- `coachReliabilityReporter.ts` / classify / `coach.tsx` — delivery-commit fulfilled telemetry; no false freeze on full ticket  

### Explicitly **not** included (must stay out of this OTA)

- Voice / STT / TTS / expo-av  
- Home shortcuts UI  
- Passkey / ClerkExpoPasskeys changes  
- NCAAF gate flip (`NCAAF_GAME_LINE_SIM_VALIDATED` stays **false**)  
- Forward collector activation  

Diff scale vs `b666165e` (tip incl. docs/tests): on the order of **+3030 / −152** across stadium-mobile (see `git diff --stat b666165e..54b89f32 -- artifacts/stadium-mobile`).

---

## Rollback target (production)

| Field | Value |
|-------|--------|
| **Rollback tip SHA** | `b666165e8d21c85222ab2ff874b538394efac66a` |
| **Production update ID** | `01a144bd-83bc-7ee4-8e43-3718b03c42b3` |
| **Production group** | `68de9f95-8f7b-40fb-825a-45ea830e665a` |
| **Message** | `production b666165e… — hide Device attestation on production channel (Build 78 / 1.1.0)` |
| **Export launch hash (recorded)** | `YBbHBG0NwMh4KdPq3jCHpBc_73j0za_nZmTYVHMOeRw` |

Rollback = republish / point production channel back to group `68de9f95…` (or equivalent heal script for that tip). **Do not** roll production to preview group `dd669b36…` (or superseded `23003912…`).

Server rollback (only if a future server regress): prior Render tip before `e607f131` was `ddeb4733…` — **not** required for a mobile-only OTA revert.

---

## Publication gate (not satisfied this turn)

1. Human authorization to lift `.ota-production-freeze`  
2. **Required:** `--skip-bundler --input-dir dist` so published hash ≡ reviewed export (preview corrective already proved `2ecBll…`)  
3. Device check: `Updates.updateId` matches the new production update (not `01a144bd…`) **and** launch hash matches export  
4. Keep NCAAF blocked · voice paused · collector dry-run  

**This document does not authorize production OTA.**
