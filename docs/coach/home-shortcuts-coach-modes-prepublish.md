# Home shortcuts → Coach modes (pre-publish)

**Status:** Code ready. **Not published.** Report-before-publish.  
**Production:** untouched. `.ota-production-freeze` **armed**.  
**No** native build / server deploy / merge / freeze lift / OTA.

---

## Final SHA

| Field | Value |
|-------|--------|
| **Full SHA** | _(set at commit — see git tip on `cursor/prod-ota-home-shortcuts-8b51`)_ |
| Branch | `cursor/prod-ota-home-shortcuts-8b51` |
| Runtime | `1.1.0` |
| Passkey startup guard | **Retained** (`hasClerkExpoPasskeysNative`) |

---

## Shortcut → Coach behavior

| Shortcut | Coach mode (`ticketStyle`) | Ask (sport preserved) |
|----------|----------------------------|------------------------|
| Hot Picks | `balanced` | Best balanced `{SPORT}` parlay |
| Easy Money | `safe` | Safe / lower-risk `{SPORT}` parlay |
| Best Value | `value` | Best-value `{SPORT}` parlay from qualified +EV |
| Longshots | `longshot` | Lottery longshot `{SPORT}` parlay (higher payout) |

- Best Value **no longer** opens Props.
- Longshots **no longer** opens Steals.
- Explicit `ticketStyle` on silent launch + URL params — selection is **not** message-text-only.
- Auto-send exactly once per `ts` via `takeCoachLaunch` + `autoSentRef`, including when Coach is already mounted (`freshThread` reset).

---

## Selection effects (qualification preserved)

| Mode | Selection effect | Gates |
|------|------------------|-------|
| `value` | Pool narrowed to **qualified positive-EV/edge** legs; EV-led ranking among them | Shared qualify / sim / correlation unchanged; honest shortfall if short |
| `longshot` | Opens rare multi-count lottery path; among near-equal ranks prefers **higher American odds**; alts may seat if already qualified | Sim / qualify / correlation / rare-event protections preserved; no unqualified filler |
| `safe` / `balanced` | Existing tier floors | Unchanged |

No duplicate scans or added network work — same `buildCoachParlay` pipeline.

---

## Tests (this tip)

```text
node --test lib/homeShortcuts.test.ts \
  lib/coachTicketStyleSelection.test.ts \
  lib/coachBoardRankVariety.test.ts \
  lib/coachTicketQualityTiers.test.ts \
  lib/passkeyStartupGuard.test.ts
→ 19 pass / 0 fail
```

Log: `/opt/cursor/artifacts/home-shortcuts-coach-modes-tests.log`

---

## Out of scope until authorized

- Preview or production OTA  
- Freeze lift / merge / native rebuild / server deploy  
