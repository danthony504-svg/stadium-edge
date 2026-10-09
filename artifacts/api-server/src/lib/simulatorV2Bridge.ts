/**
 * Thin bridge from api-server → @workspace/simulator-v2.
 * Phase B: shadow diagnostics only. Never feeds Coach seating / grading
 * unless serve flags + acceptance gates are explicitly enabled (not default).
 */

import {
  DEFAULT_SIM_V2_FLAGS,
  type SimV2FeatureFlags,
  assertShadowCannotInfluenceCoach,
  parseSimV2FlagsFromEnv,
  selectProductionSimResult,
  type SimV2MarketFamily,
  type SimV2SportId,
  type SimV2SimulationResult,
} from "@workspace/simulator-v2";

let cachedFlags: SimV2FeatureFlags | null = null;

export function getSimV2Flags(): SimV2FeatureFlags {
  if (!cachedFlags) cachedFlags = parseSimV2FlagsFromEnv(process.env);
  return cachedFlags;
}

/** Test helper — reset cached env parse. */
export function resetSimV2FlagsCache(): void {
  cachedFlags = null;
}

/**
 * Coach / production must call this before using any sim hit.
 * Under Phase A defaults, always returns V1 and asserts no V2 influence.
 */
export function resolveCoachSimHit(args: {
  sport: SimV2SportId;
  family: SimV2MarketFamily;
  v1SimHit: number | null;
  v2?: SimV2SimulationResult | null;
}): { simHit: number | null; engine: "v1" | "v2" } {
  const choice = selectProductionSimResult({
    flags: getSimV2Flags(),
    sport: args.sport,
    family: args.family,
    v1SimHit: args.v1SimHit,
    v2: args.v2 ?? null,
  });
  // Phase A hard guard — also fails if misconfigured flags try to serve V2.
  if (!getSimV2Flags().serveEnabled || getSimV2Flags().shadowOnly || getSimV2Flags().forceV1Rollback) {
    assertShadowCannotInfluenceCoach(choice);
  }
  return { simHit: choice.simHit, engine: choice.engine };
}

export { DEFAULT_SIM_V2_FLAGS };
