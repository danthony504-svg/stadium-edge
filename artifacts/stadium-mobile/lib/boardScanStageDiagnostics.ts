// Board-scan pipeline funnel diagnostics — props remaining after each filter stage.

import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import type { CoachBoardScanManifest } from "./coachBoardScanManifest.ts";
import { logCoachPickDiag } from "./coachPickDiagnostics.ts";
import type { CoachTicketStyle } from "./coachTicketQualityTiers.ts";
import { COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE } from "./gameSimQualityGates.ts";
import {
  legIsStrictBoardQualified,
  legMeetsEliteTier,
  legMeetsExpandedTier,
  legMeetsSafetyEvTier,
  resolveQualifyingPoolForTarget,
  type TieredFillSummary,
} from "./coachTicketTieredFill.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

export type BoardScanPipelineStage =
  | "slate-filtered"
  | "props-realistic"
  | "post-game-scoring"
  | "post-prop-scoring"
  | "post-injury-scoring"
  | "post-edge-confidence"
  | "post-ladder-collapse"
  | "strict-qualified"
  | "elite-tier"
  | "expanded-tier"
  | "safety-tier"
  | "combinator-input"
  | "combinator-candidates"
  | "combinator-chosen"
  | "scan-final";

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export type BoardScanStageFunnel = {
  scoredTotal: number;
  afterEdge: number;
  afterConfidence: number;
  afterGrade: number;
  strictQualified: number;
  elite: number;
  expanded: number;
  safety: number;
  qualifyingPool: number;
  selectedPool: TieredFillSummary["selectedPool"];
};

export function countBoardScanStageFunnel(
  scored: BoardScoredLeg[],
  target: number,
  ticketStyle: CoachTicketStyle,
): BoardScanStageFunnel {
  const minGradeRank = gradeRank(COACH_SIM_MIN_GRADE);
  let afterEdge = 0;
  let afterConfidence = 0;
  let afterGrade = 0;

  for (const leg of scored) {
    const edge = leg.edgePct ?? leg.pick.finalAiScore?.edgePct ?? 0;
    if (edge <= 0) continue;
    afterEdge += 1;

    const conf = leg.confidencePct ?? leg.pick.finalAiScore?.confidencePct ?? 0;
    if (conf < COACH_SIM_MIN_CONFIDENCE) continue;
    afterConfidence += 1;

    const grade = leg.pick.finalAiScore?.grade ?? leg.grade ?? "F";
    if (gradeRank(grade) < minGradeRank) continue;
    afterGrade += 1;
  }

  const strictQualified = scored.filter(legIsStrictBoardQualified).length;
  const elite = scored.filter(legMeetsEliteTier).length;
  const expanded = scored.filter(legMeetsExpandedTier).length;
  const safety = scored.filter((leg) => legMeetsSafetyEvTier(leg, ticketStyle)).length;
  const { pool, summary } = resolveQualifyingPoolForTarget(scored, target, ticketStyle);

  return {
    scoredTotal: scored.length,
    afterEdge,
    afterConfidence,
    afterGrade,
    strictQualified,
    elite,
    expanded,
    safety,
    qualifyingPool: pool.length,
    selectedPool: summary.selectedPool,
  };
}

export function logBoardScanPipelineStage(
  stage: BoardScanPipelineStage,
  remaining: number,
  detail?: Record<string, unknown>,
): void {
  logCoachPickDiag("board-scan-stage", {
    stage,
    remaining,
    ...detail,
  });
}

export function logBoardScanFunnel(
  funnel: BoardScanStageFunnel,
  detail?: Record<string, unknown>,
): void {
  logCoachPickDiag("board-scan-stage", {
    stage: "funnel-snapshot",
    remaining: funnel.strictQualified,
    ...funnel,
    ...detail,
  });
}

function topGateFailures(manifest: CoachBoardScanManifest | undefined): string[] {
  if (!manifest?.gateFailureCounts) return [];
  return Object.entries(manifest.gateFailureCounts)
    .filter(([gate]) => gate !== "qualified_main" && gate !== "qualified_alt")
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 3)
    .map(([gate, count]) => `${gate.replace(/_/g, " ")} (${count})`);
}

/** User-facing one-liner when the board scan exhausts with zero ticket legs. */
export function summarizeBoardScanEmptyReason(
  manifest: CoachBoardScanManifest | undefined,
  funnel: Partial<BoardScanStageFunnel>,
  opts?: { preview?: boolean; combinatorCandidates?: number; combinatorChosen?: number },
): string {
  if (opts?.preview) {
    return "Board scan still scoring — combinator has not run on the final candidate list yet.";
  }

  const gates = topGateFailures(manifest);
  const gateHint = gates.length ? ` Top rejections: ${gates.join(", ")}.` : "";

  if ((opts?.combinatorCandidates ?? 0) === 0 && (funnel.qualifyingPool ?? 0) > 0) {
    return `Combinator received ${funnel.qualifyingPool} qualified legs but built 0 candidate tickets (correlation / uniqueness constraints).${gateHint}`;
  }

  if ((funnel.strictQualified ?? 0) === 0 && (funnel.scoredTotal ?? 0) > 0) {
    return `Scored ${funnel.scoredTotal} markets, but none passed edge, EV, confidence, and AI grade gates.${gateHint}`;
  }

  if ((funnel.scoredTotal ?? 0) === 0 && (manifest?.marketsSimulated ?? 0) > 0) {
    return `Simulated ${manifest!.marketsSimulated.toLocaleString()} markets, but none produced a gradable sim-aligned score.${gateHint}`;
  }

  if ((funnel.scoredTotal ?? 0) === 0) {
    return `No posted markets cleared the initial sim gate on this slate.${gateHint}`;
  }

  if ((opts?.combinatorChosen ?? 0) === 0 && (funnel.qualifyingPool ?? 0) >= 1) {
    return `Qualified pool had ${funnel.qualifyingPool} legs, but the combinator could not assemble a valid ticket.${gateHint}`;
  }

  return `Full board scan finished with zero deliverable legs.${gateHint}`;
}

export function summarizeBoardScanEmptyFromResult(scan: FullBoardScanResult): string {
  const m = scan.manifest;
  const strictQualified = (m?.qualifiedMain ?? 0) + (m?.qualifiedAlt ?? 0);
  return summarizeBoardScanEmptyReason(m, {
    scoredTotal: m?.totalEvaluated ?? scan.totalScanned,
    strictQualified,
    qualifyingPool: scan.totalQualified,
  }, {
    preview: !scan.scanComplete,
    combinatorChosen: scan.picks.length,
  });
}
