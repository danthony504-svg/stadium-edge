import { eq } from "drizzle-orm";
import { coachPrecomputedSlateTable, db } from "@workspace/db";
import { COACH_SNAPSHOT_ROW_ID, type CoachSnapshot } from "@workspace/coach-types";
import type { SnapshotStore } from "@workspace/coach-cache";

/** Persists v2 snapshots in the global coach_precomputed_slate row. */
export class PostgresCoachSnapshotStore implements SnapshotStore {
  async get(rowId = COACH_SNAPSHOT_ROW_ID): Promise<CoachSnapshot | null> {
    const rows = await db
      .select()
      .from(coachPrecomputedSlateTable)
      .where(eq(coachPrecomputedSlateTable.id, rowId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return row.data as CoachSnapshot;
  }

  async set(snapshot: CoachSnapshot, rowId = COACH_SNAPSHOT_ROW_ID): Promise<void> {
    const now = new Date();
    await db
      .insert(coachPrecomputedSlateTable)
      .values({
        id: rowId,
        fingerprint: snapshot.fingerprint,
        data: snapshot,
        deepSimComplete: snapshot.deepSimComplete,
        computedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: coachPrecomputedSlateTable.id,
        set: {
          fingerprint: snapshot.fingerprint,
          data: snapshot,
          deepSimComplete: snapshot.deepSimComplete,
          updatedAt: now,
        },
      });
  }

  async delete(rowId = COACH_SNAPSHOT_ROW_ID): Promise<boolean> {
    const result = await db
      .delete(coachPrecomputedSlateTable)
      .where(eq(coachPrecomputedSlateTable.id, rowId));
    return (result.rowCount ?? 0) > 0;
  }

  async clear(): Promise<void> {
    await db.delete(coachPrecomputedSlateTable).where(eq(coachPrecomputedSlateTable.id, COACH_SNAPSHOT_ROW_ID));
  }
}
