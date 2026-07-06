import { doublePrecision, integer, text, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";

// Ledger of every Game Simulator moneyline-style winner prediction (10k-run
// Monte Carlo). Each row is upserted when a fresh sim runs pregame; after the
// game finishes we grade predictedWinner against the real final score so the app
// (and Coach) can cite an honest win-rate track record.
export const simPredictionsTable = pgTable("sim_predictions", {
  id: text("id").primaryKey(),
  sport: text("sport").notNull(),
  eventId: text("event_id").notNull(),
  game: text("game").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  predictedWinner: text("predicted_winner").notNull(), // home | away
  predictedTeam: text("predicted_team").notNull(),
  homeWinProb: doublePrecision("home_win_prob").notNull(),
  awayWinProb: doublePrecision("away_win_prob").notNull(),
  edgeBand: text("edge_band").notNull(), // no_edge | small_edge | good_edge | strong_edge
  simulations: integer("simulations").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  // pending | correct | incorrect | push | ungraded
  status: text("status").notNull().default("pending"),
  actualWinner: text("actual_winner"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  predictedAt: timestamp("predicted_at", { withTimezone: true }).notNull().defaultNow(),
  gradedAt: timestamp("graded_at", { withTimezone: true }),
});

export type SimPredictionRow = typeof simPredictionsTable.$inferSelect;
