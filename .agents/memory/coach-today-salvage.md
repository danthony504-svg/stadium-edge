---
name: Coach today-only zero-leg salvage
description: Why a sport-named "today" parlay can return ZERO legs despite a real upcoming-today game, and the salvage that fixes it (with its mandatory gates)
---

# Coach today-only zero-leg salvage

A sport-named today-only parlay (e.g. "7-leg soccer parlay for today") can come
back with ZERO legs even when a real upcoming-today game with plenty of markets
is on the board. Two causes compound:

1. The model often grounds its legs on PROPS from NON-today games (handed to it by
   the server's prop backfill, which is not today-aware). The post-parse
   `startsTodayUpcoming` filter then drops every one of them → `picks.length === 0`.
2. The reach-the-count backfill is gated on `picks.length > 0`, so once everything
   is filtered out it never runs — nothing gets rebuilt from today's real games.

**The fix (salvage):** right after the today filter, when `picks` emptied AND the
model emitted pick lines AND the user NAMED a sport that still has real
upcoming-today games, rebuild from `context.realOdds` filtered to that sport (it's
already today-filtered) via `backfillPicks([], pool, GENERIC_BACKFILL_ORDER)`. That
only ever appends REAL posted lines (one per game×market-family), so it never
fabricates and never stacks correlated same-line sides. It often lands short of N
(one match can't honestly yield 7 uncorrelated legs) — the existing honest
leg-count note then says exactly how many held up. The today-note now renders only
when the salvage ALSO comes up empty.

**Why:** repeatedly refusing a buildable request (zero legs while admitting "this
has to come from <real today game>") reads as broken even when the prose is honest.
A short real ticket beats zero.

**How to apply / mandatory gates:** the salvage MUST be excluded for:
- `altSign` (`+alt`/`-alt`): the sign filter already ran earlier, so unsigned
  generic mains would violate the lock and never get re-validated.
- `oddsThreshold` / `confidenceThreshold`: their own filters stay authoritative.
- `mentionsPropIntent(trimmed)`: a props-only / prop-market ask wants players, not
  game moneylines — don't silently fall back to game mains.
Skip it when no sport is named (generic "today" ask keeps prior behavior).

`mentionsPropIntent` is a pure helper in `lib/slate.ts` (re-exported via api.ts),
shared by BOTH the salvage gate and the reach-count backfill's `mentionsProps`
check (was an inline regex duplicate). Residual: the prop-market regex is broad
(e.g. bare "shots"), so borderline phrasing can suppress the game-main fill — that
under-fills, it never fabricates.
