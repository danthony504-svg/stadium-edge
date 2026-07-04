import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { teamPace } from "../lib/statmuse.js";
import { keyInjuryWeight, simulateProp, type SimPropRequest } from "../lib/monteCarloBuild.js";
import { DEEP_SIMULATIONS, QUICK_SIMULATIONS } from "../lib/monteCarlo.js";
import { runGameMonteCarlo } from "../lib/gameMonteCarlo.js";
import { getCachedSim, setCachedSim, simCacheKey, type SimTier } from "../lib/simCache.js";

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

type GameSimContext = {
  sport: string;
  oppPace: number | null;
  leaguePace: number | null;
  oppKeyInjuries: number;
  ownKeyInjuries: number;
  weatherImpact: number | null;
};

type SimPropRow = ReturnType<typeof simulateProp> & {
  tier: SimTier;
  cached: boolean;
  deepPending?: boolean;
};

const deepInFlight = new Set<string>();

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

type TeamHistoryResp = {
  homeSplit?: { ptsFor?: number | null; ptsAgainst?: number | null };
  awaySplit?: { ptsFor?: number | null; ptsAgainst?: number | null };
  last10?: { ptsFor?: number | null; ptsAgainst?: number | null };
  recent?: Array<{ pts?: number | null }>;
};

async function fetchTeamHistory(
  baseUrl: string,
  sport: string,
  teamId: string,
): Promise<TeamHistoryResp | null> {
  try {
    const r = await fetch(
      `${baseUrl}/sports/team-history?sport=${encodeURIComponent(sport)}&teamId=${encodeURIComponent(teamId)}`,
    );
    if (!r.ok) return null;
    return (await r.json()) as TeamHistoryResp;
  } catch {
    return null;
  }
}

function tierSimCount(tier: SimTier, simulations?: number): number {
  if (simulations && Number.isFinite(simulations) && simulations > 0) return simulations;
  return tier === "deep" ? DEEP_SIMULATIONS : QUICK_SIMULATIONS;
}

async function runPropSims(
  props: SimPropRequest[],
  tier: SimTier,
  gameCtx: GameSimContext,
  baseUrl: string,
  isHomeByPlayer: Record<string, boolean>,
  simulations?: number,
): Promise<{ rows: SimPropRow[]; deepPending: boolean }> {
  const simCount = tierSimCount(tier, simulations);
  const injuries = await fetchInjuries(baseUrl, gameCtx.sport);
  const historyCache = new Map<string, PlayerHistoryResp | null>();
  let deepPending = false;

  const rows = await Promise.all(
    props.map(async (p) => {
      const cacheKey = simCacheKey(p.sport, p.player, p.market, p.line, p.side, tier);
      const cached = await getCachedSim<SimPropRow>(cacheKey);
      if (cached) {
        const row: SimPropRow = { ...cached, tier, cached: true };
        if (tier === "quick") {
          const deepKey = simCacheKey(p.sport, p.player, p.market, p.line, p.side, "deep");
          const deepHit = await getCachedSim(deepKey);
          if (!deepHit) {
            deepPending = true;
            scheduleDeepSim([p], gameCtx, baseUrl, isHomeByPlayer);
          }
        }
        return row;
      }

      const athleteId = p.athleteId ?? "";
      const histKey = `${p.sport}:${athleteId}:${p.opponentTeamId ?? ""}`;
      let history = historyCache.get(histKey);
      if (history === undefined) {
        history = athleteId
          ? await fetchPlayerHistory(baseUrl, p.sport, athleteId, p.opponentTeamId ?? undefined)
          : null;
        historyCache.set(histKey, history);
      }

      const isHome = p.isHome ?? isHomeByPlayer[p.player] ?? null;
      const result = simulateProp(
        { ...p, sport: p.sport, isHome },
        history,
        {
          sport: gameCtx.sport,
          oppPace: gameCtx.oppPace,
          leaguePace: gameCtx.leaguePace,
          oppKeyInjuries: gameCtx.oppKeyInjuries,
          ownKeyInjuries: gameCtx.ownKeyInjuries,
          weatherImpact: gameCtx.weatherImpact,
          playerHistories: new Map(),
        },
        simCount,
      );

      const row: SimPropRow = { ...result, tier, cached: false };
      await setCachedSim(cacheKey, row, tier);

      if (tier === "quick") {
        deepPending = true;
        scheduleDeepSim([p], gameCtx, baseUrl, isHomeByPlayer);
      }

      return row;
    }),
  );

  return { rows, deepPending: tier === "quick" ? deepPending : false };
}

function scheduleDeepSim(
  props: SimPropRequest[],
  gameCtx: GameSimContext,
  baseUrl: string,
  isHomeByPlayer: Record<string, boolean>,
): void {
  void warmDeepSims(props, gameCtx, baseUrl, isHomeByPlayer).catch(() => {
    /* background warm is best-effort */
  });
}

