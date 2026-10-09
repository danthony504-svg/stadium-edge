import { z } from "zod";
import { SimV2ProviderProvenanceSchema } from "./event.js";

export const SimV2ParticipationEvidenceSchema = z.object({
  status: z.enum([
    "confirmed_starter",
    "confirmed_active",
    "projected",
    "questionable",
    "out",
    "unknown",
  ]),
  evidenceSource: z.string().min(1),
  evidenceAt: z.string().datetime(),
  note: z.string().optional(),
  /** Snap share / minutes prior when known — never invented. */
  expectedParticipation: z.number().min(0).max(1).nullable(),
});

export type SimV2ParticipationEvidence = z.infer<typeof SimV2ParticipationEvidenceSchema>;

export const SimV2PlayerSchema = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1),
  teamId: z.string().min(1),
  position: z.string().optional(),
  participation: SimV2ParticipationEvidenceSchema,
  provenance: z.array(SimV2ProviderProvenanceSchema).min(1),
});

export type SimV2Player = z.infer<typeof SimV2PlayerSchema>;
