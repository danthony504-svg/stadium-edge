# Preview release verification closeout — `54b89f32`

**Date:** 2026-10-16  
**Channel:** `preview` only · **Runtime:** `1.1.0` · **Platform:** iOS  
**IPA:** existing Build 79 (`9155c37b`) — no native rebuild  
**Paired server (live Render):** `e607f131898daebaecd08602558905b96f738122` · stamp `ppg-per-drive-v1`  
**Holds:** production OTA freeze armed · `NCAAF_GAME_LINE_SIM_VALIDATED=false` · voice paused · collector dry-run only  
**Production publication:** **not executed**

---

## 1. Phone update identity (authoritative)

| Field | Value |
|-------|--------|
| **iOS update ID** | `01a14636-bbcb-729a-ab5f-27c666590c3b` |
| **Update group** | `23003912-6cf5-4d67-9eb6-c9094581af06` |
| **Channel tip message** | `preview 54b89f32efc81fe3cf56cee50388816054484600 — delivery-commit + PR747 (server e607f131 verified)` |
| **Published `launchAsset.hash`** | `jLOJwvrT-BYkoecJ73EOUj-8OjBgd0GhBm2bZt3mzRg` |
| **Baked tip SHA** | `54b89f32efc81fe3cf56cee50388816054484600` (forced `EXPO_PUBLIC_GIT_COMMIT` at export) |
| **Manifest permalink** | `https://u.expo.dev/update/01a14636-bbcb-729a-ab5f-27c666590c3b` |
| **Dashboard** | `https://expo.dev/accounts/danthony504/projects/stadium-edge/updates/23003912-6cf5-4d67-9eb6-c9094581af06` |

Device attestation must match **`Updates.updateId = 01a14636…`**. Do not trust baked commit labels alone if they ever lag; updateId + published launch hash are tip identity.

Artifacts: `/opt/cursor/artifacts/preview-publish-54b89f32-result.json`, `preview-manifest-54b89.body` / `.headers` (`expo-update-id: 01a14636…`), `preview-channel-after-54b89f32.log`, `release-identities-e607-54b89.json`.

---

## 2. Launch-hash reconciliation (export vs published)

| Stage | Hash (EAS url-safe SHA-256) | Bytes | Role |
|-------|-----------------------------|-------|------|
| **Final local export** (`expo export` → `dist/…/entry-2d1a5e0c….hbc`) | `2ecBllWhtHVRT39CG_l8QAjlaiZMyZzlC54riVre4XM` | 9 551 624 | Reviewed bake; full tip SHA present in HBC |
| **Published tip** (EAS manifest `launchAsset.hash`) | `jLOJwvrT-BYkoecJ73EOUj-8OjBgd0GhBm2bZt3mzRg` | ≠ export (publisher recorded ~6 040 724) | **What the phone downloads** |

**Why they differ:** preview publish ran `eas update --branch preview` **without** `--skip-bundler --input-dir dist`. EAS rebundled at publish time, so the published launch asset is **not** byte-identical to the local export. Both stages bake tip `54b89f32…`; only the published hash is authoritative for installed JS content.

**Reconcile verdict**

| Claim | Result |
|-------|--------|
| Local export hash matches published hash | **No** — expected given rebundle |
| Phone tip = update `01a14636…` / group `23003912…` | **Yes** (channel + manifest) |
| Phone content identity = `jLOJwvr…` | **Yes** (manifest `launchAsset.hash`) |
| Tip SHA intended / message / export bake | `54b89f32efc81fe3cf56cee50388816054484600` |
| Production channel changed by this publish | **No** — still `b666165e` / `01a144bd…` / `68de9f95…` |

**Next production candidate publish (when authorized):** use `--skip-bundler --input-dir dist` after a reviewed export so published hash **equals** export hash.

Recompute artifact: `/opt/cursor/artifacts/preview-export-54b89f32-checks.json`, `preview-export-54b89f32-launch-hash.txt`, `launch-hash-reconcile-54b89f32.json`.

---

## 3. Completed prop ticket — opponent context + one committed success

Harness: `/opt/cursor/artifacts/coach-fulfilled-event-check.mjs` against live Render `e607f131` with tip delivery-commit reporter logic (ran on tip checkout after preview publish).

| Check | Result |
|-------|--------|
| Ask | `5 leg NFL` · requestId `greenfield-fulfilled-check-1792179436375` |
| Duration | **18 215 ms** · not timed out · 5/5 legs |
| Prop pool | 5087 |
| Prop legs with opponent | Darren Waller (CAR) Rec Yds · Bryce Young (CAR) Pass TDs · game **Carolina Panthers @ Philadelphia Eagles** → opponent pack is **PHI** (`opponentTeamIdForProp` + `propOpponentDefenseKey` = `game@@opp:<phiId>`) |
| Tip wiring | Per-opp batches (`defenseIndexByFamilyByOpponent`); never bare game key alone |
| `parlay_fulfilled` posts | **exactly 1** (`fulfilledCount: 1`) |
| False freeze | **0** (`freezeCount: 0`; no `ABSOLUTE_BUDGET` / `coach_scan_freeze` on full ticket) |
| Dedupe | Subsequent fulfilled attempts → `fulfilled_deduped` |

Artifacts: `/opt/cursor/artifacts/coach-fulfilled-event-check.json`, `coach-fulfilled-event-check.log` (`FULFILLED_CHECK_OK`).

Supporting opponent evidence (candidate lineage, not a claim that the full context audit is complete): E2E HOU@JAX per-opp traces (`e2e-prop-traces-live.json`), isolated boost≠suppress (`isolated-pair-verify.md`), tip `footballOppTeamId` / `propContextPipeline` keys.

---

## 4. Explicit non-actions

- No production OTA / no freeze lift  
- No voice / STT / TTS work  
- NCAAF game-line gate remains **false**  
- Forward collector remains **dry-run only** (`NCAAF_FORWARD_ACTIVATE` unset)
