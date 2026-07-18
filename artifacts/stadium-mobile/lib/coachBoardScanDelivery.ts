// Single Coach board-scan delivery pipeline — final handoff after correlation.

import type { ParsedPick } from "../components/PickCard.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { boardScanIsComplete } from "./coachScanPolicy.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import {
  type CoachBoardScanManifest,
  formatCoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
import { logCoachRun } from "./coachRunTrace.ts";
import {
  executeFinalTicketHandoff,
  salvageHighestRanked,
} from "./coachFinalTicketAssembly.ts";
import { rankScanCandidatesForDelivery } from "./coachDeliveryResolve.ts";
import { tagTicketRoles } from "./ticketStaging.ts";
import { finalizeBoardBuiltCoachTicket } from "./pickRecommendation.ts";
import { prepareCoachDeliveredTicket } from "./coachTicketKernel.ts";

export type CoachBoardScanDelivery = {
  picks: ParsedPick[];
  manifest: CoachBoardScanManifest;
  scanComplete: boolean;
  coachDetailNote: string;
};

function defaultManifest(
  scan: FullBoardScanResult,
  legTarget: number,
): CoachBoardScanManifest {
  return (
    scan.manifest ?? {
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
    }
  );
}

/** Final ticket delivery — correlation complete → assembly once → pick cards. */
export function deliverCoachBoardScanTicket(
  scan: FullBoardScanResult,
  enrich: CoachFlashEnrich,
  legTarget: number,
): CoachBoardScanDelivery {
  const manifest = defaultManifest(scan, legTarget);

  if (!boardScanIsComplete(scan) || !scan.scanComplete) {
    return {
      picks: [],
      manifest,
      scanComplete: false,
      coachDetailNote: formatCoachBoardScanManifest({ ...manifest, scanComplete: false }),
    };
  }

  const requestId = scan.requestId ?? "";
  const assembly = executeFinalTicketHandoff({
    requestId,
    candidates: scan.picks,
    enrich,
    requestedLegs: legTarget,
    relaxCorrelation: true,
  });
  let picks = assembly.picks;

  if (!picks.length && scan.picks.length && !assembly.stale) {
    const tagged = tagTicketRoles([...scan.picks]);
    const finalized = finalizeBoardBuiltCoachTicket(tagged, enrich);
    picks = prepareCoachDeliveredTicket(finalized.picks, enrich);
    if (!picks.length) {
      picks = rankScanCandidatesForDelivery(scan.picks, enrich, legTarget);
    }
    if (!picks.length) {
      picks = salvageHighestRanked(scan.picks, enrich, legTarget);
    }
  }

  if (assembly.failureReason && picks.length) {
    logCoachRun("final-selection", {
      requestId,
      requested: legTarget,
      selected: picks.length,
      failureReason: assembly.failureReason,
      timedOut: assembly.timedOut,
    });
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
  logCoachRun("simulations-complete", {
    requestId,
    count: scan.picks.length,
    delivered: picks.length,
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
  if (boardScanIsComplete(scan) && scan.scanComplete) {
    return deliverCoachBoardScanTicket(scan, enrich, legTarget).coachDetailNote;
  }
  if (scan.manifest) {
    return formatCoachBoardScanManifest({
      ...scan.manifest,
      scanComplete: !!scan.scanComplete,
      boardExhausted: !!scan.scanComplete,
      requestedLegs: legTarget,
    });
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

/** User-facing lead when a complete scan staged zero deliverable legs. */
export const COACH_EMPTY_BOARD_SCAN_LEAD =
  "_Full board scan finished — no legs cleared delivery gates. Open **View scan manifest** below for coverage and rejection reasons._";

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
  if (!picks.length && tagged.length) {
    picks = tagged.slice(0, legTarget > 0 ? legTarget : tagged.length);
  }
  if (legTarget > 0 && picks.length > legTarget) {
    picks = picks.slice(0, legTarget);
  }
  if (!picks.length) {
    return { picks: [], progressNote: "" };
  }
  const note = `Scoring live board — **${picks.length}** of **${legTarget}** legs ready (${scan.totalScanned.toLocaleString()} markets scanned)…`;
  return { picks, progressNote: note };
}
