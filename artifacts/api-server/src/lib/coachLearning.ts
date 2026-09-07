import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { coachLearningRecommendationsTable, db } from "@workspace/db";
import { gradeLegs } from "../routes/grade";
import { ESPN_SPORT_PATHS } from "./sports";
import { classifyLearningSettlement, learningIdentity, parseCoachPicks } from "./coachLearningCore";

export { learningIdentity, parseCoachPicks } from "./coachLearningCore";

/** Capture immutable model evidence without retaining a user identity or prompt text. */
export async function captureCoachLearning(
  text: string,
  options: { requestId?: string; inputs: Record<string, unknown>; baseModelVersion: string; source?: string },
): Promise<void> {
  const picks = parseCoachPicks(text);
  if (!picks.length) return;
  const requestId = options.requestId ?? randomUUID();
  const realGames = Array.isArray(options.inputs.realGames) ? options.inputs.realGames : [];
  await db.insert(coachLearningRecommendationsTable).values(picks.map((pick) => {
    const game = realGames.find((row): row is Record<string, unknown> =>
      !!row && typeof row === "object" && row.game === pick.game,
    );
    const sport = typeof game?.sport === "string" ? game.sport : null;
    // Missing/ambiguous metadata stays null; a server must never fabricate an ID.
    const providerEventId = typeof game?.providerEventId === "string" ? game.providerEventId : null;
    return {
      id: randomUUID(),
      identity: learningIdentity(pick, sport, providerEventId),
      requestId,
      sport,
      providerEventId,
      startsAt: typeof game?.startsAt === "string" ? new Date(game.startsAt) : null,
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

async function providerStatus(sport: string, eventId: string, startsAt: Date | null): Promise<string | null> {
  const path = ESPN_SPORT_PATHS[sport];
  if (!path || !startsAt || !Number.isFinite(startsAt.getTime())) return null;
  const day = startsAt.toISOString().slice(0, 10).replaceAll("-", "");
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}&limit=300`);
  if (!response.ok) return null;
  const body = await response.json() as { events?: Array<{ id?: string; status?: { type?: { name?: string; detail?: string } }; competitions?: Array<{ status?: { type?: { name?: string; detail?: string } } }> }> };
  const event = body.events?.find((candidate) => candidate.id === eventId);
  return event?.competitions?.[0]?.status?.type?.detail ?? event?.competitions?.[0]?.status?.type?.name
    ?? event?.status?.type?.detail ?? event?.status?.type?.name ?? null;
}

/** Fail-closed settlement; a missing sport/event remains ungraded with a reason. */
export async function settleCoachLearning(): Promise<void> {
  const rows = await db.select().from(coachLearningRecommendationsTable)
    .where(eq(coachLearningRecommendationsTable.status, "pending")).limit(40);
  for (const row of rows) {
    if (!row.sport || !row.providerEventId) {
      await db.update(coachLearningRecommendationsTable)
        .set({ status: "ungraded", resultDetail: "provider event identity unresolved", settledAt: new Date() })
        .where(and(eq(coachLearningRecommendationsTable.id, row.id), eq(coachLearningRecommendationsTable.status, "pending")));
      continue;
    }
    const status = await providerStatus(row.sport, row.providerEventId, row.startsAt);
    const [grade] = await gradeLegs([{ game: row.game, market: row.market, pick: row.selection, sport: row.sport, startsAt: row.startsAt?.toISOString() }]);
    const settlement = classifyLearningSettlement(status, grade ?? null);
    if (settlement.status === "ungraded" && !status) continue;
    await db.update(coachLearningRecommendationsTable)
      .set({ status: settlement.status, resultDetail: settlement.reason, settledAt: new Date() })
      .where(and(eq(coachLearningRecommendationsTable.id, row.id), eq(coachLearningRecommendationsTable.status, "pending")));
  }
}
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { coachLearningRecommendationsTable, db } from "@workspace/db";
import { gradeLegs } from "../routes/grade";
import { ESPN_SPORT_PATHS } from "./sports";
import { classifyLearningSettlement, learningIdentity, parseCoachPicks } from "./coachLearningCore";

export { learningIdentity, parseCoachPicks } from "./coachLearningCore";

/** Capture immutable model evidence without retaining a user identity or prompt text. */
export async function captureCoachLearning(
  text: string,
  options: { requestId?: string; inputs: Record<string, unknown>; baseModelVersion: string; source?: string },
): Promise<void> {
  const picks = parseCoachPicks(text);
  if (!picks.length) return;
  const requestId = options.requestId ?? randomUUID();
  const realGames = Array.isArray(options.inputs.realGames) ? options.inputs.realGames : [];
  await db.insert(coachLearningRecommendationsTable).values(picks.map((pick) => {
    const game = realGames.find((row): row is Record<string, unknown> =>
      !!row && typeof row === "object" && row.game === pick.game,
    );
    const sport = typeof game?.sport === "string" ? game.sport : null;
    // Missing/ambiguous metadata stays null; a server must never fabricate an ID.
    const providerEventId = typeof game?.providerEventId === "string" ? game.providerEventId : null;
    return {
      id: randomUUID(),
      identity: learningIdentity(pick, sport, providerEventId),
      requestId,
      sport,
      providerEventId,
      startsAt: typeof game?.startsAt === "string" ? new Date(game.startsAt) : null,
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

async function providerStatus(sport: string, eventId: string, startsAt: Date | null): Promise<string | null> {
  const path = ESPN_SPORT_PATHS[sport];
  if (!path || !startsAt || !Number.isFinite(startsAt.getTime())) return null;
  const day = startsAt.toISOString().slice(0, 10).replaceAll("-", "");
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}&limit=300`);
  if (!response.ok) return null;
  const body = await response.json() as { events?: Array<{ id?: string; status?: { type?: { name?: string; detail?: string } }; competitions?: Array<{ status?: { type?: { name?: string; detail?: string } } }> }> };
  const event = body.events?.find((candidate) => candidate.id === eventId);
  return event?.competitions?.[0]?.status?.type?.detail ?? event?.competitions?.[0]?.status?.type?.name
    ?? event?.status?.type?.detail ?? event?.status?.type?.name ?? null;
}

/** Fail-closed settlement; a missing sport/event remains ungraded with a reason. */
export async function settleCoachLearning(): Promise<void> {
  const rows = await db.select().from(coachLearningRecommendationsTable)
    .where(eq(coachLearningRecommendationsTable.status, "pending")).limit(40);
  for (const row of rows) {
    if (!row.sport || !row.providerEventId) {
      await db.update(coachLearningRecommendationsTable)
        .set({ status: "ungraded", resultDetail: "provider event identity unresolved", settledAt: new Date() })
        .where(and(eq(coachLearningRecommendationsTable.id, row.id), eq(coachLearningRecommendationsTable.status, "pending")));
      continue;
    }
    const status = await providerStatus(row.sport, row.providerEventId, row.startsAt);
    const [grade] = await gradeLegs([{ game: row.game, market: row.market, pick: row.selection, sport: row.sport, startsAt: row.startsAt?.toISOString() }]);
    const settlement = classifyLearningSettlement(status, grade ?? null);
    if (settlement.status === "ungraded" && !status) continue;
    await db.update(coachLearningRecommendationsTable)
      .set({ status: settlement.status, resultDetail: settlement.reason, settledAt: new Date() })
      .where(and(eq(coachLearningRecommendationsTable.id, row.id), eq(coachLearningRecommendationsTable.status, "pending")));
  }
}
