---
name: Player-history gamelog ambiguous/NaN labels
description: Why the mobile Player Props detail modal must honest-null whole columns from the ESPN player-history feed, and how it decides which.
---

# Player-history gamelog: ambiguous & non-numeric columns

The `/sports/player-history` feed (api-server `routes/history.ts`) flattens each
game's stat groups into a single label-keyed `stats` map per game, plus a
top-level `labels[]` header. Two real-data traps make naive column reads
fabricate:

1. **Duplicate labels collide.** Football carries passing AND rushing groups that
   both use `YDS`/`TD`/`AVG`/`LNG`. After the label-keyed flatten only one
   survives per game and you cannot tell which — so any market mapped to those
   labels (NFL/NCAAF yardage markets) is unreliable.
2. **Some "numbers" are strings.** NBA `FG`/`3PT` come as `"2-5"` (made-attempted),
   which is NOT the prop quantity and parses to `NaN`.

**Rule:** in the mobile `PlayerPropsSheet`, build an `ambiguous` Set =
labels that appear >1× in `historyQ.data.labels`, and thread it into BOTH
`buildGrid` (season grid) and `gameValueForMarket` (per-game bars). Excluded /
NaN / missing columns return `null` → honest empty state, never a bar.
`num()` guards parse so `"2-5"`→null. This is the never-fabricate boundary:
prefer an empty "no per-game data" message over a wrong stat.

**Real-computation exceptions (allowed, not estimates):**
- `batter_total_bases` = H + 2B + 2·(3B) + 3·(HR) — exact identity from
  unambiguous MLB batting columns.
- `player_threes` (NBA "3-Pointers") — the made portion of the "made-attempted"
  `3PT` string ("2-5"→2) IS the betting quantity, so extracting the number
  before the dash is an EXACT read, not the ambiguous case. Lives in propStats
  `MARKET_MADE`/`madeCount()` (prefers a bare `3PM` if present). Was previously
  (wrongly) honest-nulled, causing "No per-game data for 3-Pointers in the
  recent log." Add other made-attempted markets here, not to the ambiguous Set.

**Verified column quirks:** NHL assists=`A` shots=`S` (map
`player_shots_on_goal`→`["S","SOG","SHOTS"]`, `player_assists`→`["AST","A"]`);
NHL grid columns are `["G","A","PTS","S","PIM"]`.

**State-sync gotcha:** the Props screen builds a fresh `sheet` data object on
every player tap, so reset the selected market with
`useEffect(() => setMarket(data.initialMarket), [data])` — NOT a render-time
setState (openKey/lastKey pattern). The fresh-object identity makes the effect
fire on reopen-same-player and tap-different-market too. Include `ambiguous` in
the grid + bars `useMemo` deps.
