import {
  pgTable,
  text,
  timestamp,
  bigint,
  bigserial,
  integer,
  primaryKey,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export const referralAccountsTable = pgTable("referral_accounts", {
  userId: text("user_id").primaryKey(),
  code: text("code").notNull().unique(),
  identityHash: text("identity_hash").notNull().unique(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const referralConversionsTable = pgTable(
  "referral_conversions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    referrerId: text("referrer_id")
      .notNull()
      .references(() => referralAccountsTable.userId, { onDelete: "cascade" }),
    referredUserId: text("referred_user_id")
      .unique()
      .references(() => referralAccountsTable.userId, { onDelete: "set null" }),
    identityHash: text("identity_hash").unique(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("referral_conversions_referrer").on(t.referrerId),
    check("no_self_referral", sql`${t.referrerId} <> ${t.referredUserId}`),
  ],
);
export const referralOfferCodesTable = pgTable(
  "referral_offer_codes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    milestone: integer("milestone").notNull(),
    encryptedCode: text("encrypted_code").notNull(),
    codeHash: text("code_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    assignedUserId: text("assigned_user_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "referral_offer_codes_milestone_check",
      sql`${t.milestone} IN (3,10)`,
    ),
  ],
);
export const referralRewardsTable = pgTable(
  "referral_rewards",
  {
    userId: text("user_id")
      .notNull()
      .references(() => referralAccountsTable.userId, { onDelete: "cascade" }),
    milestone: integer("milestone").notNull(),
    offerId: bigint("offer_id", { mode: "number" })
      .notNull()
      .unique()
      .references(() => referralOfferCodesTable.id),
    awardedAt: timestamp("awarded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.milestone] }),
    check("referral_rewards_milestone_check", sql`${t.milestone} IN (3,10)`),
  ],
);
