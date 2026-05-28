---
name: Tracker pick-string forms / CLV matching
description: Why cross-referencing persisted tracker entries against buildPicksFromOdds output must tolerate nickname vs full-name pick strings.
---

# Tracker pick-string forms break exact-match cross-referencing

The client-side tracker (localStorage) stores each leg's `market`/`pick` in
**whatever string form the add-path produced**, and the add-paths disagree:

- Game-detail "+ Add" rows add picks straight from `buildPicksFromOdds`, which
  emits **nickname** form (`"Thunder ML"`, `"Celtics -4.5"`).
- Live-odds rows and AI-parsed chat cards can produce **full team name** form
  (`"Oklahoma City Thunder ML"`).
- `addLeg` even stores the *raw* `leg.*` on the tracker entry while pushing the
  *canonicalized* `toAdd.*` onto `parlayLegs` — so the two can diverge in-call.

**The rule:** any feature that joins a persisted tracker entry back to live
odds (CLV auto-capture is the first such feature) must NOT do an exact
`"{market}|{pick}"` string match against `buildPicksFromOdds` output. It will
silently miss every leg whose stored form differs (Totals match because they
carry no team name; Moneyline/Spread are the ones that break).

**How to apply:** build the lookup map with multiple key variants per outcome —
register both the nickname pick and a full-name variant
(`teamFull + pick.slice(nick.length)` when `pick.startsWith(nick)`), and run
both sides through a case/space-normalizing key (`clvMatchKey` lower+collapse).
Keep this isolated to the consuming feature; do NOT change `buildPicksFromOdds`
output or the tracker write paths (both are used widely and have their own
dedupe/grace-window invariants).

**Why:** a code review caught CLV `closingOdds` never freezing for legs added
from non-game-detail paths — `priceByKey.get("Moneyline|Oklahoma City Thunder ML")`
missed the nickname-keyed entry, so `lastSeenOdds` never updated and the
auto-freeze never fired. No fabrication risk either way: prices only ever come
from the real merged book feed; a miss just means no CLV, never an invented one.
