import {
  pgTable,
  text,
  timestamp,
  serial,
  integer,
  index,
} from "drizzle-orm/pg-core";

/**
 * Bounded crash / reliability events from the mobile JS reporter.
 * No emails, tokens, or full API payloads — sanitized fields only.
 */
export const reliabilityEventsTable = pgTable(
  "reliability_events",
  {
    id: serial("id").primaryKey(),
    /** Stable crash fingerprint for dedupe / Telegram. */
    fingerprint: text("fingerprint").notNull(),
    severity: text("severity").notNull().default("critical"),
    errorMessage: text("error_message").notNull(),
    errorStack: text("error_stack"),
    componentStack: text("component_stack"),
    updateId: text("update_id"),
    runtimeVersion: text("runtime_version"),
    channel: text("channel"),
    appVersion: text("app_version"),
    bundleSource: text("bundle_source"),
    platform: text("platform"),
    /** Random anonymous session id from the client (not a user id). */
    sessionId: text("session_id"),
    clientTs: timestamp("client_ts", { withTimezone: true }),
    /** Count of duplicate reports folded into this row within the dedupe window. */
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("reliability_events_fingerprint_idx").on(t.fingerprint),
    index("reliability_events_created_at_idx").on(t.createdAt),
  ],
);

export type ReliabilityEventRow = typeof reliabilityEventsTable.$inferSelect;
export type InsertReliabilityEvent = typeof reliabilityEventsTable.$inferInsert;
