import { z } from "zod";

export const SimV2SportIdSchema = z.enum([
  "nfl",
  "ncaaf",
  "nba",
  "wnba",
  "ncaab",
  "mlb",
  "nhl",
  "soccer",
  "tennis",
  "ufc",
  "mma",
  "golf",
]);

export type SimV2SportId = z.infer<typeof SimV2SportIdSchema>;

export const SimV2PeriodKeySchema = z.enum([
  "fg",
  "h1",
  "h2",
  "q1",
  "q2",
  "q3",
  "q4",
  "f5",
  "i1",
  "p1",
  "p2",
  "p3",
]);

export type SimV2PeriodKey = z.infer<typeof SimV2PeriodKeySchema>;

/** Period keys that must sum to full-game when present (sport-specific subsets). */
export const PERIOD_SUM_GROUPS: Record<string, SimV2PeriodKey[]> = {
  football_quarters: ["q1", "q2", "q3", "q4"],
  football_halves: ["h1", "h2"],
  hockey_periods: ["p1", "p2", "p3"],
  basketball_quarters: ["q1", "q2", "q3", "q4"],
  basketball_halves: ["h1", "h2"],
};
