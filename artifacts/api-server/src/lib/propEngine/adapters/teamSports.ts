import { simulateProp, type GameSimContext, type PlayerHistoryShape } from "../../monteCarloBuild.js";
import { ODDS_SPORT_KEYS } from "../../sports.js";
import type { AnalyzePropsInput, PropLine, PropSimResult, SportPropAdapter } from "../types.js";
import { attachFairProbs, fetchTeamSportPropLines } from "../vendors/teamSportProps.js";

const TEAM_PROP_SPORTS = ["mlb", "nba", "wnba", "nhl", "nfl", "ncaaf", "ncaab", "soccer"];

async function fetchPlayerHistory(
  sport: string,
  athleteId: string,
  teamId: string,
): Promise<PlayerHistoryShape | null> {
  const base = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";
  try {
    const q = new URLSearchParams({ sport, athleteId, teamId });
    const r = await fetch(`${base}/sports/player-history?${q}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return (await r.json()) as PlayerHistoryShape;
  } catch {
    return null;
  }
}

type TeamContext = {
  histories: Map<string, PlayerHistoryShape | null>;
  game: GameSimContext;
};

async function buildTeamContext(input: AnalyzePropsInput): Promise<TeamContext> {
  return {
    histories: new Map(),
    game: {
      sport: input.sport,
      playerHistories: new Map(),
    },
  };
}

export const teamSportPropAdapter: SportPropAdapter = {
  sports: TEAM_PROP_SPORTS,

  async fetchLines(input: AnalyzePropsInput): Promise<PropLine[]> {
    if (!input.eventId) return [];
    const oddsKey = ODDS_SPORT_KEYS[input.sport] ?? input.sport;
    const lines = await fetchTeamSportPropLines({
      sport: input.sport,
      eventId: input.eventId,
      away: input.away,
      home: input.home,
      oddsSportKey: Array.isArray(oddsKey) ? oddsKey[0] : String(oddsKey),
    });
    return attachFairProbs(lines);
  },

  async buildContext(input: AnalyzePropsInput): Promise<TeamContext> {
    return buildTeamContext(input);
  },

  async simulate(line: PropLine, ctx: unknown, simulations: number): Promise<PropSimResult> {
    const teamCtx = ctx as TeamContext;
    const history = teamCtx.histories.get(line.subject) ?? null;
    const result = simulateProp(
      {
        player: line.subject,
        market: line.market,
        line: line.line ?? 0,
        side: line.side === "Under" ? "Under" : "Over",
        sport: line.sport,
      },
      history,
      teamCtx.game,
      simulations,
    );
    return {
      simulations: result.simulations,
      hitProbability: result.hitProbability,
      meanProjection: result.meanProjection,
      confidenceScore: result.confidenceScore,
      lineHitRates: result.lineHitRates,
    };
  },

  statsComplete(ctx: unknown): boolean {
    const c = ctx as TeamContext;
    return c.histories.size > 0;
  },
};

export { TEAM_PROP_SPORTS };
