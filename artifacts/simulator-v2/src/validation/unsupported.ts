import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";
import { PHASE_B_FOOTBALL_FAMILIES } from "../models/football/markets.js";
import { FOOTBALL_JOINT_MODEL_IDS } from "../models/football/jointFootball.js";

export type UnsupportedDecision = {
  supported: boolean;
  reason?: string;
};

/**
 * Phase B: NFL/NCAAF joint model may settle ml/spread/total/team_total for
 * shadow diagnostics. Production serve still gated by feature flags + acceptance.
 * Fixtures remain test-only via allowFixture.
 */
const PHASE_B_SUPPORTED_FAMILIES: Partial<Record<SimV2SportId, SimV2MarketFamily[]>> = {
  nfl: [...PHASE_B_FOOTBALL_FAMILIES],
  ncaaf: [...PHASE_B_FOOTBALL_FAMILIES],
};

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
  const allowed = PHASE_B_SUPPORTED_FAMILIES[sport];
  if (!allowed || !allowed.includes(family)) {
    return {
      supported: false,
      reason: `unsupported_market_family:${sport}:${family}:no_accepted_sport_model`,
    };
  }
  // Phase B football joint models only (v0 + correct) — reject unknown ids.
  if (
    opts?.modelId &&
    !(FOOTBALL_JOINT_MODEL_IDS as readonly string[]).includes(opts.modelId)
  ) {
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
