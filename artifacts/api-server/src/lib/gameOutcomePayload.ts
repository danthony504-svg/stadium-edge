/**
 * Published preview client (OTA commit bdddb08e) behavior this payload has to
 * survive:
 *
 * 1. fetchSlateGameSimulationsWithStatus rescales period cover rates from
 *    outcomes.homeScores when that array is present and the request includes a
 *    non-full-game cover query. Omitting outcomes stops that overwrite.
 * 2. gameSimHitForPick then reads coverHitRates[query.id]. A finite rate is
 *    passed to sanitizeSimHitForGrade and the function returns that result.
 *    sanitizeSimHitForGrade rejects rates <= 0 or >= 1 and returns null.
 *    That return does not fall through.
 * 3. Only a missing rate falls through to homeWinProbability / awayWinProbability
 *    for every moneyline, including a period moneyline. Omitting outcomes does
 *    not stop that fallback. A real period cover rate would be graded, because
 *    that client has no period-decomposition block.
 *
 * Server protection for a response this process builds: drop outcomes, and
 * replace each non-full-game cover rate with 0 so the published grader returns
 * null instead of the full-game win probability. Full-game rates and win
 * probabilities stay, so a mixed request can still grade full-game sides.
 *
 * The 0 value is a temporary compatibility sentinel for the published client
 * (`bdddb08e`), which does not read `coverQueryStatus`. New clients must treat
 * `coverQueryStatus[id] === "unsupported_market"` as the block and must not
 * interpret 0 as a probability.
 *
 * A draw the published client already cached is unprotected until its 20-minute
 * memory TTL or the next slate sync. This process cannot delete that cache.
 */

import { isPeriodMarket } from "./preSimShift/periodGuard.js";

export const PUBLISHED_CLIENT_UNGRADEABLE_COVER = 0;

/** Explicit block for clients that understand this field. Not a probability. */
export const UNSUPPORTED_MARKET_STATUS = "unsupported_market";

export function requestAsksNonFullGamePeriod(
  queries: Array<{ period?: string | null }> | null | undefined,
): boolean {
  return (queries ?? []).some((query) => {
    const period = String(query?.period ?? "").toLowerCase();
    return period !== "" && period !== "fg";
  });
}

type PeriodQuery = { id?: string | null; period?: string | null; kind?: string | null; teamSide?: string | null };

export function omitScoreOutcomesForPeriodQueries<T extends { outcomes?: unknown }>(
  body: T,
  queries: Array<{ period?: string | null }> | null | undefined,
): T {
  return sealPublishedClientPeriodQueries(body, queries);
}

export function sealPublishedClientPeriodQueries<
  T extends {
    outcomes?: unknown;
    coverHitRates?: Record<string, number> | null;
    coverQueryStatus?: Record<string, string> | null;
  },
>(body: T, queries: PeriodQuery[] | null | undefined): T {
  if (!body || typeof body !== "object") return body;
  if (!requestAsksNonFullGamePeriod(queries)) return body;
  const next = { ...body };
  delete next.outcomes;
  const rates: Record<string, number> = { ...(next.coverHitRates ?? {}) };
  const status: Record<string, string> = { ...(next.coverQueryStatus ?? {}) };
  for (const query of queries ?? []) {
    const period = String(query?.period ?? "").toLowerCase();
    if (period === "" || period === "fg") continue;
    const id = String(query?.id ?? "").trim();
    if (!id) continue;
    rates[id] = PUBLISHED_CLIENT_UNGRADEABLE_COVER;
    status[id] = UNSUPPORTED_MARKET_STATUS;
  }
  next.coverHitRates = rates;
  next.coverQueryStatus = status;
  return next;
}

type CachedSim = {
  outcomes?: unknown;
  coverHitRates?: Record<string, number | null> | null;
  coverProbs?: Record<string, number | null> | null;
  coverQueryStatus?: Record<string, string> | null;
};

type CachedLine = { game?: string | null; market?: string | null; pick?: string | null };

/** Same id the published client looks up: game|market|pick, lowercased. */
export function publishedClientCoverQueryId(game: string, market: string, pick: string): string {
  return `${game}|${market}|${pick}`.toLowerCase();
}

