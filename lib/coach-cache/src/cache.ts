import { COACH_SNAPSHOT_ROW_ID, type CoachSnapshot } from "@workspace/coach-types";

import { buildCoachSnapshot, type BuildCoachSnapshotInput } from "./build";
import { isSnapshotInstantServeable } from "./freshness";
import type { SnapshotStore } from "./store";

export type GetIfCurrentParams = {
  contextFingerprint: string;
  nowMs?: number;
  rowId?: string;
};

/**
 * Odds-fingerprint-keyed snapshot cache. A changed slate fingerprint invalidates
 * the stored snapshot — same model as leg-level sim cache.
 */
export class CoachSnapshotCache {
  private readonly store: SnapshotStore;

  constructor(store: SnapshotStore) {
    this.store = store;
  }

  async get(rowId = COACH_SNAPSHOT_ROW_ID): Promise<CoachSnapshot | null> {
    return this.store.get(rowId);
  }

  async put(snapshot: CoachSnapshot, rowId = COACH_SNAPSHOT_ROW_ID): Promise<void> {
    await this.store.set(snapshot, rowId);
  }

  snapshotMatchesFingerprint(snapshot: CoachSnapshot, contextFingerprint: string): boolean {
    return snapshot.fingerprint === contextFingerprint;
  }

  /** Hit when fingerprint matches and snapshot is still within instant-serve window. */
  async getIfCurrent(params: GetIfCurrentParams): Promise<CoachSnapshot | null> {
    const rowId = params.rowId ?? COACH_SNAPSHOT_ROW_ID;
    const nowMs = params.nowMs ?? Date.now();
    const cached = await this.store.get(rowId);
    if (!cached) return null;
    if (!this.snapshotMatchesFingerprint(cached, params.contextFingerprint)) return null;
    if (!isSnapshotInstantServeable(cached, nowMs)) return null;
    return cached;
  }

  async buildAndStore(
    input: BuildCoachSnapshotInput & { rowId?: string },
  ): Promise<CoachSnapshot> {
    const snapshot = buildCoachSnapshot(input);
    await this.store.set(snapshot, input.rowId ?? COACH_SNAPSHOT_ROW_ID);
    return snapshot;
  }
}
