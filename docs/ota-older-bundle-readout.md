# Read running update ID without Device attestation menu

Use this when Build 78 / an older OTA still hides Menu → Device attestation
(`shouldShowOtaDiagnosticsMenuItem` was `return isDev` on pre-`01a13019` tips).

## Option A — deep link (works on tips that register `/ota-debug`)

1. Open Safari on the iPhone.
2. Paste and open: `stadium-mobile://ota-debug`
3. If the screen opens: **Copy report** (static fields include `Updates.updateId`,
   `isEmbeddedLaunch`, `isEmergencyLaunch`, apply / rollback diagnosis).
4. If the app crashes into **Something went wrong**: the ErrorFallback block already
   shows selectable `updateId`, `runtime`, `channel`, `isEmbeddedLaunch`,
   `updatePreviouslyFailed` — tap **Copy Diagnostics**.

## Option B — Sign in / Account (after apply-fix tip)

Once the apply-fix OTA stays running:

- **Sign in** screen footer → **Running update** chip (copy / open `/ota-debug`)
- **Account** (signed-in) → same chip above Delete account
- Home → Device attestation strip (if present)
- Blue **App update ready** banner shows `running … → downloaded …` short ids

## Option C — classify launch vs selection

From the copied report / chip `applyOutcome`:

| Outcome | Meaning |
|---------|---------|
| `launch_failed` | Restart targeted a tip; boot did not stay on it (ledger failed / emergency / `updatePreviouslyFailed`) |
| `selection_failed` | Embedded with no successful tip selection / `reloadAsync` threw |

## Tip `01a13540` native first error

Device: embedded + `reason=updatePreviouslyFailed` means Expo already recorded
`failedLaunchCount>0` for that tip. The **first** native error is the
`Fatal error:` / `Fatal exception:` line in `expo-error.log` (or
`readLogEntriesAsync`) immediately before
`AppController markFailedLaunchForUpdate` for `01a13540…` — written when a
fatal hit ErrorRecovery **before** `RCTContentDidAppear`. Later
`updatePreviouslyFailed` is only the blacklist symptom. That tip id cannot be
recovered; publish a superseding update id.
| `idle_embedded` | Cold start on embedded, no Restart target recorded this boot |
| `applied_ok` / `launched` | Tip is running (`isEmbeddedLaunch=false`) |

## Native deps note (OTA #616 vs Build 78)

`package.json` native-ish dependencies are **identical** between tip `a20c3939`
(Build 78–era channel tip) and `0330710` (OTA #616). Failure is **apply/selection**,
not a missing native module on Build 78.
