# Build 78 IPS crashes (2026-10-14) — ErrorRecovery SIGABRT

## Scope

Two TestFlight Build 78 / `1.1.0` reports (`90811de5-15a8-3023-bb9e-1862263245ef`):

| Report | Incident | `procLaunch` (CDT) | Capture (CDT) | Lifetime | Fault queue |
|--------|----------|--------------------|---------------|----------|-------------|
| `StadiumEdge-2026-10-14-055739_3532.ips` | `CAEE5EBC-…` | 04:55:19 | 05:57:39 | **3740 s (~62 min)** | `expo.controller.errorRecoveryQueue` |
| `StadiumEdge-2026-10-14-055852_e467.ips` | `5075F146-…` | 05:58:51.397 | 05:58:51.672 | **0.27 s** | `expo.controller.errorRecoveryQueue` |

Same device (`5DFFD9D0-87A0-4C42-B2EB-20A558D26F3A`), same binary UUID, identical StadiumEdge image offsets in `lastExceptionBacktrace`: **573640 → 569024 → 568448 → 164088**.

Constraints honored: no OTA publish, no deploy, no new native build from this investigation.

## Proven cause (what the IPS proves)

### Terminal abort class

Both reports are `EXC_CRASH` / `SIGABRT` with `asi: abort() called`, faulting on Expo Updates’ **`expo.controller.errorRecoveryQueue`**.

That queue label is created only in `EXUpdates.ErrorRecovery` (`expo-updates` ErrorRecovery.swift). The terminal pipeline task `.crash` calls `crash()` → `delegate.throwException(NSException…)` → process abort when recovery cannot relaunch a working update.

**The Expo recovery stack is the mechanism of death, not the original app bug.**

### Symbolication (UUID-matched Build 78 binary)

Artifacts used:

- IPA binary: `/tmp/build78-artifacts/ipa-extract/Payload/StadiumEdge.app/StadiumEdge` (Mach-O UUID `90811DE5-15A8-3023-BB9E-1862263245EF`)
- Companion Apple `.symbols` (same UUID; contains 111 mangled `ErrorRecovery` symbols; address table not decoded on Linux)
- No DWARF `.dSYM` bundle was present (folder named `dsym-extract` was another IPA unpack)

Binary is stripped (symtab ≈ `__mh_execute_header` only). Offsets were resolved via `LC_FUNCTION_STARTS` + Capstone arm64 disassembly and correlated to `ErrorRecovery.swift` / mangled names in the `.symbols` file:

| Image offset | VA (`0x100000000+off`) | Function start | Correlation |
|--------------|------------------------|----------------|-------------|
| **164088** | `0x1000280f8` | `0x1000280dc` | Swift block trampoline (`blr x19`) — dispatch into `errorRecoveryQueue` work |
| **568448** | `0x10008ac80` | `0x10008abe8` | Epilogue of prior ErrorRecovery pipeline helper |
| **569024** | `0x10008aec0` | `0x10008ac90` | Caller that `bl`’s into `0x10008b744` (crash body) — matches `runNextTask` → `.crash` |
| **573640** | `0x10008c0c8` | `0x10008b744` | Inside large frame that builds/raises `NSException` — matches `ErrorRecovery.crash` / `throwException` |

Mangled names present in the UUID-matched `.symbols` file include:

- `_$s9EXUpdates13ErrorRecoveryC5crash33_…LLyyF`
- `_$s9EXUpdates13ErrorRecoveryC11runNextTask33_…LLyyF`
- `_$s9EXUpdates13ErrorRecoveryC13startPipeline33_…`
- `_$s9EXUpdates13ErrorRecoveryC05writeB16OrExceptionToLog__…`

Instant-crash IPS also shows concurrent work on `dev.expo.modules.core.logging` opening a file handle (`fileHandleForWritingAtPath`) while the recovery queue aborts — consistent with `ErrorRecovery.writeErrorOrExceptionToLog` writing **`expo-error.log`** for the *original* fatal (text not embedded in the `.ips`).

### What is **not** proven from these two IPS files

- The **original** JS/native fatal string (e.g. `Cannot find native module 'ClerkExpoPasskeys'`, Coach, Restart banner, Account scroll) is **not** present in either `.ips`.
- Passkeys / Coach / Restart banner are **not** asserted as the Oct-14 trigger without `expo-error.log` / `readLogEntriesAsync` paste.

## Update / channel correlation

