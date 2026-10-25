/** Identity coverage is separate from fingerprint-folded event counts. */
export function coachDigestCoverage(
  rows: readonly {
    eventType: string;
    requestId?: string | null;
    occurrenceCount?: number | null;
  }[],
) {
  const ids = new Set<string>(),
    terminal = new Map<string, Set<string>>();
  let requestStartEvents = 0,
    unidentifiedEvents = 0,
    cancelledEvents = 0,
    incomplete = false;
  const types = new Set([
    "parlay_fulfilled",
    "parlay_underfilled",
    "parlay_zero_results",
    "coach_grounding_failure",
    "coach_alt_market_failure",
    "coach_simulation_failure",
    "coach_scan_freeze",
  ]);
  for (const row of rows) {
    const n = Math.max(1, row.occurrenceCount ?? 1),
      id = row.requestId?.trim();
    if (id) ids.add(id);
    if (!id || n > 1) unidentifiedEvents += id ? n - 1 : n;
    if (
      row.eventType === "parlay_requested" ||
      row.eventType === "coach_question_received"
    )
      requestStartEvents += n;
    if (row.eventType === "coach_cancelled") cancelledEvents += n;
    if (!types.has(row.eventType)) continue;
    if (!id || n > 1) incomplete = true;
    if (!id) continue;
    const outcomes = terminal.get(id) ?? new Set<string>();
    outcomes.add(row.eventType);
    terminal.set(id, outcomes);
  }
  const conflict = [...terminal.values()].some((x) => x.size > 1);
  const full = [...terminal.values()].filter(
    (x) => x.size === 1 && x.has("parlay_fulfilled"),
  ).length;
  return {
    totalRequests: ids.size,
    requestStartEvents,
    unidentifiedEvents,
    cancelledEvents,
    observedParlayTerminals: terminal.size,
    fulfillmentPct:
      terminal.size && !incomplete && !conflict
        ? Math.round((1000 * full) / terminal.size) / 10
        : null,
  };
}
