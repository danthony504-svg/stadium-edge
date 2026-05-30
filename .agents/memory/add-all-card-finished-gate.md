---
name: Add-all slip card finished-game gate
description: Why the per-message "Add all N legs" card vanished while per-leg "+ ADD" stayed; gate must match inline-card + onClick resolver.
---

# Add-all chat slip card finished-game gate

The per-message "This message · N-leg slip" / "+ Add all N legs to ticket" card
in `renderAssistantMessage` (ParlayBuilder.tsx) is hidden when
`allOver = messagePicks.every(p => <finished>(p.game))`.

**Rule:** that finished-game predicate MUST be the same one the inline pick
cards use to suppress finished legs AND the same one the add-all `onClick` uses
to partition finished/live (`gameResolvesToFinal`). Do not use a cruder
status-only check (the old `isGameOver`, since removed).

**Why:** ESPN (`realGamesBySport`) can mark a game **Final** while the Odds API
pool (`realOddsBySport`) still carries that matchup with a **future/stale
commence time**. `gameResolvesToFinal` keeps such a leg alive (future/live odds
or livePicks entry overrides the Final status), so the inline pick card renders
(often even showing a future "Today 1:10 PM" time). If the visibility gate used
ESPN status alone, `allOver` went true and the add-all card disappeared — every
per-leg "+ ADD" button showed but the whole-ticket add control was gone. That's
the user-visible "no add to slip option" bug (MLB, day-after stale odds).

**How to apply:** any new gate that decides whether a chat slip snapshot is
"all over" must reuse `gameResolvesToFinal`, not invent a parallel finished
check. Keep snapshot-render suppression, the `allOver` gate, and the add-all
onClick filter on the SAME predicate or they drift apart again.
