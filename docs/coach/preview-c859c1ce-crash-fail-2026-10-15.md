# FAIL — preview tip `c859c1ce` / update `01a142e1` crashed on device

**Status:** Path A validation **FAIL**. Production freeze **armed**. No native build. No production OTA.

---

## 1. Preserved update / build identity

| Field | Value |
|-------|--------|
| Channel | **preview** |
| iOS update ID | `01a142e1-23e0-772e-beb5-bf03df51e982` |
| Update group | `af92adaa-9a40-44ab-b13a-dfd6d8315061` |
| JS tip | `c859c1ce73ae64182a996a2751b4f831d601ba8d` |
| Construction | cherry-pick of `40f5b9f4` onto baseline `100b2450` |
| Runtime | `1.1.0` |
| Native build under test | **79** / UUID `9bde7e94-4cc6-3eaa-8f7c-29fa073c6e96` |
| Signing | `com.stadiumedge.app` / team `VQSSG3D637` / `storeInfo.thirdParty: true` (Ad Hoc lineage) |
| Device vendor | `291BE85F-D693-4146-88A0-FF631206F5C1` |

IPS copies: `/opt/cursor/artifacts/ips-2026-10-15/StadiumEdge-2026-10-15-232030_5287.ips`, `…232044_5384.ips`, `summary.json`.

**Expo error / recovery logs:** **not attached** to this incident. IPS alone does not contain `expo-error.log` text. Capture ASAP from:

`Library/Application Support/expo-error.log`  
(and Console.app / `Updates.readLogEntriesAsync` if UI can boot after recovery)

---

## 2. Comparison with October 14 crash (do **not** assume same cause)

| Dimension | Oct 14 (Build 78 / TF) | Oct 15 (this FAIL) |
|-----------|------------------------|--------------------|
| App version | `1.1.0` | `1.1.0` |
| Native build # | **78** (TestFlight / `is_beta`) | **79** (Ad Hoc / thirdParty) |
| Binary UUID | (Build 78 UUID — see prior diagnosis) | **`9bde7e94-4cc6-3eaa-8f7c-29fa073c6e96`** |
| Device | `5DFFD9D0-…` | **`291BE85F-…`** (different) |
| Channel context | Production tip `01a13a0a` @ `100b2450` (temporal) | Preview tip `01a142e1` @ `c859c1ce` (under test) |
| Exception | `EXC_CRASH` / `SIGABRT` | **Same** |
| Fault queue | `expo.controller.errorRecoveryQueue` | **Same** |
| Lifetime pattern | ~3740 s then ~0.27 s | **~2146 s then ~0.32 s** (same *shape*) |
| StadiumEdge offsets | **573640 → 569024 → 568448 → 164088** | **573708 → 569092 → 568516 → 163916** |
| Offset delta | — | **+68 / +68 / +68 / −172** vs Oct 14 |
| Original fatal string | **Unknown** | **Unknown** (no `expo-error.log`) |
| Running `updateId` in IPS | **Not present** | **Not present** |

### What is the same
- Death **mechanism**: Expo Updates `ErrorRecovery` → `abort()` on `errorRecoveryQueue`.
- Long-then-instant pair consistent with failed relaunch after a prior fatal.

### What is different (so cause is not assumed identical)
- **Different native binary** (build 79 vs 78, different UUID).
- **Different device**.
- **Different channel / tip under test** (preview `c859c1ce` vs production-era `100b2450` tip).
- Offset cluster shifted by a constant (+68) on the ErrorRecovery trio — consistent with **same symbols, different binary layout**, not proof of the same original JS/native fault.

**Proven:** recovery stack is how the process dies.  
**Not proven:** that the original fatal equals Oct 14’s; that `ClerkExpoPasskeys` is involved; that Home shortcut auto-send is the trigger; that `01a142e1` was the executing update id (IPS has no Updates metadata).

---

