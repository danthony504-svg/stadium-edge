import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { appPerformanceTable, db } from "@workspace/db";

import {
  isPerformanceSource,
  recommendationId,
  recommendationIdentity,
  utcDayStart,
  type RecommendationInput,
} from "../lib/appPerformance";
import { gradeLegs } from "./grade";
import { rateLimit } from "../lib/sports";

const router: IRouter = Router();
router.use("/sports/performance", rateLimit({ windowMs: 60_000, max: 120, name: "performance" }));

function userId(req: Request): string | null {
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

function validRecommendation(raw: unknown): raw is RecommendationInput {
  if (!raw || typeof raw !== "object") return false;
  const row = raw as Record<string, unknown>;
  return isPerformanceSource(row.source)
    && ["sport", "game", "market", "selection", "providerEventId"].every((key) => typeof row[key] === "string" && (row[key] as string).trim())
    && typeof row.odds === "number"
    && Number.isFinite(row.odds);
}

async function settlePending(user: string): Promise<void> {
  const pending = await db.select().from(appPerformanceTable)
    .where(and(eq(appPerformanceTable.userId, user), eq(appPerformanceTable.status, "pending")))
    .orderBy(asc(appPerformanceTable.startsAt)).limit(40);
  const ready = pending.filter((row) => row.startsAt && row.startsAt.getTime() < Date.now());
  if (!ready.length) return;
  const graded = await gradeLegs(ready.map((row) => ({
    game: row.game, market: row.market, pick: row.selection, sport: row.sport,
    odds: row.odds, startsAt: row.startsAt?.toISOString(),
  })));
  await Promise.all(graded.map(async (grade, index) => {
    const row = ready[index];
    if (!row) return;
    if (grade.result === "win" || grade.result === "loss" || grade.result === "push") {
      await db.update(appPerformanceTable)
        .set({ status: grade.result, resultDetail: grade.detail, settledAt: new Date() })
        .where(eq(appPerformanceTable.id, row.id));
    }
  }));
}

router.post("/sports/performance/capture", async (req, res) => {
  const user = userId(req);
  if (!user) return void res.status(401).json({ error: "auth required" });
  const rows = Array.isArray(req.body?.recommendations) ? req.body.recommendations : [];
  if (!rows.length || rows.length > 30 || !rows.every(validRecommendation)) {
    return void res.status(400).json({ error: "recommendations must be a 1..30 valid array" });
  }
  try {
    await db.insert(appPerformanceTable).values(rows.map((input: RecommendationInput) => ({
      id: recommendationId(user, input),
      userId: user,
      identity: recommendationIdentity(input),
      source: input.source,
      sport: input.sport.toLowerCase(),
      providerEventId: input.providerEventId,
      game: input.game,
      market: input.market,
      selection: input.selection,
      line: input.line ?? null,
      odds: input.odds,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      status: "pending",
    }))).onConflictDoNothing({ target: appPerformanceTable.id });
    res.status(201).json({ captured: rows.length });
  } catch (err) {
    req.log.error({ err }, "performance capture failed");
    res.status(503).json({ error: "performance ledger unavailable" });
  }
});

router.get("/sports/performance", async (req, res) => {
  const user = userId(req);
  if (!user) return void res.status(401).json({ error: "auth required" });
  try {
    await settlePending(user);
    const dayStart = utcDayStart();
    const [today, history] = await Promise.all([
      db.select().from(appPerformanceTable)
        .where(and(eq(appPerformanceTable.userId, user), gte(appPerformanceTable.createdAt, dayStart)))
        .orderBy(desc(appPerformanceTable.createdAt)),
      db.select().from(appPerformanceTable)
        .where(and(eq(appPerformanceTable.userId, user), inArray(appPerformanceTable.status, ["win", "loss", "push", "ungraded"])))
        .orderBy(desc(appPerformanceTable.settledAt)).limit(250),
    ]);
    res.json({ timezone: "UTC", dayStart: dayStart.toISOString(), today, history });
  } catch (err) {
    req.log.error({ err }, "performance ledger read failed");
    res.status(503).json({ error: "performance ledger unavailable" });
  }
});

export default router;
