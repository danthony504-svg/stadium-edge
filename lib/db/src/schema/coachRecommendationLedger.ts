import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Immutable recommendation-time ledger for AI Coach. Capture fields are
 * inserted once and must never be rewritten as prices or model inputs change.
 * Only settlement columns may transition from pending to a terminal result.
 */
export const coachRecommendationSnapshotsTable = pgTable(
  "coach_recommendation_snapshots",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    requestId: text("request_id"),
    buildId: text("build_id"),
    ticketId: text("ticket_id"),
    deliveryKind: text("delivery_kind"),
    sport: text("sport").notNull(),
    league: text("league"),
    eventId: text("event_id"),
    game: text("game").notNull(),
    player: text("player"),
    position: text("position"),
    market: text("market").notNull(),
    side: text("side"),
    line: doublePrecision("line"),
    sportsbook: text("sportsbook"),
    odds: integer("odds").notNull(),
    impliedProbability: doublePrecision("implied_probability"),
    noVigProbability: doublePrecision("no_vig_probability"),
    modelProjection: doublePrecision("model_projection"),
    simulationProbability: doublePrecision("simulation_probability"),
    simulationSampleSize: integer("simulation_sample_size"),
    simulationMean: doublePrecision("simulation_mean"),
    simulationMedian: doublePrecision("simulation_median"),
    confidencePct: doublePrecision("confidence_pct"),
    edgePct: doublePrecision("edge_pct"),
    evPct: doublePrecision("ev_pct"),
    aiGrade: text("ai_grade"),
    dataTier: text("data_tier"),
    dataCompletenessPct: doublePrecision("data_completeness_pct"),
    correlationScore: doublePrecision("correlation_score"),
    includedInParlay: boolean("included_in_parlay").notNull().default(false),
    isProp: boolean("is_prop").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    snapshot: jsonb("snapshot").notNull(),
    qualificationMetadata: jsonb("qualification_metadata"),
    status: text("status").notNull().default("pending"),
    actualResult: jsonb("actual_result"),
    gradeDetail: text("grade_detail"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("coach_recommendation_user_id_key").on(table.userId, table.id),
    index("coach_recommendation_pending_settlement").on(table.status, table.startsAt),
    index("coach_recommendation_user_captured").on(table.userId, table.capturedAt),
    index("coach_recommendation_user_settled").on(table.userId, table.settledAt),
  ],
);

export type CoachRecommendationSnapshotRow =
  typeof coachRecommendationSnapshotsTable.$inferSelect;
