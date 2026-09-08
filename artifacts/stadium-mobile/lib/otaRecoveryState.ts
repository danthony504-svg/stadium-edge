/**
 * Observable OTA recovery snapshot for on-device diagnostics.
 *
 * Mirrors otaLaunchLog: a tiny in-memory store with subscribers, no
 * expo-updates or React Native imports, so the pure updater core can report
 * into it and Node tests can read it back.
 */

export type OtaRecoverySnapshot = {
  runningUpdateId: string;
  availableUpdateId: string;
  /** Result of the last checkForUpdateAsync, verbatim reason included. */
  checkResult: string;
  /** Result of the last fetchUpdateAsync, or why it was not attempted. */
  fetchResult: string;
  pending: boolean;
  reloadBlocked: boolean;
  reloadBlockedReason: string;
  /** Target the next reload would launch. */
  reloadTargetId: string;
  /** Native or reconciled evidence that a specific update refuses to launch. */
  updatePreviouslyFailed: boolean;
  failedLaunchCount: number;
  rollbackState: string;
  lastError: string;
};

const EMPTY: OtaRecoverySnapshot = {
  runningUpdateId: "—",
  availableUpdateId: "—",
  checkResult: "not run yet",
  fetchResult: "not attempted",
  pending: false,
  reloadBlocked: false,
  reloadBlockedReason: "—",
  reloadTargetId: "—",
  updatePreviouslyFailed: false,
  failedLaunchCount: 0,
  rollbackState: "—",
  lastError: "—",
};

let snapshot: OtaRecoverySnapshot = { ...EMPTY };
const listeners = new Set<() => void>();

export function readOtaRecoverySnapshot(): OtaRecoverySnapshot {
  return snapshot;
}

export function reportOtaRecoveryState(patch: Partial<OtaRecoverySnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const fn of listeners) fn();
}

export function subscribeOtaRecoveryState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetOtaRecoveryStateForTests(): void {
  snapshot = { ...EMPTY };
}
