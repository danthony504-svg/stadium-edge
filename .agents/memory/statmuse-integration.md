---
name: StatMuse real-stat source
description: How StatMuse is wired in as a REAL (non-fabricated) stat source across chat AI, the deterministic stat-lookup card, and pick rationale — including the anti-fabrication guard and the league mapping.
---

# StatMuse integration

StatMuse (www.statmuse.com) answers plain-English sports questions and puts the
answer sentence in the page's `<meta name="description">`. There is no JSON API
— we scrape that one meta tag. Used as a REAL stat source in three places.

## Anti-fabrication guard (the whole point)
When StatMuse does NOT understand a question it returns marketing boilerplate,
not a stat. `askStatMuse` returns `answer: null` when the meta text contains a
GENERIC_MARKER ("instant answers to your" / "stats, scores, betting and more" /
"muse on" / "ask statmuse"). Every consumer drops null answers. **Never relax
this** — a leaked blurb would surface as a fake "fact". If StatMuse changes its
boilerplate wording, add the new phrase to GENERIC_MARKERS.

## Shape
- `lib/statmuse.ts` `askStatMuse(query, league?)` → `{ query, league, answer, url }`,
  browser UA, 12s `AbortSignal.timeout`, 10-min `cachedJson`. `STATMUSE_LEAGUE`
  maps our sportIds → slug (nfl/nba/wnba/mlb/nhl same, soccer→fc, ncaaf→cfb,
  ncaab→cbb; **ufc/tennis absent** → skipped). No-league `/ask` works too (good
  for team questions where sport is unknown). `resolveStatMuseLeague` accepts a
  slug OR an internal sportId, returns null when unsupported.
- Route `GET /api/sports/statmuse?q=&league=` (rate 40/min).

## Wiring
- **Chat (chat.ts):** after the named-game trim, fetch bounded facts — team
  record/form for each NAMED game's teams (cap 8, deduped, league from the
  game's `sport` field in realOdds/realGames) + the latest user message IF it's
  a stat question AND not a parlay/build. Non-null answers → `lockedContext.statmuseFacts`,
  documented by the "STATMUSE FACTS RULE" SYSTEM_PROMPT bullet (cite verbatim,
  never invent a new stat, never override the bookmaker line). **Wrapped in a
  2.5s Promise.race budget** so it can never delay model generation; in-flight
  fetches still warm the cache. namedGameLabels + labelSport are captured inside
  the trim block and reused for this.
