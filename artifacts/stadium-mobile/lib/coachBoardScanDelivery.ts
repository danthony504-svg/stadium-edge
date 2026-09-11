// Single Coach board-scan delivery pipeline — no preview/filler fallbacks on final tickets.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { boardScanIsComplete, boardScanMatchesLegTarget } from "./coachScanPolicy.ts";
import {
  type CoachBoardScanManifest,
  formatCoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";
import {
  applyCoachTicketInvariants,
  boardScanToCoachTicket,
  prepareCoachDeliveredTicket,
} from "./coachTicketKernel.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import { finalizeBoardBuiltCoachTicket } from "./pickRecommendation.ts";
import { tagTicketRoles } from "./ticketStaging.ts";

export type CoachBoardScanDelivery = {
  picks: ParsedPick[];
  manifest: CoachBoardScanManifest;
  scanComplete: boolean;
  coachDetailNote: string;
};

/** Final ticket delivery — only when scanComplete; one gate stack, no salvage tiers. */
export function deliverCoachBoardScanTicket(
  scan: FullBoardScanResult,
  enrich: CoachFlashEnrich,
  legTarget: number,
): CoachBoardScanDelivery {
  const manifest = scan.manifest ?? {
    scanComplete: !!scan.scanComplete,
    boardExhausted: !!scan.scanComplete,
    requestedLegs: legTarget,
    deliveredLegs: 0,
    gameSimDraws: 10_000,
    propSimDraws: 10_000,
    propSimTier: "deep" as const,
    marketsFound: scan.totalScanned,
    marketsFoundByFamily: {} as never,
    propsFound: 0,
    propsEligibleForSim: 0,
    propsSkippedUnsupported: 0,
    alternateGameLinesFound: 0,
    alternatePropsFound: 0,
    marketsSimulated: scan.totalScanned,
    gameLinesSimulated: 0,
    propsSimulated: 0,
    propsSimBatches: 0,
    propsSimTimeouts: 0,
    preScoreEvaluated: 0,
    totalEvaluated: scan.totalQualified,
    totalQualified: scan.totalQualified,
    qualifiedMain: scan.staging.mainQualified,
    qualifiedAlt: scan.staging.altQualified,
    qualifiedByCategory: { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 },
    gateFailureCounts: {},
    rejectedSamples: [],
    footballPropFunnelBySport: {
      nfl: {
        raw_found: 0,
        normalized: 0,
        eligible: 0,
        simulated: 0,
        graded: 0,
        qualified: 0,
        after_dedupe: 0,
        after_correlation: 0,
        final_selected: 0,
      },
      ncaaf: {
        raw_found: 0,
        normalized: 0,
        eligible: 0,
        simulated: 0,
        graded: 0,
        qualified: 0,
        after_dedupe: 0,
        after_correlation: 0,
        final_selected: 0,
      },
    },
    footballPropFoundByMarketBySport: { nfl: {}, ncaaf: {} },
    footballPropRejectCountsBySport: { nfl: {}, ncaaf: {} },
    footballPropRejectedSamples: [],
  };

  if (!boardScanIsComplete(scan) || !scan.scanComplete) {
    return {
      picks: [],
      manifest,
      scanComplete: false,
      coachDetailNote: formatCoachBoardScanManifest({ ...manifest, scanComplete: false }),
    };
  }

  // Refuse foreign / oversized scans only. boardScanMatchesLegTarget now accepts
  // same-request shortfalls (0 ≤ picks ≤ target), so we never wipe a non-empty
  // shortfall merely because pick count < requestedLegs.
  if (legTarget > 0 && !boardScanMatchesLegTarget(scan, legTarget)) {
    // Prefix-reuse guard (e.g. 15-leg for an 8-leg ask). Still mark complete so
    // recovery can attach the scan manifest instead of "may still be scoring".
    const finalManifest: CoachBoardScanManifest = {
      ...manifest,
      scanComplete: true,
      boardExhausted: true,
      requestedLegs: legTarget,
      deliveredLegs: 0,
    };
    return {
      picks: [],
      manifest: finalManifest,
      scanComplete: true,
      coachDetailNote: formatCoachBoardScanManifest(finalManifest),
    };
  }

  // Zero staged legs — completed empty result with manifest (not "still scoring").
  if (!scan.picks.length) {
    const finalManifest: CoachBoardScanManifest = {
      ...manifest,
      scanComplete: true,
      boardExhausted: true,
      requestedLegs: legTarget > 0 ? legTarget : manifest.requestedLegs,
      deliveredLegs: 0,
    };
    return {
      picks: [],
      manifest: finalManifest,
      scanComplete: true,
      coachDetailNote: formatCoachBoardScanManifest(finalManifest),
    };
  }

  const tagged = tagTicketRoles([...scan.picks]);
  const finalized = finalizeBoardBuiltCoachTicket(tagged, enrich);
  // Finalize already ran delivery filtering. Apply invariants only — do not
  // re-run filterCoachDeliveredPicks (prepareCoachDeliveredTicket), which can
  // zero a valid shortfall solely from a second gate pass / thin enrich.
  let picks = applyCoachTicketInvariants(finalized.picks, enrich);
  if (!picks.length && finalized.picks.length) {
    picks = finalized.picks;
  }
  if (!picks.length && scan.picks.length) {
    // Last resort: trust already-staged scan legs through fail-soft board path.
    picks = boardScanToCoachTicket(scan, enrich, legTarget);
  }

  const finalManifest: CoachBoardScanManifest = {
    ...manifest,
    scanComplete: true,
    boardExhausted: true,
    requestedLegs: legTarget,
    deliveredLegs: picks.length,
  };

  traceCoachTicket("board-scan-staged", {
    requestedLegs: legTarget,
    scanRequestedLegs: scan.requestedLegs,
    pickIds: picks,
    source: "deliverCoachBoardScanTicket",
  });

  return {
    picks,
    manifest: finalManifest,
    scanComplete: true,
    coachDetailNote: formatCoachBoardScanManifest(finalManifest),
  };
}

/** Format manifest markdown for UI — works even when scan staged zero ticket legs. */
export function coachBoardScanManifestForMessage(
  scan: FullBoardScanResult | null | undefined,
  enrich: CoachFlashEnrich,
  legTarget: number,
): string {
  if (!scan) return "";
  // Prefer the recorded scan.manifest whenever present so stream-end shortfall
  // tickets still surface Coverage → Delivery even when leg-target matching
  // rejects deliverCoachBoardScanTicket staging.
  if (scan.manifest) {
    return formatCoachBoardScanManifest({
      ...scan.manifest,
      scanComplete: !!scan.scanComplete || !!scan.manifest.scanComplete,
      boardExhausted:
        !!(scan.scanComplete || scan.manifest.boardExhausted || scan.manifest.scanComplete),
      requestedLegs: legTarget > 0 ? legTarget : scan.manifest.requestedLegs,
      deliveredLegs:
        scan.manifest.deliveredLegs ||
        (boardScanIsComplete(scan) ? scan.picks?.length ?? 0 : scan.manifest.deliveredLegs),
    });
  }
  if (boardScanIsComplete(scan) && scan.scanComplete) {
    return deliverCoachBoardScanTicket(scan, enrich, legTarget).coachDetailNote;
  }
  return "";
}

/**
 * Resolve read-only scan-manifest markdown from any available board-scan
 * candidate — complete matching scans first, then any scan that still carries
 * a recorder manifest (including shortfall / target-mismatch leftovers).
 */
export function resolveCoachBoardScanManifestDetail(
  legTarget: number,
  enrich: CoachFlashEnrich,
  ...candidates: Array<FullBoardScanResult | null | undefined>
): string {
  for (const scan of candidates) {
    if (!scan || !boardScanIsComplete(scan)) continue;
    if (legTarget > 0 && !boardScanMatchesLegTarget(scan, legTarget)) continue;
    const text = coachBoardScanManifestForMessage(scan, enrich, legTarget);
    if (text.trim()) return text;
  }
  for (const scan of candidates) {
    if (!scan?.manifest) continue;
    const text = coachBoardScanManifestForMessage(scan, enrich, legTarget);
    if (text.trim()) return text;
  }
  return "";
}

const SCAN_MANIFEST_HEADING_RE = /### Scan manifest/i;

export function coachReplyHasScanManifest(
  boardScanManifestDetail?: string,
  coachDetailNote?: string,
): boolean {
  return (
    SCAN_MANIFEST_HEADING_RE.test(boardScanManifestDetail ?? "") ||
    SCAN_MANIFEST_HEADING_RE.test(coachDetailNote ?? "")
  );
}

/** User-facing lead when a fixed-leg parlay exhausts the board with zero deliveries. */
export const COACH_EMPTY_BOARD_SCAN_LEAD =
  "_Full board scan finished — no legs cleared delivery gates. Open **More ticket detail** below for coverage and rejection reasons._";

/** Progress-only flash — never claims final shortfall; may show scored preview count. */
export function deliverCoachBoardScanProgress(
  scan: FullBoardScanResult,
  enrich: CoachFlashEnrich,
  legTarget: number,
): { picks: ParsedPick[]; progressNote: string } {
  if (!scan.picks.length || boardScanIsComplete(scan)) {
    return { picks: [], progressNote: "" };
  }
  const tagged = tagTicketRoles([...scan.picks]);
  const finalized = finalizeBoardBuiltCoachTicket(tagged, enrich);
  let picks = prepareCoachDeliveredTicket(finalized.picks, enrich);
  if (legTarget > 0 && picks.length > legTarget) {
    picks = picks.slice(0, legTarget);
  }
  // Stash already hit the requested count but delivery gates stripped the flash
  // — fail-soft to staged legs so "Scored N of N" never sits at 93% with no cards.
  if (legTarget >= 3 && scan.picks.length >= legTarget && picks.length < legTarget) {
    const soft = boardScanToCoachTicket(scan, enrich, legTarget);
    if (soft.length) {
      picks = legTarget > 0 && soft.length > legTarget ? soft.slice(0, legTarget) : soft;
    }
  }
  if (!picks.length) {
    return { picks: [], progressNote: "" };
  }
  const note = `Scoring live board — **${picks.length}** of **${legTarget}** legs ready (${scan.totalScanned.toLocaleString()} markets scanned)…`;
  return { picks, progressNote: note };
}
