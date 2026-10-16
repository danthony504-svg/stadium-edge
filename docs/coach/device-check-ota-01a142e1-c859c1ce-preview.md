# Device check — preview OTA `01a142e1` (release `c859c1ce`) — **FAIL**

**Published:** 2026-10-16  
**Channel:** `preview` only (production untouched; freeze armed)  
**Runtime:** `1.1.0`  
**Update group:** `af92adaa-9a40-44ab-b13a-dfd6d8315061`  
**iOS update ID:** `01a142e1-23e0-772e-beb5-bf03df51e982`  
**JS tip:** `c859c1ce73ae64182a996a2751b4f831d601ba8d`  
**Baseline:** `100b2450c18a74edfc806b6090149b62ad108f96`  
**Binary under test:** build **79** / UUID `9bde7e94-4cc6-3eaa-8f7c-29fa073c6e96` (Ad Hoc / thirdParty — preview-build78 lineage), **not** App Store Build 78  

**Verdict: FAIL** — device crashed while testing this update. Do **not** republish `c859c1ce` until cause is identified.

---

## Preserved identity

| Field | Value |
|-------|--------|
| Preview update under test | `01a142e1-23e0-772e-beb5-bf03df51e982` |
| Group | `af92adaa-9a40-44ab-b13a-dfd6d8315061` |
| Message | `home-shortcuts release c859c1ce Build78-equiv preview validation (prod freeze armed)` |
| JS tip | `c859c1ce73ae64182a996a2751b4f831d601ba8d` |
| App version / build | `1.1.0` / **79** |
| StadiumEdge UUID | `9bde7e94-4cc6-3eaa-8f7c-29fa073c6e96` |
| Vendor ID | `291BE85F-D693-4146-88A0-FF631206F5C1` |
| Team ID | `VQSSG3D637` |

IPS preserved: `/opt/cursor/artifacts/ips-2026-10-15/` + `summary.json`.

---

## Device results

| Check | Result |
|-------|--------|
| Preview publish of `c859c1ce` | Done (then **failed on device**) |
| Cold launch / stability on tip | **FAIL** — ErrorRecovery SIGABRT (see IPS) |
| Hot Picks on this tip | **FAIL** (session aborted by crash; not attested) |
| Easy Money on this tip | **FAIL** (session aborted by crash; not attested) |
| No ErrorRecovery loop | **FAIL** — long-then-instant pair |
| `expo-error.log` / Updates native fatal text | **NOT PROVIDED** |
| Production channel | **Unchanged** (embedded `4a0960e4…`) |

---

## IPS pair (2026-10-15 CDT)

| Report | Incident | Lifetime | Fault queue |
|--------|----------|----------|-------------|
| `StadiumEdge-2026-10-15-232030_5287.ips` | `CE87A839-…` | **~2146 s (~36 min)** | `expo.controller.errorRecoveryQueue` |
| `StadiumEdge-2026-10-15-232044_5384.ips` | `B4ACF74F-…` | **~0.32 s** | `expo.controller.errorRecoveryQueue` |

Both: `EXC_CRASH` / `SIGABRT`, `asi: abort() called`.  
StadiumEdge offsets in `lastExceptionBacktrace`: **573708 → 569092 → 568516 → 163916**.

---

## Preview recovery (executed)

| Action | Value |
|--------|--------|
| `eas update:roll-back-to-embedded --channel preview` | Done |
| Recovery group | `79838722-e89e-4632-896b-fca5730b8701` |
| Recovery iOS update | `01a142f6-2f28-7b2f-a152-427678f50a93` |
| Production | **Not touched** — still `4a0960e4…` embedded |

Full cause analysis + next steps: [`preview-c859c1ce-crash-fail-2026-10-15.md`](./preview-c859c1ce-crash-fail-2026-10-15.md).
