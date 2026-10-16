# Preview tip prep — Best Value `view=value` + Longshots all-sports labels (`6acbe744`)

**Status:** Code prepared on branch. **Not published.** Report-before-publish.  
**Production:** untouched (embedded `4a0960e4…`). `.ota-production-freeze` **armed**.  
**No** native build / server deploy / merge / freeze lift / production OTA.

**Separate from** startup / ClerkExpoPasskeys validation of tip `01a14331` / `03dd1116`.

---

## Lineage

| Role | SHA |
|------|-----|
| Current preview tip (device) | `03dd11160a0f6e6e91fa5046384f918844f76349` → update `01a14331…` / group `efcd57c4…` |
| Existing Best Value + Longshots-label fix | `65106875` (earlier tip; not on passkey-safe baseline) |
| **This tip (branch HEAD)** | `6acbe7446609a2f24eba8fd463b8d7ed87c15aaf` = cherry-pick of `65106875` onto passkey-safe lineage after `03dd1116` docs tip |

Construction: reuse `65106875` as-is (auto-merge `steals.tsx` clean). Preserves `hasClerkExpoPasskeysNative` + home shortcuts from `03dd1116`.

---

## What changes (vs published `03dd1116`)

### Best Value

| Before (`03dd1116` on device) | After (`6acbe744`, unpublished) |
|-------------------------------|----------------------------------|
| Nav **PASS** → `/props` (± `sp`) | Nav → `/props?sp=<sport>&view=value` |
| Value-view **MISSING** (Popular / browse) | `valueMode`: qualified +EV props ranked **EV then Final AI**; Popular Players / Categories hidden |
| Sport preserved when props-supported | Unchanged |
| No extra Coach scan | Unchanged — still Props board only |

Qualification gates / Final AI / EV floor unchanged. Reuses existing qualified candidates (`valueProps` / recommended signals already on the Props screen).

### Longshots

| Before | After |
|--------|--------|
| Nav + destination **PASS** | Unchanged routing |
| Board-wide scan / “Steals Found Today” counts unlabeled while a sport pill is selected | Labeled **Across all sports**; sport row scoped to selected league |

---

## Files (exact)

- `artifacts/stadium-mobile/lib/homeShortcuts.ts` — `view: "value"` on `best_value`
- `artifacts/stadium-mobile/app/(tabs)/index.tsx` — pass `view` param
- `artifacts/stadium-mobile/app/(tabs)/props.tsx` — `valueMode` chrome + ranked rail
- `artifacts/stadium-mobile/app/(tabs)/steals.tsx` — Across all sports labels
- `artifacts/stadium-mobile/lib/homeShortcuts.test.ts` — destination + source assertions

---

## Checks run (this prep)

| Check | Result |
|-------|--------|
| `node --test lib/homeShortcuts.test.ts` | **6/6 pass** |
| Cherry-pick `65106875` → `6acbe744` | Clean (steals auto-merge) |
| Preview channel tip | Still `01a14331` / `efcd57c4` (`03dd1116`) — **unchanged** |
| Production channel | Still embedded rollback `4a0960e4…` |
| `.ota-production-freeze` | **Armed** |

Log: `/opt/cursor/artifacts/best-value-view-fix-6acbe744-tests.log`

---

## Device gap on current preview (why this tip exists)

See [`device-check-ota-01a14331-destinations.md`](./device-check-ota-01a14331-destinations.md):

- Best Value: **navigation-only PASS**; value-view **MISSING**
- Longshots: destination **PASS**; **Across all sports** labels **MISSING**

---

## Publish gate (preview only — owner authorize)

Do **not** publish until authorized. When authorized, export/publish from **`6acbe744`** (or a docs-fast-forward tip that includes it) to **`preview` only**, with forced `EXPO_PUBLIC_GIT_COMMIT` bake (same discipline as `03dd1116`).

Out of scope until separately authorized:

- Production OTA / freeze lift  
- Conflating this tip with Path A / passkeys startup sign-off  
- Native rebuild / server deploy  
