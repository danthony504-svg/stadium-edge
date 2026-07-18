// Coach final handoff tracing — delivery path from board scan to rendered pick cards.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { boardScanIsComplete, boardScanMatchesLegTarget, boardScanReadyForDelivery } from "./coachScanPolicy.ts";

export const COACH_EMPTY_BOARD_SCAN_LEAD =
  "_Full board scan finished — no legs cleared delivery gates. Open **View scan manifest** below for coverage and rejection reasons._";

export type CoachHandoffSource = "preview" | "final";

export type CoachFinalHandoffSnapshot = {
  requestId: string | null;
  scanComplete: boolean;
  source: CoachHandoffSource;
  candidateCount: number;
  pickCount: number;
  emptyReason: string | null;
  rendered: boolean;
  "delivery-attempt"?: number;
};

export type CoachDeliveryAttemptDetail = {
  requestId: string | null;
  scanComplete: boolean;
  source: CoachHandoffSource;
  candidateCount: number;
  pickCount?: number;
  legTarget?: number;
  stage: string;
  readyForDelivery?: boolean;
  legTargetMismatch?: boolean;
  finalizeRejected?: string | null;
  propLabelIssues?: PropLabelNormalizationAudit;
};

export type PropLabelNormalizationAudit = {
  propCandidates: number;
  withMarketKey: number;
  withMarketLabel: number;
  missingLabel: number;
};

let activeHandoffRequestId: string | null = null;
let handoffDeliveryAttempt = 0;

export function resetCoachHandoffDeliveryAttempt(requestId: string | null): void {
  if (requestId !== activeHandoffRequestId) {
    activeHandoffRequestId = requestId;
    handoffDeliveryAttempt = 0;
  }
}

export function nextCoachDeliveryAttempt(requestId?: string | null): number {
  if (requestId != null && requestId !== activeHandoffRequestId) {
    activeHandoffRequestId = requestId;
    handoffDeliveryAttempt = 0;
  }
  handoffDeliveryAttempt += 1;
  return handoffDeliveryAttempt;
}

export function coachHandoffSource(scan: { scanComplete?: boolean } | null | undefined): CoachHandoffSource {
  return boardScanIsComplete(scan) ? "final" : "preview";
}

export function auditPropLabelNormalization(picks: readonly ParsedPick[]): PropLabelNormalizationAudit {
  const propCandidates = picks.filter((p) => p.isProp);
  const withMarketKey = propCandidates.filter(
    (p) => !!(p.propMarketKey?.trim() || p.market?.trim()),
  ).length;
  const withMarketLabel = propCandidates.filter(
    (p) => !!(p.marketLabel?.trim() || p.market?.trim()),
  ).length;
  return {
    propCandidates: propCandidates.length,
    withMarketKey,
    withMarketLabel,
    missingLabel: Math.max(0, propCandidates.length - withMarketLabel),
  };
}

export function deriveCoachEmptyReason(opts: {
  scan: FullBoardScanResult | null | undefined;
  legTarget: number;
  candidateCount: number;
  pickCount: number;
  finalizeRejected?: string | null;
  scanReadyForDelivery?: boolean;
}): string | null {
  const { scan, legTarget, candidateCount, pickCount, finalizeRejected } = opts;
  if (pickCount > 0) return null;
  if (!scan) return "no-board-scan";
  if (!boardScanIsComplete(scan)) return "scan-in-progress";
  if (legTarget > 0 && !boardScanMatchesLegTarget(scan, legTarget)) {
    return `leg-target-mismatch:scan=${scan.requestedLegs ?? scan.picks.length}:ask=${legTarget}`;
  }
  if (finalizeRejected === "prefix-of-last-delivered") return "prefix-of-last-delivered";
  if (finalizeRejected === "empty") return "finalize-empty";
  if (candidateCount > 0) return "delivery-gates-stripped-candidates";
  if ((scan.totalQualified ?? 0) > 0) return "board-qualified-none-staged";
  return "board-exhausted-zero-qualified";
}

export function buildCoachFinalHandoffSnapshot(opts: {
  requestId?: string | null;
  scan?: FullBoardScanResult | null;
  pickCount: number;
  rendered: boolean;
  emptyReason?: string | null;
  finalizeRejected?: string | null;
  legTarget?: number;
  deliveryAttempt?: number;
}): CoachFinalHandoffSnapshot {
  const scan = opts.scan ?? null;
  const candidateCount = scan?.picks?.length ?? 0;
  const scanComplete = boardScanIsComplete(scan);
  const source = coachHandoffSource(scan);
  const legTarget = opts.legTarget ?? scan?.requestedLegs ?? 0;
  const emptyReason =
    opts.emptyReason ??
    deriveCoachEmptyReason({
      scan,
      legTarget,
      candidateCount,
      pickCount: opts.pickCount,
      finalizeRejected: opts.finalizeRejected ?? null,
      scanReadyForDelivery: scan ? boardScanReadyForDelivery(scan, legTarget) : false,
    });

  return {
    requestId: opts.requestId ?? scan?.requestId ?? null,
    scanComplete,
    source,
    candidateCount,
    pickCount: opts.pickCount,
    emptyReason,
    rendered: opts.rendered,
    ...(opts.deliveryAttempt != null ? { "delivery-attempt": opts.deliveryAttempt } : {}),
  };
}

export function logCoachDeliveryAttempt(detail: CoachDeliveryAttemptDetail): void {
  const attempt = nextCoachDeliveryAttempt(detail.requestId);
  console.log(
    "[coach-delivery-attempt]",
    JSON.stringify({
      ...detail,
      "delivery-attempt": attempt,
    }),
  );
}

export function logCoachRenderPicks(opts: {
  requestId?: string | null;
  scan?: FullBoardScanResult | null;
  pickCount: number;
  source: CoachHandoffSource;
  stage: string;
}): void {
  console.log(
    "[coach-render-picks]",
    JSON.stringify({
      requestId: opts.requestId ?? opts.scan?.requestId ?? null,
      scanComplete: boardScanIsComplete(opts.scan),
      source: opts.source,
      candidateCount: opts.scan?.picks?.length ?? 0,
      pickCount: opts.pickCount,
      stage: opts.stage,
      propLabelIssues: opts.scan?.picks?.length ? auditPropLabelNormalization(opts.scan.picks) : undefined,
    }),
  );
}

export function logCoachFinalHandoff(snapshot: CoachFinalHandoffSnapshot): void {
  console.log("[coach-final-handoff]", JSON.stringify(snapshot));
}

/** User-facing empty copy when a complete scan staged zero deliverable legs. */
export function coachFinalEmptyReply(scanComplete: boolean): string {
  if (!scanComplete) return "";
  return COACH_EMPTY_BOARD_SCAN_LEAD;
}