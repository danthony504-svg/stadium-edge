import { Router, type IRouter } from "express";
import { ESPN_SPORT_PATHS, cachedJson } from "../lib/sports";

const router: IRouter = Router();

type EspnTeam = {
  team?: {
    displayName?: string;
    record?: { items?: Array<{ type?: string; stats?: Array<{ name?: string; value?: number; displayValue?: string }> }> };
  };
};
type EspnStats = {
  results?: {
    stats?: {
      categories?: Array<{
        name?: string;
        stats?: Array<{ name?: string; abbreviation?: string; displayValue?: string; value?: number; description?: string }>;
      }>;
    };
  };
};

// Curated per-sport stat allowlist: stats that describe what a team's
// DEFENSE produces (forced turnovers / sacks / blocks / steals etc.).
// We DO NOT pretend ESPN's per-team feed has "opponent allows X 3PM" —
// that would require aggregating opponent box scores. Honest pass-through
// of what's actually in the feed: the team's own defensive output plus
// the headline "avgPointsAgainst" from the record, which IS a real
// opponent-scoring rate.
const SPORT_DEFENSIVE_STATS: Record<string, { category: string; stats: string[] }[]> = {
  nba: [
    { category: "defensive", stats: ["avgSteals", "avgBlocks", "avgDefensiveRebounds"] },
    { category: "general", stats: ["avgRebounds", "assistTurnoverRatio"] },
  ],
  ncaab: [
    { category: "defensive", stats: ["avgSteals", "avgBlocks", "avgDefensiveRebounds"] },
    { category: "general", stats: ["avgRebounds", "assistTurnoverRatio"] },
  ],
  wnba: [
    { category: "defensive", stats: ["avgSteals", "avgBlocks", "avgDefensiveRebounds"] },
  ],
  nfl: [
    { category: "defensive", stats: ["sacks", "totalTackles", "passesDefended", "stuffs"] },
    { category: "defensiveInterceptions", stats: ["interceptions"] },
  ],
  ncaaf: [
    { category: "defensive", stats: ["sacks", "totalTackles", "passesDefended", "stuffs"] },
    { category: "defensiveInterceptions", stats: ["interceptions"] },
  ],
  nhl: [
    { category: "defensive", stats: ["blockedShots", "hits", "takeaways"] },
    { category: "goaltending", stats: ["goalsAgainstAverage", "savePct", "shotsAgainst"] },
  ],
  mlb: [
    { category: "pitching", stats: ["ERA", "WHIP", "strikeoutsPitched", "battingAverageAgainst", "opponentOnBasePercentage"] },
    { category: "fielding", stats: ["fieldingPct", "errors"] },
  ],
  soccer: [
    { category: "defensive", stats: ["goalsConceded", "cleanSheets", "tackles", "interceptions"] },
  ],
};

// Opposing team's OWN OFFENSIVE profile — these drive prop-side decisions the
// "defensive" block can't answer: a team that misses lots of buckets creates
// more rebound chances for everyone on the floor (opp's avgFieldGoalPct LOW
// → rebound props lean OVER), a team that throws for 280yd/game makes opp
// receivers' yardage props lean OVER, a team with a 0.270 team BA gives
// opposing pitchers a harder strikeout night (Ks lean UNDER), etc. ESPN's
// per-team statistics feed exposes these reliably; missing keys silently
// drop through.
const SPORT_OFFENSIVE_STATS: Record<string, { category: string; stats: string[] }[]> = {
  nba: [
    { category: "offensive", stats: ["avgPoints", "avgAssists", "avgFieldGoalsMade", "avgFieldGoalsAttempted", "fieldGoalPct", "threePointFieldGoalPct", "avgTurnovers"] },
  ],
  ncaab: [
    { category: "offensive", stats: ["avgPoints", "avgAssists", "avgFieldGoalsMade", "avgFieldGoalsAttempted", "fieldGoalPct", "threePointFieldGoalPct", "avgTurnovers"] },
  ],
  wnba: [
    { category: "offensive", stats: ["avgPoints", "avgAssists", "avgFieldGoalsMade", "avgFieldGoalsAttempted", "fieldGoalPct", "threePointFieldGoalPct", "avgTurnovers"] },
  ],
  nfl: [
    { category: "passing", stats: ["passingYardsPerGame", "completionPct", "yardsPerPassAttempt"] },
    { category: "rushing", stats: ["rushingYardsPerGame", "yardsPerRushAttempt"] },
    { category: "scoring", stats: ["totalPointsPerGame"] },
  ],
  ncaaf: [
    { category: "passing", stats: ["passingYardsPerGame", "completionPct", "yardsPerPassAttempt"] },
    { category: "rushing", stats: ["rushingYardsPerGame", "yardsPerRushAttempt"] },
    { category: "scoring", stats: ["totalPointsPerGame"] },
  ],
  nhl: [
    { category: "offensive", stats: ["avgGoals", "shotsTotal", "shootingPct"] },
    { category: "general", stats: ["powerPlayPct", "faceoffsWonPct"] },
  ],
  mlb: [
    { category: "batting", stats: ["avg", "onBasePct", "slugAvg", "OPS", "runsScored", "hits", "homeRuns", "strikeouts"] },
  ],
  soccer: [
    { category: "offensive", stats: ["totalGoals", "shotsOnTarget", "totalShots"] },
  ],
};

