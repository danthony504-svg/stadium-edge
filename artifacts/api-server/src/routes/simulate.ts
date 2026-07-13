import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { teamPace } from "../lib/statmuse.js";
import { keyInjuryWeight, simulateProp, type SimPropRequest } from "../lib/monteCarloBuild.js";
import { DEEP_SIMULATIONS, QUICK_SIMULATIONS } from "../lib/monteCarlo.js";
import { runGameMonteCarlo, type GameCoverQuery } from "../lib/gameMonteCarlo.js";
import { parsePeriodScope } from "../lib/gamePeriodMonteCarlo.js";
import { runSportGameMonteCarlo } from "../lib/sportSim/registry.js";
import { runTennisMonteCarlo } from "../lib/tennisMonteCarlo.js";
import { buildFightAnalysis } from "../lib/ufc.js";
import { getCachedSim, setCachedSim, simCacheKey, type SimTier } from "../lib/simCache.js";
import { fetchEspnPlayerHistory } from "../lib/espnPlayerHistory.js";
import { fetchEspnInjuries } from "../lib/espnInjuries.js";
import { resolvePropAthleteIds } from "../lib/resolvePropAthleteIds.js";

const router: IRouter = Router();

/** Internal self-calls for routes not yet ported to direct ESPN fetch. */
function apiBaseFromReq(req: { protocol: string; get(name: string): string | undefined }): string {
  return `${req.protocol}://${req.get("host")}/api`;
}

router.use("/sports/simulate", rateLimit({ windowMs: 60_000, max: 60, name: "simulate" }));

function parseCoverQueries(raw: unknown): GameCoverQuery[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: GameCoverQuery[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as { id?: string }).id ?? "").trim();
    const kind = String((item as { kind?: string }).kind ?? "").toLowerCase();
    if (!id) continue;
    const valid =
      kind === "ml" ||
      kind === "spread" ||
      kind === "total" ||
      kind === "teamtotal" ||
      kind === "raceto";
    if (!valid) continue;
    const normalizedKind =
      kind === "teamtotal" ? "teamTotal" : kind === "raceto" ? "raceTo" : kind;
    const q: GameCoverQuery = { id, kind: normalizedKind as GameCoverQuery["kind"] };
    const teamSide = String((item as { teamSide?: string }).teamSide ?? "").toLowerCase();
    if (teamSide === "home" || teamSide === "away") q.teamSide = teamSide;
    const totalSide = String((item as { totalSide?: string }).totalSide ?? "").toLowerCase();
    if (totalSide === "over" || totalSide === "under") q.totalSide = totalSide;
    const line = (item as { line?: number }).line;
    if (line != null && Number.isFinite(line)) q.line = line;
    const period = parsePeriodScope((item as { period?: string }).period);
    if (period) q.period = period;
    const raceTarget = (item as { raceTarget?: number }).raceTarget;
    if (raceTarget != null && Number.isFinite(raceTarget)) q.raceTarget = raceTarget;
    out.push(q);
  }
  return out.length ? out : undefined;
}

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

