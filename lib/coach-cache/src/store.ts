import { COACH_SNAPSHOT_ROW_ID, type CoachSnapshot } from "@workspace/coach-types";

/** Pluggable snapshot storage — Postgres adapter comes in runtime phase. */
export interface SnapshotStore {
  get(rowId?: string): Promise<CoachSnapshot | null>;
  set(snapshot: CoachSnapshot, rowId?: string): Promise<void>;
  delete(rowId?: string): Promise<boolean>;
  clear(): Promise<void>;
}

export class InMemorySnapshotStore implements SnapshotStore {
  private rows = new Map<string, CoachSnapshot>();

  async get(rowId = COACH_SNAPSHOT_ROW_ID): Promise<CoachSnapshot | null> {
    return this.rows.get(rowId) ?? null;
  }

  async set(snapshot: CoachSnapshot, rowId = COACH_SNAPSHOT_ROW_ID): Promise<void> {
    this.rows.set(rowId, snapshot);
  }

  async delete(rowId = COACH_SNAPSHOT_ROW_ID): Promise<boolean> {
    return this.rows.delete(rowId);
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }
}
