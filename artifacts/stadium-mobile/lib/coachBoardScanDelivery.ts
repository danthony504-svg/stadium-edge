// Single Coach board-scan delivery pipeline — tier fill to target from scored pool.

import type { ParsedPick } from "./parsedPick.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import {
  boardScanIsComplete,
  boardScanMatchesLegTarget,
  ensureFixedLegShortfallLegNote,
} from "./coachScanPolicy.ts";
import {
  type CoachBoardScanManifest,
  emptyCoachBoardScanManifest,
  formatCoachBoardScanManifest,
  normalizeCoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
import {
  buildTieredCoachTicketFromPool,
  positiveEdgeScoredLegs,
  salvageCoachDelivery,
} from "./coachDeliverySalvage.ts";
import {
  emptyCoachPipelineSnapshot,
  explainDeliveryFilterRejection,
  logCoachPipelineSnapshot,
  logDeliveryFilterStages,
  logUnselectedScoredPoolMarkets,
  pushPipelineRejection,
  rejectionFromDelivery,
  setPipelineStage,
  traceScoredPoolPipeline,
} from "./coachPipelineTrace.ts";
import { buildIndependentCoachTicket } from "./coachTicketCombinations.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";
import { prepareCoachDeliveredTicket } from "./coachTicketKernel.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import { finalizeBoardBuiltCoachTicket } from "./pickRecommendation.ts";
import { tagTicketRoles } from "./ticketStaging.ts";
import {
  emitCoachLiveBoardSummary,
  logCoachLiveBoardEmptyTicketFallback,
  recordCoachLiveBoardDelivered,
  recordCoachLiveBoardExitReason,
  recordCoachLiveBoardGrounded,
} from "./coachLiveBoardTrace.ts";

export type CoachBoardScanDelivery = {
  picks: ParsedPick[];
  manifest: CoachBoardScanManifest;
  scanComplete: boolean;
  coachDetailNote: string;
  positiveEdgePool: number;
  shortfallNote: string;
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

/** Final ticket delivery — tier-fill from scored pool until target or pool exhausted. */
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
      positiveEdgePool: 0,
      shortfallNote: "",
    };
  }

  let stagedPicks = [...scan.picks];
  const scoredPool = scan.scoredPool ?? [];
  const positiveEdgePool = positiveEdgeScoredLegs(scoredPool).length;

  if (
    legTarget > 0 &&
    !boardScanMatchesLegTarget(scan, legTarget) &&
    scoredPool.length
  ) {
    const restaged = buildIndependentCoachTicket(scoredPool, legTarget, {
      varietySeed: scan.requestId ?? `restage-${legTarget}`,
    });
    stagedPicks = restaged.picks;
  } else if (legTarget > 0 && !boardScanMatchesLegTarget(scan, legTarget)) {
    recordCoachLiveBoardExitReason("delivery_guard");
    emitCoachLiveBoardSummary("scan-leg-target-mismatch");
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
      positiveEdgePool,
      shortfallNote: "",
    };
  }

  let tieredPicks = stagedPicks;
  if (scoredPool.length && legTarget > 0) {
    const tiered = buildTieredCoachTicketFromPool(
      scoredPool,
      legTarget,
      scan.requestId,
      stagedPicks,
    );
    if (tiered.picks.length >= tieredPicks.length) {
      tieredPicks = tiered.picks;
    }
    pipeline.relaxationsApplied = [
      tiered.tierCounts[1] > 0 ? "tier-1-strict" : "",
      tiered.tierCounts[2] > 0 ? "tier-2-medium-confidence" : "",
      tiered.tierCounts[3] > 0 ? "tier-3-alternate-lines" : "",
      tiered.tierCounts[4] > 0 ? "tier-4-positive-ev" : "",
    ].filter(Boolean);
  }

  if (scoredPool.length) {
    traceScoredPoolPipeline(scoredPool, pipeline);
  }

  const stagedBeforeDelivery = tieredPicks.length;
  let picks = deliverTaggedPicks(tieredPicks, enrich, pipeline);
  recordCoachLiveBoardGrounded(picks.length);
  if (stagedBeforeDelivery > 0 && picks.length === 0) {
    recordCoachLiveBoardExitReason("delivery_guard");
  }

  if (legTarget > 0 && picks.length < legTarget && scoredPool.length) {
    const salvage = salvageCoachDelivery({
      scored: scoredPool,
      target: legTarget,
      enrich,
      varietySeed: scan.requestId,
      stagedPicks: tieredPicks,
    });
    pipeline.relaxationsApplied = [
      ...new Set([...pipeline.relaxationsApplied, ...salvage.relaxationsApplied]),
    ];
    if (salvage.picks.length > picks.length) {
      picks = deliverTaggedPicks(salvage.picks, enrich, pipeline);
    }
    if (picks.length < salvage.picks.length && salvage.picks.length > picks.length) {
      const relaxed = salvage.picks
        .map((p) => ({ ...p, coachDelivered: true }))
        .slice(0, legTarget);
      if (relaxed.length > picks.length) {
        picks = relaxed;
      }
    }
  }

  if (scoredPool.length) {
    logUnselectedScoredPoolMarkets(scoredPool, picks, pipeline);
  }

  picks.sort(
    (a, b) =>
      (b.finalAiScore?.composite ?? b.scores?.composite ?? 0) -
      (a.finalAiScore?.composite ?? a.scores?.composite ?? 0),
  );

  const beforeFinalDelivery =
    pipeline.stages.beforeFinalSelection ??
    (positiveEdgePool || stagedPicks.length);
  setPipelineStage(pipeline, "finalDelivery", picks.length);
  logDeliveryFilterStages(pipeline.stages, {
    finalDelivery: Math.max(0, beforeFinalDelivery - picks.length),
  });

  logCoachPipelineSnapshot({
    ...pipeline,
    stages: {
      ...manifest.pipelineStages,
      ...pipeline.stages,
      beforeFinalSelection: positiveEdgePool || stagedPicks.length,
      afterCorrelation: tieredPicks.length,
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
    1: picks.filter((p) => p.coachDeliveryTier === 1 || (!p.coachDeliveryTier && !p.coachConfidenceLabel)).length,
    2: picks.filter((p) => p.coachConfidenceLabel === "Medium confidence" || p.coachDeliveryTier === 2).length,
    3: picks.filter((p) => p.coachDeliveryTier === 3 || (p.ticketRole === "alt" && p.coachDeliveryTier !== 4)).length,
    4: picks.filter((p) => p.coachDeliveryTier === 4).length,
  } as Record<1 | 2 | 3 | 4, number>;

  const shortfallNote =
    legTarget > 0 && picks.length < legTarget
      ? ensureFixedLegShortfallLegNote("", legTarget, picks.length, positiveEdgePool)
      : "";

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
      scoredPool: scoredPool.length,
      positiveEdgePool,
    },
  });

  let coachDetailNote = formatCoachBoardScanManifest(finalManifest);
  if (shortfallNote) {
    coachDetailNote = `${shortfallNote}\n\n${coachDetailNote}`;
  }

  recordCoachLiveBoardDelivered(picks.length);
  if (picks.length === 0) {
    if (positiveEdgePool === 0 && scoredPool.length > 0) {
      recordCoachLiveBoardExitReason("ev_filter");
    } else if ((manifest.totalQualified ?? 0) === 0 && scoredPool.length > 0) {
      recordCoachLiveBoardExitReason("confidence_filter");
    }
    logCoachLiveBoardEmptyTicketFallback({
      delivered: 0,
      scanComplete: true,
      hasManifestReply: true,
      legTarget,
    });
    emitCoachLiveBoardSummary("delivery-zero-picks");
  }

  return {
    picks,
    manifest: finalManifest,
    scanComplete: true,
    coachDetailNote,
    positiveEdgePool,
    shortfallNote,
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
  "_Full board scan finished — no positive-edge markets cleared delivery gates. Open **View scan manifest** below for coverage and rejection reasons._";

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
