// Pure fight-sim → game-sim mapper (no Expo / RN imports) for unit tests + OTA.

import type { FightSimResult, GameSimulationResult } from "./api";

export function fightSimToGameResult(sport: string, sim: FightSimResult): GameSimulationResult {
  return {
    sport,
    simulations: sim.simulations,
    homeWinProbability: sim.homeWinProbability,
    awayWinProbability: sim.awayWinProbability,
    tieProbability: 0,
    // Projected "score" = mean total rounds for O/U rounds display/grading.
    homeProjectedScore: sim.meanTotalRounds ?? null,
    awayProjectedScore: 0,
    mostLikelyWinner: sim.mostLikelyWinner === "home" ? "home" : "away",
    mostLikelyWinnerPct: sim.mostLikelyWinnerPct,
    confidenceScore: sim.confidenceScore,
    methodRates: sim.methodRates,
    coverHitRates: sim.coverHitRates,
    outcomes: sim.outcomes,
  };
}
