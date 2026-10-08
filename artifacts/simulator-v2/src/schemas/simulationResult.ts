import { z } from "zod";
import { SIM_V2_SCHEMA_VERSION } from "../version.js";
import { SimV2MarketFamilySchema } from "./market.js";
import { SimV2SportIdSchema } from "./sport.js";

export const SimV2SettleStatusSchema = z.enum([
  "ok",
  "unsupported",
  "missing_data",
  "integrity_reject",
  "fixture_only",
]);

export type SimV2SettleStatus = z.infer<typeof SimV2SettleStatusSchema>;

export const SimV2SimulationResultSchema = z.object({
  schemaVersion: z.literal(SIM_V2_SCHEMA_VERSION),
  engineId: z.literal("simulator-v2"),
  marketId: z.string().min(1),
  eventId: z.string().min(1),
  sport: SimV2SportIdSchema,
  family: SimV2MarketFamilySchema,
  status: SimV2SettleStatusSchema,
  reason: z.string().optional(),
  /** Simulation hit probability in [0,1] — null when not ok. */
  simHit: z.number().min(0).max(1).nullable(),
  /** Echo of provider american odds — never invented. */
  providerOddsAmerican: z.number().int().nullable(),
  impliedProbRaw: z.number().gt(0).lt(1).nullable(),
  edgePct: z.number().finite().nullable(),
  evPct: z.number().finite().nullable(),
  modelId: z.string().min(1),
  modelVersion: z.string().min(1),
  dataFingerprint: z.string().min(1),
  nDraws: z.number().int().nonnegative(),
  seed: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  computedAt: z.string().datetime(),
});

export type SimV2SimulationResult = z.infer<typeof SimV2SimulationResultSchema>;
