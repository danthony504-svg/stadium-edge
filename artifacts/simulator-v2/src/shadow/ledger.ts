import { z } from "zod";
import { SimV2MarketFamilySchema } from "../schemas/market.js";
import { SimV2SportIdSchema } from "../schemas/sport.js";

export const ShadowLedgerEntrySchema = z.object({
  entryId: z.string().min(1),
  recordedAt: z.string().datetime(),
  sport: SimV2SportIdSchema,
  eventId: z.string().min(1),
  marketId: z.string().min(1),
  family: SimV2MarketFamilySchema,
  providerMarketKey: z.string().min(1),
  providerOddsAmerican: z.number().int().nullable(),
  v1SimHit: z.number().min(0).max(1).nullable(),
  v2SimHit: z.number().min(0).max(1).nullable(),
  v2Status: z.string().min(1),
  v2ModelId: z.string().nullable(),
  v2ModelVersion: z.string().nullable(),
  v2DataFingerprint: z.string().nullable(),
  /** Actual settled result when available: 1 win, 0 loss, null unknown/push. */
  actualResult: z.union([z.literal(0), z.literal(1), z.null()]),
  actualSettledAt: z.string().datetime().nullable(),
  v1LatencyMs: z.number().nonnegative().nullable(),
  v2LatencyMs: z.number().nonnegative().nullable(),
  /** Always true for Phase A shadow rows — never used for Coach seating. */
  shadowOnly: z.literal(true),
});

export type ShadowLedgerEntry = z.infer<typeof ShadowLedgerEntrySchema>;

/** In-memory ledger for Phase A. Production may swap for DB later without changing API. */
export class InMemoryShadowLedger {
  private readonly rows: ShadowLedgerEntry[] = [];

  append(entry: ShadowLedgerEntry): void {
    const parsed = ShadowLedgerEntrySchema.parse(entry);
    if (!parsed.shadowOnly) {
      throw new Error("shadow_ledger_requires_shadowOnly");
    }
    this.rows.push(parsed);
  }

  list(): readonly ShadowLedgerEntry[] {
    return this.rows;
  }

  clear(): void {
    this.rows.length = 0;
  }

  withActualResult(
    entryId: string,
    actualResult: 0 | 1 | null,
    actualSettledAt: string,
  ): boolean {
    const row = this.rows.find((r) => r.entryId === entryId);
    if (!row) return false;
    row.actualResult = actualResult;
    row.actualSettledAt = actualSettledAt;
    return true;
  }
}

export const defaultShadowLedger = new InMemoryShadowLedger();
