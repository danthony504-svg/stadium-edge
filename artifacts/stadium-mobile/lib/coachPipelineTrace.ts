/** Structured pipeline trace logs — each tag marks a mandatory handoff point. */

function log(tag: string, payload: Record<string, unknown>): void {
  console.log(tag, JSON.stringify(payload));
}

export function logPipelineCorrelationStart(
  requestId: string,
  extra?: Record<string, unknown>,
): void {
  log("[coach-pipeline] correlation-start", { requestId, ...extra });
}

export function logPipelineCorrelationTimeoutFired(
  requestId: string,
  durationMs: number,
  extra?: Record<string, unknown>,
): void {
  log("[coach-pipeline] correlation-timeout-fired", { requestId, durationMs, ...extra });
}

export function logPipelineFallbackBuilderStart(
  requestId: string,
  extra?: Record<string, unknown>,
): void {
  log("[coach-pipeline] fallback-builder-start", { requestId, ...extra });
}

export function logPipelineFallbackBuilderComplete(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
  extra?: Record<string, unknown>,
): void {
  log("[coach-pipeline] fallback-builder-complete", {
    requestId,
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
  log("[coach-pipeline] final-ticket-build-start", {
    requestId,
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
  log("[coach-pipeline] final-ticket-build-complete", {
    requestId,
    pickCount,
    requestedLegCount,
    ...extra,
  });
}

export function logPipelineComplete(
  requestId: string,
  extra?: Record<string, unknown>,
): void {
  log("[coach-pipeline] pipeline-complete", { requestId, ...extra });
}

export function logCoachTicketRenderComplete(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
): void {
  log("[coach-ticket] render-complete", { requestId, pickCount, requestedLegCount });
}

export function logPipelineProgressBumpRejected(
  stageId: string,
  requestId: string,
  expectedRequestId: string | undefined,
  sendGen: number,
  expectedSendGen: number | undefined,
): void {
  log("[coach-pipeline] progress-bump-rejected", {
    stageId,
    requestId,
    expectedRequestId,
    sendGen,
    expectedSendGen,
  });
}
