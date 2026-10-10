import { eq } from "drizzle-orm";
import { coachPrecomputedSlateTable, db } from "@workspace/db";
import { logger } from "./logger.js";
import { normalizeCoachPrecomputedSlateRow } from "./coachSlateRow.js";
import { shouldPublishCoachSlateSnapshot } from "./coachSlatePublish.js";
import {
  COACH_SLATE_ROW_ID,
  type SlatePreAnalysisSnapshot,
} from "./coachSlateTypes.js";

export { normalizeCoachPrecomputedSlateRow } from "./coachSlateRow.js";
export { shouldPublishCoachSlateSnapshot } from "./coachSlatePublish.js";

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

/**
 * Atomically publish a complete slate snapshot to id=global.
 * Incomplete snapshots are rejected so a prior successful row is preserved.
 */
export async function persistCoachPrecomputedSlate(
  snapshot: SlatePreAnalysisSnapshot,
): Promise<void> {
  if (!shouldPublishCoachSlateSnapshot(snapshot)) {
    logger.info(
      { fingerprint: snapshot.fingerprint, deepSimComplete: snapshot.deepSimComplete },
      "coach slate: refusing to publish incomplete snapshot (preserving prior global row)",
    );
    return;
  }
  const now = new Date();
  await db
    .insert(coachPrecomputedSlateTable)
    .values({
      id: COACH_SLATE_ROW_ID,
      fingerprint: snapshot.fingerprint,
      data: snapshot,
      deepSimComplete: true,
      computedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: coachPrecomputedSlateTable.id,
      set: {
        fingerprint: snapshot.fingerprint,
        data: snapshot,
        deepSimComplete: true,
        computedAt: now,
        updatedAt: now,
      },
    });
}
