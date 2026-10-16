# Home shortcuts — all-sports default + Longshots lottery seating (pre-publish)

**Status:** Code ready. **Not published.** Report-before-publish.  
**Production:** untouched. `.ota-production-freeze` **armed**.  
**No** native build / server deploy / merge / freeze lift / OTA.

---

## Final SHA

| Field | Value |
|-------|--------|
| **Full SHA** | `7da4bd7f2e2f19491f41296248251f9c5f27ac55` |
| Branch | `cursor/prod-ota-home-shortcuts-8b51` |
| Passkey startup guard | **Retained** |

---

## All-sports by default

Home Hot Picks / Easy Money / Best Value / Longshots no longer embed the Home sport pill in:

- generated `autoMsg` (no `NFL` / `MLB` / … tokens)
- structured launch params (still only `autoMsg` + `ticketStyle` + `send`/`ts` — no `sp`)

Coach loads the generic/supported board via `coachBoardSportsForAsk` when the ask has no focal sport. **Typed** sport requests (“NFL parlay”, “MLB lottery…”) still scope via `focalSportsFromText`.

Mixed-sport tickets remain allowed; seats come from the shared qualified pool — **no** force-every-sport rule and **no** unqualified filler.

Ticket styles (`balanced` / `safe` / `value` / `longshot`), sim, qualification, correlation, and sport-specific gates are unchanged.

---

## Longshots investigation (Guardians +3.5 @ −575)

| Question | Finding |
|----------|---------|
| Does opening Coach + auto-send prove lottery selection? | **No** |
| Was `ticketStyle=longshot` enough before this tip? | Mode was set, but ranking only preferred longer odds when ranks were **near-equal** — high composite chalk could still lead |
| Screenshot lead leg | Guardians +3.5 at **−575** (heavy chalk) |
| Would that leg seat under fixed longshot rules? | **No** — plus-money floor (`odds >= +100`) excludes it |
| Complete ticket estimated combined odds | **Unavailable** — remaining legs were not captured in the screenshot/artifact trail; a single known chalk leg cannot establish parlay combined odds |

### Fix (this tip)

1. **Filter:** `legQualifiesForLongshotStyle` — among shared-qualified legs, require American odds ≥ `+100`.
2. **Rank:** longshot mode leads with higher American odds (not only near-equal tie-break), so payout preference actually drives selection.

Honest shortfall if too few plus-money qualified legs — no chalk padding.

---

## Tests

```text
node --test lib/homeShortcuts.test.ts \
  lib/coachTicketStyleSelection.test.ts \
  lib/coachBoardRankVariety.test.ts \
  lib/coachTicketQualityTiers.test.ts \
  lib/passkeyStartupGuard.test.ts
→ 23 pass / 0 fail
```

Log: `/opt/cursor/artifacts/home-shortcuts-all-sports-longshot-fix-tests.log`

---

## Out of scope until authorized

- Preview / production OTA  
- Freeze lift / merge / native rebuild / server deploy  