async function warmDeepSims(
  props: SimPropRequest[],
  gameCtx: GameSimContext,
  baseUrl: string,
  isHomeByPlayer: Record<string, boolean>,
): Promise<void> {
  const historyCache = new Map<string, PlayerHistoryResp | null>();

  for (const p of props) {
    const deepKey = simCacheKey(p.sport, p.player, p.market, p.line, p.side, "deep");
    if (deepInFlight.has(deepKey)) continue;
    const existing = await getCachedSim(deepKey);
    if (existing) continue;

    deepInFlight.add(deepKey);
    try {
      const athleteId = p.athleteId ?? "";
      const histKey = `${p.sport}:${athleteId}:${p.opponentTeamId ?? ""}`;
      let history = historyCache.get(histKey);
      if (history === undefined) {
        history = athleteId
          ? await fetchPlayerHistory(baseUrl, p.sport, athleteId, p.opponentTeamId ?? undefined)
          : null;
        historyCache.set(histKey, history);
      }

      const isHome = p.isHome ?? isHomeByPlayer[p.player] ?? null;
      const result = simulateProp(
        { ...p, sport: p.sport, isHome },
        history,
        {
          sport: gameCtx.sport,
          oppPace: gameCtx.oppPace,
          leaguePace: gameCtx.leaguePace,
          oppKeyInjuries: gameCtx.oppKeyInjuries,
          ownKeyInjuries: gameCtx.ownKeyInjuries,
          weatherImpact: gameCtx.weatherImpact,
          playerHistories: new Map(),
        },
        DEEP_SIMULATIONS,
      );
      const row: SimPropRow = { ...result, tier: "deep", cached: false };
      await setCachedSim(deepKey, row, "deep");
    } finally {
      deepInFlight.delete(deepKey);
    }
  }
}

// POST /sports/simulate/game-outcome
router.post("/sports/simulate/game-outcome", async (req, res): Promise<void> => {
  const sport = String(req.body?.sport ?? "").toLowerCase();
  const homeTeamId = String(req.body?.homeTeamId ?? "");
  const awayTeamId = String(req.body?.awayTeamId ?? "");
  const simulations = Number(req.body?.simulations) || DEEP_SIMULATIONS;
  const weatherImpact =
    req.body?.weatherImpact != null ? Number(req.body.weatherImpact) : null;

  if (!sport || !homeTeamId || !awayTeamId) {
    res.status(400).json({ error: "sport, homeTeamId, awayTeamId required" });
    return;
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const [homeHist, awayHist] = await Promise.all([
    fetchTeamHistory(baseUrl, sport, homeTeamId),
    fetchTeamHistory(baseUrl, sport, awayTeamId),
  ]);

  const result = runGameMonteCarlo({
    sport,
    simulations,
    weatherImpact,
    home: {
      ptsFor: homeHist?.homeSplit?.ptsFor ?? homeHist?.last10?.ptsFor ?? null,
      ptsAgainst: homeHist?.homeSplit?.ptsAgainst ?? homeHist?.last10?.ptsAgainst ?? null,
      recentScores: (homeHist?.recent ?? [])
        .map((g) => g.pts)
        .filter((v): v is number => v != null && Number.isFinite(v)),
    },
    away: {
      ptsFor: awayHist?.awaySplit?.ptsFor ?? awayHist?.last10?.ptsFor ?? null,
      ptsAgainst: awayHist?.awaySplit?.ptsAgainst ?? awayHist?.last10?.ptsAgainst ?? null,
      recentScores: (awayHist?.recent ?? [])
        .map((g) => g.pts)
        .filter((v): v is number => v != null && Number.isFinite(v)),
    },
  });

  if (!result) {
    res.status(422).json({ error: "insufficient team scoring data for simulation" });
    return;
  }

  res.json({
    sport,
    homeTeam: req.body?.homeTeam ?? null,
    awayTeam: req.body?.awayTeam ?? null,
    ...result,
  });
});

// POST /sports/simulate/props
// Body: { sport, homeTeam?, awayTeam?, props: SimPropRequest[], tier?: "quick"|"deep", simulations? }
router.post("/sports/simulate/props", async (req, res): Promise<void> => {
  const sport = String(req.body?.sport ?? "").toLowerCase();
  const props = (req.body?.props ?? []) as SimPropRequest[];
  const tier: SimTier = req.body?.tier === "deep" ? "deep" : "quick";
  const simulations = req.body?.simulations != null ? Number(req.body.simulations) : undefined;
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

  const gameCtx: GameSimContext = {
    sport,
    oppPace,
    leaguePace,
    oppKeyInjuries,
    ownKeyInjuries,
    weatherImpact,
  };

  const { rows, deepPending } = await runPropSims(
    props,
    tier,
    gameCtx,
    baseUrl,
    isHomeByPlayer,
    simulations,
  );

  res.json({
    sport,
    tier,
    simulations: tierSimCount(tier, simulations),
    deepPending: tier === "quick" ? deepPending : false,
    props: rows,
  });
});

// GET /sports/simulate/game?sport=nba&eventId=...&homeTeam=...&awayTeam=...
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

    const simRes = await fetch(`${baseUrl}/sports/simulate/props`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport,
        homeTeam,
        awayTeam,
        tier: "quick",
        props: simRequests,
      }),
    });
    const data = (await simRes.json()) as Record<string, unknown>;
    res.json({ eventId, ...data });
  } catch (err) {
    req.log.error({ err }, "simulate/game failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "simulate failed" });
  }
});

export default router;
