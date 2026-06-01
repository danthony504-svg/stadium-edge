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

## Verified
Chat cited exact StatMuse numbers end-to-end (LeBron 20.9 PPG; Mahomes 3,587;
Dodgers 38-21). api-server has no watcher → restart after edits.
