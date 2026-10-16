# Home shortcuts — all-sports default + Longshots lottery seating (pre-publish)

**Status:** Local export ready. **Not published.** Report-before-publish.  
**Production:** untouched. `.ota-production-freeze` **armed**.  
**No** native build / server deploy / merge / freeze lift / OTA.

---

## Final SHA

| Field | Value |
|-------|--------|
| **Full SHA** | `528a835924881dfc812c01cfadb860ec43191039` |
| Prior tip (plus-money floor + all-sports asks) | `7da4bd7f2e2f19491f41296248251f9c5f27ac55` |
| Branch | `cursor/prod-ota-home-shortcuts-8b51` |
| Passkey startup guard | **Retained** (`hasClerkExpoPasskeysNative`) |
| `.ota-production-freeze` | **Armed** |

---

## All-sports by default

Home Hot Picks / Easy Money / Best Value / Longshots no longer embed the Home sport pill in:

- generated `autoMsg` (no `NFL` / `MLB` / … tokens)
- structured launch params (still only `autoMsg` + `ticketStyle` + `send`/`ts` — no `sp`)

Coach loads the generic/supported board via `coachBoardSportsForAsk` when the ask has no focal sport. **Typed** sport requests (“NFL parlay”, “MLB lottery…”) still scope via `focalSportsFromText`.

Mixed-sport tickets remain allowed; seats come from the shared qualified pool — **no** force-every-sport rule and **no** unqualified filler.

---

## Explicit `ticketStyle` reach

| Path | Behavior |
|------|----------|
| Home → `resolveHomeShortcut` | Sets `ticketStyle`: `balanced` / `safe` / `value` / `longshot` |
| `askCoach` / `markCoachHomeLaunch` | Carries style through silent launch |
| Coach `takeCoachLaunch` → `buildCoachParlay` | `resolveCoachTicketStyle(explicit, ask)` prefers Home mode over ask text |
| Staging + combinator | Style narrows primary pools **and** backfill/replacement |

Ticket styles, sim, qualification, correlation, and sport-specific gates are unchanged in meaning — longshot only adds the plus-money seating floor among already-qualified legs.

---

## Longshots investigation (Guardians +3.5 @ −575)

| Question | Finding |
|----------|---------|
| Does opening Coach + auto-send prove lottery selection? | **No** |
| Screenshot lead leg | Guardians +3.5 at **−575** (heavy chalk) |
| Would that leg seat under fixed longshot rules? | **No** — plus-money floor (`odds >= +100`) excludes it |
| Complete ticket estimated combined odds | **Unavailable** — remaining legs not captured |

### Fix

1. **Filter:** `legQualifiesForLongshotStyle` — among shared-qualified legs, require American odds ≥ `+100`.
2. **Rank:** longshot mode leads with higher American odds (not only near-equal tie-break).
3. **Backfill / replacement:** `legAllowedForTicketStyle` gates `tryAppendBackfillLeg`, `pickDiverseLegsFromPool`, `backfillDiverseTicket`, `backfillAtQualityTier`, `applyCapAndBackfillToTarget`, and props/tiered staging fills — minus-money chalk cannot re-enter through fill.

Honest shortfall if too few plus-money qualified legs — no chalk padding.

---

## Tests

```text
node --test lib/homeShortcuts.test.ts \
  lib/coachTicketStyleSelection.test.ts \
  lib/coachBoardRankVariety.test.ts \
  lib/coachTicketQualityTiers.test.ts \
  lib/passkeyStartupGuard.test.ts
→ 25 pass / 0 fail
```

Log: `/opt/cursor/artifacts/home-shortcuts-all-sports-longshot-fix-tests.log`

---

## Local export (forced SHA bake)

| Field | Value |
|-------|--------|
| Launch `fileSHA256` | `kE-TEyEhMY-kH6qsb_0BWsOZfOZTDpjDtTUX4XG98vg` |
| HBC | `_expo/static/js/ios/entry-a6928cd0118b5938088cdacc66168716.hbc` |
| Baked `EXPO_PUBLIC_GIT_COMMIT` | `528a835924881dfc812c01cfadb860ec43191039` |
| Published | **No** |

See [`preview-export-528a8359-prepublish.md`](./preview-export-528a8359-prepublish.md).

---

## Out of scope until authorized

- Preview / production OTA  
- Freeze lift / merge / native rebuild / server deploy  

