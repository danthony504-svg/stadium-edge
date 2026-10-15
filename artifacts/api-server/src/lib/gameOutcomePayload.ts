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
 * A draw the published client already cached is unprotected until its 20-minute
 * memory TTL or the next slate sync. This process cannot delete that cache.
 */

export const PUBLISHED_CLIENT_UNGRADEABLE_COVER = 0;

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
  },
>(body: T, queries: PeriodQuery[] | null | undefined): T {
  if (!body || typeof body !== "object") return body;
  if (!requestAsksNonFullGamePeriod(queries)) return body;
  const next = { ...body };
  delete next.outcomes;
  const rates: Record<string, number> = { ...(next.coverHitRates ?? {}) };
  for (const query of queries ?? []) {
    const period = String(query?.period ?? "").toLowerCase();
    if (period === "" || period === "fg") continue;
    const id = String(query?.id ?? "").trim();
    if (!id) continue;
    rates[id] = PUBLISHED_CLIENT_UNGRADEABLE_COVER;
  }
  next.coverHitRates = rates;
  return next;
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