function teamInjuryWeight(teams: Awaited<ReturnType<typeof fetchEspnInjuries>>, teamName: string): number {
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

function propSport(p: SimPropRequest, gameCtx: GameSimContext): string {
  return String(p.sport ?? gameCtx.sport).toLowerCase();
}

async function runPropSims(
  props: SimPropRequest[],
  tier: SimTier,
  gameCtx: GameSimContext,
  isHomeByPlayer: Record<string, boolean>,
  simulations?: number,
): Promise<{ rows: SimPropRow[]; deepPending: boolean }> {
  const simCount = tierSimCount(tier, simulations);
  const historyCache = new Map<string, Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null>();
  let deepPending = false;

  const rows = await Promise.all(
    props.map(async (p) => {
      const sportKey = propSport(p, gameCtx);
      const cacheKey = simCacheKey(sportKey, p.player, p.market, p.line, p.side, tier, p.additionalLines);
      const cached = await getCachedSim<SimPropRow>(cacheKey);
      if (cached && cached.hitProbability != null) {
        const row: SimPropRow = { ...cached, tier, cached: true };
        if (tier === "quick") {
          const deepKey = simCacheKey(sportKey, p.player, p.market, p.line, p.side, "deep", p.additionalLines);
          const deepHit = await getCachedSim(deepKey);
          if (!deepHit) {
            deepPending = true;
            scheduleDeepSim([p], gameCtx, isHomeByPlayer);
          }
        }
        return row;
      }

      const athleteId = p.athleteId ?? "";
      const histKey = `${sportKey}:${athleteId}:${p.opponentTeamId ?? ""}`;
      let history = historyCache.get(histKey);
      if (history === undefined) {
        history = athleteId
          ? await fetchEspnPlayerHistory(sportKey, athleteId, p.opponentTeamId ?? undefined)
          : null;
        historyCache.set(histKey, history);
      }

      const isHome = p.isHome ?? isHomeByPlayer[p.player] ?? null;
      const result = simulateProp(
        { ...p, sport: sportKey, isHome },
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
      if (result.hitProbability != null) {
        await setCachedSim(cacheKey, row, tier);
      }

      if (tier === "quick") {
        deepPending = true;
        scheduleDeepSim([p], gameCtx, isHomeByPlayer);
      }

      return row;
    }),
  );

  return { rows, deepPending: tier === "quick" ? deepPending : false };
}

function scheduleDeepSim(
  props: SimPropRequest[],
  gameCtx: GameSimContext,
  isHomeByPlayer: Record<string, boolean>,
): void {
  void warmDeepSims(props, gameCtx, isHomeByPlayer).catch(() => {
    /* background warm is best-effort */
  });
}

async function warmDeepSims(
  props: SimPropRequest[],
  gameCtx: GameSimContext,
  isHomeByPlayer: Record<string, boolean>,
): Promise<void> {
  const historyCache = new Map<string, Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null>();

  for (const p of props) {
    const sportKey = propSport(p, gameCtx);
    const deepKey = simCacheKey(sportKey, p.player, p.market, p.line, p.side, "deep", p.additionalLines);
    if (deepInFlight.has(deepKey)) continue;
    const existing = await getCachedSim(deepKey);
    if (existing) continue;

    deepInFlight.add(deepKey);
    try {
      const athleteId = p.athleteId ?? "";
      const histKey = `${sportKey}:${athleteId}:${p.opponentTeamId ?? ""}`;
      let history = historyCache.get(histKey);
      if (history === undefined) {
        history = athleteId
          ? await fetchEspnPlayerHistory(sportKey, athleteId, p.opponentTeamId ?? undefined)
          : null;
        historyCache.set(histKey, history);
      }

      const isHome = p.isHome ?? isHomeByPlayer[p.player] ?? null;
      const result = simulateProp(
        { ...p, sport: sportKey, isHome },
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
      if (result.hitProbability != null) {
        await setCachedSim(deepKey, row, "deep");
      }
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
  const coverQueries = parseCoverQueries(req.body?.coverQueries);
  const retainOutcomes = req.body?.retainOutcomes !== false;

  if (!sport) {
    res.status(400).json({ error: "sport required" });
    return;
  }

  const homeTeam = String(req.body?.homeTeam ?? "");
  const awayTeam = String(req.body?.awayTeam ?? "");
  const nameOnlySports =
    sport === "tennis" ||
    sport === "tabletennis" ||
    sport === "cricket" ||
    sport === "ufc" ||
    sport === "mma";

  if (!nameOnlySports && (!homeTeamId || !awayTeamId)) {
    res.status(400).json({ error: "sport, homeTeamId, awayTeamId required" });
    return;
  }

  if (nameOnlySports && (!homeTeam || !awayTeam)) {
    res.status(400).json({ error: "homeTeam and awayTeam required" });
    return;
  }

  if (sport === "tabletennis" || sport === "cricket") {
    res.status(422).json({
      error: `insufficient ${sport} matchup data for simulation — browse posted lines only`,
    });
    return;
  }

  if (sport === "tennis") {
    const result = await runTennisMonteCarlo({
      away: awayTeam,
      home: homeTeam,
      simulations,
      coverQueries,
      retainOutcomes,
    });
    if (!result) {
      res.status(422).json({ error: "insufficient tennis matchup data for simulation" });
      return;
    }
    res.json({
      sport,
      homeTeam: homeTeam || null,
      awayTeam: awayTeam || null,
      ...result,
    });
    return;
  }

  if (sport === "ufc" || sport === "mma") {
    const analysis = await buildFightAnalysis(awayTeam, homeTeam);
    const sim = analysis.simulation;
    res.json({
      sport,
      homeTeam: homeTeam || null,
      awayTeam: awayTeam || null,
      simulations: sim.simulations,
      homeWinProbability: sim.homeWinProbability,
      awayWinProbability: sim.awayWinProbability,
      tieProbability: 0,
      mostLikelyWinner: sim.mostLikelyWinner === "home" ? "home" : "away",
      mostLikelyWinnerPct: sim.mostLikelyWinnerPct,
      confidenceScore: sim.confidenceScore,
      methodRates: sim.methodRates,
      lean: analysis.lean,
    });
    return;
  }

  const baseUrl = apiBaseFromReq(req);
  const [homeHist, awayHist] = await Promise.all([
    fetchTeamHistory(baseUrl, sport, homeTeamId),
    fetchTeamHistory(baseUrl, sport, awayTeamId),
  ]);

  const result = runSportGameMonteCarlo({
    sport,
    simulations,
    weatherImpact,
    coverQueries,
    retainOutcomes,
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

  const homeTeamId = String(req.body?.homeTeamId ?? "").trim();
  const awayTeamId = String(req.body?.awayTeamId ?? "").trim();
  const propsIn = (props as SimPropRequest[]).map((p) => ({
    ...p,
    sport: String(p.sport ?? sport).toLowerCase(),
  }));
  const propsResolved = await resolvePropAthleteIds(sport, propsIn, {
    homeTeamId,
    awayTeamId,
    homeTeam,
    awayTeam,
  });

  const baseUrl = apiBaseFromReq(req);

  let oppPace: number | null = null;
  let leaguePace: number | null = 100;
  if ((sport === "nba" || sport === "wnba") && homeTeam && awayTeam) {
    try {
      const [homeP, awayP] = await Promise.all([
        teamPace(sport, homeTeam),
        teamPace(sport, awayTeam),
      ]);
      if (homeP != null && awayP != null) {
        oppPace = (homeP + awayP) / 2;
        leaguePace = 100;
      }
    } catch {
      // pace optional
    }
  }

  const injuries = await fetchEspnInjuries(sport);
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
    propsResolved,
    tier,
    gameCtx,
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

  const baseUrl = apiBaseFromReq(req);
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
