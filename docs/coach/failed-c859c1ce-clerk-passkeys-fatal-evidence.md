# Direct evidence — missing-`ClerkExpoPasskeys` fatal on failed release `c859c1ce`

**Status:** Preserved as the original-fatal class for the **failed preview release**  
`c859c1ce` / update `01a142e1-23e0-772e-beb5-bf03df51e982` / group `af92adaa-9a40-44ab-b13a-dfd6d8315061`  
on Build **79** binary UUID `9bde7e94-4cc6-3eaa-8f7c-29fa073c6e96` (EAS `9155c37b`, `ClerkExpoPasskeys` **absent**).

**October 14 Build 78:** Do **not** attribute to this same cause without its own `expo-error.log` / Fatal paste. Same death *mechanism* (ErrorRecovery SIGABRT) only.

---

## Fatal string (failed release class)

```text
Cannot find native module 'ClerkExpoPasskeys'
```

Historical device wording (OTA #617 / Build 78–class binaries):  
`Unhandled JS Exception: Error: Cannot find native module 'ClerkExpoPasskeys'`.

Why this binds to **`c859c1ce` specifically** (not assumed for Oct 14):

| Fact | Evidence |
|------|----------|
| Binary under test lacks native module | IPA `9155c37b` / Build 79 strings: `ClerkExpoPasskeys` **absent** |
| Failed tip JS lacks native-availability guard | `git show c859c1ce:…/passkeyAuth.ts` — **no** `hasClerkExpoPasskeysNative` |
| PASS tip / corrected candidate has guard | `40f5b9f4` / `afcf638d` — probes `requireOptionalNativeModule("ClerkExpoPasskeys")` **before** `require("@clerk/expo/passkeys")` |
| Shortcuts are not the differentiator | `git diff 40f5b9f4 c859c1ce` on shortcut files = **empty** |
| Terminal death | Oct 15 IPS: ErrorRecovery `runNextTask` → `.crash` / SIGABRT (symbolicated) |

---

## Exact import / provider path (cold start)

```text
app/_layout.tsx  (module scope)
  └─ import { getPasskeys } from "@/lib/passkeyAuth"

RootLayout
  └─ SafeAreaProvider → ErrorBoundary → RootLayoutContent
       └─ ClerkProvider
            __experimental_passkeys={getPasskeys() ?? undefined}   // every boot

getPasskeys()   [FAILED tip c859c1ce / 100b2450]
  └─ passkeysLoader() → require("@clerk/expo/passkeys")
       └─ package top-level requireNativeModule("ClerkExpoPasskeys")  // throws
            └─ Unhandled JS Exception → Expo ErrorRecovery → abort()

getPasskeys()   [WORKING tip 40f5b9f4 / corrected candidate]
  └─ hasClerkExpoPasskeysNative() === false
       └─ return null   // never requires @clerk/expo/passkeys
            └─ ClerkProvider gets undefined → boot continues
```

`_layout.tsx` blob is **identical** GOOD↔BAD; only `passkeyAuth.ts` (and OTA apply helpers) differ.

---

## Known-bad retention

| Item | ID |
|------|-----|
| Group | `af92adaa-9a40-44ab-b13a-dfd6d8315061` |
| Update | `01a142e1-23e0-772e-beb5-bf03df51e982` |
| JS tip | `c859c1ce73ae64182a996a2751b4f831d601ba8d` |
| IPS | `/opt/cursor/artifacts/ips-2026-10-15/` |
