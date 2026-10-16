# Preview recovery candidate — `40f5b9f4` (not published)

**Status:** Candidate **republished to preview** as update `01a1430d…` / group `2d980f30…` (see [`device-check-ota-01a1430d-d405-republish-preview.md`](./device-check-ota-01a1430d-d405-republish-preview.md)). Failed group `af92adaa…` remains **known-bad**. Production freeze **armed**. No native build. No production OTA.

---

## 1. Original exception recovery (logs exhausted)

| Source | Result |
|--------|--------|
| Uploaded IPS pair (Oct 15) | Present — ErrorRecovery SIGABRT only; **no** fatal string |
| `expo-error.log` / Console.app / `Updates.readLogEntriesAsync` | **Not in uploads, artifacts, transcript, or EAS insights** |
| Connected iPhone / `idevice*` | **None** in this environment |
| EAS update insights (`af92adaa…`) | 1 install, `crashRatePercent: 0` (does **not** surface ErrorRecovery fatals) |
| Binary string `ErrorRecovery fatal exception: ` | Present in UUID-matched Build 79 IPA — proves logger format; **payload not recovered** |

**Verdict:** Existing remote logs are exhausted. The original JS/native exception text is still **unknown**. Next capture (human, when a device can boot after embedded recovery) remains: `Library/Application Support/expo-error.log` **before** a successful `consumeErrorLog` deletes it — not another tip bisect.

---

## 2. IPS symbolication (UUID-matched Build 79)

| Field | Value |
|-------|--------|
| IPS UUID | `9bde7e94-4cc6-3eaa-8f7c-29fa073c6e96` |
| Matching binary | EAS `9155c37b-0297-45a7-98fe-ea3f38bea6a9` (`preview-build78`, **build 79**) |
| UUID match | **Yes** |
| `ClerkExpoPasskeys` in binary | **Absent** |
| DWARF `.dSYM` | **Not available** (EAS Build Artifacts URL null) |

| Offset | VA | Correlation (Capstone + LC_FUNCTION_STARTS + Build78 Δ) |
|--------|-----|--------------------------------------------------------|
| **573708** | `0x10008c10c` | `ErrorRecovery.crash` / `throwException` body |
| **569092** | `0x10008af04` | `runNextTask` → `.crash` (confirmed `bl` to crash func `0x10008b788`) |
| **568516** | `0x10008acc4` | ErrorRecovery pipeline helper |
| **163916** | `0x10002804c` | Swift block trampoline into `errorRecoveryQueue` |

Artifacts: `/opt/cursor/artifacts/ips-2026-10-15/symbolication-build79.json`.

**Oct 14 IPS:** prior Build 78 symbolication stands (`90811de5…`, offsets 573640→…). Those `.ips` / IPA extracts are **not** on this VM; re-symbolication of Oct 14 was not repeated. Same death class, different binary — original fatal still unproven for both.

---

## 3. Failed tip vs last-good preview (not just 10 files)

| Role | Identity |
|------|----------|
| **GOOD** (Hot Picks + Easy Money **PASS**) | Git `40f5b9f4…` · update `01a14121…` · group `d405e8b6…` |
| **BAD** (Path A **FAIL**) | Git `c859c1ce…` · update `01a142e1…` · group `af92adaa…` |
| BAD construction | Cherry-pick of `40f5b9f4` **onto** `100b2450` (drops 48 commits of GOOD ancestry) |

### Shortcut surface
`git diff 40f5b9f4 c859c1ce` on `homeShortcuts` / `coachSilentLaunch` / Home index → **empty**. Shortcuts are **not** the ancestry gap.

### Startup / import / provider differences (ErrorRecovery-relevant)

Entry `_layout.tsx` blob is **identical**, but early-loaded implementations differ:

1. **`passkeyAuth.ts` (highest priority)** — GOOD has `hasClerkExpoPasskeysNative()` via `requireOptionalNativeModule("ClerkExpoPasskeys")` and **skips** `require("@clerk/expo/passkeys")` when absent (`afcf638d`). BAD/`100b2450` lacks that guard; on this Build 79 binary (passkeys **unlinked**), evaluating the Clerk passkeys package at `ClerkProvider` mount remains the leading unproven original-fatal class.
2. **OTA apply / embedded-rollback path** — GOOD has `isRollBackToEmbedded` / safer `reloadAsync` gating / `otaLaunch` skip-when-current; BAD does not. Relevant to the ~0.3 s second IPS (recovery relaunch), not proof of first fatal.
3. **Build-time only** (`react-native.config.js`, strip hooks, `app.config.js`) — affect IPA construction, not OTA JS; already reflected in installed Build 79.

Full startup patch: `/opt/cursor/artifacts/recovery-candidate-40f5b9f4/startup-provider-diff-good40f5-vs-badc859.patch`  
Mobile `--stat`: `/opt/cursor/artifacts/recovery-candidate-40f5b9f4/full-mobile-stat-good-vs-bad.txt` (87 paths under `artifacts/stadium-mobile`).

---

## 4. Recovery candidate (exact diff)

| Field | Value |
|-------|--------|
| **Candidate git tip** | `40f5b9f4747df2b99c98c4c08d26f276e2e07d16` |
| **Required shortcut changes on top** | **None** — already included and device-PASSed on preview |
| **Exact diff vs demonstrated working baseline** | **Empty** (`candidate-vs-working-baseline.diff` is 0 bytes) |
| **Published form (authorized 2026-10-16)** | `eas update:republish --group d405e8b6-edf6-45d3-a8a6-d977ea97d2f4 --platform ios` → **new** group `2d980f30-223d-4cca-8654-48929301d4af` / iOS `01a1430d-37ee-747a-be37-c296473cff9f` |
| **Do not publish** | `c859c1ce` / group `af92adaa…` |

### Why not `100b2450` + shortcut cherry-pick again
That is exactly the failed release shape: shortcuts without Build78 passkey/OTA hardening that the working preview tip carried.

### Validation completed here (pre-publish)
| Check | Result |
|-------|--------|
| Production freeze file present | **Yes** |
| Preview currently on embedded recovery `01a142f6…` / `79838722…` | **Yes** (prior recovery) |
| UUID-matched IPS symbolication | **Done** |
| GOOD tip includes `hasClerkExpoPasskeysNative` | **Yes** |
| GOOD tip `passkeyAuth` unit tests | See `/opt/cursor/artifacts/recovery-candidate-40f5b9f4/passkeyAuth-good-tip-tests.log` |
| Device cold-launch of candidate on Build 79 | **Not run** (no publish; no connected phone) |
| Original fatal string | **Still missing** |

### Validation required before any preview publish of this candidate
1. Prefer one more attempt to pull `expo-error.log` from the crash window on the recovery-embedded boot (does not require republishing a tip).
2. If publishing is still desired without that string: republish **only** group `d405e8b6` (known PASS) on preview — not a new untested tip.
3. Cold launch ×2 on Build 79 / UUID `9bde7e94…`; Hot Picks; Easy Money; no ErrorRecovery.
4. Keep `af92adaa…` known-bad; keep production frozen.

---

## 5. Freeze / known-bad (unchanged)

| Item | State |
|------|--------|
| `.ota-production-freeze` | **Armed** |
| Production | Embedded `4a0960e4…` |
| Failed preview group | `af92adaa-9a40-44ab-b13a-dfd6d8315061` / `01a142e1…` / `c859c1ce` — **known-bad** |
| This candidate | **Docs only — not published** |