- **Stat card (ParlayBuilder):** the deterministic player-lookup card also calls
  `/api/sports/statmuse` (scoped to the resolved player's sport) and renders a
  violet "StatMuse" line. When ESPN player-search misses, it falls back to a
  StatMuse answer (covers TEAM questions like "Dodgers record") before the
  couldn't-find note.
- **Pick rationale:** covered via the chat `statmuseFacts` injection (team facts
  for named games) — picks are generated during the model call so we can't
  per-pick fetch; the AI cites the injected facts in EDGE notes.

## Per-game PERIOD breakdown (game-by-game grid)
ESPN game logs only have full-game totals, so questions like "how many points
did Wembanyama score in the first quarter in his last 5 games game by game"
can't be answered from ESPN. StatMuse's meta-description ALSO fails here: a
multi-game period question collapses to a single game ("5 points in Game 7…").
The fix is to scrape StatMuse's results **table**, not the meta sentence.

- `askStatMuseGameLog(rawQuery, league)` (lib/statmuse.ts), two-step:
  1. Try `fetchStatMuseTable(rawQuery)`; if it already returns ≥2 rows, use it.
  2. Otherwise resolve the canonical player name — prefer the table's player,
     else fall back to `playerFromAnswer(askStatMuse(raw).answer)` (the headline
     ALWAYS leads with the player name even on a 1-row result). **Decouple player
     resolution from table parsing** — `fetchStatMuseTable` returns null when
     there's no DATE table, so without the headline fallback step-2 never runs.
  3. Re-query the canonical phrasing `"<player> <period> <stat> last N games
     game by game"`, which reliably returns the full per-game GRID; parse it.
- `fetchStatMuseTable`: parse first `<table>`; **require a DATE column** (rejects
  season-aggregate tables → honest null). statLabel = header[dateIdx+1]. Per row,
  find the date cell, then take the **first numeric cell after the date** as the
  value (the asked stat sits right after DATE; team/opp codes are non-numeric and
  come after — positional DATE+1 alone can misread a label). matchup splits into
  team / loc(@|vs) / opp. 10-min cache.
- Phrasing gotcha: raw "how many…score in the…" collapses to 1 game; "…last N
  games game by game" returns the grid. "each game" with NO number → StatMuse
  returns the whole season (all real games), which is honest, just long. The
  `count` default (5) only applies when the canonical step-2 query is built.
- League is intentionally NOT passed: this runs BEFORE any ESPN sport resolution,
  and no-league `/ask` disambiguates by player name (verified for NBA).
- Route `GET /api/sports/statmuse-gamelog?q=&league=` (rate 30/min), `{rows:[]}`
  on miss. Client (ParlayBuilder): detects period + game-by-game intent (and not
  a parlay) → fetch → render `PeriodGameLogCard` (per-game date/opp/value rows +
  Total/Avg DERIVED only from the real scraped values + honesty note).
- Verified: user's exact messy Wembanyama Q1 question → [5,11,2,11,7]; "LeBron
  first half points each game" → full season; nonsense → `{rows:[]}`.

### Period log now also feeds the PICK path (not just the display card)
The same per-game period grid is injected into chat so the AI grounds period
player props (Q1/1H points etc.) on REAL game-by-game period numbers instead of
season rates.
- `playerPeriodGameLog(player, periodPhrase, statWord, league, count=5)`: a FAST
  single-fetch variant for when the caller ALREADY has a clean player name —
  skips the two-step player-resolution of `askStatMuseGameLog` and goes straight
  to the canonical `"<player> <period> <stat> last N games game by game"` grid
  via `fetchStatMuseTable`. Returns null on miss. **Keeps StatMuse's OWN resolved
  `r.player`** (`r.player || name`) so rows are never misattributed to a name
  StatMuse didn't return. `detectStatWord` is exported for the caller.
- chat.ts (inside the best-effort statmuseFacts block): when `periodIntent`, pick
  the primary period (q1>h1>q2>q3>q4>h2), `detectStatWord` from the message, and
  up to 4 candidate players — players NAMED in the message first (full-name OR
  last-name **whole-word** match, `\b…\b`, ≥3 chars, against the FULL realProps
  pool), else distinct players in the period-FILTERED realProps (only q1/h1 have
  per-player props, so q2-q4/h2 yield no candidates and are correctly skipped).
  Fetch each log in parallel, format `"<player> — <period> <stat>, last N games:
  v,v,v (avg X)"`.
- **OFF-SLATE named players (step "1b")**: the props-pool match above ONLY grounds
  players whose team plays tonight. A question about a star whose team is idle
  (e.g. "Wembanyama Q1 vs the Knicks" when SAS isn't on the slate) found ZERO
  candidates → model fell back to one headline fact and honestly refused. Fix: a
  second extraction (runs only when `periodIntent` AND `candidates.length < 4`)
  pulls capitalized name phrases from the raw message via regex, EXCLUDING (a)
  tonight's team-name tokens from realGames, (b) the named opponent captured via
  `vs|versus|against (the )?Name`, and (c) a STOP wordlist (common caps, sports,
  days, months); single-word names must be ≥4 chars. Safe because the candidate
  only ever feeds `playerPeriodGameLog` → REAL StatMuse grid or null, never an
  invented number. Verified e2e: returns "5, 11, 2, 11, 7 (7.2 avg)" overall and
  notes only 1 verified Knicks game — exactly the "last ~5 OVERALL, not
  opponent-scoped" behavior chosen.
- SYSTEM_PROMPT "PERIOD GAME-LOG FACTS" directive: count games clearing the line,
  cite the game-by-game numbers + hit rate, take only the side the log supports,
  never override with a season rate, never invent if there's no log fact.
- **Budget is per-fetch, NOT all-or-nothing**: the enrichment used to wrap
  `Promise.all([...])` in one `Promise.race` against a single timeout — adding the
  period fetches made one slow lookup able to drop ALL facts. Now each fetch is
  individually raced against `STATMUSE_BUDGET_MS` (`withDeadline`) so fast facts
  still ship; stragglers keep running and warm the cache. Whole block in try/catch.
- Verified e2e: POST /api/chat with a Wembanyama `player_points_q1` prop → EDGE
  cited "5, 11, 2, 11, 7 … (2/5 clears, 7.2 avg)" and honestly leaned pass
  because the log doesn't beat 8.5. SSE delta shape is `data:{"content":"…"}`
  (NOT OpenAI `choices[].delta`); model stays silent ~30-60s (heartbeat `:` lines)
  before first token — use a ≥110s curl window when smoke-testing.

## Verified
Chat cited exact StatMuse numbers end-to-end (LeBron 20.9 PPG; Mahomes 3,587;
Dodgers 38-21). api-server has no watcher → restart after edits.

## Opponent-scoped period game-log (two-path gotcha)
askStatMuseGameLog has TWO query paths: (1) raw question (r1), (2) a rebuilt
canonical `"<player> <period> <stat> last N games game by game"` fallback (r2)
used when the raw collapses to <2 rows. An explicit opponent ("vs the Knicks")
must be carried into BOTH or the fallback silently widens to last-N games vs ANY
team while the UI still claims the opponent. Fix: extractOpponentClause(rawQuery)
re-injects ` vs the <opp>` into the canonical (raw already has it).
**Client honesty gate (decided):** PeriodGameLogCard does NOT label the subtitle
with the *requested* opponent name. It derives the label from the REAL rows — only
shows ` vs <opp>` when an opponent was requested AND every row's `opp` is uniform,
using that row abbreviation (e.g. "vs NYK"). Mixed/empty opps → no claim. This
makes mislabeling impossible even if StatMuse ignores the opponent.
**Why:** requested name (e.g. "knicks") ≠ row abbreviation ("NYK"), so you can't
verify the requested name against rows; deriving from rows is the only honest gate.
