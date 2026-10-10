import { eq } from "drizzle-orm";
import { coachPrecomputedSlateTable, db } from "@workspace/db";
import { logger } from "./logger.js";
import { normalizeCoachPrecomputedSlateRow } from "./coachSlateRow.js";
import {
  COACH_SLATE_ROW_ID,
  type SlatePreAnalysisSnapshot,
} from "./coachSlateTypes.js";

export { normalizeCoachPrecomputedSlateRow } from "./coachSlateRow.js";

export async function getCoachPrecomputedSlate(): Promise<{
  snapshot: SlatePreAnalysisSnapshot | null;
  fresh: boolean;
  instantServe: boolean;
  computedAt: string | null;
  deepSimComplete: boolean;
}> {
  try {
    const rows = await db
      .select()
      .from(coachPrecomputedSlateTable)
      .where(eq(coachPrecomputedSlateTable.id, COACH_SLATE_ROW_ID))
      .limit(1);
    return normalizeCoachPrecomputedSlateRow(rows[0]);
  } catch (err) {
    // Degrade to empty slate — callers must not 500 free-user Coach paths.
    logger.error({ err }, "coach slate: failed to read precomputed row");
    return {
      snapshot: null,
      fresh: false,
      instantServe: false,
      computedAt: null,
      deepSimComplete: false,
    };
  }
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
