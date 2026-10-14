# Device-test prep — PR #736

**Ready for device install** — IPA inspect **PASS** (`channel=preview`, zero `ClerkExpoPasskeys`).

| Item | Value |
|------|--------|
| EAS build | https://expo.dev/accounts/danthony504/projects/stadium-edge/builds/9155c37b-0297-45a7-98fe-ea3f38bea6a9 |
| IPA | https://expo.dev/artifacts/eas/xdt_76YDHDHCwDv-3zYfvzzH6zb57hMGojZV2V0dma0.ipa |
| Binary commit | `057c9f0ddd42e9309146cc6eb8d3b68f089b4e82` |
| Branch tip (inspect fix) | `7d711c7e` |
| Preview OTA group | `ad3cc4af-a734-4375-899c-c3fd0c0f9ec7` |
| Preview iOS update | `01a13c12-5ea2-77cf-a9f0-af8e5b079c2a` |
| Device UDID | `00008150-001968CA2280401C` |

**Goal:** Exercise Build 78 fail-soft + college sport lock + OTA rollback on a **meaningful** binary without exposing production users.

**Constraints:** production OTA freeze stays armed; no merge; no production publish.

---

## Preflight verifications

| Check | Result |
|-------|--------|
| `eas.json` → `build.preview.channel` | **`preview` only** (`distribution: internal`) |
| `build.preview-ota.channel` | **`preview` only** |
| `build.production.channel` | `production` (untouched; freeze armed) |
| Plain `preview` / `preview-ota` IPA | **Includes** `ClerkExpoPasskeys` → crash path **UNVERIFIED** |
| `preview-build78` IPA | Keeps lockfile dep; excludes via `EXPO_NO_CLERK_PASSKEYS=1` + pre/post-install hooks + `react-native.config.js` — **use this for crash-path** |
| Production freeze | **armed** (`.ota-production-freeze`) |
| `EXPO_TOKEN` | **configured** on Cursor Cloud Agent env — see `docs/device-test-expo-token.md` |
| Registered device | `00008150-001968CA2280401C` (Apple team `VQSSG3D637`) |

---

## Pinned commit + exact installation method

| Item | Value |
|------|--------|
| **JS tip under test** | branch tip (`git rev-parse HEAD` on `cursor/build78-formpack-def8`) |
| College-sim content (required ancestor) | `4738df08db5fc3425bc1fd317431c52bc5b9c0a8` |
| Prior fixpack (pre preview config) | `6f7d4178dc382332bff87f46984875dabb0d521e` |
| PR | https://github.com/danthony504-svg/stadium-edge/pull/736 |
| Runtime | `1.1.0` |
| Test channel | `preview` |
| Production freeze | **armed** (`.ota-production-freeze`) |
| Prep script | `artifacts/stadium-mobile/scripts/prepare-preview-test.sh` |
| Agent | https://cursor.com/agents/bc-01a13bfe-099e-7b4a-a43d-ee439b6c5cb3 |

### iPhone install — `preview-build78` (no ClerkExpoPasskeys)

Profile `preview-build78` = `channel: preview` + `distribution: internal` + `EXPO_NO_CLERK_PASSKEYS=1`.  
Apple installs only on **registered device UDIDs**.

1. Device already registered for Ad Hoc: `00008150-001968CA2280401C`.
2. Build:
   ```bash
   git checkout origin/cursor/build78-formpack-def8
   cd artifacts/stadium-mobile
   eas build --profile preview-build78 --platform ios --non-interactive
   ```
3. Gate IPA: `bash scripts/inspect-preview-build78-ipa.sh app.ipa` (must PASS: `channel=preview`, zero `ClerkExpoPasskeys`).
4. Install via the EAS build **installation link** / QR (registered device only).
5. Publish branch tip to **preview** only, then cold-launch ×2, sign-in, college sport lock, full scan timing.

### Install method A — preview-build78 + preview OTA

```bash
git fetch origin cursor/build78-formpack-def8
git checkout origin/cursor/build78-formpack-def8
TIP=$(git rev-parse HEAD)
cd artifacts/stadium-mobile
eas build --profile preview-build78 --platform ios --non-interactive
# copy install URL from eas build output

cd ../..
PUBLISH_PREVIEW_OTA=1 \
  bash artifacts/stadium-mobile/scripts/prepare-preview-test.sh "$TIP"
```

### Install method B — Metro on tip (no OTA)

```bash
git checkout origin/cursor/build78-formpack-def8
cd artifacts/stadium-mobile
eas build --profile development --platform ios   # approve first; register device
npx expo start --dev-client
```

---

## Why a separate test binary is required

| Fact | Implication |
|------|-------------|
| Build 78 / App Store binaries bake `expo-channel-name: **production**` | They only fetch **production** OTAs |
| `.ota-production-freeze` blocks production publish | Must not put this tip on production |
| `eas.json` `preview` / `preview-ota` bake channel **preview** | Those binaries fetch preview OTAs only |

**Conclusion:** You cannot load this tip onto production Build 78 without a production OTA. A **preview-channel binary** (or development client + Metro) is required.

---

## Crash-test binary requirements (ClerkExpoPasskeys)

