import { pgTable, text, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";

// Ledger of the app's OWN "+500 steal" picks — longshot bets (American odds
// +500..+30000) the model flagged as carrying a REAL cross-book no-vig edge.
// Each row is captured ONCE (the moment we first surface it) and later graded
// against real game/stat results so the W/L track record reflects genuine
// outcomes only — never a fabricated record. `id` is a stable key
// (sport|eventId|market|pick) so re-surfacing the same steal across refreshes
// does not create duplicates and never overwrites an already-graded row — while
// the SAME pick in a recurring matchup (series games on different dates, MLB
// doubleheaders) is still logged & graded as a distinct attempt.
export const liveStealsTable = pgTable("live_steals", {
  id: text("id").primaryKey(),
  sport: text("sport").notNull(),
  game: text("game").notNull(),
  market: text("market").notNull(),
  pick: text("pick").notNull(),
  // Player name for prop steals; null for game-line (ML/spread/total) steals.
  player: text("player"),
  // American odds captured at first sight (the price the "pick" was made at).
  price: integer("price").notNull(),
  // Real de-vig signals captured with the pick (percentage points / EV % /
  // consensus fair win prob). Nullable — never fabricated.
  edge: doublePrecision("edge"),
  ev: doublePrecision("ev"),
  fairProb: doublePrecision("fair_prob"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  // pending | win | loss | push | ungraded. Only ever set to a terminal
  // win/loss/push from a REAL graded result; ungraded means we could not settle
  // it for certain (kept honest, retried until aged out).
  status: text("status").notNull().default("pending"),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  gradedAt: timestamp("graded_at", { withTimezone: true }),
});

export type LiveStealRow = typeof liveStealsTable.$inferSelect;
