/**
 * Live Coach same-event correlation guards.
 * Pregame parlayCorrelationScore / maxLegsPerGame are NOT imported here —
 * live tickets stay isolated, but must not stack overlapping same-game sides.
 */

export type LiveCorrelationPick = {
  eventId: string;
  market: string;
  pick: string;
};

type LiveMarketFamily = "ml" | "spread" | "total" | "other";

function liveMarketFamily(market: string | null | undefined): LiveMarketFamily {
  const m = String(market ?? "")
    .trim()
    .toLowerCase();
  if (m === "moneyline") return "ml";
  if (m === "spread" || m === "puck line" || m === "puckline") return "spread";
  if (m === "total") return "total";
  return "other";
}

/** Team token from "Buccaneers ML" / "Buccaneers +8.5" — null for totals. */
export function liveSideTeamKey(
  pick: string | null | undefined,
  market: string | null | undefined,
): string | null {
  const family = liveMarketFamily(market);
  if (family === "total" || family === "other") return null;
  const p = String(pick ?? "").trim();
  if (!p) return null;
  const ml = p.match(/^(.*?)\s+ML$/i);
  if (ml?.[1]) return ml[1].trim().toLowerCase();
  const spread = p.match(/^(.*?)\s+[+-]?\d/);
  if (spread?.[1]) return spread[1].trim().toLowerCase();
  return null;
}

/**
 * True when seating `candidate` beside `existing` would stack an overlapping
 * same-event outcome (both MLs, both spreads, both totals, or same-team ML+spread).
 * Distinct events never conflict. Total + one side bet is allowed.
 */
export function livePicksConflictSameEvent(
  existing: LiveCorrelationPick,
  candidate: LiveCorrelationPick,
): boolean {
  const a = String(existing.eventId ?? "").trim();
  const b = String(candidate.eventId ?? "").trim();
  if (!a || !b || a !== b) return false;

  const ef = liveMarketFamily(existing.market);
  const cf = liveMarketFamily(candidate.market);
  if (ef === "other" || cf === "other") return false;

  // Both sides of the same market family (ML/ML, spread/spread, over/under).
  if (ef === cf) return true;

  // Same-team moneyline + spread = overlapping team outcome.
  if (
    (ef === "ml" && cf === "spread") ||
    (ef === "spread" && cf === "ml")
  ) {
    const et = liveSideTeamKey(existing.pick, existing.market);
    const ct = liveSideTeamKey(candidate.pick, candidate.market);
    if (et && ct && et === ct) return true;
  }

  return false;
}

/** True if candidate conflicts with any already-seated live pick. */
export function liveCandidateConflictsTicket(
  ticket: readonly LiveCorrelationPick[],
  candidate: LiveCorrelationPick,
): boolean {
  return ticket.some((row) => livePicksConflictSameEvent(row, candidate));
}
