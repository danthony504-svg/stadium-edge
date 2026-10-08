/**
 * Shadow settle allowlist by sport. Production serve still requires
 * SIM_V2_ACCEPTED_FAMILIES + SIM_V2_SERVE. Each sport stream owns only its keys.
 */
import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";
import { PHASE_C_FOOTBALL_FAMILIES } from "../models/football/markets.js";
import { FOOTBALL_JOINT_MODEL_IDS } from "../models/football/jointFootball.js";
import { HOCKEY_SHADOW_FAMILIES } from "../models/hockey/markets.js";
import { HOCKEY_JOINT_MODEL_IDS } from "../models/hockey/jointHockey.js";

export type SportShadowSupport = {
  families: readonly SimV2MarketFamily[];
  modelIds: readonly string[];
};

export const SHADOW_SUPPORT_BY_SPORT: Partial<Record<SimV2SportId, SportShadowSupport>> = {
  nfl: {
    families: [...PHASE_C_FOOTBALL_FAMILIES],
    modelIds: [...FOOTBALL_JOINT_MODEL_IDS],
  },
  ncaaf: {
    families: [...PHASE_C_FOOTBALL_FAMILIES],
    modelIds: [...FOOTBALL_JOINT_MODEL_IDS],
  },
  nhl: {
    families: [...HOCKEY_SHADOW_FAMILIES],
    modelIds: [...HOCKEY_JOINT_MODEL_IDS],
  },
};

export function getSportShadowSupport(sport: SimV2SportId): SportShadowSupport | undefined {
  return SHADOW_SUPPORT_BY_SPORT[sport];
}
