// Temporary ticket-path tracing — remove after prefix/slice bug is verified fixed in prod.

import { parlayLegKey } from "./parlayVarietyMemory.ts";
import type { ParsedPick } from "../components/PickCard.tsx";
import { pickLegFingerprint } from "./parlayReachCore.ts";

export const COACH_TICKET_TRACE = true;

export type CoachTicketTraceStage =
  | "combinator-candidates"
  | "combinator-selected"
  | "board-scan-staged"
  | "server-staged"
  | "mobile-received"
  | "mobile-delivered"
  | "slip-capture";

function pickTraceIds(picks: readonly ParsedPick[]): string[] {
  return picks.map((p) => pickLegFingerprint(p));
}

function pickLegKeys(picks: readonly ParsedPick[]): string[] {
  return picks.map((p) => parlayLegKey(p));
}

/** Structured console trace for ticket path debugging. */
export function traceCoachTicket(
  stage: CoachTicketTraceStage,
  detail: {
    requestedLegs?: number;
    candidateId?: string;
    candidateIds?: string[];
    pickIds?: readonly ParsedPick[];
    scanRequestedLegs?: number;
    source?: string;
    extra?: Record<string, unknown>;
  },
): void {
  if (!COACH_TICKET_TRACE) return;
  const ids = detail.pickIds ? pickTraceIds(detail.pickIds) : undefined;
  const legKeys = detail.pickIds ? pickLegKeys(detail.pickIds) : undefined;
  console.log(
    `[coach-ticket-trace] ${stage}`,
    JSON.stringify({
      requestedLegs: detail.requestedLegs,
      scanRequestedLegs: detail.scanRequestedLegs,
      candidateId: detail.candidateId,
      candidateCount: detail.candidateIds?.length,
      candidateIds: detail.candidateIds,
      pickCount: ids?.length,
      pickIds: ids,
      legKeys,
      source: detail.source,
      ...detail.extra,
    }),
  );
}
