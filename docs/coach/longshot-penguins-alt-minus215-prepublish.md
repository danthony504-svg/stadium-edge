# Longshots −215 ALT bypass (Penguins +2.5) — pre-publish

**Status:** Fix tested. **Not published.** Production freeze **armed**.  
**Device tip that reproduced:** preview `01a143a5` / bake `528a8359…`

---

## Distinction (handicap vs American odds)

| Field | Example | Role |
|-------|---------|------|
| Handicap / line | Penguins **+2.5** | Spread rung in `pick.pick` — **not** the longshot floor |
| American odds | **−215** | Price in `pick.odds` — longshot requires `odds >= +100` |

The UI rendered both; the bug was seating on **−215**, not misreading +2.5 as plus-money.

---

## Root cause

`ticketStyle=longshot` propagated correctly (Home → launch → `buildCoachParlay` → staging/combinator). Primary staging and tiered backfill called `legAllowedForTicketStyle`.

**Bypass:** post-staging consumers re-seated from the **raw** `stagePool` / `qualifiedCandidates` without the style floor:

1. `topUpTicketFromQualifiedScored` (mid-scan + post-lean)
2. `injectPrioritySportsIntoTicket` / `enforceMultiSportFloorOnTicket` (NHL ALT inject)
3. `fillReservedPropSlots` / period / team-total fills (fed ungated pool)
4. `enforceMlLeanOnPicks` lean-side swaps
5. Exported `qualifiedCandidates` for lean/fill

A shared-qualified NHL ALT (high sim can clear `qualifiesAltPick` even at −215) could therefore land after staging. Rendering used the same `pick.odds` — no separate display path.

---

## Fix (this tip)

- `filterScoredLegsForTicketStyle` / `filterPicksForTicketStyle` — shared American-odds style belt
- Style-narrowed `stylePool` for all post-staging fills in `buildScanResult`
- `ticketStyle` threaded into top-up, post-lean fill, mlLean, priority inject / multi-sport floor
- Terminal `filterPicksForTicketStyle` after substitutions in scan result **and** `buildCoachParlay`
- Qualification gates unchanged; honest shortfall if too few plus-money legs

---

## Tests

```text
node --test lib/longshotDeliveredOddsGate.test.ts \
  lib/coachTicketStyleSelection.test.ts \
  lib/homeShortcuts.test.ts \
  lib/passkeyStartupGuard.test.ts \
  lib/postLeanFinalFill.test.ts \
  lib/mlLeanEnforcement.test.ts \
  lib/coachPrioritySports.test.ts \
  lib/ticketStaging.test.ts
→ 92 pass / 0 fail
```

Regression covers NHL Penguins +2.5 @ −215 through top-up / inject / lean / terminal belt, plus cross-sport strip (MLB −575, NFL −110) and balanced-style unchanged.

Log: `/opt/cursor/artifacts/longshot-delivered-odds-gate-full-tests.log`

---

## Out of scope until authorized

- Preview / production OTA  
- Freeze lift / merge / native rebuild / server deploy  
