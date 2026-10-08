import { z } from "zod";
import { SimV2ProviderProvenanceSchema } from "./event.js";

/**
 * Provider odds are preserved verbatim. V2 never invents or overwrites prices.
 */
export const SimV2OddsSchema = z.object({
  marketId: z.string().min(1),
  american: z.number().int().refine((n) => n !== 0, "american odds cannot be 0"),
  book: z.string().min(1),
  capturedAt: z.string().datetime(),
  /** Optional multi-book fair when computed upstream — still not a sim probability. */
  impliedProbRaw: z.number().gt(0).lt(1),
  impliedProbDevig: z.number().gt(0).lt(1).optional(),
  provenance: SimV2ProviderProvenanceSchema,
});

export type SimV2Odds = z.infer<typeof SimV2OddsSchema>;

export function impliedProbFromAmerican(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error("invalid american odds");
  }
  if (american > 0) return 100 / (american + 100);
  return -american / (-american + 100);
}

export function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error("invalid american odds");
  }
  if (american > 0) return american / 100 + 1;
  return 100 / -american + 1;
}
