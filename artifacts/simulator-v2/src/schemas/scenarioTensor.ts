import { z } from "zod";
import { SimV2PeriodKeySchema, SimV2SportIdSchema } from "./sport.js";
import { SimV2ProviderProvenanceSchema } from "./event.js";
import { SIM_V2_SCHEMA_VERSION } from "../version.js";

export const SimV2DataQualitySchema = z.object({
  status: z.enum(["pass", "degraded", "reject"]),
  missingFields: z.array(z.string()),
  warnings: z.array(z.string()),
  participationReady: z.boolean(),
  oddsReady: z.boolean(),
});

export type SimV2DataQuality = z.infer<typeof SimV2DataQualitySchema>;

/**
 * Joint scenario tensor metadata. Numeric columns are Float64Array length = nDraws
 * and are validated separately (Zod does not serialize typed arrays).
 */
export const SimV2ScenarioTensorMetaSchema = z.object({
  schemaVersion: z.literal(SIM_V2_SCHEMA_VERSION),
  engineId: z.literal("simulator-v2"),
  modelId: z.string().min(1),
  modelVersion: z.string().min(1),
  sport: SimV2SportIdSchema,
  eventId: z.string().min(1),
  nDraws: z.number().int().positive(),
  seed: z.string().min(1),
  dataFingerprint: z.string().min(8),
  createdAt: z.string().datetime(),
  /** Phase A fixtures must set true — never served as production model output. */
  isFixture: z.boolean(),
  quality: SimV2DataQualitySchema,
  periodsPresent: z.array(SimV2PeriodKeySchema),
  playerStatKeys: z.array(z.string()),
  provenance: z.array(SimV2ProviderProvenanceSchema).min(1),
});

export type SimV2ScenarioTensorMeta = z.infer<typeof SimV2ScenarioTensorMetaSchema>;

export type SimV2ScenarioTensor = {
  meta: SimV2ScenarioTensorMeta;
  team: {
    homeFg: Float64Array;
    awayFg: Float64Array;
    homeByPeriod: Partial<Record<string, Float64Array>>;
    awayByPeriod: Partial<Record<string, Float64Array>>;
  };
  players: Record<
    string,
    {
      participated: Uint8Array;
      stats: Record<string, Float64Array>;
    }
  >;
};
