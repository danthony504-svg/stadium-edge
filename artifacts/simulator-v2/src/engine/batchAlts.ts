import type { SimV2ScenarioTensor } from "../schemas/scenarioTensor.js";
import type { SimV2Market } from "../schemas/market.js";
import type { SimV2Odds } from "../schemas/odds.js";
import type { SimV2SimulationResult } from "../schemas/simulationResult.js";
import { settleMarket } from "./settle.js";

export type AltLineBatchRequest = {
  tensor: SimV2ScenarioTensor;
  /** Same underlying settlePath / player / period; differing lines only. */
  markets: SimV2Market[];
  oddsByMarketId: Record<string, SimV2Odds | null>;
  allowFixture?: boolean;
  periodSumGroup?: string[];
};

export type AltLineBatchResult = {
  results: SimV2SimulationResult[];
  /** True when all markets share one tensor (no per-line re-simulation). */
  reusedSingleTensor: true;
  tensorId: string;
  settleLatencyMs: number;
};

function sameUnderlying(a: SimV2Market, b: SimV2Market): boolean {
  return (
    a.eventId === b.eventId &&
    a.family === b.family &&
    a.period === b.period &&
    a.settlement.settlePath === b.settlement.settlePath &&
    (a.playerId ?? "") === (b.playerId ?? "") &&
    (a.teamSide ?? "") === (b.teamSide ?? "") &&
    a.settlement.comparator === b.settlement.comparator
  );
}

/**
 * Settle many alternate lines against one joint tensor — O(markets × nDraws), not O(markets × full sim).
 */
export function settleAltLineBatch(req: AltLineBatchRequest): AltLineBatchResult {
  const t0 = performance.now();
  if (req.markets.length === 0) {
    return {
      results: [],
      reusedSingleTensor: true,
      tensorId: req.tensor.meta.dataFingerprint,
      settleLatencyMs: 0,
    };
  }
  const root = req.markets[0];
  for (const m of req.markets) {
    if (!sameUnderlying(root, m)) {
      throw new Error(
        `alt_batch_underlying_mismatch:${root.marketId}:${m.marketId}`,
      );
    }
  }

  const results = req.markets.map((market) =>
    settleMarket({
      tensor: req.tensor,
      market,
      odds: req.oddsByMarketId[market.marketId] ?? null,
      allowFixture: req.allowFixture,
      periodSumGroup: req.periodSumGroup,
    }),
  );

  return {
    results,
    reusedSingleTensor: true,
    tensorId: req.tensor.meta.dataFingerprint,
    settleLatencyMs: performance.now() - t0,
  };
}
