type RatingSample = { hits: number; games: number };

const CENTRAL_80_NORMAL = 1.2815515655446004;

/** Estimate the spread of underlying hit chances across equally weighted rating draws. */
export function ratingHitRange80(samples: readonly RatingSample[], pooledHit: number): [number, number] {
  // A singleton cannot estimate its own within-rating binomial variance.
  const groups = samples.filter(({ games }) => games > 1);
  if (groups.length < 2) return [pooledHit, pooledHit];
  const rates = groups.map(({ hits, games }) => hits / games);
  const center = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  const observed = rates.reduce((sum, rate) => sum + (rate - center) ** 2, 0) / (rates.length - 1);
  const samplingNoise = rates.reduce((sum, rate, i) =>
    sum + rate * (1 - rate) / (groups[i]!.games - 1), 0) / rates.length;
  const halfWidth = CENTRAL_80_NORMAL * Math.sqrt(Math.max(0, observed - samplingNoise));
  return [Math.max(0, pooledHit - halfWidth), Math.min(1, pooledHit + halfWidth)];
}
