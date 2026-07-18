/** Stage tracing for Coach board-scan ticket staging (line-value → correlation). */

import { clearCoachPipelineState } from "./coachPipelineStateMachine.ts";
import type {
  CoachBuildProgressCallback,
  CoachBuildStageId,
  ParlayBuildPhase,
} from "./coachBuildProgress.ts";

export const COACH_CORRELATION_TIMEOUT_MS = 3_000;

export type CoachScanPhaseCallback = (
  phase: ParlayBuildPhase,
  requestId: string,
) => void;

export class CoachCorrelationStageError extends Error {
  readonly requestId: string;
  readonly durationMs: number;
  readonly timedOut: boolean;

  constructor(
    message: string,
    opts: { requestId: string; durationMs: number; timedOut?: boolean; cause?: unknown },
  ) {
    super(message, opts.cause != null ? { cause: opts.cause } : undefined);
    this.name = "CoachCorrelationStageError";
    this.requestId = opts.requestId;
    this.durationMs = opts.durationMs;
    this.timedOut = opts.timedOut === true;
  }
}

let activeRequestId: string | null = null;
const settledCorrelationRequestIds = new Set<string>();

export function coachPipelineIsDev(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.__DEV__ === "boolean") return g.__DEV__;
  return process.env.NODE_ENV !== "production";
}

export function activeCoachScanRequestId(): string | null {
  return activeRequestId;
}

/** Throw in development when requestId is missing — never emit events as "unknown". */
export function assertCoachScanRequestId(
  requestId: string | null | undefined,
  source: string,
): asserts requestId is string {
  const id = requestId?.trim();
  if (id && id !== "unknown") return;
  const msg = `[coach-scan] missing requestId at ${source} (active=${activeRequestId ?? "none"})`;
  if (coachPipelineIsDev()) {
    throw new Error(msg);
  }
  console.error(msg);
}

/** Resolve explicit requestId or fall back to the active scan pipeline id. */
export function resolveCoachScanRequestId(
  explicit?: string | null,
  source = "resolveCoachScanRequestId",
): string {
  const id = explicit?.trim() || activeRequestId?.trim() || "";
  if (!id || id === "unknown") {
    assertCoachScanRequestId(id, source);
    return activeRequestId ?? explicit ?? id;
  }
  return id;
}

export function beginCoachScanPipeline(requestId: string): void {
  assertCoachScanRequestId(requestId, "beginCoachScanPipeline");
  activeRequestId = requestId;
  for (const id of settledCorrelationRequestIds) {
    if (id !== requestId) settledCorrelationRequestIds.delete(id);
  }
}

export function clearCoachScanPipeline(requestId?: string): void {
  if (!requestId || activeRequestId === requestId) {
    activeRequestId = null;
  }
  if (requestId) {
    settledCorrelationRequestIds.delete(requestId);
    clearCoachPipelineState(requestId);
  }
}

/** Claim correlation completion for a request — rejects stale/duplicate late results. */
export function claimCoachCorrelationCompletion(requestId: string): boolean {
  if (coachScanPipelineIsStale(requestId)) return false;
  if (settledCorrelationRequestIds.has(requestId)) return false;
  settledCorrelationRequestIds.add(requestId);
  return true;
}

export function coachCorrelationAlreadySettled(requestId: string): boolean {
  return settledCorrelationRequestIds.has(requestId);
}

export function coachScanPipelineIsStale(requestId: string | undefined): boolean {
  if (!requestId) return false;
  return activeRequestId != null && activeRequestId !== requestId;
}

function logJson(tag: string, payload: Record<string, unknown>): void {
  console.log(tag, JSON.stringify(payload));
}

export function logCoachScanLineValueStart(requestId: string): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-scan] line-value-start", { requestId });
}

export function logCoachScanLineValueComplete(
  requestId: string,
  inputCount: number,
  outputCount: number,
  durationMs: number,
  onProgress?: CoachBuildProgressCallback,
): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-scan] line-value-complete", {
    requestId,
    inputCount,
    outputCount,
    durationMs,
  });
  onProgress?.("line-value", requestId);
}

export function logCoachScanCorrelationStart(
  requestId: string,
  candidateCount: number,
  onPhase?: CoachScanPhaseCallback,
  _onProgress?: CoachBuildProgressCallback,
): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-scan] correlation-start", { requestId, candidateCount });
  onPhase?.("stream", requestId);
}

export function logCoachScanCorrelationComplete(
  requestId: string,
  inputCount: number,
  outputCount: number,
  durationMs: number,
  onPhase?: CoachScanPhaseCallback,
  onProgress?: CoachBuildProgressCallback,
  extra?: {
    candidateTicketCount?: number;
    correlationsScored?: number;
    exceptions?: string[];
    usedFallback?: boolean;
    timedOut?: boolean;
  },
): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-scan] correlation-complete", {
    requestId,
    inputCount,
    outputCount,
    durationMs,
    candidateTicketCount: extra?.candidateTicketCount,
    correlationsScored: extra?.correlationsScored,
    exceptions: extra?.exceptions?.length ? extra.exceptions : undefined,
    usedFallback: extra?.usedFallback,
    timedOut: extra?.timedOut,
  });
  onPhase?.("score", requestId);
}

export function logCoachScanCorrelationError(
  requestId: string,
  err: unknown,
  durationMs: number,
): never {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(
    "[coach-scan] correlation-error",
    JSON.stringify({ requestId, message, durationMs }),
  );
  if (stack) console.error(stack);
  throw new CoachCorrelationStageError(message, {
    requestId,
    durationMs,
    cause: err,
  });
}

export function logCoachScanCorrelationTimeout(
  requestId: string,
  durationMs: number,
): never {
  console.error(
    "[coach-scan] correlation-timeout",
    JSON.stringify({ requestId, durationMs }),
  );
  throw new CoachCorrelationStageError(
    `Correlation scoring timed out after ${durationMs}ms`,
    { requestId, durationMs, timedOut: true },
  );
}

export function correlationDeadline(deadlineMs = COACH_CORRELATION_TIMEOUT_MS): number {
  return Date.now() + deadlineMs;
}

export function correlationTimedOut(deadlineAt: number): boolean {
  return Date.now() >= deadlineAt;
}

/** True when correlation scoring should be skipped (too few legs to diversify). */
export function shouldSkipCorrelationScoring(
  candidateCount: number,
  target: number,
  minCandidates = Math.max(target + 2, 3),
): boolean {
  return candidateCount < minCandidates;
}
