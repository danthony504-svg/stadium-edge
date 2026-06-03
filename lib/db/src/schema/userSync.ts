import { pgTable, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";

// Per-user cloud storage for app state that should follow a signed-in user
// across devices (e.g. saved bet slips, pick history). Keyed by the Clerk user
// id plus a namespace so each kind of data lives in its own row. `data` is an
// opaque JSON blob owned by the client; the server just persists/returns it.
export const userSyncTable = pgTable(
  "user_sync",
  {
    userId: text("user_id").notNull(),
    namespace: text("namespace").notNull(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.namespace] })],
);

export type UserSyncRow = typeof userSyncTable.$inferSelect;
