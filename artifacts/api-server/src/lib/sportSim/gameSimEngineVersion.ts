import { FOOTBALL_DRIVE_ENGINE_VERSION } from "./footballDriveMatchup.js";
import type { SportSimModelId } from "./types.js";

/** Non-football game-outcome stamp. Bump only when that shared contract changes. */
export const SPORT_SIM_ENGINE_VERSION = "sport-sim-v1";

export function gameSimEngineVersion(model: SportSimModelId | "tennis-point" | "ufc-round"): string {
  return model === "nfl-drive" ? FOOTBALL_DRIVE_ENGINE_VERSION : SPORT_SIM_ENGINE_VERSION;
}

export function gameDrawEngineAccepted(
  draw: { engineVersion?: unknown; sport?: string | null } | null | undefined,
  sportHint?: string | null,
): boolean {
  if (!draw || typeof draw !== "object") return false;
  const version = typeof draw.engineVersion === "string" ? draw.engineVersion : "";
  const sport = String(sportHint ?? draw.sport ?? "").toLowerCase();
  const football =
    sport === "nfl" ||
    sport === "ncaaf" ||
    sport === "cfb" ||
    sport.includes("ncaaf");
  if (football) return version === FOOTBALL_DRIVE_ENGINE_VERSION;
  if (!version) return false;
  if (!sport) {
    return version === FOOTBALL_DRIVE_ENGINE_VERSION || version === SPORT_SIM_ENGINE_VERSION;
  }
  return version === SPORT_SIM_ENGINE_VERSION;
}

/** In-process slate return. Copies the registry stamp; a missing field stays missing. */
export function stampedTeamGameOutcome(sport: string, result: {
  engineVersion?: string;
  homeWinProbability?: number | null;
  awayWinProbability?: number | null;
  coverHitRates?: Record<string, number> | null;
}): {
  sport: string;
  engineVersion?: string;
  homeWinProbability: number | null;
  awayWinProbability: number | null;
  coverHitRates: Record<string, number>;
} {
  return {
    sport,
    engineVersion: result.engineVersion,
    homeWinProbability: result.homeWinProbability ?? null,
    awayWinProbability: result.awayWinProbability ?? null,
    coverHitRates: result.coverHitRates ?? {},
  };
}
