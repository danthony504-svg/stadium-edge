---
name: Tennis matchup (real ESPN player data)
description: How the mobile game-detail tennis matchup card is sourced; the two ESPN structural gotchas that silently empty it; why table tennis is honestly declined.
---

Mobile game-detail (`app/game/[id].tsx`) shows a real player matchup for `game.sport === "tennis"` via `GET /api/sports/tennis-matchup?away=&home=` (server `lib/tennis.ts` + `routes/tennis.ts`). Table tennis renders an honest "no reliable source" note instead — there is NO real table-tennis stats source (StatMuse covers only NBA/NFL/MLB/NHL/FC/WNBA/PGA/CFB; ESPN has none; Bovada obscure). Never fabricate it.

Data sources (all ESPN, fail-closed null, never fabricated):
- rankings: `site.api.espn.com/.../tennis/{atp,wta}/rankings` → rank/points/tour, keyed by normName(displayName).
- scoreboard: `.../tennis/{atp,wta}/scoreboard` → country (athlete.flag.alt), tour, athleteId.
- recent form + H2H: per-athlete `sports.core.api.espn.com/v2/sports/tennis/leagues/{tour}/seasons/{year}/athletes/{id}/eventlog` → each item's `competition.$ref` resolved for inline name + winner + round.

TWO structural gotchas that each silently empty the form (both fixed, keep them):
1. **athleteId lives on the scoreboard COMPETITOR, not the athlete.** `comp.athlete` only carries a `guid` (no numeric id); the numeric id ("3481") is `comp.id`. Read `comp.id` for athleteId or unranked players get no eventlog. (Rankings DO have `r.athlete.id`.)
2. **competition `competitor.linescores` is sometimes a `$ref` object, not an array.** Mapping it throws, the try-block swallows it, and EVERY match gets skipped → empty form. Guard `Array.isArray(linescores)` before mapping; set scores are then honestly omitted (we don't expand the $ref) while real W/L + opponent + round still render.

Other notes: byes are filtered (`/^bye$/i` on opponent name) — never counted as a win or listed. H2H is derived only from the two players' season eventlogs (this-season meetings, honestly labelled), null when none. api-server has NO watcher — restart its workflow after editing `lib/tennis.ts`.
