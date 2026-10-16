# Device check — production OTA `01a144bd` (release `b666165e`)

**Published:** 2026-10-16  
**Channel:** `production` only (App Store Build 78 / runtime `1.1.0`)  
**Source commit (forced bake):** `b666165e8d21c85222ab2ff874b538394efac66a`  
**Method:** `eas update --skip-bundler --input-dir dist`  
**Freeze:** lifted for authorize publish, then **re-armed**  
**No** native build / server deploy / merge

## Change

Hide Device attestation **Home card** and **Nav menu** item on the production channel (null render — no empty spacing). Still visible on `preview` / `development` / `__DEV__`. `/ota-debug` route, OTA recovery, passkey guards, and Coach behavior unchanged.

## Published identity

| Field | Value |
|-------|--------|
| **Full SHA** | `b666165e8d21c85222ab2ff874b538394efac66a` |
| **iOS update ID** | `01a144bd-83bc-7ee4-8e43-3718b03c42b3` |
| **Update group** | `68de9f95-8f7b-40fb-825a-45ea830e665a` |
| Launch `fileSHA256` | `YBbHBG0NwMh4KdPq3jCHpBc_73j0za_nZmTYVHMOeRw` |
| Matches reviewed export | **Yes** |
| Passkey guard in HBC | **Present** |
| Rollback (prior tip) | Group `258ec15a-5f01-457d-911d-34706ece35f9` (`929bfbfe`) |

## Device follow-up

| Check | Pass criteria |
|-------|----------------|
| Production Home | No Device attestation card / no gap |
| Production menu | No Device attestation row |
| Preview / `__DEV__` | Card + menu still present |
