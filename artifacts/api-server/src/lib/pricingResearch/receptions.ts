import { americanToProb } from "../oddsAltDevig.js";
import { gammaDraw, seededRandom } from "./random.js";
import type { Side } from "./fairOdds.js";

export type ReceptionPrior = {
  version: string;
  trainedThrough: number;
  targetsShape: number;
  targetsRate: number;
  catchAlpha: number;
  catchBeta: number;
};

type Game = {
  eventId: string;
  finishedAt: number;
  availableAt: number;
  targets: number;
  catches: number;
  exposure: number;
};

function poissonOutcomes(mean: number, line: number, side: Side) {
  if (mean > 700) return { win: side === "over" ? 1 : 0, loss: side === "over" ? 0 : 1, push: 0 };
  let mass = Math.exp(-mean), atOrBelow = mass;
  for (let k = 1; k <= Math.floor(line); k++) {
    mass *= mean / k;
    atOrBelow += mass;
  }
  const push = Number.isInteger(line) ? mass : 0;
  const over = Math.max(0, 1 - atOrBelow);
  const under = Math.max(0, atOrBelow - push);
  return side === "over" ? { win: over, loss: under, push } : { win: under, loss: over, push };
}

/** Research model for receptions. Exposure units must match the fitted prior and forecast. */
export function receptionPosterior(input: {
  asOf: number;
  prior: ReceptionPrior;
  games: readonly Game[];
  nextExposure: number;
  line: number;
  side: Side;
  offeredAmerican?: number;
  halfLifeGames?: number;
  draws?: number;
  seed?: number;
}) {
  const { prior, asOf, line, side, nextExposure, halfLifeGames = 8, draws = 400 } = input;
  if (!Number.isFinite(asOf) || !Number.isFinite(prior.trainedThrough) || prior.trainedThrough >= asOf || !prior.version ||
      ![prior.targetsShape, prior.targetsRate, prior.catchAlpha, prior.catchBeta, nextExposure, halfLifeGames]
        .every(n => Number.isFinite(n) && n >= 0.001 && n <= 1e6) ||
      !Number.isFinite(line) || line < 0 || line > 100 || !["over", "under"].includes(side) ||
      !Number.isInteger(draws) || draws < 100 || draws > 20_000 ||
      (input.offeredAmerican != null && (!Number.isFinite(input.offeredAmerican) || Math.abs(input.offeredAmerican) < 100))) {
    throw new RangeError("Invalid as-of reception projection inputs");
  }
  const games = input.games.filter(g =>
    Number.isFinite(g.finishedAt) && Number.isFinite(g.availableAt) &&
    g.finishedAt <= g.availableAt && g.availableAt < asOf,
  ).sort((a, b) => b.finishedAt - a.finishedAt);
  const seen = new Set<string>();
  let targets = 0, catches = 0, exposure = 0, totalWeight = 0, squaredWeight = 0;
  for (const [i, game] of games.entries()) {
    if (!game.eventId || seen.has(game.eventId) || !Number.isInteger(game.targets) ||
        !Number.isInteger(game.catches) || game.catches < 0 || game.targets < game.catches ||
        !Number.isFinite(game.exposure) || game.exposure <= 0) throw new RangeError("Invalid or duplicate game");
    seen.add(game.eventId);
    const weight = 0.5 ** (i / halfLifeGames);
    targets += weight * game.targets;
    catches += weight * game.catches;
    exposure += weight * game.exposure;
    totalWeight += weight;
    squaredWeight += weight ** 2;
  }

  const shape = prior.targetsShape + targets;
  const rate = prior.targetsRate + exposure;
  const alpha = prior.catchAlpha + catches;
  const beta = prior.catchBeta + targets - catches;
  const random = seededRandom(input.seed ?? 20261126);
  const probabilities = [];
  const breakEven = input.offeredAmerican == null ? null : americanToProb(input.offeredAmerican);
  let pushes = 0, positiveEv = 0, wins = 0;
  for (let i = 0; i < draws; i++) {
    const opportunityRate = gammaDraw(shape, random) / rate;
    const caught = gammaDraw(alpha, random), missed = gammaDraw(beta, random);
    const catchRate = caught + missed === 0 ? alpha / (alpha + beta) : caught / (caught + missed);
    // Binomial thinning of Poisson targets gives Poisson receptions given the drawn rates.
    const result = poissonOutcomes(opportunityRate * nextExposure * catchRate, line, side);
    probabilities.push(result.win);
    pushes += result.push;
    wins += result.win;
    if (breakEven != null && result.win > (1 - result.push) * breakEven) positiveEv++;
  }
  const ordered = [...probabilities].sort((a, b) => a - b);
  const essGames = squaredWeight > 0 ? totalWeight ** 2 / squaredWeight : 0;
  return {
    modelVersion: "receptions-gamma-beta-v1",
    priorVersion: prior.version,
    probability: wins / draws,
    pushProbability: pushes / draws,
    ci80: [ordered[Math.floor(draws * 0.1)]!, ordered[Math.ceil(draws * 0.9) - 1]!],
    positiveEvProbability: breakEven == null ? null : positiveEv / draws,
    historyGames: games.length,
    essGames,
    opportunityPriorWeight: prior.targetsRate / rate,
    catchPriorWeight: (prior.catchAlpha + prior.catchBeta) / (alpha + beta),
    targetsMean: (shape / rate) * nextExposure,
    catchRateMean: alpha / (alpha + beta),
    draws: probabilities,
  };
}
