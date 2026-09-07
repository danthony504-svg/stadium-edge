import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { coachLearningRecommendationsTable, db } from "@workspace/db";
import { gradeLegs } from "../routes/grade";

type Pick = { game: string; market: string; selection: string; odds: string };
const PICK_LINE = /^PICK:\s*([^|]+)\|([^|]+)\|([^|]+)\|\s*([+-]?\d+)/gim;

export function parseCoachPicks(text: string): Pick[] {
  return Array.from(text.matchAll(PICK_LINE)).map((m) => ({
    game: m[1]!.trim(), market: m[2]!.trim(), selection: m[3]!.trim(), odds: m[4]!.trim(),
  }));
}

export function learningIdentity(pick: Pick, sport: string | null, eventId: string | null): string {
  return [sport ?? "unresolved", eventId ?? "unresolved", pick.market, pick.selection]
    .join("|").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Capture immutable model evidence without retaining a user identity or prompt text. */
export async function captureCoachLearning(
  text: string,
  options: { requestId?: string; inputs: Record<string, unknown>; baseModelVersion: string; source?: string },
): Promise<void> {
  const picks = parseCoachPicks(text);
  if (!picks.length) return;
  const requestId = options.requestId ?? randomUUID();
  // Server chat context does not currently retain provider event IDs in every
  // market row. Preserve that fact as unresolved rather than guessing one.
  await db.insert(coachLearningRecommendationsTable).values(picks.map((pick) => {
    const sport = typeof options.inputs.sport === "string" ? options.inputs.sport : null;
    const providerEventId = null;
    return {
      id: randomUUID(),
      identity: learningIdentity(pick, sport, providerEventId),
      requestId,
      sport,
      providerEventId,
      game: pick.game,
      market: pick.market,
      selection: pick.selection,
      odds: pick.odds,
      source: options.source ?? "coach",
      baseModelVersion: options.baseModelVersion,
      inputs: options.inputs,
      status: "pending",
    };
  })).onConflictDoNothing({ target: coachLearningRecommendationsTable.identity });
}

/** Fail-closed settlement; a missing sport/event remains ungraded with a reason. */
export async function settleCoachLearning(): Promise<void> {
  const rows = await db.select().from(coachLearningRecommendationsTable)
    .where(eq(coachLearningRecommendationsTable.status, "pending")).limit(40);
  for (const row of rows) {
    if (!row.sport || !row.providerEventId) {
      await db.update(coachLearningRecommendationsTable)
        .set({ status: "ungraded", resultDetail: "provider event identity unresolved", settledAt: new Date() })
        .where(eq(coachLearningRecommendationsTable.id, row.id));
      continue;
    }
    const [grade] = await gradeLegs([{ game: row.game, market: row.market, pick: row.selection, sport: row.sport }]);
    if (!grade || grade.result === "ungraded") continue;
    await db.update(coachLearningRecommendationsTable)
      .set({ status: grade.result, resultDetail: grade.detail, settledAt: new Date() })
      .where(eq(coachLearningRecommendationsTable.id, row.id));
  }
}
