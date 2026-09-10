import type { CoachParlayLegCount, CoachSnapshot, CoachTicket } from "@workspace/coach-types";

function clampParlaySize(legs: number): CoachParlayLegCount | null {
  const rounded = Math.floor(legs);
  if (!Number.isFinite(rounded)) return null;
  const sizes: CoachParlayLegCount[] = [3, 5, 6, 9, 10, 15];
  if (sizes.includes(rounded as CoachParlayLegCount)) {
    return rounded as CoachParlayLegCount;
  }
  return null;
}

/** Read a precomputed ticket from a snapshot — returns null when size/sport not indexed. */
export function getTicketFromSnapshot(
  snapshot: CoachSnapshot,
  legs: number,
  sport?: string | null,
): CoachTicket | null {
  const size = clampParlaySize(legs);
  if (!size) return null;

  if (sport) {
    const sportKey = sport.toLowerCase();
    return snapshot.tickets.bySport[sportKey]?.[size] ?? null;
  }

  return snapshot.tickets.global[size] ?? null;
}
