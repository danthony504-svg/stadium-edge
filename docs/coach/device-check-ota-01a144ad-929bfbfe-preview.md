# Device check — preview OTA `01a144ad` (release `929bfbfe`)

**Published:** 2026-10-16  
**Channel:** `preview` only (existing IPA Build 79 / `9155c37b`)  
**Runtime:** `1.1.0` · **Platform:** `ios`  
**Source commit (forced bake):** `929bfbfe6847e1488c4c75824373811d1fe22e8c`  
**Method:** `eas update --skip-bundler --input-dir dist` after reviewed export  
**Production:** untouched (embedded `4a0960e4…`); `.ota-production-freeze` **armed**  
**No** native build / server deploy / merge / freeze lift

Includes: longshot plus-money after every substitution (Penguins +2.5 @ −215 fix) + passkey startup guard.

---

## Published identity

| Field | Value |
|-------|--------|
| **iOS update ID** | `01a144ad-87a7-736e-bef2-2187ae79eef8` |
| **Update group** | `15c261b9-3da9-46b1-8c28-61ad57f0278d` |
| Launch `fileSHA256` | `-7_QKY2ZgKaEF6uNuFXrM4MOMfqNNGGc4rxsBc8dw2w` |
| Matches reviewed export | **Yes** |
| Baked `EXPO_PUBLIC_GIT_COMMIT` | `929bfbfe6847e1488c4c75824373811d1fe22e8c` |
| Passkey guard in HBC | **Present** (`hasClerkExpoPasskeysNative`) |
| Message | `preview 929bfbfe… — longshot delivered-odds belt after substitutions (existing IPA)` |

Artifact: `/opt/cursor/artifacts/preview-publish-929bfbfe-result.json`

---

## Device follow-up

| Check | Pass criteria |
|-------|----------------|
| `Updates.updateId` | `01a144ad…` (not `01a143a5`) |
| Commit hash (running JS) | full `929bfbfe…` |
| Longshots | No minus-money ALTs (e.g. Penguins +2.5 @ −215 excluded) |
| Cold launch / sign-in | No ClerkExpoPasskeys fatal |