router.get("/sports/team-defense", async (req, res): Promise<void> => {
  const sportId = String(req.query.sport || "").toLowerCase();
  const teamId = String(req.query.teamId || "");
  if (!sportId || !teamId) {
    res.status(400).json({ error: "sport and teamId required" });
    return;
  }
  const path = ESPN_SPORT_PATHS[sportId];
  if (!path) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }
  try {
    const key = `team-defense:${path}:${teamId}:v4`;
    const out = await cachedJson(key, 60 * 60 * 1000, async () => {
      const [team, stats] = await Promise.all([
        fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}`).then((r) => r.ok ? (r.json() as Promise<EspnTeam>) : null).catch(() => null),
        fetch(`https://site.web.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/statistics`).then((r) => r.ok ? (r.json() as Promise<EspnStats>) : null).catch(() => null),
      ]);
      // Headline "opponent scored against this team" — the only true
      // opponent-allowed number ESPN exposes per team without box-score
      // aggregation. Pull it from the record.
      const totalRec = team?.team?.record?.items?.find((r) => r.type === "total");
      const avgPointsAgainst = totalRec?.stats?.find((s) => s.name === "avgPointsAgainst")?.value ?? null;
      const avgPointsFor = totalRec?.stats?.find((s) => s.name === "avgPointsFor")?.value ?? null;
      const pointDiff = totalRec?.stats?.find((s) => s.name === "differential" || s.name === "pointDifferential")?.value ?? null;
      // Pull the curated defensive-output stats for this sport from the
      // statistics feed. Honest empty when ESPN doesn't ship them.
      // Pass through ONLY numeric value + displayValue. ESPN's `description`
      // field is untrusted free-text that gets appended into the chat
      // system message verbatim — stripping it removes the prompt-injection
      // surface (model can't be steered by upstream-controlled prose).
      const cats = stats?.results?.stats?.categories ?? [];
      // Shared extractor — same allowlist shape on both sides, so de-dupe
      // the pass-through loop. Strips ESPN's `description` for the same
      // prompt-injection reason as above.
      const extract = (allowlist: { category: string; stats: string[] }[]) => {
        const out: Record<string, { value: number | null; displayValue: string | null }> = {};
        for (const entry of allowlist) {
          const cat = cats.find((c) => c.name === entry.category);
          for (const wanted of entry.stats) {
            const s = cat?.stats?.find((x) => x.name === wanted);
            if (!s) continue;
            out[wanted] = {
              value: typeof s.value === "number" ? Math.round(s.value * 100) / 100 : null,
              displayValue: typeof s.displayValue === "string" ? s.displayValue.slice(0, 32) : null,
            };
          }
        }
        return out;
      };
      const defensive = extract(SPORT_DEFENSIVE_STATS[sportId] ?? []);
      const offensive = extract(SPORT_OFFENSIVE_STATS[sportId] ?? []);
      return {
        sport: sportId,
        teamId,
        teamName: team?.team?.displayName ?? null,
        avgPointsAgainst: avgPointsAgainst != null ? Math.round(avgPointsAgainst * 10) / 10 : null,
        avgPointsFor: avgPointsFor != null ? Math.round(avgPointsFor * 10) / 10 : null,
        pointDifferential: pointDiff != null ? Math.round(pointDiff * 10) / 10 : null,
        defensive,
        offensive,
      };
    });
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch team defense");
    res.json({ sport: sportId, teamId, teamName: null, avgPointsAgainst: null, avgPointsFor: null, pointDifferential: null, defensive: {}, offensive: {} });
  }
});

export default router;
