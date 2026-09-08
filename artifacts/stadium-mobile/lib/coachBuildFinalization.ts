// Coach parlay build — idempotent terminal finalization after board scan / correlation.

/** Max wait after correlation before forcing terminal state from the latest scan. */
export const COACH_BUILD_FINALIZE_WATCHDOG_MS = 3_000;

let finalizedRequestIds = new Set<string>();
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

export function resetCoachBuildFinalization(): void {
  finalizedRequestIds.clear();
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
