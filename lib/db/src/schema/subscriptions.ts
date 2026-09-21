import {
  pgTable,
  text,
  timestamp,
  serial,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Per-user Apple / RevenueCat subscription entitlement mirrored from the
 * client after purchase/restore, and from RevenueCat webhooks.
 */
export const subscriptionEntitlementsTable = pgTable(
  "subscription_entitlements",
  {
    userId: text("user_id").primaryKey(),
    /** free | go | pro — null/free means no paid Apple plan. */
    planId: text("plan_id").notNull().default("free"),
    /** App Store product id, e.g. com.stadiumedge.app.go.weekly */
    productId: text("product_id"),
    /** active | expired | cancelled | billing_issue | unknown */
    status: text("status").notNull().default("unknown"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    managementUrl: text("management_url"),
    /** RevenueCat / StoreKit original app user id when known. */
    originalAppUserId: text("original_app_user_id"),
    /** apple | revenuecat | client_sync */
    source: text("source").notNull().default("client_sync"),
    storeKitActive: boolean("store_kit_active").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type SubscriptionEntitlementRow =
  typeof subscriptionEntitlementsTable.$inferSelect;
export type InsertSubscriptionEntitlement =
  typeof subscriptionEntitlementsTable.$inferInsert;

/**
 * Idempotent log of webhook / sync events (RevenueCat notification id or
 * synthetic client sync key).
 */
export const subscriptionEventsTable = pgTable(
  "subscription_events",
  {
    id: serial("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    userId: text("user_id"),
    eventType: text("event_type").notNull(),
    payload: text("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("subscription_events_event_key_uidx").on(t.eventKey)],
);

export type SubscriptionEventRow = typeof subscriptionEventsTable.$inferSelect;
