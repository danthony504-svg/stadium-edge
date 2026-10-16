# Preview release verification — `54b89f32` (export-equivalent)

**Date:** 2026-10-16  
**Channel:** `preview` only · **Runtime:** `1.1.0` · **Platform:** iOS  
**IPA:** existing Build 79 (`9155c37b`) — no native rebuild  
**Paired server (live Render):** `e607f131898daebaecd08602558905b96f738122` · stamp `ppg-per-drive-v1`  
**Holds:** production OTA freeze armed · `NCAAF_GAME_LINE_SIM_VALIDATED=false` · voice paused · collector dry-run only  
**Production publication:** **not executed**

---

## Verdict

| Claim | Result |
|-------|--------|
| Update ID identifies the release | **Yes** — but alone does **not** prove export equivalence |
| First publish (`01a14636…`) ≡ reviewed export | **No** — rebundle hash `jLOJwvr…` ≠ export `2ecBll…` |
| Corrective publish ≡ reviewed export | **Yes** — `eas update --skip-bundler --input-dir dist` |
| Matching launch hash | **`2ecBllWhtHVRT39CG_l8QAjlaiZMyZzlC54riVre4XM`** |
| Production frozen / unchanged | **Yes** — still `b666165e` / `01a144bd…` / `68de9f95…` |

Artifact: `/opt/cursor/artifacts/preview-equivalence-54b89f32.json`.

---

## 1. Equivalence probe (source / bake / deps / config)

| Check | Reviewed export / tip `54b89f32…` | First publish `01a14636…` |
|-------|----------------------------------|---------------------------|
| **Source SHA** | Git object `54b89f32efc81fe3cf56cee50388816054484600`; tip bytes in HBC | Message cites tip; **content hash differs** |
| **Baked env** | `EXPO_PUBLIC_GIT_COMMIT=54b89f32…`, domain `stadium-edge.onrender.com`, Clerk `pk_test_…`, runtime `1.1.0`, iOS buildNumber `79` | Rebundled separately — not byte-identical to export |
| **Dependencies** | `expo-updates ~29.0.18`, SDK `54.0.0`, Metro export | EAS rebundle path (no `--skip-bundler`) |
| **Build / channel config** | `eas.json` preview → channel `preview`, distribution `internal` | Same channel; publish method wrong for equivalence |

**Conclusion:** update ID `01a14636…` named the release but **did not** prove equivalence to the reviewed export. Corrective preview publication authorized and executed.

---

## 2. Phone identity after corrective publish (authoritative)

| Field | Value |
|-------|--------|
| **iOS update ID** | `01a146ed-1a89-71f5-9e5a-5909a432a38f` |
| **Update group** | `dd669b36-2dfd-40fb-8970-63ac7b71f759` |
| **Channel tip message** | `preview 54b89f32… — corrective skip-bundler export 2ecBll (equiv to reviewed bake)` |
| **Published `launchAsset.hash`** | `2ecBllWhtHVRT39CG_l8QAjlaiZMyZzlC54riVre4XM` |
| **Reviewed export hash** | `2ecBllWhtHVRT39CG_l8QAjlaiZMyZzlC54riVre4XM` (**match**) |
| **Dashboard** | https://expo.dev/accounts/danthony504/projects/stadium-edge/updates/dd669b36-2dfd-40fb-8970-63ac7b71f759 |

Device: `Updates.updateId` must be **`01a146ed…`** (not the prior non-equivalent `01a14636…`). Content proof is the matching launch hash.

Artifacts: `preview-corrective-publish-54b89f32.log`, `preview-corrective-publish-54b89f32-result.json`, `preview-manifest-corrective-54b89.*`, `preview-channel-after-corrective-54b89.log`.

### Superseded (non-equivalent) tip

| Field | Value |
|-------|--------|
| Update ID | `01a14636-bbcb-729a-ab5f-27c666590c3b` |
| Group | `23003912-6cf5-4d67-9eb6-c9094581af06` |
| Launch hash | `jLOJwvrT-BYkoecJ73EOUj-8OjBgd0GhBm2bZt3mzRg` |

---

## 3. Prop-delivery recheck (after equivalence)

Harness: tip worktree `54b89f32` + live Render `e607f131` · requestId `corrective-fulfilled-check-1792191442823`.

| Check | Result |
|-------|--------|
| Ask | `5 leg NFL` · 5/5 · **29 292 ms** · not timed out |
| Prop pool | 7465 |
| Opponent samples | Jaylen Warren (PIT) @ TB · Bryce Young (CAR) @ PHI — away players face home defenses |
| `parlay_fulfilled` | **exactly 1** |
| False freeze | **0** |
| `ok` | **true** (`FULFILLED_CHECK_OK`) |

Artifact: `/opt/cursor/artifacts/coach-fulfilled-corrective-54b89.json`.

---

## 4. Explicit non-actions

- No production OTA / freeze remains armed  
- No voice / STT / TTS / home-shortcuts / passkey changes  
- NCAAF gate remains **false**  
- Forward collector remains dry-run only  
