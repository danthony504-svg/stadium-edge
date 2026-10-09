import type { ShadowLedgerEntry } from "./ledger.js";
import type { SimV2SimulationResult } from "../schemas/simulationResult.js";
import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";

export type V1ShadowSnapshot = {
  simHit: number | null;
  latencyMs: number | null;
};

export type ShadowCompareInput = {
  entryId: string;
  sport: SimV2SportId;
  eventId: string;
  marketId: string;
  family: SimV2MarketFamily;
  providerMarketKey: string;
  providerOddsAmerican: number | null;
  v1: V1ShadowSnapshot;
  v2: SimV2SimulationResult | null;
  actualResult?: 0 | 1 | null;
  actualSettledAt?: string | null;
};

/**
 * Build a shadow ledger row. Does not return anything consumable by Coach seating.
 */
export function buildShadowCompareEntry(input: ShadowCompareInput): ShadowLedgerEntry {
  return {
    entryId: input.entryId,
    recordedAt: new Date().toISOString(),
    sport: input.sport,
    eventId: input.eventId,
    marketId: input.marketId,
    family: input.family,
    providerMarketKey: input.providerMarketKey,
    providerOddsAmerican: input.providerOddsAmerican,
    v1SimHit: input.v1.simHit,
    v2SimHit: input.v2?.status === "ok" ? input.v2.simHit : null,
    v2Status: input.v2?.status ?? "v2_absent",
    v2ModelId: input.v2?.modelId ?? null,
    v2ModelVersion: input.v2?.modelVersion ?? null,
    v2DataFingerprint: input.v2?.dataFingerprint ?? null,
    actualResult: input.actualResult ?? null,
    actualSettledAt: input.actualSettledAt ?? null,
    v1LatencyMs: input.v1.latencyMs,
    v2LatencyMs: input.v2?.latencyMs ?? null,
    shadowOnly: true,
  };
}