/**
 * Seal a stored sim, including one read back from a cached snapshot.
 * Query-time sealing is authoritative. This pass also covers rows that were
 * stored before the seal: period-looking rate keys, and period lines whose
 * client lookup id was never written.
 */
export function sealCachedGameSim<T extends CachedSim>(
  sim: T,
  lines?: readonly CachedLine[] | null,
): T {
  if (!sim || typeof sim !== "object") return sim;
  const source = sim.coverHitRates ?? sim.coverProbs ?? {};
  const rates: Record<string, number | null> = { ...source };
  const status: Record<string, string> = { ...(sim.coverQueryStatus ?? {}) };
  let sealed = false;
  const zero = (id: string) => {
    if (!id) return;
    sealed = true;
    rates[id] = PUBLISHED_CLIENT_UNGRADEABLE_COVER;
    status[id] = UNSUPPORTED_MARKET_STATUS;
  };
  for (const id of Object.keys(rates)) {
    if (isPeriodMarket(id)) zero(id);
  }
  for (const line of lines ?? []) {
    const market = String(line?.market ?? "");
    const pick = String(line?.pick ?? "");
    const game = String(line?.game ?? "");
    if (!game || !pick || !isPeriodMarket(market)) continue;
    zero(publishedClientCoverQueryId(game, market, pick));
  }
  if (!sealed) return sim;
  const next = { ...sim };
  delete next.outcomes;
  next.coverHitRates = rates;
  next.coverProbs = { ...rates };
  next.coverQueryStatus = status;
  return next;
}

export function sealCachedBoardScan<
  T extends {
    gameSimulations?: Record<string, CachedSim> | null;
    evalLinesByGame?: Record<string, CachedLine[]> | null;
  },
>(scan: T): T {
  if (!scan?.gameSimulations) return scan;
  const sims: Record<string, CachedSim> = {};
  for (const [game, sim] of Object.entries(scan.gameSimulations)) {
    const lines = (scan.evalLinesByGame?.[game] ?? []).map((line) => ({
      ...line,
      game: line.game || game,
    }));
    sims[game] = sealCachedGameSim(sim, lines);
  }
  return { ...scan, gameSimulations: sims };
}

/**
 * Condition copied from the published client's fetchSlateGameSimulationsWithStatus.
 * True when that client would replace server period cover rates.
 */
export function publishedClientWouldRescalePeriodCovers(entry: {
  outcomes?: { homeScores?: unknown[] | null } | null;
}): boolean {
  return Boolean(entry.outcomes?.homeScores?.length);
}

export type PublishedClientGradeQuery = {
  id: string;
  kind: "ml" | "spread" | "total" | "teamTotal" | "raceTo";
  period?: string | null;
  teamSide?: "home" | "away" | null;
};

/**
 * Control flow copied from bdddb08e gameSimHitForPick + the first lines of
 * sanitizeSimHitForGrade. A finite cover rate returns immediately, including
 * when sanitize rejects it. The win-probability fallback runs only when no
 * finite cover rate is stored.
 */
export function publishedClientHitForPick(
  entry: {
    simulations?: number | null;
    homeWinProbability?: number | null;
    awayWinProbability?: number | null;
    coverHitRates?: Record<string, number> | null;
    outcomes?: { homeScores?: unknown[] | null } | null;
  },
  query: PublishedClientGradeQuery,
): number | null {
  const n = entry.simulations ?? 0;
  if (
    !(
      n > 0 &&
      Number.isFinite(entry.homeWinProbability) &&
      Number.isFinite(entry.awayWinProbability)
    )
  ) {
    return null;
  }
  const fromCover = entry.coverHitRates?.[query.id];
  if (fromCover != null && Number.isFinite(fromCover)) {
    if (fromCover <= 0 || fromCover >= 1) return null;
    return fromCover;
  }
  if (entry.outcomes?.homeScores?.length) {
    return 0.5;
  }
  if (query.kind === "ml" && query.teamSide) {
    const mlHit =
      query.teamSide === "home" ? entry.homeWinProbability : entry.awayWinProbability;
    if (mlHit == null || !Number.isFinite(mlHit) || mlHit <= 0 || mlHit >= 1) return null;
    return mlHit;
  }
  return null;
}