## 3. Release vs baseline investigation (`c859c1ce` ← `100b2450`)

### Delta (only)

10 JS files — Home/Coach shortcut wiring (`homeShortcuts`, `coachSilentLaunch`, coach auto-send effect, index quick actions, props/steals destinations). **No** `package.json` / `app.json` / native module changes.

Notable runtime behavior added on Coach mount: `takeCoachLaunch()` + `void sendRef.current(autoMsg)` when Home pushes Hot Picks / Easy Money. That can throw into JS if `send` fails hard, but:
- First IPS lifetime ~36 minutes → **not** an immediate cold-boot-only death.
- Instant second IPS (~0.3 s) matches ErrorRecovery **relaunch failure**, same pattern as Oct 14.

### Baseline `100b2450`
- Was the JS tip for production update `01a13a0a` (Account scroll) temporally correlated with Oct 14 Build 78 IPS.
- **No** recorded cold-launch PASS of that tip on Build 78.
- `c859c1ce` = that baseline **plus** shortcut cherry-pick only.

### Causal status

| Hypothesis | Status |
|------------|--------|
| H1: Tip `01a142e1` / `c859c1ce` JS fatal → ErrorRecovery abort | **Plausible** (under test when crash reported); **unproven** without fatal log / updateId |
| H2: Same original fatal as Oct 14 | **Not assumed** — different binary/device/channel; offsets shifted |
| H3: Home shortcut auto-send is the unique trigger | **Unproven** — long first lifetime; needs log / bisect |
| H4: Baseline `100b2450` alone is sufficient to crash this binary | **Open** — bisect required (baseline-only preview OTA vs `c859c1ce`) |
| H5: OTA apply / reload path (not tip business logic) | **Open** — same death class historically involves apply/recovery |

**Bottom line for republish:** Do **not** republish `c859c1ce` (or promote to production) until `expo-error.log` first Fatal is captured **or** a controlled bisect clears the tip.

---

## 4. Preview recovery plan (production stays frozen)

### Already done
1. Marked validation **FAIL**.
2. Preserved IPS + identity in artifacts / this doc.
3. **Preview** `eas update:roll-back-to-embedded` → group `79838722-e89e-4632-896b-fca5730b8701` / iOS `01a142f6-2f28-7b2f-a152-427678f50a93` (embedded rollback directive).
4. Confirmed **production** still `4a0960e4…` embedded; `.ota-production-freeze` armed.

### Device next (human)
1. Confirm preview-build78 boots on embedded after recovery (cold launch ×2).
2. **Before** a successful boot consumes the file, pull `expo-error.log` from the crash window (Console.app / container if available).
3. Paste first `Fatal error:` / `Fatal exception:` / `markFailedLaunchForUpdate` lines into a follow-up doc.

### Before any republish of this release
| Step | Purpose |
|------|---------|
| A. Capture fatal log | Identify original fault |
| B. Optional bisect on **preview only** | Publish **baseline-only** checkout `100b2450` to preview → cold launches; then `c859c1ce` again only if baseline is clean |
| C. If shortcut auto-send suspected | Preview tip with launch queue **without** auto-`send` on mount |
| D. Keep failed group `af92adaa…` as known-bad | Do not republish that group |
| E. Prefer prior known-good preview (e.g. `d405e8b6` / `40f5b9f4`) only after embedded recovers | Via `eas update:republish --group …` on **preview** — still not production |

### Explicitly not authorized
- Native / EAS rebuild  
- Production OTA / freeze lift  
- Republishing `c859c1ce` / `01a142e1` until investigation clears it  

---

## 5. Freeze

| Item | State |
|------|--------|
| `.ota-production-freeze` | **Armed** |
| Production channel | Embedded rollback `4a0960e4…` |
| Preview channel | Embedded rollback `79838722…` (recovery from failing tip) |
| Release tip `c859c1ce` | **Failed validation — do not ship** |
