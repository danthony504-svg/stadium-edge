import type { CoachScanStatus } from "@workspace/coach-types";

export interface ScanStatusStore {
  get(): Promise<CoachScanStatus>;
  set(status: CoachScanStatus): Promise<void>;
}

export function createInitialScanStatus(nowMs = Date.now()): CoachScanStatus {
  return {
    jobRunning: false,
    manifest: null,
    lastError: null,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export class InMemoryScanStatusStore implements ScanStatusStore {
  private status: CoachScanStatus;

  constructor(initial?: CoachScanStatus) {
    this.status = initial ?? createInitialScanStatus();
  }

  async get(): Promise<CoachScanStatus> {
    return this.status;
  }

  async set(status: CoachScanStatus): Promise<void> {
    this.status = status;
  }
}
