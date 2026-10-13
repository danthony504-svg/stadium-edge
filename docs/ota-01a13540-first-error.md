# Tip `01a13540` — first native error (reconstructed) + PR #724 root-cause fix

## Device evidence (confirmed)

| Field | Value |
|-------|-------|
| Running | embedded (`isEmbeddedLaunch=true`) |
| Channel tip | `01a13540-fed5-7fbf-baf2-db29681a48fe` |
| `checkForUpdateAsync` | `isAvailable=false`, `reason=updatePreviouslyFailed` |

Expo `CheckForUpdateProcedure` returns `updatePreviouslyFailed` only when the
stored DB row for that tip has `failedLaunchCount > 0` **and**
`successfulLaunchCount == 0`. So tip `01a13540` **did launch at least once** and
was marked failed before a successful mark.

## First native error (what `expo-error.log` / `readLogEntriesAsync` must show)

`failedLaunchCount` is incremented **only** from
`ErrorRecovery.startPipeline` → `markFailedLaunchForLaunchedUpdate()` when a
fatal is handled **before** `RCTContentDidAppear`.

That path always:

1. Writes `expo-error.log` via `ErrorRecovery.writeErrorOrExceptionToLog` with a
   leading line of either:
   - `Fatal error: …` (NSError / UpdatesError), or
   - `Fatal exception: …` (NSException)
2. Logs UpdatesLogger warn: **`AppController markFailedLaunchForUpdate`** with
   `updateId` = short logging id for `01a13540-…`

So the **first error involving OTA `01a13540`** in the native log stream is that
Fatal error/exception entry immediately preceding
`AppController markFailedLaunchForUpdate` for that update id — not the later
`reason=updatePreviouslyFailed` check result (that is only the blacklist
symptom).

Raw device `expo-error.log` / paste was **not** available in this agent
environment; the above is the Expo-native contract for this failure class
(same class as historical tip `01a131bc` tip-boot blacklist).

## Tip `01a13540` bytecode vs Build 78 apply path

Published tip (commit `0330710` / OTA #616) Hermes bundle contains:

- `reloadScreenOptions` on the production `reloadAsync` path
- `DEFAULT_LAUNCH_DELAY_MS` wired at **400ms** (tip source)
- No production Restart banner (`EXPO_PUBLIC_OTA_USER_BANNER` unset → gated off)

Failure window: Restart selected `01a13540` → relaunch started error monitoring
→ fatal **or** tip-boot Updates I/O / reload before ContentDidAppear →
`markFailedLaunch` → embedded wins → subsequent checks return
`updatePreviouslyFailed`.

## Does PR #724 fix that failure (not only diagnostics)?

| Lever | Tip `01a13540` | PR #724 (+ this hardening) | Root-cause? |
|-------|----------------|----------------------------|-------------|
| Auto `reloadAsync` on boot | OtaController: no | Still no | Prevents 01a131bc pattern |
| First check delay | **400ms** | **3500ms** + wait for startup idle | Yes — tip-boot race |
| Updates I/O while `isStartupProcedureRunning` | Allowed | **Blocked** (check + restart) | Yes — ErrorRecovery race |
| `reloadAsync({ reloadScreenOptions })` | Yes | **Bare** `reloadAsync()` | Yes — Build 78 apply |
| Failed-launch ledger | Missing | `noteReloadTarget` before reload | Classification + safety |
| Banner / readout | Off / attestation menu | Banner on + Sign-in chip | Diagnostics only |
| Blacklisted tip id recoverable? | No | **Requires fresh update id** | Publish requirement |

**Verdict:** #724 (with startup-procedure gate) addresses the **launch-failure
class** that produces `updatePreviouslyFailed` for `01a13540`. Diagnostics alone
would not. The blacklisted id itself cannot be revived — publish a superseding
production tip, then Restart **or** cold-start after fetch.

## Preserve

Login/Clerk, subscriptions/StoreKit, both 7-day trial honesty paths. No Build 79.
