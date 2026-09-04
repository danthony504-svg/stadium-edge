import {
  COACH_PARLAY_SIZES,
  type CoachParlayLegCount,
  type CoachScanManifest,
  type CoachSnapshot,
  type CoachSportIdOrCustom,
  type CoachTicketsIndex,
} from "@workspace/coach-types";
import type { CoachRankedPool } from "@workspace/coach-rank";
import { assembleCoachTicket } from "@workspace/coach-ticket";

export type BuildCoachSnapshotInput = {
  ranked: CoachRankedPool;
  manifest: CoachScanManifest;
  fingerprint: string;
  activeSports: CoachSportIdOrCustom[];
  nowMs?: number;
  parlaySizes?: readonly CoachParlayLegCount[];
};

function uniqueSports(ranked: CoachRankedPool): CoachSportIdOrCustom[] {
  const sports = new Set<CoachSportIdOrCustom>();
  for (const leg of [...ranked.props, ...ranked.gameLines]) {
    sports.add(leg.sport);
  }
  return [...sports].sort((a, b) => String(a).localeCompare(String(b)));
}

function hasDeliveredTicket(index: CoachTicketsIndex): boolean {
  for (const ticket of Object.values(index.global)) {
    if (ticket && ticket.deliveredLegs > 0) return true;
  }
  for (const bySize of Object.values(index.bySport)) {
    if (!bySize) continue;
    for (const ticket of Object.values(bySize)) {
      if (ticket && ticket.deliveredLegs > 0) return true;
    }
  }
  return false;
}

export function buildTicketsIndex(input: BuildCoachSnapshotInput): CoachTicketsIndex {
  const sizes = input.parlaySizes ?? COACH_PARLAY_SIZES;
  const nowMs = input.nowMs ?? Date.now();
  const global: CoachTicketsIndex["global"] = {};
  const bySport: CoachTicketsIndex["bySport"] = {};

  for (const size of sizes) {
    global[size] = assembleCoachTicket({
      ranked: input.ranked,
      manifest: input.manifest,
      requestedLegs: size,
      nowMs,
    });
  }

  for (const sport of uniqueSports(input.ranked)) {
    const sportKey = String(sport).toLowerCase();
    bySport[sportKey] = {};
    for (const size of sizes) {
      bySport[sportKey]![size] = assembleCoachTicket({
        ranked: input.ranked,
        manifest: input.manifest,
        requestedLegs: size,
        nowMs,
        sportFilter: sportKey,
      });
    }
  }

  return { global, bySport };
}

export function buildCoachSnapshot(input: BuildCoachSnapshotInput): CoachSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const tickets = buildTicketsIndex(input);
  const serveable = input.manifest.scanComplete && hasDeliveredTicket(tickets);

  return {
    at: nowMs,
    fingerprint: input.fingerprint,
    manifest: input.manifest,
    tickets,
    activeSports: input.activeSports,
    deepSimComplete: input.manifest.deepSimComplete,
    serveable,
    propsQualified: input.ranked.props.length,
    gameLinesQualified: input.ranked.gameLines.length,
  };
}
