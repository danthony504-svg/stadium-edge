import type { SimV2SimulationResult } from "../schemas/simulationResult.js";
import type { SimV2FeatureFlags } from "../flags/featureFlags.js";
import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";
import { isFamilyAcceptedForServe } from "../flags/acceptanceGates.js";

export type ProductionSimChoice = {
  /** Always the engine whose hit% may reach Coach. */
  engine: "v1" | "v2";
  simHit: number | null;
  /** V2 payload is attached for diagnostics only when not served. */
  shadowV2: SimV2SimulationResult | null;
  influencedProduction: boolean;
};

/**
 * HARD ISOLATION: V2 never influences production Coach picks unless
 * (1) master enabled, (2) not shadow-only, (3) sport+family acceptance gate passed.
 * Phase A defaults ensure influencedProduction === false always.
 */
export function selectProductionSimResult(args: {
  flags: SimV2FeatureFlags;
  sport: SimV2SportId;
  family: SimV2MarketFamily;
  v1SimHit: number | null;
  v2: SimV2SimulationResult | null;
}): ProductionSimChoice {
  const { flags, sport, family, v1SimHit, v2 } = args;

  const mayServe =
    flags.masterEnabled &&
    !flags.shadowOnly &&
    flags.serveEnabled &&
    isFamilyAcceptedForServe(flags, sport, family) &&
    v2?.status === "ok" &&
    v2.simHit != null &&
    !v2.modelId.startsWith("fixture.");

  if (mayServe) {
    return {
      engine: "v2",
      simHit: v2!.simHit,
      shadowV2: null,
      influencedProduction: true,
    };
  }

  return {
    engine: "v1",
    simHit: v1SimHit,
    shadowV2: flags.masterEnabled && flags.shadowOnly ? v2 : v2,
    influencedProduction: false,
  };
}

/** Explicit guard used by API adapters — throws if a caller tries to force V2 serve in Phase A. */
export function assertShadowCannotInfluenceCoach(choice: ProductionSimChoice): void {
  if (choice.influencedProduction) {
    throw new Error("sim_v2_phase_a_forbid_production_influence");
  }
}
