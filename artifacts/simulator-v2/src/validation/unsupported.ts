import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";

export type UnsupportedDecision = {
  supported: boolean;
  reason?: string;
};

/**
 * Phase A: no production sport models. Only fixture tensors may settle for tests.
 * Sport models register support maps in later phases.
 */
const PHASE_A_SUPPORTED_FAMILIES: Partial<Record<SimV2SportId, SimV2MarketFamily[]>> = {};

export function isMarketFamilySupported(
  sport: SimV2SportId,
  family: SimV2MarketFamily,
  opts?: { allowFixture?: boolean; isFixtureTensor?: boolean },
): UnsupportedDecision {
  if (opts?.isFixtureTensor && opts.allowFixture) {
    return { supported: true };
  }
  const allowed = PHASE_A_SUPPORTED_FAMILIES[sport];
  if (!allowed || !allowed.includes(family)) {
    return {
      supported: false,
      reason: `unsupported_market_family:${sport}:${family}:phase_a_no_sport_model`,
    };
  }
  return { supported: true };
}

export function missingDataReject(missingFields: string[]): UnsupportedDecision {
  if (missingFields.length === 0) return { supported: true };
  return {
    supported: false,
    reason: `missing_data:${missingFields.sort().join(",")}`,
  };
}
