# Device-test prep — PR #736

**Pinned JS tip under test:** `0d10cce7fab76d0c36180f11b80fb282a1078117`  
Must contain college-sim content `4738df08db5fc3425bc1fd317431c52bc5b9c0a8`.

**Goal:** Exercise Build 78 fail-soft + college sport lock + OTA rollback on a **meaningful** binary without exposing production users.

**Constraints:** production OTA freeze stays armed; no merge; no production publish; no EAS build started from this prep (approve explicitly).

---

## Preflight verifications (0d10cce7)

| Check | Result |
|-------|--------|
| `eas.json` → `build.preview.channel` | **`preview` only** (`distribution: internal`) |
| `build.preview-ota.channel` | **`preview` only** |
| `build.production.channel` | `production` (untouched; freeze armed) |
| New preview IPA includes `ClerkExpoPasskeys`? | **Yes** — `@clerk/expo-passkeys` autolinks pod `ClerkExpoPasskeys` |
| Build 78 crash compatibility | **UNVERIFIED** on any new preview/preview-ota binary |
| Production freeze | **armed** (`.ota-production-freeze`) |

---

## Pinned commit + exact installation method

| Item | Value |
|------|--------|
| **JS tip under test** | `0d10cce7fab76d0c36180f11b80fb282a1078117` |
| College-sim content (required ancestor) | `4738df08db5fc3425bc1fd317431c52bc5b9c0a8` |
| Prior fixpack (pre preview config) | `6f7d4178dc382332bff87f46984875dabb0d521e` |
| PR | https://github.com/danthony504-svg/stadium-edge/pull/736 |
| Runtime | `1.1.0` |
| Test channel | `preview` |
| Production freeze | **armed** (`.ota-production-freeze`) |
| Prep script | `artifacts/stadium-mobile/scripts/prepare-preview-test.sh` |

### iPhone install (internal / ad hoc) — device registration required

Profile `preview` uses `"distribution": "internal"`. Apple will only install the IPA on **registered device UDIDs**.

1. On the iPhone: Settings → General → About → copy **UDID** (or plug into Mac / use Apple Configurator).
2. Register once (Expo/Apple ad hoc provisioning):
   ```bash
   cd artifacts/stadium-mobile
   EXPO_TOKEN=… pnpm exec eas device:create
   # follow prompts; paste UDID; name the device
   ```
3. Rebuild after registering a **new** device (provisioning profile must include it):
   ```bash
   git checkout 0d10cce7fab76d0c36180f11b80fb282a1078117
   cd artifacts/stadium-mobile
   EXPO_TOKEN=… eas build --profile preview --platform ios --non-interactive
   ```
4. Install: open the EAS build page QR code on the iPhone (same Apple ID / device that was registered), or use the install link from `eas build:list`.
5. Confirm the binary is **preview channel** (not App Store Build 78).

`preview-ota` (`distribution: store`) can go to TestFlight instead — still channel `preview`, still links `ClerkExpoPasskeys` → crash path **UNVERIFIED**.

### Install method A — preview binary + preview OTA (JS tip)

```bash
git fetch origin cursor/build78-fixpack-def8
git checkout 0d10cce7fab76d0c36180f11b80fb282a1078117
git merge-base --is-ancestor 4738df08db5fc3425bc1fd317431c52bc5b9c0a8 HEAD

# Device registration (once) + approve build separately:
cd artifacts/stadium-mobile
EXPO_TOKEN=… pnpm exec eas device:create
EXPO_TOKEN=… eas build --profile preview --platform ios --non-interactive

# Publish JS tip to preview only (token never printed by script):
cd ../..
EXPO_TOKEN=… PUBLISH_PREVIEW_OTA=1 \
  bash artifacts/stadium-mobile/scripts/prepare-preview-test.sh \
  0d10cce7fab76d0c36180f11b80fb282a1078117

# On device: force-quit → reopen → apply tip → cold launch ×2
```

### Install method B — Metro on pinned commit (no OTA)

```bash
git checkout 0d10cce7fab76d0c36180f11b80fb282a1078117
cd artifacts/stadium-mobile
EXPO_TOKEN=… eas build --profile development --platform ios   # approve first; register device
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
- Does not start an EAS build  
- Does not merge #736  

---

## Quick reference

| Item | Value |
|------|--------|
| JS tip under test | `0d10cce7fab76d0c36180f11b80fb282a1078117` |
| Required ancestor | `4738df08db5fc3425bc1fd317431c52bc5b9c0a8` |
| Build 78 crash on preview IPA | **UNVERIFIED** (ClerkExpoPasskeys linked) |
| Device registration | `eas device:create` (UDID) before internal install |
| Phase E | `docs/coach/ncaaf-phase-e-checklist.md` — do not flip flag |
| Prior fixpack (pre preview config) | `6f7d4178dc382332bff87f46984875dabb0d521e` |
| Branch | `cursor/build78-fixpack-def8` |
| PR | https://github.com/danthony504-svg/stadium-edge/pull/736 |
| Publish script | `artifacts/stadium-mobile/scripts/publish-preview-ota.sh` |
| Build profiles | `preview` (internal) / `preview-ota` (store + OTA banner) |
| Crash-test binary | **Must omit ClerkExpoPasskeys** or mark Build 78 UNVERIFIED |
