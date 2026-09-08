// Coach parlay build — idempotent terminal finalization after board scan / correlation.

import type { ParsedPick } from "../components/PickCard.tsx";

/** Max wait after correlation before forcing terminal state from the latest scan. */
export const COACH_BUILD_FINALIZE_WATCHDOG_MS = 3_000;

export type CoachFinalizeBuildResult = {
  requestId: string;
  sendGeneration: number;
  picks: ParsedPick[];
  legNote?: string;
  coachDetailNote?: string;
  legTarget?: number;
  correlationComplete?: boolean;
  fallbackUsed?: boolean;
};

let finalizedRequestIds = new Set<string>();
const latestResultsByRequestId = new Map<string, CoachFinalizeBuildResult>();
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogKey: string | null = null;

export function coachBuildFinalizeKey(sendGeneration: number, requestId: string): string {
  return `${sendGeneration}:${requestId}`;
}

export function coachBuildWasFinalized(
  sendGeneration: number,
  requestId?: string | null,
): boolean {
  if (!requestId) return false;
  return finalizedRequestIds.has(coachBuildFinalizeKey(sendGeneration, requestId));
}

export function markCoachBuildFinalized(sendGeneration: number, requestId: string): void {
  finalizedRequestIds.add(coachBuildFinalizeKey(sendGeneration, requestId));
}

export function getLatestCoachFinalizeResult(requestId: string): CoachFinalizeBuildResult | null {
  return latestResultsByRequestId.get(requestId) ?? null;
}

export function resetCoachBuildFinalization(): void {
  finalizedRequestIds.clear();
  latestResultsByRequestId.clear();
  disarmCoachBuildFinalizeWatchdog();
}

export function disarmCoachBuildFinalizeWatchdog(): void {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
    watchdogKey = null;
  }
}

/**
 * Arm a single 3s watchdog per request — fires once if finalization has not landed.
 * Does not restart the board scan.
 */
export function armCoachBuildFinalizeWatchdog(
  sendGeneration: number,
  requestId: string,
  onFire: () => void,
): void {
  if (coachBuildWasFinalized(sendGeneration, requestId)) return;
  const key = coachBuildFinalizeKey(sendGeneration, requestId);
  if (watchdogKey === key && watchdogTimer) return;
  disarmCoachBuildFinalizeWatchdog();
  watchdogKey = key;
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    watchdogKey = null;
    if (coachBuildWasFinalized(sendGeneration, requestId)) return;
    onFire();
  }, COACH_BUILD_FINALIZE_WATCHDOG_MS);
}

/** Final scan with a failed delivery gate must still terminate the in-flight build. */
export function shouldTerminateCoachBuildOnDeliveryGateFailure(
  isFinalScan: boolean,
  gateOk: boolean,
): boolean {
  return isFinalScan && !gateOk;
}

function logFinalize(meta: CoachFinalizeBuildResult, terminalStateCommitted: boolean): void {
  console.log("[coach-finalize] requestId", meta.requestId);
  if (meta.correlationComplete) console.log("[coach-finalize] correlationComplete");
  console.log("[coach-finalize] selectedPickCount", meta.picks.length);
  if (meta.fallbackUsed) console.log("[coach-finalize] fallbackUsed");
  console.log("[coach-finalize] terminalStateCommitted", terminalStateCommitted);
}

/**
 * Idempotent terminal commit — runs `commit` at most once per requestId + sendGeneration.
 * Stores the latest completed result for fallback finalization.
 */
export function finalizeCoachBuild(
  result: CoachFinalizeBuildResult,
  commit: () => void,
): boolean {
  if (result.requestId) {
    latestResultsByRequestId.set(result.requestId, result);
  }

  const key = result.requestId
    ? coachBuildFinalizeKey(result.sendGeneration, result.requestId)
    : "";
  if (key && finalizedRequestIds.has(key)) {
    console.log("[coach-finalize] skippedCommit alreadyFinalized", { requestId: result.requestId });
    logFinalize(result, true);
    return true;
  }

  commit();

  if (key) {
    finalizedRequestIds.add(key);
    disarmCoachBuildFinalizeWatchdog();
  }

  logFinalize(result, true);
  return true;
}
