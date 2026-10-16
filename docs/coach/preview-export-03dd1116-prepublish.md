# Preview export — `03dd1116` (pre-publication)

**Status:** Local export **only**. **Not published.** Production freeze **armed**. No native build. No server deploy.

---

## Release identity

| Field | Value |
|-------|--------|
| **Full SHA** | `03dd11160a0f6e6e91fa5046384f918844f76349` |
| Short | `03dd1116` |
| Branch | `cursor/prod-ota-home-shortcuts-8b51` |
| Runtime | `1.1.0` |
| Channel intent | `preview` (when authorized to publish) |
| Contents | Home shortcuts + `hasClerkExpoPasskeysNative` guard + OTA hardenings from `40f5b9f4` |

---

## Export checks (passed)

| Check | Result |
|-------|--------|
| `expo export --platform ios --clear` | OK → `dist/` |
| HBC | `_expo/static/js/ios/entry-5e6943f2e4feef544da2e499a08fe833.hbc` (~9.51 MB) |
| Content SHA-256 | `eeb81083aaf80e480b1bc69179c70f43e4428fa5104ee26f1081255bfdf6107d` |
| EAS-style `fileSHA256` | `7rgQg6r4DkgLG8aReccPQ-RCj6UQTuJvEIElW_32EH0` |
| Baked `EXPO_PUBLIC_GIT_COMMIT` | Full `03dd1116…` present (**forced**; prior shell value unset) |
| Stale `afb30bde…` bake | **Absent** |
| `hasClerkExpoPasskeysNative` in HBC | **Present** |
| `requireOptionalNativeModule` in HBC | **Present** |
| Distinct-marker probe (GITCOMMIT_MARKER / DEPLOYMSG_MARKER) | **Passed** (proves Metro inlines both env vars) |
| Unit: `passkeyAuth` + `passkeyStartupGuard` | **16/16 pass** |
| Preview channel tip unchanged | Still `01a1430d` / `2d980f30` |
| Production channel | Still embedded `4a0960e4…` / `01a13aae` |
| `.ota-production-freeze` | **Armed** |

Artifacts: `/opt/cursor/artifacts/preview-export-03dd1116-checks.json`, `preview-export-03dd1116.log`, `preview-export-03dd1116-metadata.json`.

### Guard behavior (startup)

When `ClerkExpoPasskeys` is absent:

1. `hasClerkExpoPasskeysNative()` → `false` via `requireOptionalNativeModule`
2. `getPasskeys()` returns `null` **without** `require("@clerk/expo/passkeys")`
3. `_layout` passes `__experimental_passkeys={undefined}` to `ClerkProvider`
4. Regression: `lib/passkeyStartupGuard.test.ts`

### Other sign-in methods preserved

| Method | Behavior with native passkeys absent |
|--------|--------------------------------------|
| Email / password | Unchanged — does not require `getPasskeys()` success |
| Passkey UI | `isPasskeysSupported()` → `false`; passkey buttons stay hidden/disabled |
| Apple / Google / other Clerk factors | Unaffected by passkeys prop being `undefined` |

---

## Exact preview test plan (before publication)

Do **not** publish until an owner authorizes. When authorized, publish **preview only** with:

```bash
# From clean shell — force bake (never reuse prior EXPO_PUBLIC_GIT_COMMIT)
unset EXPO_PUBLIC_GIT_COMMIT EXPO_PUBLIC_DEPLOY_MESSAGE
EXPO_PUBLIC_GIT_COMMIT=03dd11160a0f6e6e91fa5046384f918844f76349 \
  bash artifacts/stadium-mobile/scripts/publish-preview-ota.sh \
  'preview 03dd1116 — passkeys native guard + home shortcuts'
```

### Device matrix (Build 79 / `preview-build78` IPA `9155c37b`, UUID `9bde7e94…`)

| # | Step | Pass criteria |
|---|------|----------------|
| 0 | Confirm binary: Build 79, channel `preview`, no `ClerkExpoPasskeys` | IPA inspect / prior attestation |
| 1 | Apply new preview tip; confirm `Updates.updateId` is the **new** id (not `01a1430d` / not `01a142e1`) | Device attestation |
| 2 | Confirm **Commit hash (running JS)** equals `03dd11160a0f6e6e91fa5046384f918844f76349` (not stale `afb30bde`) | Attestation `commitHash` |
| 3 | Cold launch ×3 | No ErrorRecovery / SIGABRT; Home paints |
| 4 | Menu → Device attestation → Copy | No `Fatal` / `Cannot find native module 'ClerkExpoPasskeys'` in native logs |
| 5 | Sign-in: email/password (or Apple) | Succeeds without passkeys |
| 6 | Passkey control | Hidden or non-fatal when unsupported |
| 7 | Home → Hot Picks | Coach silent launch + auto-send |
| 8 | Home → Easy Money | Coach silent launch + auto-send |
| 9 | Production channel / freeze | Unchanged; no production publish |

### Explicitly out of scope until authorized

- Production OTA / freeze lift  
- Native / EAS rebuild  
- Server deploy  
- Republishing known-bad `af92adaa…` / `c859c1ce`  
