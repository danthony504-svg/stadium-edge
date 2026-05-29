import { Router, type IRouter } from "express";
import { ESPN_SPORT_PATHS, cachedJson } from "../lib/sports";

const router: IRouter = Router();

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
      home: { teamId: homeTeamId, teamName: null, last10: { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null }, last5: { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null }, lastGameDate: null },
      away: { teamId: awayTeamId, teamName: null, last10: { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null }, last5: { games: 0, wins: 0, losses: 0, ptsFor: null, ptsAgainst: null, avgMargin: null }, lastGameDate: null },
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
    const key = `player-history:${path}:${athleteId}`;
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
    };
    const log = await cachedJson<GameLog>(key, 30 * 60 * 1000, async () => {
      const url = `https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${athleteId}/gamelog`;
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
    const vsOpponent = opponentTeamId
      ? flat.filter((g) => g.opponentId === opponentTeamId).slice(0, 5)
      : [];
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
    res.json({
      sport: sportId,
      athleteId,
      labels,
      recent,
      vsOpponent,
      homeSplit,
      awaySplit,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch player history");
    res.json({ sport: sportId, athleteId, labels: [], recent: [], vsOpponent: [] });
  }
});

export default router;