| When (UTC) | Event | ID / note |
|------------|-------|-----------|
| 2026-10-14 **02:40:47Z** | **Rollback production OTA (embedded) run #5** — success | [run 38502290200](https://github.com/danthony504-svg/stadium-edge/actions/runs/38502290200) → iOS update `01a13849-3796-71b1-9607-fd9cd4493ef8`, message *Emergency rollback to embedded bundle*, group `9125e6db-…` |
| 2026-10-14 **09:55:19Z** | Long process launches | After rollback #5; healthy ~62 min session |
| 2026-10-14 **10:52:10Z** | **Publish production OTA** | [run 38552272849](https://github.com/danthony504-svg/stadium-edge/actions/runs/38552272849) @ `100b2450` — *fix(account): scroll so Sign out…* → iOS update **`01a13a0a-825f-72b5-8372-76e92d45f5c0`**, group `b76dd8f2-…`, channel `production`, `runtimeVersion` `1.1.0`, `EXPO_PUBLIC_OTA_USER_BANNER=true` |
| 2026-10-14 **10:57:39Z** | Long process SIGABRT (ErrorRecovery) | ~5 minutes after tip publish |
| 2026-10-14 **10:58:51Z** | Instant relaunch SIGABRT (0.27 s) | Classic failed tip boot before `RCTContentDidAppear` |
| Live check (investigation) | Channel tip | `expo-update-id: 01a13a0a-825f-72b5-8372-76e92d45f5c0` |

### Embedded vs downloaded

| Evidence | Conclusion |
|----------|------------|
| Rollback #5 published an embedded-rollback directive before the long session | Channel directed clients to **embedded** after 02:41Z |
| Embedded `main.jsbundle` in Build 78 IPA has **no** `ClerkExpoPasskeys` / `@clerk/expo/passkeys` / `getPasskeys` strings | Embedded JS is pre-passkey; a 62‑minute foreground session is consistent with **embedded** (or another non-fatal bundle), not the historical passkey tip crash-on-import |
| Tip `01a13a0a` published ~5 minutes before the fatal window; instant relaunch dies in ErrorRecovery | Strong temporal correlation that the device **attempted to launch downloaded tip `01a13a0a`** (in-process `reloadAsync` keeps the same `procLaunch` for the long IPS) |
| Instant IPS has much smaller `MALLOC` / `mapped file` than the 62‑min IPS | Early-launch death vs full session |

**Best-supported narrative:** post–rollback #5 the app ran **embedded** successfully → production tip **`01a13a0a`** was published → apply/reload into that downloaded update → fatal before content appeared → ErrorRecovery pipeline exhausted → SIGABRT; cold start retried the bad launch and died in 0.27 s.

## Prior same-offset class (context only)

Oct 13 Build 78 IPS files on the same device/UUID share offsets `573640/569024/568448/164088`. On-device logs from the `01a13582` era previously showed:

`Unhandled JS Exception: Error: Cannot find native module 'ClerkExpoPasskeys'`

That fatal was addressed in tip `01a136bb` / fail-soft `getPasskeys()` (`23550135`). **Oct 14 IPS do not re-prove that string.** Tip `01a13a0a`’s git tree includes fail-soft + tip-boot gates; CDN asset download from this agent was unauthorized, so the published Hermes blob was not re-scanned here.

## Remaining gaps

1. **`expo-error.log` / Updates logger paste** from the device for the 10:57–10:58Z window (first `Fatal error:` / `Fatal exception:` before `markFailedLaunchForUpdate`).
2. Full **DWARF dSYM** (not only Apple `.symbols`) for line-accurate `atos` of `0x8c0c8` / `0x8aec0` / `0x8ac80` / `0x280f8`.
3. On-device attestation: `isEmbeddedLaunch`, `updateId`, `createdAt` immediately after the crash loop.
4. Whether `01a13a0a` itself JS-fatals, or a tip-boot / reload race re-entered ErrorRecovery without a new app-level bug.

## Targeted fix status

**No code fix shipped from this investigation** — original fatal text is not established from the two IPS files. Speculative changes blaming passkeys, Coach, Restart banner, or Account scroll would violate the evidence bar.

Operational options (human / ops — not executed here):

- Capture `expo-error.log` / OTA Diagnostics native log on next repro.
- If production must stay up: another **embedded rollback** (same workflow as run #5) until the tip fatal is identified — **not** performed by this agent.

## Constraints

- No OTA publish, deploy, or EAS/TestFlight build started by this investigation.
