import type { GameSimulationResult, OddsGame } from "./api.ts";
import { impliedProb } from "./format.ts";

export function soccerSimulatorMoneyline(game: OddsGame | null, sim: GameSimulationResult) {
  const market = game?.markets.find(({ key }) => key === "h2h");
  if (!game || !market || sim.sport !== "soccer") return [];
  const label = (name: string) => name.trim().toLowerCase();
  const prices = new Map(market.outcomes.map(outcome => [label(outcome.name), outcome.price]));
  const sides = [
    { name: game.homeTeam, probability: sim.homeWinProbability },
    { name: game.awayTeam, probability: sim.awayWinProbability },
    { name: "Draw", probability: sim.tieProbability },
  ];
  // A draw price is the evidence that the posted market settles on three outcomes.
  if (!prices.has("draw") || sides.some(({ probability }) =>
    !Number.isFinite(probability) || probability < 0 || probability > 1) ||
    Math.abs(sides.reduce((sum, { probability }) => sum + probability, 0) - 1) > 0.002) return [];
  return sides.flatMap(({ name, probability }) => {
    const odds = prices.get(label(name));
    if (odds == null || !Number.isFinite(odds) || Math.abs(odds) < 100) return [];
    const breakEven = impliedProb(odds);
    return [{ name, odds, probability, breakEven, grade: probability > breakEven ? "Lean" : "Pass" }];
  });
}
