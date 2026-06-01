import { Router, type IRouter } from "express";
import { ESPN_SPORT_PATHS, cachedJson } from "../lib/sports";

const router: IRouter = Router();

// ESPN search returns a league slug per athlete; map the ones whose game-log
// shape we support (US major + college) back to our internal sportId so the
// follow-up /player-history call works. Soccer/tennis/UFC have a different
// game-log structure, so we intentionally omit them from name-search results.
const LEAGUE_TO_SPORT: Record<string, string> = {
  mlb: "mlb",
  nba: "nba",
  wnba: "wnba",
  nhl: "nhl",
  nfl: "nfl",
  "college-football": "ncaaf",
  "mens-college-basketball": "ncaab",
};

type EspnSchedEvent = {
  id: string;
  date: string;
  competitions?: Array<{
    status?: { type?: { completed?: boolean; state?: string; description?: string } };
    competitors?: Array<{
      homeAway: "home" | "away";
      score?: { value?: number; displayValue?: string } | string;
      winner?: boolean;
      team?: { id?: string; displayName?: string; abbreviation?: string };
    }>;
  }>;
};

type SchedResp = { events?: EspnSchedEvent[]; team?: { displayName?: string } };

// Normalize an ESPN scoreboard "score" field which can be either a number,
// a string, or an object {value, displayValue} depending on endpoint.
function parseScore(s: unknown): number | null {
  if (s == null) return null;
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s === "string") {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof s === "object" && s !== null) {
    const obj = s as { value?: number; displayValue?: string };
    if (typeof obj.value === "number" && Number.isFinite(obj.value)) return obj.value;
    if (typeof obj.displayValue === "string") {
      const n = parseInt(obj.displayValue, 10);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

// Pull a team's completed schedule from ESPN and reduce to a clean list of
// past results, newest first. Each entry is honest about whether it has a
// final score — we drop any event still in-progress or scheduled.
async function fetchTeamHistory(path: string, teamId: string) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/schedule`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ESPN team schedule ${r.status}`);
  const data = (await r.json()) as SchedResp;
  const events = data.events ?? [];
  const results: Array<{
    eventId: string;
    date: string;
    opponentId: string | null;
    opponentName: string | null;
    teamScore: number | null;
    oppScore: number | null;
    isHome: boolean;
    won: boolean | null;
    margin: number | null;
  }> = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const st = comp.status?.type;
    if (!st?.completed && st?.state !== "post") continue;
    const me = comp.competitors?.find((c) => c.team?.id === teamId);
    const opp = comp.competitors?.find((c) => c.team?.id !== teamId);
    if (!me || !opp) continue;
    const teamScore = parseScore(me.score);
    const oppScore = parseScore(opp.score);
    const won = teamScore != null && oppScore != null ? teamScore > oppScore : null;
    results.push({
      eventId: ev.id,
      date: ev.date,
      opponentId: opp.team?.id ?? null,
      opponentName: opp.team?.displayName ?? null,
      teamScore,
      oppScore,
      isHome: me.homeAway === "home",
      won,
      margin: teamScore != null && oppScore != null ? teamScore - oppScore : null,
    });
  }
  // Newest first
  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return { teamName: data.team?.displayName ?? null, results };
}

// Summarize a list of results into a compact form pack: last N record,
// points for/against averages, average margin. All numbers are derived
// directly from real final scores — nothing fabricated.
function summarizeForm(results: Array<{ teamScore: number | null; oppScore: number | null; won: boolean | null; margin: number | null }>, n: number) {
  const scored = results.filter((r) => r.teamScore != null && r.oppScore != null).slice(0, n);
  if (scored.length === 0) {
    return { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null };
  }
  const wins = scored.filter((r) => r.won === true).length;
  const losses = scored.filter((r) => r.won === false).length;
  const ptsFor = scored.reduce((a, r) => a + (r.teamScore as number), 0) / scored.length;
  const ptsAgainst = scored.reduce((a, r) => a + (r.oppScore as number), 0) / scored.length;
  const avgMargin = scored.reduce((a, r) => a + (r.margin as number), 0) / scored.length;
  return {
    games: scored.length,
    wins,
    losses,
    ptsFor: Math.round(ptsFor * 10) / 10,
    ptsAgainst: Math.round(ptsAgainst * 10) / 10,
    avgMargin: Math.round(avgMargin * 10) / 10,
  };
}

