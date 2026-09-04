import type { CoachSnapshot, CoachV2TicketResponse } from "@workspace/coach-types";
import { getTicketFromSnapshot } from "@workspace/coach-cache";
import { buildShortfallReason } from "@workspace/coach-ticket";

export function buildTicketResponseFromSnapshot(
  snapshot: CoachSnapshot,
  legs: number,
  sport?: string | null,
  refreshing = false,
): CoachV2TicketResponse | null {
  const ticket = getTicketFromSnapshot(snapshot, legs, sport);
  if (!ticket) return null;

  const shortfall =
    ticket.deliveredLegs < ticket.requestedLegs
      ? buildShortfallReason(
          snapshot.manifest,
          ticket.requestedLegs,
          ticket.deliveredLegs,
          snapshot.propsQualified,
          snapshot.gameLinesQualified,
        )
      : null;

  return {
    ticket,
    shortfall,
    ready: snapshot.manifest.scanComplete && ticket.deliveredLegs > 0,
    deepSimComplete: snapshot.deepSimComplete,
    manifest: snapshot.manifest,
    refreshing,
  };
}
