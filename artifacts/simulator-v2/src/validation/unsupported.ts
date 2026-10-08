import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";
import { getSportShadowSupport } from "./modelSupportRegistry.js";

export type UnsupportedDecision = {
  supported: boolean;
  reason?: string;
};

/**
 * Shadow settle gate. Production serve still gated by feature flags + acceptance.
 * Fixtures remain test-only via allowFixture.
 */
export function isMarketFamilySupported(
  sport: SimV2SportId,
  family: SimV2MarketFamily,
  opts?: {
    allowFixture?: boolean;
    isFixtureTensor?: boolean;
    modelId?: string;
  },
): UnsupportedDecision {
  if (opts?.isFixtureTensor && opts.allowFixture) {
    return { supported: true };
  }
  if (opts?.isFixtureTensor && !opts.allowFixture) {
    return { supported: false, reason: "fixture_tensor_not_for_production" };
  }
  const support = getSportShadowSupport(sport);
  if (!support || !support.families.includes(family)) {
    return {
      supported: false,
      reason: `unsupported_market_family:${sport}:${family}:no_accepted_sport_model`,
    };
  }
  if (opts?.modelId && !(support.modelIds as readonly string[]).includes(opts.modelId)) {
    return {
      supported: false,
      reason: `unsupported_model:${opts.modelId}`,
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
