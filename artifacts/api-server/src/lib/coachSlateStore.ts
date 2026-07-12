import { eq } from "drizzle-orm";
import { coachPrecomputedSlateTable, db } from "@workspace/db";
import {
  COACH_SLATE_ROW_ID,
  type SlatePreAnalysisSnapshot,
  isSlateSnapshotFresh,
  isSlateSnapshotInstantServe,
} from "./coachSlateTypes.js";

export async function getCoachPrecomputedSlate(): Promise<{
  snapshot: SlatePreAnalysisSnapshot | null;
  fresh: boolean;
  instantServe: boolean;
  computedAt: string | null;
  deepSimComplete: boolean;
}> {
  const rows = await db
    .select()
    .from(coachPrecomputedSlateTable)
    .where(eq(coachPrecomputedSlateTable.id, COACH_SLATE_ROW_ID))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { snapshot: null, fresh: false, instantServe: false, computedAt: null, deepSimComplete: false };
  }
  const snapshot = row.data as SlatePreAnalysisSnapshot;
  return {
    snapshot,
    fresh: isSlateSnapshotFresh(snapshot),
    instantServe: isSlateSnapshotInstantServe(snapshot),
    computedAt: row.computedAt.toISOString(),
    deepSimComplete: row.deepSimComplete,
  };
}

export async function persistCoachPrecomputedSlate(
  snapshot: SlatePreAnalysisSnapshot,
): Promise<void> {
  const now = new Date();
  await db
    .insert(coachPrecomputedSlateTable)
    .values({
      id: COACH_SLATE_ROW_ID,
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
