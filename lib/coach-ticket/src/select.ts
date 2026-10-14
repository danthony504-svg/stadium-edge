import type { CoachRankedLeg } from "@workspace/coach-rank";

export type TicketSelectionResult = {
  picks: CoachRankedLeg[];
  droppedForDiversity: number;
};

/** One leg per game; at most one prop per player. Never relaxes gates. */
export function canAddLegToTicket(selected: CoachRankedLeg[], candidate: CoachRankedLeg): boolean {
  if (selected.some((leg) => leg.legFingerprint === candidate.legFingerprint)) return false;
  if (selected.some((leg) => leg.gameId === candidate.gameId)) return false;
  if (candidate.kind === "player_prop" && candidate.playerId) {
    if (selected.some((leg) => leg.playerId === candidate.playerId)) return false;
  }
  return true;
}

/**
 * Select up to `target` highest-ranked legs with diversity constraints.
 * Returns fewer than target when the pool is exhausted — no filler.
 */
export function selectTicketLegs(
  candidates: CoachRankedLeg[],
  target: number,
): TicketSelectionResult {
  const sorted = [...candidates].sort(
    (a, b) => b.rankScore - a.rankScore || b.edgePct - a.edgePct,
  );
  const picks: CoachRankedLeg[] = [];
  let droppedForDiversity = 0;

  for (const leg of sorted) {
    if (picks.length >= target) break;
    if (canAddLegToTicket(picks, leg)) {
      picks.push(leg);
    } else {
      droppedForDiversity += 1;
    }
  }

  return { picks, droppedForDiversity };
}