A **new preview build that already links `ClerkExpoPasskeys` does not test** the missing-module guard. The OTA Build 78 failure was:

`Cannot find native module 'ClerkExpoPasskeys'`

So the fail-soft path (`hasClerkExpoPasskeysNative` → `getPasskeys() === null`) is only exercised when the **native binary does not include** that module.

| Binary | Crash-test value |
|--------|------------------|
| **Build 78 production IPA** (no ClerkExpoPasskeys) + production OTA of this tip | Real crash-test — **blocked** by production freeze |
| **Custom test IPA** with Build 78–equivalent natives (no ClerkExpoPasskeys) + preview channel | Meaningful crash-test on preview |
| New `preview` / `preview-ota` EAS build that **includes** ClerkExpoPasskeys | Exercises sport lock / college / rollback JS only — **Build 78 crash compatibility = UNVERIFIED** |

### Required for a PASS on Build 78 crash compatibility

1. Install a binary **without** native `ClerkExpoPasskeys` (Build 78 itself, or a deliberately stripped/equivalent native set).
2. Load this tip’s JS (production OTA only if freeze is lifted by humans; otherwise a preview-channel binary built from an older native tree that omits the module).
3. Cold launch ×2: no `ErrorRecovery` / boot loop; sign-in works; passkey CTA hidden or inert; `getPasskeys()` stays null.

If you only install a modern preview binary that already has ClerkExpoPasskeys:

> **Build 78 compatibility: UNVERIFIED** — missing-module guard not exercised on device.

Unit coverage still exists in `passkeyAuth.test.ts` (`describe("passkeyAuth missing ClerkExpoPasskeys")`), but that is not a device crash-test.

---

## Recommended device checklist (preview tip)

### A. Sanity (any preview binary)

1. Cold launch ×2 — no ErrorRecovery / boot loop  
2. Email/password sign-in  
3. Open Coach once  

### B. Passkeys crash path

- **If binary lacks ClerkExpoPasskeys:** confirm no crash; passkey CTA fail-soft. → Build 78 crash check can PASS.  
- **If binary has ClerkExpoPasskeys:** mark **Build 78 compatibility UNVERIFIED**; still run college/sport checks.

### C. College Coach (stay on college)

NCAAF game lines remain **P0 fail-closed** (`NCAAF_GAME_LINE_SIM_VALIDATED = false`) until Phase E sign-off. Engine now feeds scoring + defense inputs, but grades stay blocked. Player props alone do **not** lift P0. Phase E checklist: `docs/coach/ncaaf-phase-e-checklist.md` (E2/E4/E6 still OPEN).

| Ask | Expected |
|-----|----------|
| `7 leg college` | NCAAF-only; may shortfall empty (P0 + gameLinesOnly) |
| `7 leg college football player props` / receiving yards | NCAAF-locked; props may seat; no pro-sport fill |
| Contaminated expectation | Ticket sports ⊆ `{ncaaf}` |

### D. Full Coach scan timing

Same college ask twice; record wall-clock + stage timings. Until measured on device → **UNVERIFIED**.

---

## NCAAF P0 status (after college sim fix)

### Engine changes (server)

- Soft monotonic TD/FG rates past former hard caps (`footballDriveMatchup`)
- Rush/pass yards-allowed packs tilt opposing offense ±8% (`defenseAllowed` on `GameSimTeamInput`)
- Sparse venue split blends with L10
- Wired in `simulate.ts` **and** `coachSlateInProcessSims.ts`

### Client gate (unchanged until validation flag)

- `NCAAF_GAME_LINE_SIM_VALIDATED = false` in `coachP0UnvalidatedTotals.ts`
- Spreads / ML / alt / period sides still reject with `unvalidated_ncaaf_game_line_simulation`
- Totals P0 for nfl/ncaaf/nhl unchanged
- Validation tests: `artifacts/api-server/test/ncaafGameLineSimValidation.test.ts`

### What this prep does **not** do

- Does not set `NCAAF_GAME_LINE_SIM_VALIDATED = true`  
- Does not publish production OTA  
- Does not merge #736  

---

## Quick reference

| Item | Value |
|------|--------|
| JS tip under test | branch tip (`cursor/build78-formpack-def8`) |
| Required ancestor | `4738df08db5fc3425bc1fd317431c52bc5b9c0a8` |
| Crash-path binary | `eas build --profile preview-build78` (no ClerkExpoPasskeys) |
| Device | registered `00008150-001968CA2280401C` |
| EXPO_TOKEN | Cursor env secret — `docs/device-test-expo-token.md` (**configured**) |
| Phase E | `docs/coach/ncaaf-phase-e-checklist.md` — E2a FAIL / restore NO |
| Prior fixpack (pre preview config) | `6f7d4178dc382332bff87f46984875dabb0d521e` |
| Branch | `cursor/build78-formpack-def8` |
| PR | https://github.com/danthony504-svg/stadium-edge/pull/736 |
| Publish script | `artifacts/stadium-mobile/scripts/publish-preview-ota.sh` (`--channel` only) |
| Build profiles | `preview` / `preview-ota` / `preview-build78` |
| Crash-test binary | **Must omit ClerkExpoPasskeys** or mark Build 78 UNVERIFIED |
