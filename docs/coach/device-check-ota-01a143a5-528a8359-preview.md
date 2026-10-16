# Device check — preview OTA `01a143a5` (release `528a8359`)

**Published:** 2026-10-16  
**Channel:** `preview` only (existing IPA Build 79 / `9155c37b`)  
**Runtime:** `1.1.0` · **Platform:** `ios`  
**Source commit (forced bake):** `528a835924881dfc812c01cfadb860ec43191039`  
**Method:** `eas update --skip-bundler --input-dir dist` after reviewed export  
**Production:** untouched (embedded `4a0960e4…`); `.ota-production-freeze` **armed**  
**No** native build / server deploy / merge / freeze lift

Includes: all-sports Home shortcuts + explicit `ticketStyle` + longshot plus-money seating through backfill/replacement + passkey startup guard.

---

## Published identity

| Field | Value |
|-------|--------|
| **iOS update ID** | `01a143a5-e68b-716c-b862-fc029356e00d` |
| **Update group** | `95a38bc4-ff00-44fe-8cad-133341803480` |
| Launch `fileSHA256` | `kE-TEyEhMY-kH6qsb_0BWsOZfOZTDpjDtTUX4XG98vg` |
| Matches reviewed export | **Yes** (manifest launchAsset.hash ≡ local export) |
| Baked `EXPO_PUBLIC_GIT_COMMIT` | `528a835924881dfc812c01cfadb860ec43191039` (explicit set) |
| Passkey guard in HBC | **Present** (`hasClerkExpoPasskeysNative`) |
| Message | `preview 528a8359… — all-sports Home shortcuts + longshot backfill (existing IPA)` |

Artifact: `/opt/cursor/artifacts/preview-publish-528a8359-result.json`

---

## Device follow-up

| Check | Pass criteria |
|-------|----------------|
| `Updates.updateId` | `01a143a5…` (not `01a1435b` / `01a14342`) |
| Commit hash (running JS) | full `528a8359…` |
| Hot Picks / Easy Money / Best Value / Longshots | All open Coach all-sports with explicit ticketStyle; Best Value ≠ Props; Longshots ≠ Steals |
| Longshots seating | No minus-money lead / fill (e.g. Guardians −575 excluded) |
| Cold launch / sign-in | No ClerkExpoPasskeys fatal (guard retained) |
