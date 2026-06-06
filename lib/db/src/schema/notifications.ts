import { pgTable, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";

// Expo push tokens — one row per device. A signed-in user may have several
// (phone, tablet). Keyed by the token itself so a device that re-registers just
// updates its owner/timestamp instead of creating duplicates.
export const pushTokensTable = pgTable("push_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  platform: text("platform"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PushTokenRow = typeof pushTokensTable.$inferSelect;

// Idempotency log so a notification is sent EXACTLY ONCE even though the cron
// endpoint may run on different autoscale instances / repeated ticks. The
// dedupeKey encodes the trigger + subject, e.g. "reminder:<userId>:<gameId>"
// or "result:<userId>:<slipId>". Composite PK = at-most-once per (user, key);
// inserts use onConflictDoNothing.
export const notifLogTable = pgTable(
  "notif_log",
  {
    userId: text("user_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.dedupeKey] })],
);

export type NotifLogRow = typeof notifLogTable.$inferSelect;

// Small durable key/value store for cron state that must survive across
// autoscale instances: last-seen odds snapshots (for line-movement detection)
// and the most recent daily-picks send date. `value` is an opaque JSON blob.
export const appKvTable = pgTable("app_kv", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AppKvRow = typeof appKvTable.$inferSelect;
