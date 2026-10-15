/**
 * The published client (OTA commit bdddb08e) rescales period cover rates
 * from `outcomes.homeScores` using ESPN period averages. Omitting those
 * score arrays when the request asks for a non-full-game period stops that
 * overwrite on a corrected response. Full-game requests keep the arrays.
 */

export function requestAsksNonFullGamePeriod(
  queries: Array<{ period?: string | null }> | null | undefined,
): boolean {
  return (queries ?? []).some((query) => {
    const period = String(query?.period ?? "").toLowerCase();
    return period !== "" && period !== "fg";
  });
}

export function omitScoreOutcomesForPeriodQueries<T extends { outcomes?: unknown }>(
  body: T,
  queries: Array<{ period?: string | null }> | null | undefined,
): T {
  if (!body || typeof body !== "object") return body;
  if (!requestAsksNonFullGamePeriod(queries) || !("outcomes" in body)) return body;
  const next = { ...body };
  delete next.outcomes;
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
