// Board-scan lifecycle — timeout, final publish, and request-scoped result stash.

import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { boardScanIsComplete } from "./coachScanPolicy.ts";
import { logCoachPickDiag } from "./coachPickDiagnostics.ts";
import { traceCoachPath } from "./coachPathTrace.ts";
import { emptyReasonForScan } from "./coachEmptyScanTerminal.ts";

/** Hard wall-clock cap — scan must publish scanComplete=true before this. */
export function boardScanHardTimeoutMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 180_000;
  if (requestedLegs >= 9) return 150_000;
  return 120_000;
}

export function logScanStart(requestId: string, requestedLegs: number): number {
  const startedAt = Date.now();
  logCoachPickDiag("scan-start", { requestId, requestedLegs });
  traceCoachPath("SCAN_STARTED", { requestId, requestedLegs });
  return startedAt;
}

export function logScanFinalPublished(
  result: FullBoardScanResult,
  startedAt: number,
  extra?: Record<string, unknown>,
): void {
  logCoachPickDiag("scan-final-published", {
    requestId: result.requestId,
    scanComplete: true,
    pickCount: result.picks.length,
    emptyReason: result.picks.length ? undefined : emptyReasonForScan(result),
    durationMs: Date.now() - startedAt,
    combinatorSource: result.combinatorMeta?.source ?? "final",
    ...extra,
  });
}

export function logScanTerminalTimeout(requestId: string, startedAt: number): void {
  logCoachPickDiag("scan-terminal-timeout", {
    requestId,
    durationMs: Date.now() - startedAt,
  });
  traceCoachPath("SCAN_TIMEOUT", { requestId, durationMs: Date.now() - startedAt });
}

export function logDeliveryPoll(
  requestId: string | undefined,
  scan: FullBoardScanResult | null | undefined,
): void {
  logCoachPickDiag("delivery-poll", {
    requestId,
    source: scan?.combinatorMeta?.source ?? (scan?.scanComplete ? "final" : "preview"),
    scanComplete: scan?.scanComplete ?? false,
    pickCount: scan?.picks?.length ?? 0,
  });
}

/** In-memory final results keyed by Coach requestId — delivery poller reads this first. */
export type BoardScanFinalRegistry = Map<string, FullBoardScanResult>;

export function stashBoardScanFinal(
  registry: BoardScanFinalRegistry,
  result: FullBoardScanResult,
): FullBoardScanResult | null {
  if (!boardScanIsComplete(result) || !result.requestId) return null;
  registry.set(result.requestId, result);
  return result;
}

export function readBoardScanFinal(
  registry: BoardScanFinalRegistry,
  requestId: string | undefined,
  ...fallbacks: (FullBoardScanResult | null | undefined)[]
): FullBoardScanResult | null {
  if (requestId) {
    const stashed = registry.get(requestId);
    if (stashed && boardScanIsComplete(stashed)) return stashed;
  }
  for (const scan of fallbacks) {
    if (scan && boardScanIsComplete(scan)) return scan;
  }
  for (const scan of fallbacks) {
    if (scan) return scan;
  }
  return null;
}

export function linkAbortSignals(
  parent: AbortSignal | undefined,
  child: AbortController,
): () => void {
  if (!parent) return () => {};
  if (parent.aborted) {
    child.abort();
    return () => {};
  }
  const onAbort = () => child.abort();
  parent.addEventListener("abort", onAbort);
  return () => parent.removeEventListener("abort", onAbort);
}
