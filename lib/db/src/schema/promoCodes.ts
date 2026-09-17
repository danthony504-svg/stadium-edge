import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  serial,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Server-backed promo catalog. Codes are uppercase; redeem windows and unlock
 * kinds mirror the mobile preview entitlements, with global max_redemptions.
 */
export const promoCodesTable = pgTable("promo_codes", {
  code: text("code").primaryKey(),
  /** lifetime | days | until */
  kind: text("kind").notNull(),
  /** For kind=days — access length after redeem. */
  days: integer("days"),
  /** For kind=until — hard calendar end of access. */
  unlockUntil: timestamp("unlock_until", { withTimezone: true }),
  /** Earliest redeem time (inclusive). Null = anytime. */
  redeemFrom: timestamp("redeem_from", { withTimezone: true }),
  /** Latest redeem time (exclusive). Null = no deadline. */
  redeemUntil: timestamp("redeem_until", { withTimezone: true }),
  /** Global successful redeem cap. Null = unlimited. */
  maxRedemptions: integer("max_redemptions"),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PromoCodeRow = typeof promoCodesTable.$inferSelect;
export type InsertPromoCode = typeof promoCodesTable.$inferInsert;

/**
 * One successful redeem per (code, identityKey).
 * identityKey = `user:<clerkId>` or `device:<uuid>` so guests and accounts both work.
 */
export const promoRedemptionsTable = pgTable(
  "promo_redemptions",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    /** `user:<id>` or `device:<id>` — unique with code. */
    identityKey: text("identity_key").notNull(),
    userId: text("user_id"),
    deviceId: text("device_id"),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When access ends. Null + lifetime=true means never. */
    unlockExpiresAt: timestamp("unlock_expires_at", { withTimezone: true }),
    unlockLifetime: boolean("unlock_lifetime").notNull().default(false),
  },
  (t) => [uniqueIndex("promo_redemptions_code_identity_uidx").on(t.code, t.identityKey)],
);

export type PromoRedemptionRow = typeof promoRedemptionsTable.$inferSelect;
export type InsertPromoRedemption = typeof promoRedemptionsTable.$inferInsert;
