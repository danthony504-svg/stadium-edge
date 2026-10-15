# Build 78 crash — separate from today’s OTA work

**Investigation date:** 2026-10-15  
**Crash date:** 2026-10-14 (IPS)  
**No deploy / OTA from this note.**

## Separation from today’s Coach / preview work

| Claim | Status |
|-------|--------|
| Today’s Coach tip / preview audit caused Build 78 SIGABRT | **Rejected** — crashes are **2026-10-14**; no production OTA published on **2026-10-15** |
| Last production OTA before crashes | Publish #619 → tip `01a13a0a-…` at **2026-10-14T10:52Z** (Account scroll) — temporal correlation only |
| Today’s branch work (opp-context, Nix audit, Telegram shortfall, P0 telemetry) | **Not on production channel**; must **not** be blamed for Build 78 fatals |

## Matching symbols (from IPS + Build 78 binary)

Source: `docs/build78-ips-crash-diagnosis.md` — UUID-matched offsets:

| Offset | Role |
|--------|------|
| 164088 | Trampoline into `errorRecoveryQueue` |
| 568448 / 569024 | ErrorRecovery pipeline → `runNextTask` → `.crash` |
| 573640 | `ErrorRecovery.crash` / `throwException` |

Both IPS: `EXC_CRASH` / `SIGABRT` on `expo.controller.errorRecoveryQueue`.  
**Proven:** Expo ErrorRecovery is the death mechanism.  
**Not proven:** original fatal string, running `updateId`, or that tip `01a13a0a` was executing.

## Expo update / error logs

| Artifact | Status |
|----------|--------|
| `expo-error.log` (Application Support) | **Not captured** — TestFlight container not downloadable; `consumeErrorLog` deletes after read |
| UpdatesLogger / Diagnostics paste | Needs successful JS boot — often impossible in 0.27s loop |
| Console.app / sysdiagnose | Required for `Fatal error` / `markFailedLaunchForUpdate` lines |

Until those logs exist, do **not** attribute the crash to a specific JS tip or to any 2026-10-15 OTA (none published to production today).

## Findings

1. Investigate Build 78 on its own evidence chain (IPS + symbols + expo-error / Console).
2. Do **not** fold it into today’s Coach/Telegram/Nix audit narrative.
3. No deploy or OTA from this investigation.
