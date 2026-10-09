import { z } from "zod";
import { SimV2SportIdSchema } from "./sport.js";

export const SimV2ProviderProvenanceSchema = z.object({
  provider: z.string().min(1),
  providerEventId: z.string().min(1).optional(),
  fetchedAt: z.string().datetime(),
  sourceUrl: z.string().url().optional(),
  rawHash: z.string().min(8).optional(),
});

export type SimV2ProviderProvenance = z.infer<typeof SimV2ProviderProvenanceSchema>;

export const SimV2TeamRefSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(1),
  abbreviation: z.string().optional(),
  side: z.enum(["home", "away"]),
});

export const SimV2EventSchema = z.object({
  eventId: z.string().min(1),
  sport: SimV2SportIdSchema,
  startTime: z.string().datetime(),
  home: SimV2TeamRefSchema,
  away: SimV2TeamRefSchema,
  competition: z.string().optional(),
  provenance: z.array(SimV2ProviderProvenanceSchema).min(1),
  asOf: z.string().datetime(),
});

export type SimV2Event = z.infer<typeof SimV2EventSchema>;
