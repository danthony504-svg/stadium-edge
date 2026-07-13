// Per-request Coach ticket lifecycle — isolate leg count, cache keys, and traces.

import type { ParsedPick } from "../components/PickCard.tsx";
import { parlayLegKey, type CoachParlayVarietyContext } from "./parlayVarietyMemory.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";
import { boardScanMatchesLegTarget } from "./coachScanPolicy.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";

export type CoachTicketRequestContext = {
  requestId: string;
  previousRequestId: string;
  sendGeneration: number;
  requestedLegs: number;
  sport: string | null;
  varietySeed: string;
  cacheKey: string;
};

let lastRequestId = "";
let lastDeliveredTicketKeys: string[] = [];
let lastDeliveredLegCount = 0;

/** Build a cache key that never collides across leg counts or variety seeds. */
export function buildCoachTicketCacheKey(opts: {
  requestedLegs: number;
  sport?: string | null;
  ticketType?: string;
  riskType?: string;
  varietySeed: string;
  excludedSports?: readonly string[];
}): string {
  const sports = (opts.excludedSports ?? []).slice().sort().join(",") || "all";
  return [
    `legs:${opts.requestedLegs}`,
    `sport:${opts.sport ?? "all"}`,
    `type:${opts.ticketType ?? "parlay"}`,
    `risk:${opts.riskType ?? "default"}`,
    `excl:${sports}`,
    `seed:${opts.varietySeed}`,
  ].join("|");
}

export function startCoachTicketRequest(opts: {
  requestId: string;
  sendGeneration: number;
  requestedLegs: number;
  sport?: string | null;
  varietySeed: string;
  ticketType?: string;
  riskType?: string;
  excludedSports?: readonly string[];
}): CoachTicketRequestContext {
  const previousRequestId = lastRequestId;
  const cacheKey = buildCoachTicketCacheKey(opts);
  lastRequestId = opts.requestId;
  traceCoachTicket("board-scan-staged", {
    requestedLegs: opts.requestedLegs,
    source: "request-start",
    extra: {
      requestId: opts.requestId,
      previousRequestId,
      cacheKey,
      cacheHit: false,
      varietySeed: opts.varietySeed,
    },
  });
  return {
    requestId: opts.requestId,
    previousRequestId,
    sendGeneration: opts.sendGeneration,
    requestedLegs: opts.requestedLegs,
    sport: opts.sport ?? null,
    varietySeed: opts.varietySeed,
    cacheKey,
  };
}

export function recordCoachTicketDelivered(
  picks: readonly ParsedPick[],
  ctx: Pick<CoachTicketRequestContext, "requestId" | "requestedLegs">,
): void {
  lastDeliveredTicketKeys = picks.map((p) => parlayLegKey(p));
  lastDeliveredLegCount = picks.length;
  traceCoachTicket("mobile-delivered", {
    requestedLegs: ctx.requestedLegs,
    pickIds: [...picks],
    source: "record-delivered",
    extra: {
      requestId: ctx.requestId,
      legKeys: lastDeliveredTicketKeys,
    },
  });
}

/** True when a new ticket exactly matches the first N legs of a prior larger ticket. */
export function ticketMatchesLargerPrefix(
  candidateKeys: readonly string[],
  largerKeys: readonly string[],
): boolean {
  if (!candidateKeys.length || candidateKeys.length >= largerKeys.length) return false;
  for (let i = 0; i < candidateKeys.length; i++) {
    if (candidateKeys[i] !== largerKeys[i]) return false;
  }
  return true;
}

export function rejectPrefixOfLastDelivered(
  picks: readonly ParsedPick[],
  requestedLegs: number,
): boolean {
  if (
    lastDeliveredLegCount > requestedLegs &&
    lastDeliveredTicketKeys.length > requestedLegs &&
    picks.length === requestedLegs
  ) {
    const candidateKeys = picks.map((p) => parlayLegKey(p));
    if (ticketMatchesLargerPrefix(candidateKeys, lastDeliveredTicketKeys)) {
      return true;
    }
  }
  return false;
}

/** Guards partial/final scan delivery against stale generation or wrong leg count. */
export function boardScanAppliesToRequest(
  scan:
    | {
        requestedLegs?: number;
        picks?: { length: number };
      }
    | null
    | undefined,
  legTarget: number,
  sendGeneration: number,
  activeSendGeneration: number,
): boolean {
  if (!scan?.picks?.length || legTarget <= 0) return false;
  if (sendGeneration !== activeSendGeneration) return false;
  return boardScanMatchesLegTarget(scan, legTarget);
}

export function pickIdsForTrace(picks: readonly ParsedPick[]): string[] {
  return picks.map((p) => pickLegFingerprint(p));
}

/** Merge variety context with the last delivered ticket for prefix rejection. */
export function varietyContextWithLastDelivered(
  base: CoachParlayVarietyContext,
): CoachParlayVarietyContext {
  if (lastDeliveredLegCount <= 0 || !lastDeliveredTicketKeys.length) return base;
  const bySize = new Map(base.recentTicketsByLegCount);
  const prior = bySize.get(lastDeliveredLegCount) ?? [];
  bySize.set(lastDeliveredLegCount, [lastDeliveredTicketKeys, ...prior]);
  return {
    ...base,
    recentTickets: [lastDeliveredTicketKeys, ...base.recentTickets],
    recentTicketsByLegCount: bySize,
  };
}
