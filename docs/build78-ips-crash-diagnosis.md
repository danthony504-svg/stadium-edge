# Build 78 IPS crashes (2026-10-14) — ErrorRecovery SIGABRT

## Scope

Two TestFlight Build 78 / `1.1.0` reports (`90811de5-15a8-3023-bb9e-1862263245ef`):

| Report | Incident | `procLaunch` (CDT) | Capture (CDT) | Lifetime | Fault queue |
|--------|----------|--------------------|---------------|----------|-------------|
| `StadiumEdge-2026-10-14-055739_3532.ips` | `CAEE5EBC-…` | 04:55:19 | 05:57:39 | **3740 s (~62 min)** | `expo.controller.errorRecoveryQueue` |
| `StadiumEdge-2026-10-14-055852_e467.ips` | `5075F146-…` | 05:58:51.397 | 05:58:51.672 | **0.27 s** | `expo.controller.errorRecoveryQueue` |

Same device (`5DFFD9D0-87A0-4C42-B2EB-20A558D26F3A`), same binary UUID, identical StadiumEdge image offsets in `lastExceptionBacktrace`: **573640 → 569024 → 568448 → 164088**.

Constraints honored: no OTA publish, no deploy, no new native build from this investigation.

---

## A. Verified server publication history (not device execution)

These facts come only from GitHub Actions / EAS publish logs. They do **not** prove which update the phone was executing at crash time.

### Rollback #5 (embedded directive)

