---
name: Coach pregame-only betting pool (mobile)
description: Mobile AI Coach must seed picks ONLY from not-yet-started games; isPickable's 4h grace leaks frozen started-game lines as fake pregame value.
---

# Mobile Coach must be pregame-only

Reported honesty bug: the mobile Coach recommended a started game's moneyline
("Diamondbacks ML, Today 3:10 PM, +4.5% edge, B+") as a PREGAME value pick ~2.5h
after tipoff, with the D-backs already losing.

**Root cause:** `isPickable()` (stadium-mobile/lib/slate.ts) keeps games started up
to 4h ago (correct for slate/Home/Upcoming display). The Coach pools
(`buildChatContext` realOdds + prop-candidate loops in lib/api.ts) reused
`isPickable`, so a started game's FROZEN pregame line entered the betting pool with
a now-stale edge. Mobile has NO live odds feed / live-score join / dead-market guard
(those exist only on web ParlayBuilder.tsx + server chat.ts `liveOdds` path keyed on
scores), so nothing downstream caught it.

**Fix — separate display eligibility from bettable eligibility:**
- `isPregameBettable(startsAt)` = stricter than `isPickable`: `t > now && t < now+48h`
  (no started-game grace). Use it for the Coach pools; leave `isPickable` for slate
  screens that intentionally show in-progress games.

**Server belt-and-braces (the non-obvious part):** the chat.ts market-lock
starvation prop backfill seeds games from `ctxFull.realGames` too (not just
`realOdds`), so a started game can re-enter even after the client gate. A guard on
the PROP ROW (`pr.startsAt`) is a NO-OP — `/api/sports/props` rows carry no
`startsAt`. The real gate is the GAME-level `commenceTime` from `/api/sports/odds`
(already fetched in every backfill): skip `e.commenceTime <= now` in the
`idsToFetch` selection AND the period-market harvest loop, in BOTH the market-lock
and fresh-fetch backfills.

**How to apply:** any new mobile Coach pool or server prop/odds backfill must gate on
not-started at the GAME level (commenceTime), never trust a prop-row startsAt.
