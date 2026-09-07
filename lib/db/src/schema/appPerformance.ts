import { index, pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-user ledger of recommendations actually delivered by Stadium Edge.
 *
 * `identity` is generated from source + sport + provider event id + market +
 * selection + line. It makes a repeated render idempotent without collapsing
 * the same market in a later fixture.
 */
export const appPerformanceTable = pgTable(
  "app_performance",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    identity: text("identity").notNull(),
    source: text("source").notNull(),
    sport: text("sport").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    game: text("game").notNull(),
    market: text("market").notNull(),
    selection: text("selection").notNull(),
    line: text("line"),
    odds: integer("odds").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("pending"),
    resultDetail: text("result_detail"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    index("app_performance_user_created_idx").on(table.userId, table.createdAt),
    index("app_performance_pending_idx").on(table.status, table.startsAt),
    index("app_performance_user_identity_idx").on(table.userId, table.identity),
  ],
);

export type AppPerformanceRow = typeof appPerformanceTable.$inferSelect;
