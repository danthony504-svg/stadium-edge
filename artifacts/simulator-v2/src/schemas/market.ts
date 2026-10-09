import { z } from "zod";
import { SimV2PeriodKeySchema, SimV2SportIdSchema } from "./sport.js";
import { SimV2ProviderProvenanceSchema } from "./event.js";

export const SimV2MarketFamilySchema = z.enum([
  "ml",
  "spread",
  "total",
  "team_total",
  "player_prop",
  "race_to",
  "method",
  "rounds",
]);

export type SimV2MarketFamily = z.infer<typeof SimV2MarketFamilySchema>;

export const SimV2SettlementRuleSchema = z.object({
  /** Machine-readable settlement definition id. */
  ruleId: z.string().min(1),
  description: z.string().min(1),
  /** Stat path on the scenario tensor, e.g. team.homeFg or players.{id}.stats.rush_yds */
  settlePath: z.string().min(1),
  comparator: z.enum(["gt", "gte", "lt", "lte", "eq", "home_wins", "away_wins", "push_push"]),
  lineApplies: z.boolean(),
  period: SimV2PeriodKeySchema,
});

export type SimV2SettlementRule = z.infer<typeof SimV2SettlementRuleSchema>;

export const SimV2MarketSchema = z.object({
  marketId: z.string().min(1),
  eventId: z.string().min(1),
  sport: SimV2SportIdSchema,
  family: SimV2MarketFamilySchema,
  /** Provider market key as listed (Odds API / book). */
  providerMarketKey: z.string().min(1),
  period: SimV2PeriodKeySchema,
  side: z.enum(["over", "under", "home", "away", "yes", "no"]).optional(),
  line: z.number().finite().optional(),
  playerId: z.string().optional(),
  teamSide: z.enum(["home", "away"]).optional(),
  settlement: SimV2SettlementRuleSchema,
  listedAt: z.string().datetime(),
  provenance: z.array(SimV2ProviderProvenanceSchema).min(1),
});

export type SimV2Market = z.infer<typeof SimV2MarketSchema>;
