# Device check — destination renders on preview `01a14331` (`03dd1116`)

**Recorded:** 2026-10-16  
**Channel:** `preview` only  
**Runtime:** `1.1.0` · **Platform:** `ios`  
**iOS update ID:** `01a14331-c4ae-743f-a090-254ecbbdb7f1`  
**Update group:** `efcd57c4-e662-4f45-b2fc-b56f2843fb1e`  
**Published commit (OTA JS):** `03dd11160a0f6e6e91fa5046384f918844f76349`  
**Scope:** Home → Best Value / Longshots **destination renders only**.  
**Not** startup / ClerkExpoPasskeys / cold-launch validation (see [`device-check-ota-01a14331-03dd1116-preview.md`](./device-check-ota-01a14331-03dd1116-preview.md)).

Production freeze **armed**. No production OTA.

---

## Best Value

| Step | Result |
|------|--------|
| Home → Best Value navigation | **PASS** (opens Props with sport preserved when props-supported) |
| Value-ranked view (`?view=value`, +EV / Final AI rail, not Popular Players) | **MISSING** on this tip |

**Why missing:** Published JS is `03dd1116` (passkey-safe home-shortcuts baseline). That tip routes Best Value to `/props` (optional `sp`) **without** `view=value` and **without** the Props `valueMode` chrome. Navigation works; browse/Popular Players behavior remains.

Prepared (unpublished) fix: tip `6acbe744` = cherry-pick of `65106875` onto this lineage — see [`preview-best-value-6acbe744-prepublish.md`](./preview-best-value-6acbe744-prepublish.md).

---

## Longshots

| Step | Result |
|------|--------|
| Home → Longshots navigation | **PASS** (opens Steals; sport filter seed when `sp` present) |
| Destination board / honest empty | **PASS** (same contract as prior Longshots device checks on `01a14121`) |
| Summary / scan counts labeled **Across all sports** when a sport pill is selected | **MISSING** on this tip |

Board-wide scan meta while MLB (or another pill) is selected can still read as sport-scoped. Labeling lands in unpublished tip `6acbe744` (`65106875` content).

---

## Separation from startup validation

| Concern | Doc |
|---------|-----|
| Passkeys guard, cold launch, sign-in, Hot Picks / Easy Money smoke | [`device-check-ota-01a14331-03dd1116-preview.md`](./device-check-ota-01a14331-03dd1116-preview.md) + [`preview-export-03dd1116-prepublish.md`](./preview-export-03dd1116-prepublish.md) |
| Best Value / Longshots destination behavior on the same tip | **This file** |
| Next preview publish candidate (value view + all-sports labels) | [`preview-best-value-6acbe744-prepublish.md`](./preview-best-value-6acbe744-prepublish.md) |
