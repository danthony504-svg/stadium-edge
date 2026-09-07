import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Private, append-only model-quality evidence. Never exposed to clients. */
export const coachLearningRecommendationsTable = pgTable("coach_learning_recommendations", {
  id: text("id").primaryKey(),
  identity: text("identity").notNull().unique(),
  requestId: text("request_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sport: text("sport"),
  league: text("league"),
  providerEventId: text("provider_event_id"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  game: text("game").notNull(),
  player: text("player"),
  market: text("market").notNull(),
  selection: text("selection").notNull(),
  line: text("line"),
  odds: text("odds"),
  confidence: text("confidence"),
  edge: text("edge"),
  aiGrade: text("ai_grade"),
  simulationProbability: text("simulation_probability"),
  source: text("source").notNull(),
  baseModelVersion: text("base_model_version").notNull(),
  inputs: jsonb("inputs").notNull(),
  correlation: jsonb("correlation"),
  status: text("status").notNull().default("pending"),
  resultDetail: text("result_detail"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
}, (t) => [
  index("coach_learning_pending_idx").on(t.status, t.createdAt),
  index("coach_learning_sport_market_idx").on(t.sport, t.market, t.status),
]);
