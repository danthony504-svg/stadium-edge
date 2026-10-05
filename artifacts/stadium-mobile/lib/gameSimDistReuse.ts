/**
 * Phase 2.4 Option C — memoize FG distributionForQuery series stats.
 *
 * Canonical key (material):
 *   outcomes object identity (WeakMap) + shareable FG series dims
 *     OR projection-only sim object identity when outcomes are absent
 *
 * Series dims (material to the value array):
 *   - kind ∈ {ml, spread, total, teamTotal}
 *   - teamSide for ml / spread / teamTotal
 *   - period must be full-game (`fg` / unset); halves/quarters/periods/race-to
 *     bypass reuse and keep their existing simulation paths
 *
 * Excluded (non-material to the reusable series):
 *   - line / alternate thresholds
 *   - totalSide (over/under)
 *   - sportsbook / American odds / price
 *   - cover-query id strings
 *
 * Shareable FG series:
 *   - ml|home / ml|away
 *   - spread|home / spread|away   (all alt lines share margin series)
 *   - total                       (all lines + over/under share h+a series)
 *   - teamTotal|home / teamTotal|away
 */

/** Minimal query shape — avoids circular import with gameSimScoring. */
export type FgDistQuery = {
  kind: "ml" | "spread" | "total" | "teamTotal" | "raceTo" | string;
  teamSide?: "home" | "away" | string;
  period?: string;
};

export type FgDistSim = {
  outcomes?: { homeScores: number[]; awayScores: number[] };
  homeProjectedScore?: number | null;
  awayProjectedScore?: number | null;
  simulations?: number;
};

export type GameSimDistStats = {
  mean: number | null;
  median: number | null;
  stdev: number | null;
};

/**
 * Series dimensions that affect the value array (not thresholds/prices).
 * Returns null when the query must not share the FG base distribution
 * (period markets, race-to, unknown kinds).
 */
export function fgDistSeriesKey(
  query: Pick<FgDistQuery, "kind" | "teamSide" | "period">,
): string | null {
  const period = query.period ?? "fg";
  if (period !== "fg") return null;
  if (query.kind === "total") return "total";
  if (query.kind === "ml" || query.kind === "spread" || query.kind === "teamTotal") {
    return `${query.kind}|${query.teamSide ?? ""}`;
  }
  // raceTo and unknown — do not memoize a false "series"
  return null;
}

/**
 * Human-readable canonical distribution identity for docs/tests.
 *
 * Exact form:
 *   `fgDist|<materialTag>|<seriesKey>`
 *
 * where `<materialTag>` is an opaque stand-in for outcomes (or projection-sim)
 * object identity — material context change ⇒ new object ⇒ new WeakMap entry.
 * `<seriesKey>` is from {@link fgDistSeriesKey} (e.g. `spread|home`, `total`).
 */
export function describeFgDistReuseKey(
  materialTag: string,
  seriesKey: string,
): string {
  return `fgDist|${materialTag}|${seriesKey}`;
}

type SeriesCache = Map<string, GameSimDistStats>;

/** Per-outcomes-object series cache — GC'd with the outcomes arrays. */
const outcomesSeriesCache = new WeakMap<object, SeriesCache>();

/** Projection-only fallback (no outcomes) keyed by sim entry. */
const projectionSeriesCache = new WeakMap<object, SeriesCache>();

export type DistReuseStats = {
  hits: number;
  misses: number;
  bypass: number;
  /** Wall ms spent inside fresh `compute()` calls (misses only). */
  computeMs: number;
};

const stats: DistReuseStats = { hits: 0, misses: 0, bypass: 0, computeMs: 0 };

export function getGameSimDistReuseStats(): DistReuseStats {
  return { ...stats };
}

export function resetGameSimDistReuseStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.bypass = 0;
  stats.computeMs = 0;
}

/** Test helper — clear WeakMap entries by dropping refs; stats reset only. */
export function clearGameSimDistReuseForTests(): void {
  resetGameSimDistReuseStats();
}

export function getCachedFgDistSeries(
  sim: FgDistSim,
  seriesKey: string,
): GameSimDistStats | undefined {
  const outcomes = sim.outcomes;
  if (outcomes?.homeScores?.length && outcomes.homeScores.length === outcomes.awayScores.length) {
    return outcomesSeriesCache.get(outcomes)?.get(seriesKey);
  }
  return projectionSeriesCache.get(sim)?.get(seriesKey);
}

export function setCachedFgDistSeries(
  sim: FgDistSim,
  seriesKey: string,
  value: GameSimDistStats,
): void {
  const outcomes = sim.outcomes;
  if (outcomes?.homeScores?.length && outcomes.homeScores.length === outcomes.awayScores.length) {
    let map = outcomesSeriesCache.get(outcomes);
    if (!map) {
      map = new Map();
      outcomesSeriesCache.set(outcomes, map);
    }
    map.set(seriesKey, value);
    return;
  }
  let map = projectionSeriesCache.get(sim);
  if (!map) {
    map = new Map();
    projectionSeriesCache.set(sim, map);
  }
  map.set(seriesKey, value);
}

/**
 * Run `compute` once per (outcomes|sim, seriesKey). Identical math to a fresh
 * compute — scheduling/cache only.
 */
export function withFgDistSeriesReuse(
  query: FgDistQuery,
  sim: FgDistSim,
  compute: () => GameSimDistStats,
): GameSimDistStats {
  const seriesKey = fgDistSeriesKey(query);
  if (!seriesKey) {
    stats.bypass += 1;
    return compute();
  }
  const hit = getCachedFgDistSeries(sim, seriesKey);
  if (hit) {
    stats.hits += 1;
    return hit;
  }
  const t0 = performance.now();
  const value = compute();
  stats.computeMs += performance.now() - t0;
  setCachedFgDistSeries(sim, seriesKey, value);
  stats.misses += 1;
  return value;
}
