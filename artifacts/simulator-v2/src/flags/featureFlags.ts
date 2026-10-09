import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";

export type SimV2FamilyKey = `${SimV2SportId}:${SimV2MarketFamily}`;

export type SimV2FeatureFlags = {
  /** Master kill switch. Default false. */
  masterEnabled: boolean;
  /** When true, V2 may compute/log but never replace V1 for Coach. Default true. */
  shadowOnly: boolean;
  /** When true AND not shadowOnly AND family accepted, V2 may serve. Default false. */
  serveEnabled: boolean;
  /** Explicit allowlist of sport:family that passed acceptance gates. */
  acceptedFamilies: SimV2FamilyKey[];
  /** Rollback: force V1 regardless of acceptance. */
  forceV1Rollback: boolean;
};

export const DEFAULT_SIM_V2_FLAGS: SimV2FeatureFlags = {
  masterEnabled: false,
  shadowOnly: true,
  serveEnabled: false,
  acceptedFamilies: [],
  forceV1Rollback: false,
};

/** Parse env-style flags. Safe defaults keep Phase A isolated. */
export function parseSimV2FlagsFromEnv(env: NodeJS.ProcessEnv = process.env): SimV2FeatureFlags {
  const masterEnabled = env.SIM_V2_ENABLED === "1" || env.SIM_V2_ENABLED === "true";
  const shadowOnly = env.SIM_V2_SHADOW_ONLY !== "0" && env.SIM_V2_SHADOW_ONLY !== "false";
  const serveEnabled = env.SIM_V2_SERVE === "1" || env.SIM_V2_SERVE === "true";
  const forceV1Rollback = env.SIM_V2_FORCE_V1 === "1" || env.SIM_V2_FORCE_V1 === "true";
  const acceptedFamilies = (env.SIM_V2_ACCEPTED_FAMILIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as SimV2FamilyKey[];

  return {
    masterEnabled,
    shadowOnly: forceV1Rollback ? true : shadowOnly,
    serveEnabled: forceV1Rollback ? false : serveEnabled,
    acceptedFamilies: forceV1Rollback ? [] : acceptedFamilies,
    forceV1Rollback,
  };
}

export function familyKey(sport: SimV2SportId, family: SimV2MarketFamily): SimV2FamilyKey {
  return `${sport}:${family}`;
}
