# Device check — preview OTA `01a14331` (release `03dd1116`)

**Published:** 2026-10-16  
**Channel:** `preview` only (existing IPA Build 79 / `9155c37b`)  
**Runtime:** `1.1.0` · **Platform:** `ios`  
**Source commit (forced bake):** `03dd11160a0f6e6e91fa5046384f918844f76349`  
**Method:** `eas update --skip-bundler --input-dir dist` after reviewed export  
**Production:** untouched (embedded `4a0960e4…`); `.ota-production-freeze` **armed**  
**No** native build / server deploy / merge / freeze lift

---

## Published identity

| Field | Value |
|-------|--------|
| **iOS update ID** | `01a14331-c4ae-743f-a090-254ecbbdb7f1` |
| **Update group** | `efcd57c4-e662-4f45-b2fc-b56f2843fb1e` |
| Launch `fileSHA256` | `7rgQg6r4DkgLG8aReccPQ-RCj6UQTuJvEIElW_32EH0` |
| Matches reviewed export | **Yes** |
| Baked `EXPO_PUBLIC_GIT_COMMIT` | `03dd11160a0f6e6e91fa5046384f918844f76349` (explicit set; no `${VAR:-}` inheritance) |
| Message | `preview 03dd11160a0f6e6e91fa5046384f918844f76349 — passkeys native guard + home shortcuts (existing IPA)` |

Artifact: `/opt/cursor/artifacts/preview-publish-03dd1116-result.json`

---

## Device follow-up

See test plan in [`preview-export-03dd1116-prepublish.md`](./preview-export-03dd1116-prepublish.md): confirm `Updates.updateId` = `01a14331…`, commit hash = full `03dd1116…`, cold launches, email/password sign-in, Hot Picks / Easy Money, no ClerkExpoPasskeys fatal.

### Destination renders (separate from startup)

Best Value **navigation-only PASS**; value-view **MISSING**. Longshots destination **PASS**; **Across all sports** labels **MISSING**. Full record: [`device-check-ota-01a14331-destinations.md`](./device-check-ota-01a14331-destinations.md). Prepared unpublished fix: [`preview-best-value-6acbe744-prepublish.md`](./preview-best-value-6acbe744-prepublish.md).