// Compact list of a team's most recent COMPLETED games (newest first) with
// real final scores. Powers the team detail page's recent-performance chart —
// every number is a real ESPN final score, nothing fabricated.
function recentList(
  results: Array<{ date: string; opponentName: string | null; teamScore: number | null; oppScore: number | null; won: boolean | null; isHome: boolean }>,
  n: number,
) {
  return results
    .filter((r) => r.teamScore != null && r.oppScore != null)
    .slice(0, n)
    .map((r) => ({ date: r.date, opp: r.opponentName, home: r.isHome, pts: r.teamScore, oppPts: r.oppScore, won: r.won }));
}

// Current win/loss streak from a team's results (newest first). Counts how
// many consecutive games — from the most recent — ended the same way. Real,
// derived straight from final scores; null when there are no decided games.
function computeStreak(results: Array<{ won: boolean | null }>) {
  const decided = results.filter((r) => r.won === true || r.won === false);
  if (decided.length === 0) return null;
  const type = decided[0].won ? "W" : "L";
  let count = 0;
  for (const r of decided) {
    if ((r.won ? "W" : "L") === type) count++;
    else break;
  }
  return { type, count };
}

// Full-season record over every COMPLETED game in the feed — a real proxy for
// standings/quality. winPct is wins / decided games, rounded to 3 dp.
function seasonRecord(results: Array<{ won: boolean | null }>) {
  const decided = results.filter((r) => r.won === true || r.won === false);
  if (decided.length === 0) return { games: 0, wins: 0, losses: 0, winPct: null };
  const wins = decided.filter((r) => r.won === true).length;
  const losses = decided.length - wins;
  return { games: decided.length, wins, losses, winPct: Math.round((wins / decided.length) * 1000) / 1000 };
}

// Matchup history: pulls form for both teams + head-to-head meetings.
// Returns honest empty buckets when a feed has no data (no fabrication).
router.get("/sports/matchup-history", async (req, res): Promise<void> => {
  const sportId = String(req.query.sport || "").toLowerCase();
  const homeTeamId = String(req.query.homeTeamId || "");
  const awayTeamId = String(req.query.awayTeamId || "");
  if (!sportId || !homeTeamId || !awayTeamId) {
    res.status(400).json({ error: "sport, homeTeamId, awayTeamId required" });
    return;
  }
  const path = ESPN_SPORT_PATHS[sportId];
  if (!path) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }
  try {
    const key = `matchup-history:${path}:${homeTeamId}:${awayTeamId}`;
    const out = await cachedJson(key, 15 * 60 * 1000, async () => {
      const [home, away] = await Promise.all([
        fetchTeamHistory(path, homeTeamId).catch(() => ({ teamName: null, results: [] as Awaited<ReturnType<typeof fetchTeamHistory>>["results"] })),
        fetchTeamHistory(path, awayTeamId).catch(() => ({ teamName: null, results: [] as Awaited<ReturnType<typeof fetchTeamHistory>>["results"] })),
      ]);
      // Head-to-head from the home team's schedule — any past completed
      // game vs this exact opponent. Both teams' schedules would dedup,
      // so we only need one side. Take the most recent 5.
      const h2hRaw = home.results.filter((r) => r.opponentId === awayTeamId).slice(0, 5);
      const h2h = h2hRaw.map((r) => ({
        date: r.date,
        homeTeamWonByMargin: r.won == null ? null : (r.won ? Math.abs(r.margin ?? 0) : -Math.abs(r.margin ?? 0)),
        homeTeamScore: r.teamScore,
        awayTeamScore: r.oppScore,
        playedAtHome: r.isHome,
      }));
      const homeWinsInH2H = h2h.filter((m) => (m.homeTeamWonByMargin ?? 0) > 0).length;
      const awayWinsInH2H = h2h.filter((m) => (m.homeTeamWonByMargin ?? 0) < 0).length;
      return {
        sport: sportId,
        home: {
          teamId: homeTeamId,
          teamName: home.teamName,
          last10: summarizeForm(home.results, 10),
          last5: summarizeForm(home.results, 5),
          // Venue splits: this team's last-10 form in games played AT HOME vs
          // ON THE ROAD. For the upcoming game (at the home team's venue),
          // homeSplit is the relevant read for the home side.
          homeSplit: summarizeForm(home.results.filter((r) => r.isHome), 10),
          awaySplit: summarizeForm(home.results.filter((r) => !r.isHome), 10),
          // Current W/L streak and full-season record — real, from final scores.
          streak: computeStreak(home.results),
          season: seasonRecord(home.results),
          // Real last-10 game-by-game scores for the team detail chart.
          recent: recentList(home.results, 10),
          // Most recent COMPLETED game date — lets the client compute real
          // days-rest / back-to-back vs the upcoming game's start time. Null
          // when the team has no completed games in the feed.
          lastGameDate: home.results[0]?.date ?? null,
        },
        away: {
          teamId: awayTeamId,
          teamName: away.teamName,
          last10: summarizeForm(away.results, 10),
          last5: summarizeForm(away.results, 5),
          homeSplit: summarizeForm(away.results.filter((r) => r.isHome), 10),
          awaySplit: summarizeForm(away.results.filter((r) => !r.isHome), 10),
          streak: computeStreak(away.results),
          season: seasonRecord(away.results),
          recent: recentList(away.results, 10),
          lastGameDate: away.results[0]?.date ?? null,
        },
        h2h: {
          meetings: h2h,
          homeWins: homeWinsInH2H,
          awayWins: awayWinsInH2H,
        },
      };
    });
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch matchup history");
    res.json({
      sport: sportId,
      home: { teamId: homeTeamId, teamName: null, last10: { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null }, last5: { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null }, recent: [], lastGameDate: null },
      away: { teamId: awayTeamId, teamName: null, last10: { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null }, last5: { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null }, recent: [], lastGameDate: null },
      h2h: { meetings: [], homeWins: 0, awayWins: 0 },
    });
  }
});

