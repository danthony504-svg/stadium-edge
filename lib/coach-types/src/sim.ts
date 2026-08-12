import { COACH_DEEP_SIM_ITERATIONS } from "./constants";
import type { CoachSportIdOrCustom } from "./sports";

export type CoachSimTier = "quick" | "deep";

/**
 * Provenance is intentionally explicit: historic-rate/local fallbacks can help
 * explain a pick, but cannot be represented as a completed Monte Carlo run.
 */
export type CoachSimProvenance =
  | "api_game_outcome"
  | "api_prop_simulate"
  | "client_fight_mc";

export type CoachSimEngineId =
  | "mlb-inning"
  | "nba-possession"
  | "wnba-possession"
  | "nfl-drive"
  | "nhl-shift"
  | "soccer-xg"
  | "tennis-point"
  | "ufc-round"
  | "generic-team"
  | "player-prop";

/**
 * The evidence attached to a recommendation. A positive hit rate alone is not
 * enough: recommendation gates require a real, deep Monte Carlo result.
 */
export type CoachSimEvidence = {
  legFingerprint: string;
  tier: "deep";
  iterations: number;
  hitProbability: number;
  engineId: CoachSimEngineId;
  provenance: CoachSimProvenance;
  computedAt: string;
  sampleGames?: number;
};

export type CoachSimDisqualifier =
  | "missing_simulation"
  | "iterations_insufficient"
  | "missing_hit_probability"
  | "insufficient_sample";

export function coachSimDisqualifier(
  evidence: CoachSimEvidence | null | undefined,
): CoachSimDisqualifier | null {
  if (!evidence) return "missing_simulation";
  if (evidence.iterations < COACH_DEEP_SIM_ITERATIONS) return "iterations_insufficient";
  if (!Number.isFinite(evidence.hitProbability) || evidence.hitProbability <= 0 || evidence.hitProbability >= 1) {
    return "missing_hit_probability";
  }
  if (evidence.engineId === "player-prop" && (evidence.sampleGames ?? 0) < 3) {
    return "insufficient_sample";
  }
  return null;
}

export function coachSimEvidenceQualifies(
  evidence: CoachSimEvidence | null | undefined,
): evidence is CoachSimEvidence {
  return coachSimDisqualifier(evidence) == null;
}

export type CoachSimResult = {
  legFingerprint: string;
  tier: CoachSimTier;
  iterations: number;
  hitProbability: number;
  evPct: number;
  edgePct: number;
  distributionSummary?: Record<string, unknown>;
  computedAt: string;
};

export type CoachSimCacheEntry = {
  legFingerprint: string;
  contextFingerprint: string;
  simResult: CoachSimResult;
  computedAt: string;
};

/** Odds-sensitive hash — any line/odds change produces a new fingerprint. */
export type CoachLegFingerprintInput = {
  sport: CoachSportIdOrCustom;
  gameId: string;
  marketKey: string;
  pick: string;
  line: number | null;
  odds: number;
  playerId?: string | null;
  isAlt?: boolean;
};