| Field | Value |
|-------|-------|
| Workflow | `.github/workflows/rollback-production-ota.yml` — **Rollback production OTA (embedded)** |
| Run | [#5](https://github.com/danthony504-svg/stadium-edge/actions/runs/38502290200) · id `38502290200` |
| Event | `workflow_dispatch` |
| Actor / triggering actor | `danthony504-svg` |
| Started (UTC) | `2026-10-14T02:40:47Z` (completed `02:41:28Z`) |
| Checkout commit | `8e7c0dc51d9e39c1ce0b2265835cfcaeef947bd1` — *Merge PR #731 (ota-rollback-pnpm)* |
| Channel / branch | `production` → `production` |
| Runtime | `1.1.0` |
| **iOS update ID** | `01a13849-3796-71b1-9607-fd9cd4493ef8` |
| **Update group ID** | `9125e6db-6a5e-4e99-820e-d834a382b420` |
| Message | `Emergency rollback to embedded bundle` |
| Kind | `eas update:roll-back-to-embedded` (no new JS bundle) |

### Tip published after rollback #5

| Field | Value |
|-------|-------|
| Workflow | `.github/workflows/publish-production-ota.yml` — **Publish production OTA** |
| Run | [#619](https://github.com/danthony504-svg/stadium-edge/actions/runs/38552272849) · id `38552272849` |
| Event | `workflow_dispatch` (`ROLLBACK_EMBEDDED: 0`) |
| Actor / triggering actor | `danthony504-svg` |
| Workflow started (UTC) | `2026-10-14T10:49:39Z` |
| **EAS ✔ Published!** (UTC) | `2026-10-14T10:52:10Z` |
| Checkout / published commit | `100b2450c18a74edfc806b6090149b62ad108f96` — *Merge PR #732 — fix(account): scroll so Sign out is reachable above safe area* |
| Channel / runtime | `production` / `1.1.0` |
| Env | `EXPO_PUBLIC_OTA_USER_BANNER=true` |
| **iOS update ID** | `01a13a0a-825f-72b5-8372-76e92d45f5c0` |
| **Update group ID** | `b76dd8f2-659e-480e-97bf-65b4be083e87` |
| Message | `fix(account): scroll so Sign out is reachable above safe area` |

No later `publish-production-ota` run was recorded after #619 at investigation time. Channel tip on the server remains this update until another publish or embedded rollback.

### Production publish posture (server)

| Path | Trigger | Freeze status |
|------|---------|---------------|
| `publish-production-ota.yml` | **Manual** `workflow_dispatch` only (comment: FROZEN / cold-launch pass) | Script exits if repo-root `.ota-production-freeze` exists |
| `force-production-ota.yml` | `workflow_dispatch` **or** push to `main` touching `artifacts/stadium-mobile/.ota-force-publish` | Script now also exits on `.ota-production-freeze` (gap closed in this PR) |
| `heal-production-ota` / `republish-stable-production-ota` | Manual + typed confirm | Scripts now exit on `.ota-production-freeze` |
| `rollback-production-ota` | Manual (or push trigger file) | **Not** blocked by freeze — emergency embedded-only path |

**Publishing remains active on `main` until `.ota-production-freeze` is present on the ref Actions check out.** This PR prepares that freeze + script gates; it does **not** publish, and freeze is ineffective for Actions until the file lands on `main` (merge this PR or commit the freeze file to `main` without running publish workflows).

Do **not** edit `.ota-force-publish` on `main` while investigating — that path auto-runs Force production OTA on push.

---

## B. Device evidence from the two IPS (proven)

### Terminal abort class

Both reports are `EXC_CRASH` / `SIGABRT` with `asi: abort() called`, faulting on Expo Updates’ **`expo.controller.errorRecoveryQueue`**.

That queue label is created only in `EXUpdates.ErrorRecovery`. Terminal task `.crash` → `throwException` → process abort when recovery cannot relaunch a working update.

**Proven:** Expo recovery stack is the **mechanism of death**.  
**Not proven from IPS:** which update id was launched, or the original fatal string.

### Symbolication (UUID-matched Build 78 binary)

| Image offset | VA (`0x100000000+off`) | Correlation |
|--------------|------------------------|-------------|
| **164088** | `0x1000280f8` | Swift block trampoline into `errorRecoveryQueue` |
| **568448** | `0x10008ac80` | Prior ErrorRecovery pipeline helper |
| **569024** | `0x10008aec0` | Caller into crash — `runNextTask` → `.crash` |
| **573640** | `0x10008c0c8` | `ErrorRecovery.crash` / `throwException` body |

Instant IPS: concurrent `dev.expo.modules.core.logging` → `fileHandleForWritingAtPath` while aborting — consistent with `writeErrorOrExceptionToLog` writing **`expo-error.log`** (text **not** in the `.ips`).

| | Long (`055739`) | Instant (`055852`) |
|--|-----------------|--------------------|
| Fault queue | `expo.controller.errorRecoveryQueue` | same |
| JS / Hermes | Alive | Alive (runtime started) |
| Writable VM | **206.7M** | **140.4M** |

### What device evidence does **not** establish

- Original JS/native fatal string.
- That tip `01a13a0a` was the **running** update (no `Updates.updateId` / `isEmbeddedLaunch` in IPS).
- Passkeys / Coach / Restart banner / Account scroll as the trigger.
- Automatic mid-session tip apply (`OtaController` forbids auto-`reloadAsync`).

**Temporal correlation** (tip published 10:52Z; crashes 10:57–10:58Z) is server+clock alignment only — **not** proof the downloaded tip was executing or was the original fatal. Treat “downloaded tip caused the crash” as **hypothesis** until `expo-error.log` / native log paste shows the first `Fatal error:` / `Fatal exception:` (and ideally `markFailedLaunchForUpdate` with an update id).

Embedded IPA `main.jsbundle` has no ClerkExpoPasskeys strings — useful for ruling out *embedded* passkey-import crash class, not for proving tip execution.

---

## C. Retrieving `expo-error.log` from TestFlight Build 78

### Where the file lives (expo-updates 29.0.18)

`ErrorRecovery.ErrorLogFile = "expo-error.log"` written under:

`Application Support/expo-error.log`

i.e. inside the app container:

`Library/Application Support/expo-error.log`

(not under `.expo-internal`). `consumeErrorLog` **deletes** the file after a later successful read (e.g. FileDownloader path) — capture ASAP after a crash.

### Can in-app Diagnostics export the raw file?

**No — not the raw `expo-error.log` file.**

| Path | What it exports | Feasible on crash-loop? |
|------|-----------------|-------------------------|
| Menu → **Device attestation** (`/ota-debug`) → **Copy** full report | `Updates.readLogEntriesAsync` (last ~1h UpdatesLogger ring). The write path also `logger.error`s the serialized fatal, so the **same text may appear** in the “expo-updates native logs” section — but this is **not** a direct file export of `expo-error.log`. | **Only if JS reaches Home / menu.** Instant 0.27s ErrorRecovery death typically **cannot** open Diagnostics. |
| Home attestation strip → open `/ota-debug` | Same static diagnostics + copy | Same limitation |
| Deep link `stadium-mobile://ota-debug` | Same | Still needs a successful enough JS boot |

While `isStartupProcedureRunning=true`, Diagnostics **skips** `readLogEntriesAsync` (zero Updates I/O on open).

### Exact feasible retrieval (Mac + this iPhone)

1. Connect the iPhone (the one that produced the IPS; keep the app installed — do not delete).
2. On Mac: **Xcode → Window → Devices and Simulators**.
3. Select the device → app **Stadium Edge** (`com.stadiumedge.app`) → **gear / “…” → Download Container…** (or “Download Container”).
4. Open the `.xcappdata` package →  
   `AppData/Library/Application Support/expo-error.log`
5. If the file exists, paste the full contents (look for leading `Fatal error:` or `Fatal exception:`).
6. If the file is **missing**: it was never written, already consumed/deleted, or the container download is incomplete — fall through to next method.

**Files app / iCloud / TestFlight UI cannot browse Application Support** for this path. There is no in-app “export expo-error.log” button on Build 78.

### Next evidence-collection method if the file is inaccessible

1. **Mac Console.app** (device connected): filter process `StadiumEdge`, reproduce one cold launch, capture lines containing `Fatal error`, `Fatal exception`, `markFailedLaunchForUpdate`, `errorRecovery`.
2. If the app **can** stay up on embedded after enough failed tip launches: Menu → Device attestation → Copy report → send the `--- expo-updates native logs (last hour) ---` block (and `Updates.updateId` / `isEmbeddedLaunch`).
3. Optional ops (human): embedded rollback (run #5 workflow) so the device can boot UI for Diagnostics — **not** executed by this investigation.

---

## D. Freeze prepared (no publish)

This branch adds:

- Repo-root **`.ota-production-freeze`** (blocks `publish-production-ota.sh`, and now `force-` / `heal-` / `republish-` scripts).
- Freeze gates on force/heal/republish scripts (force previously ignored the freeze file).

**To arm the freeze on production Actions:** merge to `main` (or land `.ota-production-freeze` on `main`) **without** running Publish / Force / Heal / Republish workflows. Do not touch `.ota-force-publish` on that commit.

Emergency embedded rollback remains available via `rollback-production-ota` (not gated by the freeze file in that script).

---

## Remaining gaps

1. Device `expo-error.log` or Console / Diagnostics native-log paste for 10:57–10:58Z.
2. On-device `isEmbeddedLaunch` + `updateId` after a successful boot.
3. Full DWARF dSYM for line-accurate `atos`.
4. Whether tip `01a13a0a` JS-fatals vs tip-boot / recovery race (needs fatal text).
5. Freeze file effective on `main` (merge/ops).

## Targeted fix status

**No speculative app-code fix.** Original fatal not established. Freeze + script gates only.

## Constraints

- No OTA publish, deploy, or EAS/TestFlight build started by this investigation.
