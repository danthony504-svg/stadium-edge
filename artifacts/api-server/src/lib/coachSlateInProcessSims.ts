/**
 * In-process prop/game simulations for the Render Cron Job worker.
 * Reuses the same runners as /sports/simulate/* — does not change sim counts.
 */
import { keyInjuryWeight, type SimPropRequest } from "./monteCarloBuild.js";
import { DEEP_SIMULATIONS } from "./monteCarlo.js";
import { runPropSims, tierSimCount } from "./propSimRunner.js";
import type { SimTier } from "./simCache.js";
import { resolvePropAthleteIds } from "./resolvePropAthleteIds.js";
import { fetchEspnInjuries } from "./espnInjuries.js";
import { teamPace } from "./statmuse.js";
import { runSportGameMonteCarlo } from "./sportSim/registry.js";
import { runTennisMonteCarlo } from "./tennisMonteCarlo.js";
import { buildFightAnalysis } from "./ufc.js";
import { coachSlateApiBase } from "./coachSlateLoopback.js";
import type { GameCoverQuery } from "./gameMonteCarlo.js";
import { parsePeriodScope } from "./gamePeriodMonteCarlo.js";

function teamInjuryWeight(
  teams: Awaited<ReturnType<typeof fetchEspnInjuries>>,
  teamName: string,
): number {
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
  sport: string,
  teamId: string,
): Promise<TeamHistoryResp | null> {
  try {
    const base = coachSlateApiBase();
    const r = await fetch(
      `${base}/sports/team-history?sport=${encodeURIComponent(sport)}&teamId=${encodeURIComponent(teamId)}`,
      { headers: { "x-internal-call": "1" } },
    );
    if (!r.ok) return null;
    return (await r.json()) as TeamHistoryResp;
  } catch {
    return null;
  }
}

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

export type InProcessPropSimRow = {
  player: string;
  market: string;
  line: number;
  side: string;
  hitProbability: number | null;
};

/** Same contract as POST /sports/simulate/props success body (props rows). */
export async function runPropSimsInProcess(body: {
  sport: string;
  tier?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  props: Array<{
    player: string;
    market: string;
    line: number;
    side: string;
    athleteId?: string | null;
  }>;
  simulations?: number;
}): Promise<{ props: InProcessPropSimRow[]; simulations: number } | null> {
  const sport = String(body.sport ?? "").toLowerCase();
  const props = body.props ?? [];
  if (!sport || !props.length) return null;
  const tier: SimTier = body.tier === "deep" ? "deep" : "quick";
  const homeTeam = String(body.homeTeam ?? "");
  const awayTeam = String(body.awayTeam ?? "");
  const homeTeamId = String(body.homeTeamId ?? "").trim();
  const awayTeamId = String(body.awayTeamId ?? "").trim();

  const propsIn = props.map((p) => ({
    ...p,
    sport,
  })) as SimPropRequest[];
  const propsResolved = await resolvePropAthleteIds(sport, propsIn, {
    homeTeamId,
    awayTeamId,
    homeTeam,
    awayTeam,
  });

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
  const gameCtx = {
    sport,
    oppPace,
    leaguePace,
    oppKeyInjuries: awayTeam ? teamInjuryWeight(injuries, awayTeam) : 0,
    ownKeyInjuries: homeTeam ? teamInjuryWeight(injuries, homeTeam) : 0,
    weatherImpact: null as number | null,
  };

  const { rows } = await runPropSims(
    propsResolved,
    tier,
    gameCtx,
    {},
    body.simulations,
  );
  return {
    simulations: tierSimCount(tier, body.simulations),
    props: rows.map((row) => ({
      player: row.player,
      market: row.market,
      line: row.line,
      side: row.side,
      hitProbability: row.hitProbability ?? null,
    })),
  };
}

export type InProcessGameOutcome = {
  homeWinProbability?: number | null;
  awayWinProbability?: number | null;
  coverHitRates?: Record<string, number>;
};

/** Same contract as POST /sports/simulate/game-outcome (subset used by slate). */
export async function runGameOutcomeSimInProcess(body: {
  sport: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeam?: string;
  awayTeam?: string;
  simulations?: number;
  coverQueries?: unknown;
  retainOutcomes?: boolean;
  weatherImpact?: number | null;
}): Promise<InProcessGameOutcome | null> {
  const sport = String(body.sport ?? "").toLowerCase();
  const homeTeamId = String(body.homeTeamId ?? "");
  const awayTeamId = String(body.awayTeamId ?? "");
  const simulations = Number(body.simulations) || DEEP_SIMULATIONS;
  const coverQueries = parseCoverQueries(body.coverQueries);
  const retainOutcomes = body.retainOutcomes !== false;
  const homeTeam = String(body.homeTeam ?? "");
  const awayTeam = String(body.awayTeam ?? "");

  if (!sport) return null;
  if (sport === "tabletennis" || sport === "cricket") return null;

  if (sport === "tennis") {
    if (!homeTeam || !awayTeam) return null;
    const result = await runTennisMonteCarlo({
      away: awayTeam,
      home: homeTeam,
      simulations,
      coverQueries,
      retainOutcomes,
    });
    if (!result) return null;
    return {
      homeWinProbability: result.homeWinProbability ?? null,
      awayWinProbability: result.awayWinProbability ?? null,
      coverHitRates: result.coverHitRates ?? {},
    };
  }

  if (sport === "ufc" || sport === "mma") {
    if (!homeTeam || !awayTeam) return null;
    const analysis = await buildFightAnalysis(awayTeam, homeTeam);
    const { runFightMonteCarlo } = await import("./ufcMonteCarlo.js");
    const sim = runFightMonteCarlo(
      {
        away: analysis.away,
        home: analysis.home,
        lean: analysis.lean,
        comparison: analysis.comparison ?? undefined,
        coverQueries,
        retainOutcomes,
      },
      simulations,
    );
    return {
      homeWinProbability: sim.homeWinProbability ?? null,
      awayWinProbability: sim.awayWinProbability ?? null,
      coverHitRates: sim.coverHitRates ?? {},
    };
  }

  if (!homeTeamId || !awayTeamId) return null;
  const [homeHist, awayHist] = await Promise.all([
    fetchTeamHistory(sport, homeTeamId),
    fetchTeamHistory(sport, awayTeamId),
  ]);
  const result = runSportGameMonteCarlo({
    sport,
    simulations,
    weatherImpact: body.weatherImpact != null ? Number(body.weatherImpact) : null,
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
  if (!result) return null;
  return {
    homeWinProbability: result.homeWinProbability ?? null,
    awayWinProbability: result.awayWinProbability ?? null,
    coverHitRates: result.coverHitRates ?? {},
  };
}
