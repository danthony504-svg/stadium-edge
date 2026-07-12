import type { CoachSportIdOrCustom } from "./sports";

export type CoachSimTier = "quick" | "deep";

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
