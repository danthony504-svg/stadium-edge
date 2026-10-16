# Device check — production OTA `01a144b4` (release `929bfbfe`)

**Published:** 2026-10-16  
**Channel:** `production` only (App Store Build 78 / runtime `1.1.0`)  
**Source commit (forced bake):** `929bfbfe6847e1488c4c75824373811d1fe22e8c`  
**Method:** `eas update --skip-bundler --input-dir dist` after reviewed export  
**Freeze:** lifted for this authorized publish, then **re-armed**  
**No** native build / server deploy / merge

---

## Published identity

| Field | Value |
|-------|--------|
| **Full SHA** | `929bfbfe6847e1488c4c75824373811d1fe22e8c` |
| **iOS update ID** | `01a144b4-5be8-7ec5-8a6a-ef2979058c16` |
| **Update group** | `258ec15a-5f01-457d-911d-34706ece35f9` |
| Launch `fileSHA256` | `dzn888_TMZ4nd1cUMDAwkiewSGIenuaDjlNp7EGDlwo` |
| Matches reviewed export | **Yes** |
| Passkey guard in HBC | **Present** |
| Rollback target | Group `4a0960e4-10e8-4ac8-a77d-3c37891942c2` (Emergency rollback to embedded bundle) |

Inventory: [`production-release-929bfbfe-inventory.md`](./production-release-929bfbfe-inventory.md)

---

## Device follow-up (Build 78)

| Check | Pass criteria |
|-------|----------------|
| `Updates.updateId` | `01a144b4…` |
| Commit hash (running JS) | full `929bfbfe…` |
| Cold launch ×3 | No ErrorRecovery / ClerkExpoPasskeys fatal |
| Home shortcuts | Coach modes; all-sports; Longshots no minus-money |
| Sign-in | Email/password (or Apple) without passkeys module |
