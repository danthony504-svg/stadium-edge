# Build 78 / runtime 1.1.0 — rollback prep (ready to dispatch)

**Do not publish PR #729.** Build 79 remains on hold.  
**Do not treat `Cannot find native module 'ClerkExpoPasskeys'` as the current fatal** — tip `01a136bb` fail-softs that throw in agent reproduction; current tip-boot cause is unverified without new device evidence.

Login, subscriptions, and both seven-day trials are unchanged by either rollback path below (channel-only / republish of prior JS).

## Last verified working OTA (Build 78 · runtime 1.1.0)

| Field | Value |
| --- | --- |
| iOS update ID | `01a13019-8a5f-7f4d-bacb-31b1105de281` |
| Update group | `804902bb-215e-48af-92ee-e17398c22bc1` |
| Git | `0cb3be3c` (Actions run [38249348071](https://github.com/danthony504-svg/stadium-edge/actions/runs/38249348071) @ 2026-10-12T12:32Z) |
| runtimeVersion | `1.1.0` |
| Evidence | Documented known-good / attestation tip before tip-boot blacklist cascade (`01a131bc` and later). Publish log: `✔ Published!` + matching iOS update ID. |

### Do not republish

| Update ID | Why |
| --- | --- |
| `01a131bc-e321-73f2-9d8a-4cf3f005f252` | Native `updatePreviouslyFailed` (reload-during-boot) |
| `01a13540-…` / `01a13582-…` / `01a136bb-…` | Later tips in the crash / recovery window — not verified working on-device for rollback |

## Recommended path (step 1) — roll back to embedded

Clears the production channel tip for runtime **1.1.0** so Expo serves **roll-back-to-embedded**. No new JS from HEAD. Uses Build 78’s baked-in bundle (same native modules the binary already has).

```bash
# GitHub UI: Actions → "Rollback production OTA (embedded)" → Run workflow
# message: "Build 78 emergency rollback to embedded — clear bad 1.1.0 tip"
# runtime_version: leave blank (resolves to app.json 1.1.0)

gh workflow run rollback-production-ota.yml \
  -f message='Build 78 emergency rollback to embedded — clear bad 1.1.0 tip' \
  -f runtime_version=''
```

Or script (requires `EXPO_TOKEN`):

```bash
cd artifacts/stadium-mobile
EXPO_TOKEN=… bash scripts/rollback-production-ota.sh \
  'Build 78 emergency rollback to embedded — clear bad 1.1.0 tip'
```

## Optional path (step 2) — republish known-good group

Only after embedded boots cleanly. Creates a **new** update id from group `804902bb-…` (contents of `01a13019`). Never republish blacklisted ids.

```bash
gh workflow run republish-stable-production-ota.yml \
  -f confirm_publish='REPUBLISH_STABLE' \
  -f update_group='804902bb-215e-48af-92ee-e17398c22bc1' \
  -f message='ROLLBACK republish 01a13019 group for Build 78 / 1.1.0'
```

## How this reaches a device that crashes before Home

Expo Updates selection runs **in native code before JS / Home / Diagnostics**:

1. **Failed tip launches** increment native `failedLaunchCount`. After the policy threshold, that tip is skipped (`updatePreviouslyFailed`) and the next cold start loads the **last successful** update — usually the **embedded** Build 78 bundle — without opening Home.
2. **Channel `roll-back-to-embedded`** is returned on the next native update check (startup procedure / `checkAutomatically`). The client does not need Menu → OTA Diagnostics or the Home attestation strip. Embedded JS from the binary launches with Build 78 natives only.
3. **Force-quit → reopen** (sometimes twice): first launch finishes blacklist / embedded selection; second can apply a later republished tip if step 2 was run.
4. A device that **never** reaches `RCTContentDidAppear` on the bad tip still falls back via (1). Rollback does not require the crashing JS to render UI.

Clerk session / SecureStore / RevenueCat / StoreKit trial state live outside the OTA JS tip and survive embedded rollback and republish of `01a13019`.
