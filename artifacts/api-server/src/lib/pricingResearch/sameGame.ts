import { americanToProb } from "../oddsAltDevig.js";
import { fairAmerican, marketKey, type MarketIdentity, type Side } from "./fairOdds.js";
import { seededRandom } from "./random.js";

const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
type Leg = {
  market: MarketIdentity;
  side: Side;
  probability: number;
  pushFree: boolean;
};

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI) * t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + 1.330274429 * t))));
  return x >= 0 ? 1 - tail : tail;
}

function normalQuantile(p: number): number {
  let low = -9, high = 9;
  for (let i = 0; i < 26; i++) {
    const mid = (low + high) / 2;
    if (normalCdf(mid) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function halton(draw: number, base: number): number {
  let p = 0, digitWeight = 1 / base;
  for (let index = draw; index > 0; index = Math.floor(index / base)) {
    p += digitWeight * (index % base);
    digitWeight /= base;
  }
  return p;
}

function cholesky(matrix: readonly (readonly number[])[]): number[][] {
  const lower: number[][] = [];
  for (const [i, row] of matrix.entries()) {
    const factors: number[] = [];
    for (let j = 0; j <= i; j++) {
      const sum = factors.reduce((total, factor, k) => total + factor * (i === j ? factor : lower[j]![k]!), 0);
      const remainder = row[j]! - sum;
      if (j === i && !(remainder > 1e-10)) throw new RangeError("Correlation matrix must be positive definite");
      factors.push(j === i ? Math.sqrt(remainder) : remainder / lower[j]![j]!);
    }
    lower.push(factors);
  }
  return lower;
}

export function shrinkCorrelation(estimate: number, prior: number, pairs: number, priorPairs = 45): number {
  if (![estimate, prior].every(rho => Number.isFinite(rho) && Math.abs(rho) < 1) ||
      !Number.isSafeInteger(pairs) || pairs < 0 || !(priorPairs > 0 && Number.isFinite(priorPairs))) {
    throw new RangeError("Invalid correlation inputs");
  }
  const weight = pairs / (pairs + priorPairs);
  return Math.tanh(weight * Math.atanh(estimate) + (1 - weight) * Math.atanh(prior));
}

export function sameGameCopula(input: {
  legs: readonly Leg[];
  /** Latent correlations for raw stats, prior to flipping the Under sides. */
  correlations: readonly (readonly number[])[];
  correlationVersion: string;
  trainedThrough: number;
  asOf: number;
  offeredAmerican?: number;
  draws?: number;
  seed?: number;
}) {
  const { legs, correlations, offeredAmerican, draws = 4096 } = input;
  const n = legs.length;
  if (n < 2 || n > primes.length || correlations.length !== n || !input.correlationVersion ||
      !Number.isFinite(input.trainedThrough) || !Number.isFinite(input.asOf) || input.trainedThrough >= input.asOf ||
      (offeredAmerican != null && (!Number.isFinite(offeredAmerican) || Math.abs(offeredAmerican) < 100)) ||
      !Number.isInteger(draws) || draws < 256 || draws > 32768 ||
      legs.some(leg => leg.pushFree !== true || !(leg.probability > 0 && leg.probability < 1) ||
        !["over", "under"].includes(leg.side) || leg.market.eventId !== legs[0]!.market.eventId ||
        leg.market.sport !== legs[0]!.market.sport)) throw new RangeError("Invalid or unsupported same-game ticket");
  const distributions = new Set(legs.map(leg => marketKey({ ...leg.market, line: 0 })));
  if (distributions.size !== n) throw new RangeError("Repeated-stat legs require explicit joint settlement rules");

  const matrix = correlations.map((row, i) => {
    if (row.length !== n) throw new RangeError("Invalid correlation matrix dimensions");
    return row.map((rho, j) => {
      if (!Number.isFinite(rho) || (i === j ? rho !== 1 : Math.abs(rho) >= 1) ||
          Math.abs(rho - (correlations[j]?.[i] ?? NaN)) > 1e-10) throw new RangeError("Invalid correlation matrix");
      return legs[i]!.side === legs[j]!.side ? rho : -rho;
    });
  });
  const lower = cholesky(matrix);
  const independent = legs.reduce((p, leg) => p * leg.probability, 1);
  const bounds = [
    Math.max(0, legs.reduce((sum, leg) => sum + leg.probability, 0) - (n - 1)),
    Math.min(...legs.map(leg => leg.probability)),
  ] as const;

  const breakEven = offeredAmerican == null ? null : americanToProb(offeredAmerican);
  const result = (joint: number, engine: "independent" | "gaussian_copula", sampleCount: number) => ({
    joint, independent, bounds, fairAmerican: fairAmerican(joint), engine,
    correlationVersion: input.correlationVersion, draws: sampleCount,
    correlationLift: independent > 0 ? joint / independent : null,
    breakEven,
    probabilityEdge: breakEven == null ? null : joint - breakEven,
    expectedReturnPerUnit: breakEven == null ? null : joint / breakEven - 1,
  });

  if (matrix.every((row, i) => row.every((rho, j) => i === j || rho === 0))) {
    return result(independent, "independent", 0);
  }

  // Integrate the conditional Gaussian probabilities over a shifted Halton sequence.
  // Integrating the last dimension analytically avoids a rare-event hit counter.
  const random = seededRandom(input.seed ?? 20261126);
  const shifts = legs.map(() => random());
  const thresholds = legs.map(leg => normalQuantile(leg.probability));
  let total = 0;
  for (let draw = 1; draw <= draws; draw++) {
    const latent: number[] = [];
    let weight = 1;
    for (let i = 0; i < n; i++) {
      const conditionalMean = latent.reduce((sum, z, j) => sum + z * lower[i]![j]!, 0);
      const conditionalHit = normalCdf((thresholds[i]! - conditionalMean) / lower[i]![i]!);
      weight *= conditionalHit;
      if (weight === 0 || i === n - 1) break;
      const unit = (halton(draw, primes[i]!) + shifts[i]!) % 1;
      latent.push(normalQuantile(Math.max(1e-12, Math.min(1 - 1e-12, unit * conditionalHit))));
    }
    total += weight;
  }
  const rawJoint = total / draws;
  const joint = Math.max(bounds[0], Math.min(bounds[1], rawJoint));
  return result(joint, "gaussian_copula", draws);
}