// Per-player game log — last N games with the stat lines that ESPN ships
// for that sport. Used to compute player-vs-opponent splits when the
// opponent ID matches recent log entries. Honest about empty / missing.
router.get("/sports/player-history", async (req, res): Promise<void> => {
  const sportId = String(req.query.sport || "").toLowerCase();
  const athleteId = String(req.query.athleteId || "");
  const opponentTeamId = String(req.query.opponentTeamId || "");
  // Optional free-text opponent ("lakers", "the celtics") so the chat can
  // surface a player's REAL stat lines from prior meetings vs that team this
  // season — matched against the opponent names already in the player's own
  // game log, so no global team database is needed and nothing is fabricated.
  const opponentNameQ = String(req.query.opponentName || "").trim();
  // Optional season (4-digit year). When present we pull THAT season's game
  // log instead of the current one, via ESPN's real ?season= param.
  const seasonReq = String(req.query.season || "").trim();
  const season = /^\d{4}$/.test(seasonReq) ? seasonReq : "";
  if (!sportId || !athleteId) {
    res.status(400).json({ error: "sport and athleteId required" });
    return;
  }
  const path = ESPN_SPORT_PATHS[sportId];
  if (!path) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }
  try {
    const key = `player-history:${path}:${athleteId}:${season || "current"}`;
    type GameLog = {
      events?: Record<string, { id?: string; opponent?: { id?: string; displayName?: string }; gameDate?: string; atVs?: string }>;
      seasonTypes?: Array<{
        categories?: Array<{
          events?: Array<{ eventId?: string; stats?: string[] }>;
        }>;
      }>;
      names?: string[];
      labels?: string[];
      glossary?: Array<{ abbreviation?: string; displayName?: string }>;
      filters?: Array<{ name?: string; value?: string; options?: Array<{ value?: string; displayValue?: string }> }>;
    };
    const log = await cachedJson<GameLog>(key, 30 * 60 * 1000, async () => {
      const url =
        `https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${athleteId}/gamelog` +
        (season ? `?season=${season}` : "");
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN gamelog ${r.status}`);
      return (await r.json()) as GameLog;
    });
    // Flatten the gamelog into a flat list keyed by eventId with the labeled stats.
    const labels = (log.labels ?? log.names ?? []) as string[];
    const eventMeta = log.events ?? {};
    const flat: Array<{ eventId: string; date: string | null; opponentId: string | null; opponentName: string | null; isHome: boolean | null; stats: Record<string, string> }> = [];
    for (const st of log.seasonTypes ?? []) {
      for (const cat of st.categories ?? []) {
        for (const ev of cat.events ?? []) {
          if (!ev.eventId) continue;
          const meta = eventMeta[ev.eventId];
          const stats: Record<string, string> = {};
          (ev.stats ?? []).forEach((v, i) => { if (labels[i]) stats[labels[i]] = v; });
          // ESPN gamelog encodes home/away in atVs: "vs" = home game,
          // "@" = away game. Null when the feed omits it.
          const atVs = meta?.atVs;
          const isHome = atVs === "vs" ? true : atVs === "@" ? false : null;
          flat.push({
            eventId: ev.eventId,
            date: meta?.gameDate ?? null,
            opponentId: meta?.opponent?.id ?? null,
            opponentName: meta?.opponent?.displayName ?? null,
            isHome,
            stats,
          });
        }
      }
    }
    flat.sort((a, b) => {
      const ad = a.date ? new Date(a.date).getTime() : 0;
      const bd = b.date ? new Date(b.date).getTime() : 0;
      return bd - ad;
    });
    const recent = flat.slice(0, 10);
    // Prior meetings vs a specific opponent THIS season. Prefer an exact team-id
    // match; otherwise fall back to fuzzy-matching a free-text hint ("lakers")
    // against the opponent display names already in this player's log. Every row
    // is a real game ESPN recorded — never fabricated.
    const normTeam = (s: string | null | undefined) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    let vsOpponent: typeof flat = [];
    if (opponentTeamId) {
      vsOpponent = flat.filter((g) => g.opponentId === opponentTeamId).slice(0, 10);
    } else if (opponentNameQ) {
      // Resolve the free-text hint to ONE real opponent the player actually
      // faced, then filter strictly to it — never a loose substring match (which
      // mixed teams, e.g. "and" ⊂ "ClevelAND", "new" matching both New York and
      // New Orleans). We score each UNIQUE opponent on EXACT token hits, weight
      // the nickname (last word) heavily, and only commit when there's a clear
      // unique winner — ambiguous hints ("LA") return nothing (honest note).
      const STOP = new Set(["the", "and", "of", "at", "vs", "fc", "sc", "team", "city", "state"]);
      const toks = (s: string | null | undefined) =>
        normTeam(s).split(" ").filter(Boolean);
      const hintFull = normTeam(opponentNameQ);
      const hintToks = toks(opponentNameQ).filter((w) => w.length >= 3 && !STOP.has(w));
      if (hintToks.length) {
        const byKey = new Map<string, { name: string | null; id: string | null; score: number }>();
        for (const g of flat) {
          if (!g.opponentName) continue;
          const oToks = toks(g.opponentName);
          if (!oToks.length) continue;
          const nick = oToks[oToks.length - 1]; // last word ≈ team nickname
          let score = 0;
          for (const h of hintToks) {
            if (h === nick) score += 3;
            else if (oToks.includes(h)) score += 1;
          }
          if (hintFull === oToks.join(" ")) score += 5; // full-name exact match
          const key = g.opponentId || g.opponentName;
          const prev = byKey.get(key);
          if (!prev || score > prev.score) {
            byKey.set(key, { name: g.opponentName, id: g.opponentId, score });
          }
        }
        const ranked = [...byKey.values()]
          .filter((c) => c.score > 0)
          // Score desc, then a stable secondary key (name asc) so equal scores
          // order deterministically across runtimes — the tie check below must
          // be reproducible, never dependent on Map/insertion order.
          .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
        const best = ranked[0];
        // Ambiguous when >1 candidate shares the top score — return nothing.
        const tie = ranked.filter((c) => c.score === best?.score).length > 1;
        if (best && !tie) {
          vsOpponent = flat
            .filter((g) => (best.id ? g.opponentId === best.id : g.opponentName === best.name))
            .slice(0, 10);
        }
      }
    }
    const vsOpponentName = vsOpponent[0]?.opponentName ?? null;
    // Home / away splits — per-stat average over the FULL season log (not
    // just the last 5), split by where the game was played. Only numeric
    // stats are averaged; rate stats (.241) and counting stats both parse.
    // Honest empty bucket ({ games: 0, averages: {} }) when a side has no
    // games or atVs is missing throughout — never fabricated.
    const splitAverages = (games: typeof flat) => {
      const sums: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const g of games) {
        for (const [lab, raw] of Object.entries(g.stats)) {
          const n = Number(raw);
          if (!Number.isFinite(n)) continue;
          sums[lab] = (sums[lab] ?? 0) + n;
          counts[lab] = (counts[lab] ?? 0) + 1;
        }
      }
      const averages: Record<string, number> = {};
      for (const lab of Object.keys(sums)) {
        averages[lab] = Math.round((sums[lab] / counts[lab]) * 100) / 100;
      }
      return { games: games.length, averages };
    };
    const homeGames = flat.filter((g) => g.isHome === true);
    const awayGames = flat.filter((g) => g.isHome === false);
    const homeSplit = splitAverages(homeGames);
    const awaySplit = splitAverages(awayGames);
    // Full-season summary: per-game averages AND season totals (sums) for
    // every numeric stat in the log. Counting stats (HR, PTS) read naturally
    // as totals; rate stats (AVG) read as the season average. Both are REAL
    // aggregates of the game log — the card chooses which to show per column.
    const seasonAvg = splitAverages(flat);
    const seasonTotals: Record<string, number> = {};
    for (const g of flat) {
      for (const [lab, raw] of Object.entries(g.stats)) {
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        seasonTotals[lab] = Math.round(((seasonTotals[lab] ?? 0) + n) * 100) / 100;
      }
    }
    const seasonSummary = { games: flat.length, averages: seasonAvg.averages, totals: seasonTotals };
    const seasonFilter = (log.filters ?? []).find((f) => f.name === "season");
    const resolvedSeason = seasonFilter?.value ?? (season || null);
    const availableSeasons = (seasonFilter?.options ?? [])
      .map((o) => o.value)
      .filter((v): v is string => !!v);
    res.json({
      sport: sportId,
      athleteId,
      labels,
      recent,
      vsOpponent,
      vsOpponentName,
      homeSplit,
      awaySplit,
      season: resolvedSeason,
      availableSeasons,
      seasonSummary,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch player history");
    res.json({ sport: sportId, athleteId, labels: [], recent: [], vsOpponent: [], vsOpponentName: null, season: null, availableSeasons: [], seasonSummary: { games: 0, averages: {}, totals: {} } });
  }
});

// Player name search — resolves a free-text name to real ESPN athletes so the
// chat can look up anyone, not just players in today's slate. Returns only
// athletes whose league maps to a sport we can pull a game log for.
router.get("/sports/player-search", async (req, res): Promise<void> => {
  const query = String(req.query.query || req.query.name || "").trim();
  if (query.length < 2) {
    res.status(400).json({ error: "query (>= 2 chars) required" });
    return;
  }
  type SearchItem = {
    id?: string;
    displayName?: string;
    league?: string;
    defaultLeagueSlug?: string;
    isActive?: boolean;
    isRetired?: boolean;
    headshot?: { href?: string } | string | null;
    teamRelationships?: Array<{ displayName?: string }>;
  };
  try {
    const key = `player-search:${query.toLowerCase()}`;
    const data = await cachedJson<{ items?: SearchItem[] }>(key, 30 * 60 * 1000, async () => {
      const url =
        `https://site.web.api.espn.com/apis/common/v3/search?region=us&lang=en&limit=12&type=player&query=` +
        encodeURIComponent(query);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN search ${r.status}`);
      return (await r.json()) as { items?: SearchItem[] };
    });
    const results = [];
    for (const it of data.items ?? []) {
      const leagueSlug = String(it.league || it.defaultLeagueSlug || "").toLowerCase();
      const sport = LEAGUE_TO_SPORT[leagueSlug];
      if (!sport || !it.id || !it.displayName) continue;
      const headshot =
        typeof it.headshot === "string"
          ? it.headshot
          : it.headshot?.href ??
            `https://a.espncdn.com/i/headshots/${leagueSlug}/players/full/${it.id}.png`;
      results.push({
        athleteId: it.id,
        name: it.displayName,
        sport,
        league: leagueSlug,
        team: it.teamRelationships?.[0]?.displayName ?? null,
        headshot,
        isActive: it.isActive !== false && it.isRetired !== true,
      });
    }
    res.json({ query, results });
  } catch (err) {
    req.log.error({ err }, "Failed player search");
    res.json({ query, results: [] });
  }
});

export default router;
