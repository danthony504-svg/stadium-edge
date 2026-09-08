/** Structured pipeline trace logs — each tag marks a mandatory handoff point. */

import { assertCoachScanRequestId } from "./coachScanPipeline.ts";

export type CoachPipelineLogPhase =
  | "EV_CALCULATION"
  | "LINE_VALUE"
  | "SIMULATIONS"
  | "SCORING_CORRELATION"
  | "CORRELATION_TIMEOUT_FALLBACK"
  | "BUILDING_FINAL_TICKET"
  | "FINAL_TICKET_READY"
  | "COMPLETE"
  | "BOARD_SCAN";

export type CoachPipelineEventPayload = {
  requestId: string;
  phase: CoachPipelineLogPhase | string;
  elapsedMs: number;
  candidateCount?: number;
  [key: string]: unknown;
};

function log(tag: string, payload: CoachPipelineEventPayload): void {
  assertCoachScanRequestId(payload.requestId, tag);
  console.log(tag, JSON.stringify(payload));
}

export function logCoachPipelineEvent(
  tag: string,
  payload: CoachPipelineEventPayload,
): void {
  log(tag, payload);
}

export function logCoachPipelineError(
  tag: string,
  payload: CoachPipelineEventPayload,
): void {
  assertCoachScanRequestId(payload.requestId, tag);
  console.error(tag, JSON.stringify(payload));
}

export function logPipelineCorrelationStart(
  requestId: string,
  extra?: Record<string, unknown>,
): void {
  logCoachPipelineEvent("[coach-pipeline] correlation-start", {
    requestId,
    phase: "SCORING_CORRELATION",
    elapsedMs: 0,
    candidateCount: typeof extra?.poolSize === "number" ? extra.poolSize : undefined,
    ...extra,
  });
}

export function logPipelineCorrelationTimeoutFired(
  requestId: string,
  durationMs: number,
  extra?: Record<string, unknown>,
): void {
  logCoachPipelineEvent("[coach-pipeline] correlation-timeout-fired", {
    requestId,
    phase: "CORRELATION_TIMEOUT_FALLBACK",
    elapsedMs: durationMs,
    candidateCount: typeof extra?.candidateCount === "number" ? extra.candidateCount : undefined,
    ...extra,
  });
}

export function logPipelineFallbackBuilderStart(
  requestId: string,
  extra?: Record<string, unknown>,
): void {
  logCoachPipelineEvent("[coach-pipeline] fallback-builder-start", {
    requestId,
    phase: "CORRELATION_TIMEOUT_FALLBACK",
    elapsedMs: typeof extra?.elapsedMs === "number" ? extra.elapsedMs : 0,
    candidateCount: typeof extra?.poolSize === "number" ? extra.poolSize : undefined,
    ...extra,
  });
}

export function logPipelineFallbackBuilderComplete(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
  extra?: Record<string, unknown>,
): void {
  logCoachPipelineEvent("[coach-pipeline] fallback-builder-complete", {
    requestId,
    phase: "CORRELATION_TIMEOUT_FALLBACK",
    elapsedMs: typeof extra?.elapsedMs === "number" ? extra.elapsedMs : 0,
    candidateCount: pickCount,
    pickCount,
    requestedLegCount,
    ...extra,
  });
}

export function logPipelineFinalTicketBuildStart(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
  extra?: Record<string, unknown>,
): void {
  logCoachPipelineEvent("[coach-pipeline] final-ticket-build-start", {
    requestId,
    phase: "BUILDING_FINAL_TICKET",
    elapsedMs: typeof extra?.elapsedMs === "number" ? extra.elapsedMs : 0,
    candidateCount: pickCount,
    pickCount,
    requestedLegCount,
    ...extra,
  });
}

export function logPipelineFinalTicketBuildComplete(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
  extra?: Record<string, unknown>,
): void {
  logCoachPipelineEvent("[coach-pipeline] final-ticket-build-complete", {
    requestId,
    phase: "FINAL_TICKET_READY",
    elapsedMs: typeof extra?.elapsedMs === "number" ? extra.elapsedMs : 0,
    candidateCount: pickCount,
    pickCount,
    requestedLegCount,
    ...extra,
  });
}

export function logPipelineComplete(
  requestId: string,
  extra?: Record<string, unknown>,
): void {
  logCoachPipelineEvent("[coach-pipeline] pipeline-complete", {
    requestId,
    phase: "COMPLETE",
    elapsedMs: typeof extra?.durationMs === "number" ? extra.durationMs : 0,
    candidateCount:
      typeof extra?.pickCount === "number"
        ? extra.pickCount
        : typeof extra?.candidateCount === "number"
          ? extra.candidateCount
          : undefined,
    ...extra,
  });
}

export function logCoachTicketRenderComplete(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
): void {
  logCoachPipelineEvent("[coach-ticket] render-complete", {
    requestId,
    phase: "COMPLETE",
    elapsedMs: 0,
    candidateCount: pickCount,
    pickCount,
    requestedLegCount,
  });
}

export function logPipelineProgressBumpRejected(
  stageId: string,
  requestId: string,
  expectedRequestId: string | undefined,
  sendGen: number,
  expectedSendGen: number | undefined,
): void {
  logCoachPipelineError("[coach-pipeline] progress-bump-rejected", {
    requestId,
    phase: stageId,
    elapsedMs: 0,
    expectedRequestId,
    sendGen,
    expectedSendGen,
  });
}
