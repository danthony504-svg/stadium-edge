---
name: Finished World Cup game suppression
description: Why finished WC soccer games linger as "bettable" and how the odds source drops them via real ESPN status
---

# Finished World Cup game still shows as bettable

**Symptom:** a World Cup match that has ended (e.g. Czech Republic @ South Korea,
FT 2–1) keeps showing on the mobile game-detail screen / lists with lopsided
in-play odds (Korea ML -2500, Czech +250000, Draw +2700).

**Why the generic guards miss it:**
- The Odds API keeps a match in its feed during play and for a while AFTER the
  final whistle — the line just freezes at extreme in-play numbers. So presence
  in the feed ≠ still playable.
- `isPickable` (mobile `lib/slate.ts`) keeps a game "live" for 4h after kickoff
  so live betting works. A soccer match is only ~2h, so a finished match stays
  inside that 4h window for ~2 extra hours. The date is NOT the issue — this
  fires the same evening, ~2h after kickoff.
- WC national-team games are NOT in ESPN's CLUB soccer feed
  (`/sports/games?sport=soccer` returns club games), so status-based suppression
  that joins to that feed can't find them. Same blind spot as the WC crest work.

**Fix (source-side, authoritative):** in `api-server` `routes/odds.ts`, right
after merging the per-key games, for `sportId === "soccer"` fetch ESPN's FIFA
World Cup scoreboard (`soccer/fifa.world/scoreboard`, cached ~2min) and DROP any
`soccer_fifa_world_cup` game whose two teams match a completed event
(`status.type.completed === true`). Dropping at the source fixes BOTH web and
mobile, and the detail screen's existing `!game` → "no longer available" path
becomes the render-side brace automatically (no client change needed).

**Team matching — match by ESPN team ID, NOT by name.** ESPN and the Odds API
spell several nations differently ("Czechia" vs "Czech Republic", "Congo DR" vs
"DR Congo", "Türkiye" vs "Turkey"). A name-based compare needs an ever-growing
alias map and still silently misses teams (false KEEPS); a loose prefix/substring
match is worse — "South **Africa**" ≈ "South **Korea**" wrongly dropped a
still-upcoming fixture (false DROP / dishonest). Correct approach: read the
scoreboard side's real `competitor.team.id`, and resolve each odds team name to
its ESPN WC team ID with the SAME uniqueness-guarded `resolveWorldCupTeam`
(exported from `routes/props.ts`) that powers the WC crests. Match by ID pair
(unordered) with a unique-event guard. This is exact and drift-proof for all 48
teams without enumerating names. (`props.ts` only imports express + lib/sports,
so importing its resolver into `odds.ts` is not circular.)

**Fail-open everywhere:** scoreboard error → keep all games; a team that can't be
resolved to an ID (null) → keep that game; >1 matching completed event → keep.
Never hide a genuinely live match on a transient hiccup. Scoreboard only carries
the current matchday, so the `isPickable` 4h cutoff is the eventual client
backstop if both feeds ever miss it.

**Reminder:** api-server has NO watcher — restart `artifacts/api-server: API
Server` after editing, then re-verify against `/api/sports/odds?sport=soccer`.
