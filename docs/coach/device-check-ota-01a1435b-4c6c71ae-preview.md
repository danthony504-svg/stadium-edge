# Device check — preview OTA `01a1435b` (release `4c6c71ae`)

**Published:** 2026-10-16  
**Channel:** `preview` only (existing IPA Build 79 / `9155c37b`)  
**Runtime:** `1.1.0` · **Platform:** `ios`  
**Source commit (forced bake):** `4c6c71ae2a722cb2381c46b9983bc27d85cbe6e3`  
**Method:** `eas update --skip-bundler --input-dir dist` after reviewed export  
**Production:** untouched (embedded `4a0960e4…`); `.ota-production-freeze` **armed**  
**No** native build / server deploy / merge / freeze lift

Includes: Home shortcuts → Coach modes (`balanced` / `safe` / `value` / `longshot`) + passkey startup guard.

---

## Published identity

| Field | Value |
|-------|--------|
| **iOS update ID** | `01a1435b-eb35-749c-b38e-3f71d7fdf88c` |
| **Update group** | `9e0e9076-5fcb-496b-beca-2bea02004b27` |
| Launch `fileSHA256` | `_QetSX8H4kj28hvcjSsaBZjp0TXc9QX5BA6pCBG2byM` |
| Matches reviewed export | **Yes** (manifest launchAsset.hash ≡ local export) |
| Baked `EXPO_PUBLIC_GIT_COMMIT` | `4c6c71ae2a722cb2381c46b9983bc27d85cbe6e3` (explicit set) |
| Passkey guard in HBC | **Present** (`hasClerkExpoPasskeysNative`) |
| Message | `preview 4c6c71ae… — Home shortcuts Coach modes balanced/safe/value/longshot (existing IPA)` |

Artifact: `/opt/cursor/artifacts/preview-publish-4c6c71ae-result.json`

---

## Device follow-up

| Check | Pass criteria |
|-------|----------------|
| `Updates.updateId` | `01a1435b…` (not `01a14342` / `01a14331`) |
| Commit hash (running JS) | full `4c6c71ae…` |
| Hot Picks / Easy Money / Best Value / Longshots | All open Coach with sport + auto-send; Best Value ≠ Props; Longshots ≠ Steals |
| Cold launch / sign-in | No ClerkExpoPasskeys fatal (guard retained) |
