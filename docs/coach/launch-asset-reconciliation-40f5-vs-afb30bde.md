# Launch-asset reconciliation — `40f5b9f4` attribution vs `afb30bde` message

**Purpose:** Resolve whether the republished preview tip (`01a1430d` / group `2d980f30`) is the `40f5b9f4` JS bundle or the earlier `afb30bde` publish, using launch-asset hashes + export records (not update *messages* alone).

---

## Table (iOS / runtime `1.1.0` / preview)

| Label | Git commit (publish record) | Update ID | Group ID | Launch `fileSHA256` (manifest `launchAsset.hash`) | Export HBC name |
|-------|----------------------------|-----------|----------|-----------------------------------------------------|-----------------|
| Slip OTA | `afb30bde18208404d49df247653ed350c77d0aa1` | `01a140e5-3c7a-70d1-8968-af35752d0c59` | `eb2cc7d7-ca2f-41fb-b008-5186b55a0dcd` | `TZuiYbtcmQAxm0wqL0ZCuVIXKjw5mZb-Iw6Ei27sC3Y` | `entry-efc28f375d270ed4b2495bb0b7c60d35.hbc` |
| Home-shortcuts PASS | `40f5b9f4747df2b99c98c4c08d26f276e2e07d16` | `01a14121-a602-751f-b218-724db14536d6` | `d405e8b6-edf6-45d3-a8a6-d977ea97d2f4` | `_RzFHXl4PChEDcOIoyZUiwmDB18rXBNhVq_PUyg277M` | `entry-baa93d88e0ae82a94b0a33dac53abdd8.hbc` |
| **Republish of d405e8b6** | attributed `@ 40f5b9f4` | `01a1430d-37ee-747a-be37-c296473cff9f` | `2d980f30-223d-4cca-8654-48929301d4af` | `_RzFHXl4PChEDcOIoyZUiwmDB18rXBNhVq_PUyg277M` | (same asset as d405; no re-export) |
| Failed Path A | `c859c1ce73ae64182a996a2751b4f831d601ba8d` | `01a142e1-23e0-772e-beb5-bf03df51e982` | `af92adaa-9a40-44ab-b13a-dfd6d8315061` | `OS4PejuGj0QksztEcIF8yUXYqlb306ctN-G6EUx6gaE` | (distinct) |

Artifact: `/opt/cursor/artifacts/launch-asset-hash-reconciliation.json`  
Export logs: `preview-ota-publish.log` (`afb30bde`), `preview-ota-40f5b9f4.log` (`40f5b9f4`), `preview-republish-d405e8b6.log`.

---

## Verdict

| Claim | Result |
|-------|--------|
| Republish `01a1430d` JS === PASS tip `01a14121` / `40f5b9f4` | **Yes** — identical launch `fileSHA256` `_RzFHXl4…` |
| Republish `01a1430d` JS === `afb30bde` / `01a140e5` | **No** — different hash (`TZuiYbt…` ≠ `_RzFHXl4…`) and different HBC export name |
| `afb30bde` is an ancestor of `40f5b9f4` | **Yes** — `40f5b9f4` = shortcuts commit on top of lineage that includes `afb30bde` + `afcf638d` guard |
| If Device attestation still shows message containing `afb30bde` | Device is **not** on `01a1430d` yet (still on `01a140e5` or cached older tip) — confirm `Updates.updateId` |

Git ancestry: `afb30bde` ⊂ `40f5b9f4` (both include `hasClerkExpoPasskeysNative`). Message text alone must not override launch-asset identity.
