# Build 78 TestFlight / OTA diagnosis (findings only)

**Status:** Channel tip proven live. Physical device `Updates.*` values not yet pasted — classification uses channel proof + behavioral exclusion. **No OTA publish. No native build. No Coach/sim/gate changes.**

**Date (UTC):** 2026-10-12  
**Repo head when diagnosed:** `main` @ `6a8cf476` (#709 merged, **unpublished** to production OTA)  
**Production OTA tip (live channel):** commit `a20c3939` → iOS update `01a12e0b-2bdc-75dd-944b-310a4eb5add5`

---

## 1. How to read the physical TestFlight device (Build 78)

On the phone (no publish required — already shipped in prior OTAs / embedded that include this screen):

1. Open **Stadium Edge** TestFlight build **78**.
2. Menu → **OTA Diagnostics** (`/ota-debug`), or tap the Home **OTA diagnostics** strip.
3. Tap **Copy report** (or screenshot every row).
4. Optionally tap **Check, fetch & reload** once, then copy the report again.

Required fields (already exposed by `app/ota-debug.tsx` / `lib/otaDebug.ts`):

| Field | Row label on device |
|-------|---------------------|
| app version | App version |
| native build number | iOS build number |
| `Updates.runtimeVersion` | Updates.runtimeVersion |
| `Updates.updateId` | Updates.updateId |
| `Updates.isEmbeddedLaunch` | Updates.isEmbeddedLaunch |
| channel | Updates.channel |
| commit/SHA | Commit hash (running JS) / Deploy message |
| last update check | checkForUpdateAsync() |
| fetch result | fetchUpdateAsync() |
| reload/apply result | reloadAsync() |

Also note UI markers while on Coach: **Add to slip** visible? Slip tab visible?

---

## 2. Expected healthy production values

| Field | Expected |
|-------|----------|
| app version | `1.1.0` |
| build | `78` |
| runtimeVersion | `1.1.0` |
| channel | `production` |
| isEmbeddedLaunch | `false` |
| updateId | `01a12e0b-2bdc-75dd-944b-310a4eb5add5` (current production 1.1.0 head) |
| commit (tip) | `a20c39394f35fd563a5b6483274df142aaed5e7d` |

### Bundle markers

| Marker | Production tip `01a12e0b` / `a20c3939` | `main` @ `#709` / `6a8cf476` (not published) |
|--------|----------------------------------------|-----------------------------------------------|
| `SLIP_UI_ENABLED=false` | **Yes** | Yes |
| greenfield `buildCoachParlay` | **Yes** | Yes |
| props-only quality-floor (`meetsCoachSimQualityFloor` in `propsOnlyTicketCleared`) | **No** | **Yes** |

**Implication:** Class **A** as “current tip **and** #709 quality floor” is **impossible until a new production OTA is published**. Do not publish until the device tip identity is proven.

---

## 3. Proven channel tip (live, 2026-10-12)

Queried Expo Updates manifest (no publish):

```
GET https://u.expo.dev/9af36ab9-f953-4879-9dd2-82807ef7430c
Headers: expo-platform=ios, expo-runtime-version=1.1.0, expo-channel-name=production
→ expo-update-id: 01a12e0b-2bdc-75dd-944b-310a4eb5add5
→ runtimeVersion: 1.1.0
→ metadata.branchName: production
→ metadata.updateGroup: e62da3e0-6a09-424b-898a-50c3090581ec
→ createdAt: 2026-10-12T02:57:26.492Z
```

Matches CI publish run [38197651441](https://github.com/danthony504-svg/stadium-edge/actions/runs/38197651441) @ `a20c3939`:

- Update group: `e62da3e0-6a09-424b-898a-50c3090581ec`
- iOS update ID: `01a12e0b-2bdc-75dd-944b-310a4eb5add5`
- Message: `fix(notifications): Clerk … on Send test notification`
- Deploy bake: `DEPLOY-VERIFY a20c3939…-38197651441`

Source markers at `a20c3939` (published tree):

- `lib/slipUi.ts` → `SLIP_UI_ENABLED = false`
- `lib/coach/buildParlay.ts` → greenfield `buildCoachParlay`
- `lib/pickRecommendation.ts` → `propsOnlyTicketCleared` **without** `meetsCoachSimQualityFloor` (#709 not in tip)

---

## 4. Device values (Build 78)

| Field | Value | Provenance |
|-------|-------|------------|
| app version | **unproven** (expect `1.1.0`) | Needs ota-debug paste |
| native build | **unproven** (expect `78`) | Needs ota-debug paste |
| `Updates.runtimeVersion` | **unproven** | Needs ota-debug paste |
| `Updates.updateId` | **unproven** | Needs ota-debug paste |
| `Updates.isEmbeddedLaunch` | **unproven** | Needs ota-debug paste |
| channel | **unproven** (expect `production` if OTA path healthy) | Needs ota-debug paste |
| commit/SHA | **unproven** | Needs ota-debug paste |
| checkForUpdateAsync | **unproven** | Needs ota-debug paste |
| fetchUpdateAsync | **unproven** (check-only probe skips fetch until button) | Needs ota-debug paste / force button |
| reloadAsync | **unproven** | Needs force button outcome |
| UI: Add to slip | **Reported visible on stale TestFlight Coach** | Behavioral (prior session) |

This agent cannot read the physical phone. `EXPO_TOKEN` is absent here; live channel tip was confirmed via public Updates protocol instead. Device `Updates.*` must come from the on-device report.

---

## 5. Classification (A–E)

### Definitions

| Class | Meaning |
|-------|---------|
| **A** | Correct current production OTA loaded (`updateId=01a12e0b…`, `isEmbeddedLaunch=false`, tip markers) |
| **B** | Old 1.1.0 OTA loaded (`runtimeVersion=1.1.0`, `isEmbeddedLaunch=false`, `updateId≠01a12e0b…`) |
| **C** | Embedded Build 78 bundle loaded (`isEmbeddedLaunch=true`, updateId blank/embedded) |
| **D** | OTA check/download/apply failing (errors / pending never applied / emergency launch) |
| **E** | Runtime mismatch (`runtimeVersion≠1.1.0`) |

### Decision table (after paste)

1. If `runtimeVersion` ∉ {`1.1.0`} → **E**
2. Else if `isEmbeddedLaunch=true` (and updateId missing/embedded) → **C** (also check probe for **D**)
3. Else if check/fetch/reload errors or `isEmergencyLaunch` / rollback loops → **D**
4. Else if `updateId ≠ 01a12e0b-2bdc-75dd-944b-310a4eb5add5` → **B**
5. Else if `updateId = 01a12e0b…` and `isEmbeddedLaunch=false` → **A** (channel tip). Note: tip still **lacks #709 quality floor**.

### Current verdict (pre-paste)

| Class | Status |
|-------|--------|
| **A** | **Ruled out for tip** if Add-to-slip is visible (`SLIP_UI_ENABLED=false` on tip). **Ruled out for #709 markers** until publish. |
| **B / C / D / E** | **Open** — requires ota-debug paste to pick exactly one. |
| Working hypothesis | Stale JS relative to tip → **B**, **C**, or **D** (not **A**). **E** only if runtime ≠ `1.1.0`. |

Pure classifier for pastes: `artifacts/stadium-mobile/lib/otaBuild78Classify.ts`.

---

## 6. Exact recovery action (no republish until proven)

### Step 0 — Prove device state (mandatory)

1. Copy full OTA Diagnostics report from Build 78.
2. Run values through `classifyBuild78Ota` (or the table above).
3. **Do not** publish production OTA and **do not** cut a native build until class is locked.

### Per-class recovery

| Class | Recovery (exact) |
|-------|------------------|
| **A** | Tip identity OK. Do **not** republish to “fix Add-to-slip” — tip already has `SLIP_UI_ENABLED=false`. If slip UI still shows with proven `01a12e0b…`, that is a renderer bug (separate from OTA). For #709 quality floor only: publish a **new** production OTA from `main` @ `#709` **after** tip identity is proven on device. |
| **B** | On device: **Check, fetch & reload**. Confirm `updateId` becomes `01a12e0b…`, `isEmbeddedLaunch=false`, Add-to-slip gone. If check says available but apply fails → treat as **D**. Do not publish until tip is loaded. |
| **C** | Same force check/fetch/reload. If check finds `01a12e0b…` and reload succeeds → leave embedded. If check finds nothing while embedded → inspect `emergencyLaunchReason` / native logs (**D**). Do not cut a new native build yet. |
| **D** | Capture exact `checkResult` / `fetchResult` / `reloadResult` / `checkError` / `downloadError` / emergency reason. Fix apply/rollback path before any new publish. Do not publish from ota-recovery. Do not native-build yet. |
| **E** | Runtime stream mismatch — this binary will never take the `1.1.0` tip. Do **not** publish current `main` Coach JS onto legacy runtimes (`1.0.3` / `1.0.0`). Device must be on a `1.1.0` binary (Build 78 should already be); if runtime shows legacy, reinstall TestFlight 1.1.0 / Build 78 first. Dedicated force-update-only OTA for `1.0.3` (no Coach) is a separate path. |

### After tip proven on device

Only then: workflow_dispatch **Publish production OTA** from `main` (includes #709 quality floor). Re-verify device `updateId` changes to the new tip and markers (`SLIP=false`, greenfield, quality floor) before calling Coach bugs fixed by OTA.

---

## 7. What was not done (by design)

- No Coach logic changes  
- No simulation changes  
- No quality-gate code changes  
- No production OTA publish  
- No native / TestFlight build  
- No merge of attestation UI PR #707 (unpublished; existing `/ota-debug` already exposes `Updates.*`)
