# Preview export — `528a8359` (pre-publication)

**Status:** Local export **only**. **Not published.** Production freeze **armed**. No native build. No server deploy.

---

## Release identity

| Field | Value |
|-------|--------|
| **Full SHA** | `528a835924881dfc812c01cfadb860ec43191039` |
| Short | `528a8359` |
| Branch | `cursor/prod-ota-home-shortcuts-8b51` |
| Runtime | `1.1.0` |
| Channel intent | `preview` (when authorized to publish) |
| Contents | All-sports Home shortcuts + explicit `ticketStyle` + longshot plus-money seating through backfill/replacement + passkey guard |

---

## Export checks (passed)

| Check | Result |
|-------|--------|
| `expo export --platform ios --clear` | OK → `dist/` |
| HBC | `_expo/static/js/ios/entry-a6928cd0118b5938088cdacc66168716.hbc` (~9.52 MB) |
| Content SHA-256 | `904f93132121318fa41faaac6ffd015ac3997ce6530e98c3b53517e171bdf2f8` |
| EAS-style `fileSHA256` (launch hash) | `kE-TEyEhMY-kH6qsb_0BWsOZfOZTDpjDtTUX4XG98vg` |
| Baked `EXPO_PUBLIC_GIT_COMMIT` | Full `528a8359…` present (**forced**; prior shell value unset) |
| Stale prior tip bakes (`7da4bd7f`, `4c6c71ae`, `13e4e5b9`, `03dd1116`, `afb30bde`) | **Absent** |
| `hasClerkExpoPasskeysNative` in HBC | **Present** |
| `requireOptionalNativeModule` in HBC | **Present** |
| `legAllowedForTicketStyle` in HBC | **Present** |
| `.ota-production-freeze` | **Armed** |
| Published | **No** |

Artifacts: `/opt/cursor/artifacts/preview-export-528a8359-checks.json`, `preview-export-528a8359.log`, `preview-export-528a8359-metadata.json`, `preview-export-528a8359-launch-hash.txt`.

---

## Verified selection behavior (unit)

- All-sports: Home shortcut asks → `focalSportsFromText` size `0`; no sport in launch params
- Explicit `ticketStyle` reaches Home → launch → `buildCoachParlay` → staging/combinator
- Longshots: `legAllowedForTicketStyle(…, "longshot")` rejects −575 / −110; accepts +100 / +450; gating present on backfill/replacement helpers

---

## Out of scope until authorized

- Preview / production OTA  
- Freeze lift / merge / native rebuild / server deploy  
