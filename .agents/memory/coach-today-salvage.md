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

**The fix (salvage):** right after the today filter, when `picks` emptied, rebuild
from `context.realOdds` (already today-filtered). If the user NAMED a sport, filter
the pool to that sport (`.sport` is the app id e.g. "soccer" which
`focalSportsFromText` returns); for a GENERIC "N-leg ... tonight" ask (no sport
named) salvage from ALL of `context.realOdds` — same late-evening one-game-left
trap hits generic asks too (the lone today game can't fill N → model grounds on
non-today backfill → post-parse filter drops all → flat refusal). Build via
`backfillPicks([], pool, GENERIC_BACKFILL_ORDER)`. That only ever appends REAL
posted lines (one per game×market-family), so it never fabricates and never stacks
correlated same-line sides. It often lands short of N (one match can't honestly
yield 7 uncorrelated legs) — the existing honest leg-count note then says exactly
how many held up. The today-note now renders only when the salvage ALSO comes up
empty.

**CRITICAL — do NOT gate the salvage on `emittedPickLines > 0`.** For an ask one
real game can't honestly fill, the model REFUSES OUTRIGHT with zero PICK lines
(`emittedPickLines === 0`) instead of returning legs that then get filtered. An
`emittedPickLines > 0` gate skips the salvage exactly when it's needed, and the
user just sees the generic "board is thin" backstop. The build-intent signal is
`requestedLegs > 0` (named sport NOT required — generic asks salvage too) — NOT
whether the model emitted picks. When
the salvage builds picks out of a refusal, the model's streamed prose (`full`) is
a refusal / stripped scaffold that CONTRADICTS the real cards, so a `salvageBuilt`
flag replaces `finalContent` with a clean lead-in (legNote still carries the
honest short-count). And feed `todayBuildNote` `emittedPickLines || (namedSport ?
requestedLegs : 0)` so a refused-but-genuine named-sport build with no real today
game shows the honest "slate too thin" note instead of silence (which falls
through to the generic backstop).

**Why:** repeatedly refusing a buildable request (zero legs while admitting "this
has to come from <real today game>") reads as broken even when the prose is honest.
A short real ticket beats zero.

**Salvage must include PROPS, not just game lines.** The first salvage cut only
ran `backfillPicks(GENERIC_BACKFILL_ORDER)` = full-game Moneyline/Spread/Total, so
a one-game soccer ask salvaged to ~3 legs all on that match — user: "what about
all the player and game props". Fix = a sibling `backfillProps(existing, propPool,
realToday, gameMeta, {target})` in PickCard.tsx (the prop analogue of
backfillPicks) called right after the game-line backfill. It emits REAL posted
prop legs only (one per game×player×market, rung closest to even money, skip
<= -1000 juice), today-gated by deriving the allowed-game set + each leg's real
kickoff from `realToday` (= salvagePool, already `startsTodayUpcoming`-filtered) —
so a tomorrow/started game's prop can never slip in, and it fabricates nothing.

**Game-label-only today-gating LEAKS — must date-match per prop.** `propPool`
(mergedPropPool) can contain NON-today props because the server prop backfill
bypasses the today filter. So gating a prop solely by "its game label is in
realToday" lets a REPEATED matchup (series play, same Away@Home on a later date)
pass and inherit today's kickoff — a fabricated start time. Fix: thread the real
`startsAt` onto `PropPoolEntry` (copied from `RealPropEntry.startsAt` in
`propPoolFromRealProps`) and in backfillProps build a per-label SET of allowed
calendar days from realToday; a prop is admitted only if its OWN day is in that
set. **Day-bucket, not exact timestamp** — odds vs props come from different feeds
and the ISO can jitter for the same event, so exact-match would over-exclude and
starve props; same-date doubleheaders are both today so admitting either is honest.
The emitted leg uses the prop's own startsAt (game's only as fallback).
Pick-string + fields mirror `matchProp` exactly (`player side line marketLabel`
or `player marketLabel` for yes/no; isProp, headshot, athleteId, propMarketKey,
propSide, propLine) so slip dedupe / tap-to-stats parity holds; runs through
`enrichPickMeta` for the AWAY@HOME subtitle. No real props for the game (club
soccer) → adds nothing, ticket stays honest game-lines only.

**Soccer ML/spread label was truncated.** `nickname()` = last word, so soccer
multi-word names collapse confusingly ("Czech Republic" → "Republic ML"). Fixed in
`buildRealOdds`: a `teamLabel(name)` = soccer? full name : nickname, applied to
full-game AND period ML+Spread emits. US leagues keep the nickname. The change is
at the SOURCE entry (buildRealOdds), so every downstream consumer (backfill, slip,
dedupe, AI context) sees the same corrected string — no per-surface patching.

**How to apply / mandatory gates:** the salvage MUST be excluded for:
- `altSign` (`+alt`/`-alt`): the sign filter already ran earlier, so unsigned
  generic mains would violate the lock and never get re-validated.
- `oddsThreshold` / `confidenceThreshold`: their own filters stay authoritative.
- `mentionsPropIntent(trimmed)`: a props-only / prop-market ask wants players, not
  game moneylines — don't silently fall back to game mains.
Generic (no-sport-named) asks DO salvage now (from all today realOdds); the only
hard skips are the locks above (`oddsThreshold`/`confidenceThreshold`/`altSign`/
`mentionsPropIntent`). The `todayBuildNote` `emittedPickLines` fallback keys on
`salvageEligible` (was `salvageSports.size > 0`) so a still-empty generic salvage
shows the honest thin-slate note instead of silence.

`mentionsPropIntent` is a pure helper in `lib/slate.ts` (re-exported via api.ts),
shared by BOTH the salvage gate and the reach-count backfill's `mentionsProps`
check (was an inline regex duplicate). Residual: the prop-market regex is broad
(e.g. bare "shots"), so borderline phrasing can suppress the game-main fill — that
under-fills, it never fabricates.
