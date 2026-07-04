import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { teamPace } from "../lib/statmuse.js";
import { keyInjuryWeight, simulateProp, type SimPropRequest } from "../lib/monteCarloBuild.js";
import { DEFAULT_SIMULATIONS } from "../lib/monteCarlo.js";

const router: IRouter = Router();

router.use("/sports/simulate", rateLimit({ windowMs: 60_000, max: 60, name: "simulate" }));

type InjuryTeam = {
  team?: string;
  entries?: Array<{ player?: string; status?: string }>;
};

type PlayerHistoryResp = {
  labels: string[];
  recent: Array<{
    stats: Record<string, string>;
    isHome?: boolean | null;
    opponentId?: string | null;
  }>;
  vsOpponent: Array<{ stats: Record<string, string> }>;
  minutesTrend?: {
    l5: number | null;
    l10: number | null;
    season: number | null;
    direction: "up" | "down" | "steady";
  } | null;
};

async function fetchPlayerHistory(
  baseUrl: string,
  sport: string,
  athleteId: string,
  opponentTeamId?: string,
): Promise<PlayerHistoryResp | null> {
  const q = new URLSearchParams({ sport, athleteId });
  if (opponentTeamId) q.set("opponentTeamId", opponentTeamId);
  try {
    const r = await fetch(`${baseUrl}/sports/player-history?${q}`);
    if (!r.ok) return null;
    return (await r.json()) as PlayerHistoryResp;
  } catch {
    return null;
  }
}

async function fetchInjuries(baseUrl: string, sport: string): Promise<InjuryTeam[]> {
  try {
    const r = await fetch(`${baseUrl}/sports/injuries?sport=${encodeURIComponent(sport)}`);
    if (!r.ok) return [];
    return (await r.json()) as InjuryTeam[];
  } catch {
    return [];
  }
}

function teamInjuryWeight(teams: InjuryTeam[], teamName: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const target = norm(teamName);
  const team = teams.find((t) => {
    const n = norm(t.team ?? "");
    return n.includes(target) || target.includes(n);
  });
  return keyInjuryWeight(team?.entries);
}

// POST /sports/simulate/props
// Body: { sport, homeTeam?, awayTeam?, isHomeByPlayer?, props: SimPropRequest[], simulations? }
router.post("/sports/simulate/props", async (req, res): Promise<void> => {
  const sport = String(req.body?.sport ?? "").toLowerCase();
  const props = (req.body?.props ?? []) as SimPropRequest[];
  const simulations = Number(req.body?.simulations) || DEFAULT_SIMULATIONS;
  const homeTeam = String(req.body?.homeTeam ?? "");
  const awayTeam = String(req.body?.awayTeam ?? "");
  const isHomeByPlayer = (req.body?.isHomeByPlayer ?? {}) as Record<string, boolean>;

  if (!sport || !Array.isArray(props) || props.length === 0) {
    res.status(400).json({ error: "sport and props[] required" });
    return;
  }
  if (props.length > 40) {
    res.status(400).json({ error: "max 40 props per request" });
    return;
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  let oppPace: number | null = null;
  let leaguePace: number | null = 100;
  if ((sport === "nba" || sport === "wnba") && homeTeam && awayTeam) {
    try {
      const [homeP, awayP] = await Promise.all([
        teamPace(homeTeam, sport),
        teamPace(awayTeam, sport),
      ]);
      if (homeP != null && awayP != null) {
        oppPace = (homeP + awayP) / 2;
        leaguePace = 100;
      }
    } catch {
      // pace optional
    }
  }

  const injuries = await fetchInjuries(baseUrl, sport);
  const oppKeyInjuries = awayTeam ? teamInjuryWeight(injuries, awayTeam) : 0;
  const ownKeyInjuries = homeTeam ? teamInjuryWeight(injuries, homeTeam) : 0;

  const weatherImpact =
    sport === "mlb" && req.body?.weatherImpact != null
      ? Number(req.body.weatherImpact)
      : null;

  const historyCache = new Map<string, PlayerHistoryResp | null>();

  const results = await Promise.all(
    props.map(async (p) => {
      const athleteId = p.athleteId ?? "";
      const cacheKey = `${sport}:${athleteId}:${p.opponentTeamId ?? ""}`;
      let history = historyCache.get(cacheKey);
      if (history === undefined) {
        history = athleteId
          ? await fetchPlayerHistory(baseUrl, sport, athleteId, p.opponentTeamId ?? undefined)
          : null;
        historyCache.set(cacheKey, history);
      }

      const isHome = p.isHome ?? isHomeByPlayer[p.player] ?? null;
      const oppPaceForPlayer =
        isHome === true ? oppPace : isHome === false ? oppPace : oppPace;

      return simulateProp(
        { ...p, sport, isHome },
        history,
        {
          sport,
          oppPace: oppPaceForPlayer,
          leaguePace,
          oppKeyInjuries,
          ownKeyInjuries,
          weatherImpact,
          playerHistories: new Map(),
        },
      );
    }),
  );

  res.json({
    sport,
    simulations,
    props: results,
  });
});

// GET /sports/simulate/game?sport=nba&eventId=...&homeTeam=...&awayTeam=...
// Fetches posted props for the event and runs Monte Carlo on each main line (both sides).
router.get("/sports/simulate/game", async (req, res): Promise<void> => {
  const sport = String(req.query.sport ?? "").toLowerCase();
  const eventId = String(req.query.eventId ?? "");
  const homeTeam = String(req.query.homeTeam ?? "");
  const awayTeam = String(req.query.awayTeam ?? "");

  if (!sport || !eventId) {
    res.status(400).json({ error: "sport and eventId required" });
    return;
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  try {
    const propsUrl = `${baseUrl}/sports/props?sport=${encodeURIComponent(sport)}&eventId=${encodeURIComponent(eventId)}`;
    const pr = await fetch(propsUrl);
    if (!pr.ok) {
      res.status(502).json({ error: `props fetch failed: ${pr.status}` });
      return;
    }
    const propRows = (await pr.json()) as Array<{
      player: string;
      market: string;
      line: number | null;
      athleteId?: string | null;
      alt?: boolean;
      overPrice?: number | null;
      underPrice?: number | null;
    }>;

    const mains = propRows.filter((r) => !r.alt && r.line != null).slice(0, 25);
    const simRequests: SimPropRequest[] = [];
    for (const r of mains) {
      if (r.overPrice != null) {
        simRequests.push({
          player: r.player,
          market: r.market,
          line: r.line as number,
          side: "Over",
          athleteId: r.athleteId,
          sport,
        });
      }
      if (r.underPrice != null) {
        simRequests.push({
          player: r.player,
          market: r.market,
          line: r.line as number,
          side: "Under",
          athleteId: r.athleteId,
          sport,
        });
      }
    }

    const body = {
      sport,
      homeTeam,
      awayTeam,
      props: simRequests,
    };

    const simRes = await fetch(`${baseUrl}/sports/simulate/props`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await simRes.json()) as Record<string, unknown>;
    res.json({ eventId, ...data });
  } catch (err) {
    req.log.error({ err }, "simulate/game failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "simulate failed" });
  }
});

export default router;
