# Device check — preview OTA `01a14342` (release `13e4e5b9`)

**Published:** 2026-10-16  
**Channel:** `preview` only (existing IPA Build 79 / `9155c37b`)  
**Runtime:** `1.1.0` · **Platform:** `ios`  
**Source commit (forced bake):** `13e4e5b91b046cd3dc587f50e99bdb20d9ed9776`  
**Method:** `eas update --skip-bundler --input-dir dist` after reviewed export  
**Production:** untouched (embedded `4a0960e4…`); `.ota-production-freeze` **armed**  
**No** native build / server deploy / merge / freeze lift

Includes: Best Value `view=value` (+EV → Final AI rank) + Longshots **Across all sports** labels on passkey-safe baseline (`03dd1116` lineage + cherry-pick `6acbe744` / `65106875`).

---

## Published identity

| Field | Value |
|-------|--------|
| **iOS update ID** | `01a14342-33e9-7b8d-bd3f-7ddc4cf9dfdb` |
| **Update group** | `b5e561ef-8742-422f-b2ec-d0c2e4ecc073` |
| Launch `fileSHA256` | `6BSK5-RNRbipZ02MvbohxVYNua_lo9ED8vDgaBZGb3M` |
| Matches reviewed export | **Yes** |
| Baked `EXPO_PUBLIC_GIT_COMMIT` | `13e4e5b91b046cd3dc587f50e99bdb20d9ed9776` (explicit set; no `${VAR:-}` inheritance) |
| Message | `preview 13e4e5b9… — Best Value view=value + Longshots Across all sports (existing IPA)` |

Artifact: `/opt/cursor/artifacts/preview-publish-13e4e5b9-result.json`

---

## Ranking (confirmed before publish)

| Surface | Order |
|---------|--------|
| **Best Value** | **EV → Final AI** `selectionScore` (intentional value surface) |
| **Coach** | Final AI composite → simAligned → edge/EV |

Qualification gates preserved (`MIN_VALUE_EV` 1.5%, server EV/evSide, no Coach scan). See [`preview-best-value-6acbe744-prepublish.md`](./preview-best-value-6acbe744-prepublish.md).

---

## Device follow-up (destinations — not startup)

| Check | Pass criteria |
|-------|----------------|
| `Updates.updateId` | `01a14342…` (not `01a14331`) |
| Commit hash (running JS) | full `13e4e5b9…` |
| Home → Best Value | Props **Best Value** chrome; +EV ranked list (not Popular Players); sport preserved |
| Home → Longshots | Steals; summary counts labeled **Across all sports** when a sport pill is selected |

Startup / passkeys validation remains on the prior tip docs — do not conflate.
