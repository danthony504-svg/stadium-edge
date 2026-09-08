/**
 * Production-safe OTA recovery status — in-memory only, for the diagnostics banner
 * and updater coordination. No product/UI feature state.
 */

export type OtaRecoveryStatus = {
  runningUpdateId: string;
  availableUpdateId: string;
  fetchResult: string;
  pending: boolean;
  reloadBlocked: boolean;
  lastOtaError: string;
  checkReason: string;
  isEmergencyLaunch: boolean;
  rollbackCommitTime: string;
};

const DEFAULT: OtaRecoveryStatus = {
  runningUpdateId: "—",
  availableUpdateId: "—",
  fetchResult: "—",
  pending: false,
  reloadBlocked: false,
  lastOtaError: "—",
  checkReason: "—",
  isEmergencyLaunch: false,
  rollbackCommitTime: "—",
};

let status: OtaRecoveryStatus = { ...DEFAULT };
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function getOtaRecoveryStatus(): OtaRecoveryStatus {
  return status;
}

export function subscribeOtaRecoveryStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function patchOtaRecoveryStatus(patch: Partial<OtaRecoveryStatus>): void {
  status = { ...status, ...patch };
  notify();
}

export function resetOtaRecoveryStatusForTests(): void {
  status = { ...DEFAULT };
  listeners.clear();
}
