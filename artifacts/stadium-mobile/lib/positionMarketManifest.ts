// Position-market diagnostic funnel. The board scanner can attach this to a
// scan response without exposing raw provider payloads to users.

export type PositionMarketStage =
  | "rawMarkets"
  | "eligiblePlayers"
  | "projectedMarkets"
  | "evQualified"
  | "confidenceQualified"
  | "correlationQualified"
  | "finalPicks";

export type PositionMarketManifest = {
  counts: Record<PositionMarketStage, number>;
  rejectionCounts: Record<string, number>;
  samples: Array<{ stage: PositionMarketStage; reason: string; key: string }>;
};

export function createPositionMarketManifest(): PositionMarketManifest {
  return {
    counts: {
      rawMarkets: 0,
      eligiblePlayers: 0,
      projectedMarkets: 0,
      evQualified: 0,
      confidenceQualified: 0,
      correlationQualified: 0,
      finalPicks: 0,
    },
    rejectionCounts: {},
    samples: [],
  };
}

export function recordPositionMarketStage(
  manifest: PositionMarketManifest,
  stage: PositionMarketStage,
  options?: { rejectedReason?: string | null; key?: string },
): void {
  manifest.counts[stage] += 1;
  if (!options?.rejectedReason) return;
  manifest.rejectionCounts[options.rejectedReason] = (manifest.rejectionCounts[options.rejectedReason] ?? 0) + 1;
  if (manifest.samples.length < 30) {
    manifest.samples.push({ stage, reason: options.rejectedReason, key: options.key ?? "unknown" });
  }
}
