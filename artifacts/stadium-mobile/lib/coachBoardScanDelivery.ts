// Single Coach board-scan delivery pipeline — no silent zero when scored candidates exist.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { boardScanIsComplete, boardScanMatchesLegTarget } from "./coachScanPolicy.ts";
import {
  type CoachBoardScanManifest,
  emptyCoachBoardScanManifest,
  formatCoachBoardScanManifest,
  normalizeCoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
import {
  salvageCoachDelivery,
  shouldSalvageCoachDelivery,
} from "./coachDeliverySalvage.ts";
import {
  emptyCoachPipelineSnapshot,
  explainDeliveryFilterRejection,
  logCoachPipelineSnapshot,
  pushPipelineRejection,
  rejectionFromDelivery,
  setPipelineStage,
} from "./coachPipelineTrace.ts";
import { buildIndependentCoachTicket } from "./coachTicketCombinations.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";
import { prepareCoachDeliveredTicket } from "./coachTicketKernel.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import { finalizeBoardBuiltCoachTicket } from "./pickRecommendation.ts";
import { tagTicketRoles } from "./ticketStaging.ts";

export type CoachBoardScanDelivery = {
  picks: ParsedPick[];
  manifest: CoachBoardScanManifest;
  scanComplete: boolean;
  coachDetailNote: string;
};

function traceDeliveryRejections(
  before: ParsedPick[],
  after: ParsedPick[],
  snapshot: ReturnType<typeof emptyCoachPipelineSnapshot>,
): void {
  const kept = new Set(after.map((p) => `${p.game}|${p.market}|${p.pick}|${p.odds}`));
  for (const pick of before) {
    const key = `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}`;
    if (kept.has(key)) continue;
    const reason =
      explainDeliveryFilterRejection(pick, pick.finalAiScore) ??
      "Rejected during final delivery filter";
    pushPipelineRejection(
      snapshot,
      rejectionFromDelivery(pick, pick.finalAiScore, reason),
    );
  }
}

function deliverTaggedPicks(
  picks: ParsedPick[],
  enrich: CoachFlashEnrich,
  snapshot: ReturnType<typeof emptyCoachPipelineSnapshot>,
): ParsedPick[] {
  setPipelineStage(snapshot, "beforeFinalSelection", picks.length);
  const tagged = tagTicketRoles([...picks]);
  const finalized = finalizeBoardBuiltCoachTicket(tagged, enrich);
  const prepared = prepareCoachDeliveredTicket(finalized.picks, enrich);
  traceDeliveryRejections(tagged, prepared, snapshot);
  return prepared;
}

/** Final ticket delivery — salvage when strict gates zero a non-empty scored pool. */
export function deliverCoachBoardScanTicket(
  scan: FullBoardScanResult,
  enrich: CoachFlashEnrich,
  legTarget: number,
): CoachBoardScanDelivery {
  const pipeline = emptyCoachPipelineSnapshot();
  const manifest: CoachBoardScanManifest = scan.manifest
    ? normalizeCoachBoardScanManifest(scan.manifest)
    : {
        ...emptyCoachBoardScanManifest(legTarget),
        scanComplete: !!scan.scanComplete,
        boardExhausted: !!scan.scanComplete,
        marketsFound: scan.totalScanned,
        marketsSimulated: scan.totalScanned,
        totalEvaluated: scan.totalScanned,
        totalQualified: scan.totalQualified,
        qualifiedMain: scan.staging.mainQualified,
        qualifiedAlt: scan.staging.altQualified,
      };

  if (!boardScanIsComplete(scan) || !scan.scanComplete) {
    return {
      picks: [],
      manifest,
      scanComplete: false,
      coachDetailNote: formatCoachBoardScanManifest({ ...manifest, scanComplete: false }),
    };
  }

  let stagedPicks = [...scan.picks];

  // Re-stage when leg target differs but scored pool is available.
  if (
    legTarget > 0 &&
    !boardScanMatchesLegTarget(scan, legTarget) &&
    scan.scoredPool?.length
  ) {
    const restaged = buildIndependentCoachTicket(scan.scoredPool, legTarget, {
      varietySeed: scan.requestId ?? `restage-${legTarget}`,
    });
    stagedPicks = restaged.picks;
  } else if (legTarget > 0 && !boardScanMatchesLegTarget(scan, legTarget)) {
    return {
      picks: [],
      manifest: {
        ...manifest,
        requestedLegs: legTarget,
        deliveredLegs: 0,
      },
      scanComplete: false,
      coachDetailNote: formatCoachBoardScanManifest({
        ...manifest,
        scanComplete: false,
        requestedLegs: legTarget,
      }),
    };
  }

  let picks = deliverTaggedPicks(stagedPicks, enrich, pipeline);

  if (shouldSalvageCoachDelivery(picks.length, legTarget, scan.scoredPool)) {
    const salvage = salvageCoachDelivery({
      scored: scan.scoredPool ?? [],
      target: legTarget,
      enrich,
      varietySeed: scan.requestId,
      stagedPicks,
    });
    pipeline.relaxationsApplied = salvage.relaxationsApplied;
    if (salvage.picks.length > picks.length) {
      picks = deliverTaggedPicks(salvage.picks, enrich, pipeline);
    }
    if (picks.length === 0 && salvage.picks.length > 0) {
      picks = salvage.picks.slice(0, legTarget);
    }
  }

  logCoachPipelineSnapshot({
    ...pipeline,
    stages: {
      ...manifest.pipelineStages,
      ...pipeline.stages,
      beforeFinalSelection: scan.scoredPool?.length ?? stagedPicks.length,
      afterCorrelation: stagedPicks.length,
    },
  });

  const coverageBySport: Record<string, number> = {};
  const coverageByMarket: Record<string, number> = {};
  for (const p of picks) {
    const sport = String(p.sport ?? "unknown").toLowerCase();
    coverageBySport[sport] = (coverageBySport[sport] ?? 0) + 1;
    const market = String(p.market ?? "unknown");
    coverageByMarket[market] = (coverageByMarket[market] ?? 0) + 1;
  }

  const tierFillCounts = {
    1: picks.filter((p) => !p.coachFillTier && !p.coachConfidenceLabel).length,
    2: picks.filter((p) => p.ticketRole === "alt" && !p.coachConfidenceLabel).length,
    3: picks.filter((p) => p.coachConfidenceLabel === "Medium confidence").length,
  } as Record<1 | 2 | 3, number>;

  const finalManifest: CoachBoardScanManifest = {
    ...manifest,
    scanComplete: true,
    boardExhausted: true,
    requestedLegs: legTarget,
    deliveredLegs: picks.length,
    finalSelectedCount: picks.length,
    coverageBySport,
    coverageByMarket,
    tierFillCounts,
    pipelineStages: {
      ...manifest.pipelineStages,
      ...pipeline.stages,
    },
    pipelineRejections: [...manifest.pipelineRejections, ...pipeline.rejections],
    relaxationsApplied: [
      ...new Set([...manifest.relaxationsApplied, ...pipeline.relaxationsApplied]),
    ],
  };

  traceCoachTicket("board-scan-staged", {
    requestedLegs: legTarget,
    scanRequestedLegs: scan.requestedLegs,
    pickIds: picks,
    source: "deliverCoachBoardScanTicket",
    extra: {
      salvage: pipeline.relaxationsApplied,
      scoredPool: scan.scoredPool?.length ?? 0,
    },
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
    return formatCoachBoardScanManifest(
      normalizeCoachBoardScanManifest({
        ...scan.manifest,
        scanComplete: !!scan.scanComplete,
        boardExhausted: !!scan.scanComplete,
        requestedLegs: legTarget,
      }),
    );
  }
  return "";
}

export { coachReplyHasScanManifest } from "./coachBoardScanManifest.ts";

/** User-facing lead when a fixed-leg parlay exhausts the board with zero deliveries. */
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
  if (legTarget > 0 && picks.length > legTarget) {
    picks = picks.slice(0, legTarget);
  }
  if (!picks.length) {
    return { picks: [], progressNote: "" };
  }
  const note = `Scoring live board — **${picks.length}** of **${legTarget}** legs ready (${scan.totalScanned.toLocaleString()} markets scanned)…`;
  return { picks, progressNote: note };
}
