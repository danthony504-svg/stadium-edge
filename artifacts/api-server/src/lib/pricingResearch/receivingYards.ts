import { americanToProb } from "../oddsAltDevig.js";
import type { Side } from "./fairOdds.js";
import { gammaDraw, seededRandom, standardNormal } from "./random.js";

export type ReceivingYardsProjection = {
  asOf: number;
  prior: {
    version: string; trainedThrough: number; targetsShape: number; targetsRate: number;
    yardsPerTarget: number; betweenPlayerSd: number; withinTargetSd: number;
  };
  games: readonly { eventId: string; finishedAt: number; availableAt: number; exposure: number; targets: number; yards: number }[];
  nextExposure: number;
  line: number;
  side: Side;
  matchup?: { multiplier: number; logSd: number; availableAt: number };
  offeredAmerican?: number;
  halfLifeGames?: number;
  seed?: number;
};

/** Gamma-Poisson opportunity and Normal-Normal efficiency, with compound yards given targets. */
export function receivingYardsPosterior(input: ReceivingYardsProjection) {
  const { games, prior, line, side, asOf, nextExposure, matchup, offeredAmerican, halfLifeGames = 8 } = input;
  if (!Number.isFinite(asOf) || !Number.isFinite(prior.trainedThrough) || prior.trainedThrough >= asOf ||
      !prior.version || ![prior.targetsShape, prior.targetsRate, prior.yardsPerTarget,
        prior.betweenPlayerSd, prior.withinTargetSd, nextExposure, halfLifeGames]
        .every(n => Number.isFinite(n) && n >= 0.001 && n <= 1e6) ||
      !Number.isFinite(line) || !["over", "under"].includes(side) ||
      (offeredAmerican != null && (!Number.isFinite(offeredAmerican) || Math.abs(offeredAmerican) < 100)) ||
      (matchup && (!Number.isFinite(matchup.availableAt) || matchup.availableAt >= asOf ||
        !(matchup.multiplier > 0 && matchup.multiplier <= 3) || !(matchup.logSd >= 0 && matchup.logSd <= 1)))) {
    throw new RangeError("Invalid or late receiving-yard projection inputs");
  }

  const history = games.filter(game => Number.isFinite(game.finishedAt) && Number.isFinite(game.availableAt) &&
    game.finishedAt <= game.availableAt && game.availableAt < asOf).sort((a, b) => b.finishedAt - a.finishedAt);
  const seen = new Set<string>();
  let targets = 0, yards = 0, exposure = 0, weights = 0, squaredWeights = 0;
  for (const [index, game] of history.entries()) {
    if (!game.eventId || seen.has(game.eventId) || !Number.isSafeInteger(game.targets) || game.targets < 0 ||
        !Number.isSafeInteger(game.yards) || (game.targets === 0 && game.yards !== 0) ||
        !Number.isFinite(game.exposure) || game.exposure <= 0) throw new RangeError("Invalid or duplicate game");
    seen.add(game.eventId);
    const weight = 0.5 ** (index / halfLifeGames);
    targets += weight * game.targets;
    yards += weight * game.yards;
    exposure += weight * game.exposure;
    weights += weight;
    squaredWeights += weight ** 2;
  }

  const shape = prior.targetsShape + targets;
  const rate = prior.targetsRate + exposure;
  const priorPrecision = 1 / prior.betweenPlayerSd ** 2;
  const dataPrecision = targets / prior.withinTargetSd ** 2;
  const precision = priorPrecision + dataPrecision;
  const efficiency = (priorPrecision * prior.yardsPerTarget + yards / prior.withinTargetSd ** 2) / precision;
  const efficiencySd = 1 / Math.sqrt(precision);
  const dispersion = (Math.max(0.5, efficiency) / prior.withinTargetSd) ** 2;
  const meanTargets = shape / rate * nextExposure;
  if (meanTargets > 100 || dispersion < 1e-6 || dispersion > 1e6) throw new RangeError("Receiving-yard inputs exceed the model's supported range");

  const random = seededRandom(input.seed ?? 1);
  const breakEven = offeredAmerican == null ? null : americanToProb(offeredAmerican);
  const draws: number[] = [];
  const outer = 400, inner = 250;
  let totalPushes = 0, positiveEv = 0;
  for (let i = 0; i < outer; i++) {
    const expectedTargets = gammaDraw(shape, random) / rate * nextExposure;
    const yardsPerTarget = Math.max(0.5, efficiency + efficiencySd * standardNormal(random));
    const multiplier = matchup ? matchup.multiplier * Math.exp(matchup.logSd * standardNormal(random)) : 1;
    let wins = 0, pushes = 0;
    for (let j = 0; j < inner; j++) {
      // Count Poisson arrivals over the given exposure.
      let count = 0;
      for (let time = -Math.log(random()); time < expectedTargets; time -= Math.log(random())) count++;
      const value = count === 0 ? 0 : Math.round(gammaDraw(count * dispersion, random) * yardsPerTarget * multiplier / dispersion);
      if (value === line) pushes++;
      else if (side === "over" ? value > line : value < line) wins++;
    }
    const hit = wins / inner;
    const push = pushes / inner;
    draws.push(hit);
    totalPushes += push;
    if (breakEven != null && hit > (1 - push) * breakEven) positiveEv++;
  }
  const sorted = [...draws].sort((a, b) => a - b);
  return {
    modelVersion: "receiving-yards-gamma-normal-v1", priorVersion: prior.version,
    probability: draws.reduce((sum, p) => sum + p, 0) / outer, pushProbability: totalPushes / outer,
    ci80: [sorted[Math.floor(outer * 0.1)]!, sorted[Math.ceil(outer * 0.9) - 1]!],
    historyGames: history.length, essGames: squaredWeights ? weights ** 2 / squaredWeights : 0,
    targetsMean: meanTargets, yardsPerTargetMean: efficiency, efficiencyDataWeight: dataPrecision / precision,
    opportunityPriorWeight: prior.targetsRate / rate,
    positiveEvProbability: breakEven == null ? null : positiveEv / outer, draws,
  };
}
