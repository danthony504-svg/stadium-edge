# Phone stuck on “missing auth key” — recovery path (preview)

**Do not mark passed until a physical preview IPA cold-launches through ClerkProvider and signs in.**

## Why the phone is stuck

On the bad tip (`01a14ab5…` / `Agsx8Vqa…`), `RootLayoutContent` hits:

```ts
if (!publishableKey) return <error screen>;
```

That early return is **before** `ClerkProvider` and **before** `AppShell` → `DeferredOtaRuntime`. JS OTA check/fetch/reload never mounts, so the phone cannot self-heal from inside that screen on the bad bake.

Native `expo-updates` `checkAutomatically: ON_LOAD` can still fetch a newer channel tip on the **next** cold start.

## Exact recovery steps (preview IPA / Build 79)

1. **Force-quit** Stadium Edge (swipe away from app switcher). Do not leave it backgrounded.
2. **Reopen** the app once. Native ON_LOAD should pull the current preview tip:
   - Corrected Clerk bake: update `01a14ac4…` / bake `135cd76d…` / hash `ooO4Lk2Z…` (or a later tip that includes the MissingAuthKeyScreen recovery UI).
3. Confirm you are **not** on the missing-key screen (sign-in / Clerk boot should appear).
4. If still on the error screen:
   - Note any `updateId` / `channel` / `baked SHA` if the newer tip’s identity strip is visible.
   - Tap **Check for update & reload** (available on tips that include `MissingAuthKeyScreen`).
5. If still stuck: **delete the app** → reinstall the preview / TestFlight IPA → open once (downloads latest preview OTA).
6. Attest: Device attestation / running bundle shows the corrected `updateId` + bake SHA; email/password sign-in succeeds.

## Rollback (if a corrected tip is invalid)

```bash
eas update:republish \
  --group dd669b36-2dfd-40fb-8970-63ac7b71f759 \
  --platform ios \
  --message "PREVIEW recover 54b89f32/2ecBll"
```

Last verified working launch hash: `2ecBllWhtHVRT39CG_l8QAjlaiZMyZzlC54riVre4XM`.  
**Production:** do not touch.
