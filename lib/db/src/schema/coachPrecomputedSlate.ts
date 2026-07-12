import { pgTable, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

/** Global 24/7 AI Coach slate pre-analysis snapshot (one row, latest-wins). */
export const coachPrecomputedSlateTable = pgTable("coach_precomputed_slate", {
  id: text("id").primaryKey().default("global"),
  fingerprint: text("fingerprint").notNull(),
  /** Full SlatePreAnalysisSnapshot JSON — compatible with mobile slatePreAnalysisCache. */
  data: jsonb("data").notNull(),
  deepSimComplete: boolean("deep_sim_complete").notNull().default(false),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CoachPrecomputedSlateRow = typeof coachPrecomputedSlateTable.$inferSelect;
