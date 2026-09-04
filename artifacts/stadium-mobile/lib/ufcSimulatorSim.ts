// UFC Game Simulator outcome — API first, then on-device fight analysis + 10k MC
// when production /sports/simulate/game-outcome is stale (requires team IDs).

import type { FightSimResult, GameSimulationResult } from "./api";
import { getFightAnalysis } from "./api";
import { fetchSimulatorGameOutcome } from "./simulatorApi";

export function fightSimToGameResult(sport: string, sim: FightSimResult): GameSimulationResult {
  return {
    sport,
    simulations: sim.simulations,
    homeWinProbability: sim.homeWinProbability,
    awayWinProbability: sim.awayWinProbability,
    tieProbability: 0,
    mostLikelyWinner: sim.mostLikelyWinner === "home" ? "home" : "away",
    mostLikelyWinnerPct: sim.mostLikelyWinnerPct,
    confidenceScore: sim.confidenceScore,
    methodRates: sim.methodRates,
  };
}

type UfcSimOpts = {
  sport: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam?: string;
  awayTeam?: string;
  simulations?: number;
  weatherImpact?: number | null;
  coverQueries?: {
    id: string;
    kind: "ml" | "spread" | "total" | "teamTotal";
    teamSide?: "home" | "away";
    line?: number;
    totalSide?: "over" | "under";
  }[];
  retainOutcomes?: boolean;
};

/** POST game-outcome; on 400/422 run client fight analysis + Monte Carlo. */
export async function fetchUfcSimulatorGameOutcome(
  opts: UfcSimOpts,
  signal?: AbortSignal,
): Promise<GameSimulationResult | null> {
  const api = await fetchSimulatorGameOutcome(opts, signal);
  if (api) return api;

  const away = opts.awayTeam?.trim();
  const home = opts.homeTeam?.trim();
  if (!away || !home) return null;

  const analysis = await getFightAnalysis(away, home, signal);
  const sim = analysis?.simulation;
  if (!sim || (sim.simulations ?? 0) <= 0) return null;
  return fightSimToGameResult(opts.sport || "ufc", sim);
}
