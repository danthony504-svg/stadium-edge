import type { CoachSportIdOrCustom, GameMarketDefinition, PropMarketDefinition } from "./sports";
import type { CoachCandidateLeg } from "./candidates";
import type { CoachGateResult } from "./gates";
import type { CoachGradeResult } from "./grade";

/**
 * Sport-specific context passed into adapters during scan and gate evaluation.
 * Built by coach-data from ESPN, odds feeds, and player history.
 */
export type CoachSportContext = {
  sport: CoachSportIdOrCustom;
  injuries: Record<string, unknown>;
  matchupHistory: Record<string, unknown>;
  playerHistory: Record<string, unknown>;
  lineMovement: Record<string, unknown>;
  trends: Record<string, unknown>;
};

/**
 * Modular sport adapter contract. Each sport (MLB, NBA, …) implements this interface
 * in its own module under coach-data/sports/<sportId>. Adding a sport = new adapter file.
 */
export type CoachSportAdapter = {
  readonly sportId: CoachSportIdOrCustom;
  readonly displayName: string;

  /** Game-line markets this sport supports (ML, spread, total, period markets, etc.). */
  supportedGameMarkets(): GameMarketDefinition[];

  /** Player/team prop markets this sport supports. */
  supportedPropMarkets(): PropMarketDefinition[];

  /**
   * Enumerate realistic candidate legs from raw odds/props for this sport.
   * Called during full scan — must not stop early.
   */
  enumerateCandidates(input: CoachSportEnumerateInput): CoachCandidateLeg[];

  /** Gate G9 — sport-specific rules (tennis ML-only, UFC ML-only, etc.). */
  evaluateSportSpecific(candidate: CoachCandidateLeg, context: CoachSportContext): CoachGateResult;

  /** Optional horizon override (default: COACH_HORIZON_MS). */
  horizonMs?: number;

  /** Minimum confidence override — may only raise the global floor. */
  minConfidencePct?: number;
};

export type CoachSportEnumerateInput = {
  sport: CoachSportIdOrCustom;
  gameLines: Array<{
    gameId: string;
    gameLabel: string;
    marketKey: string;
    marketLabel: string;
    pick: string;
    odds: number;
    line: number | null;
    startsAt: string | null;
    isAlt: boolean;
  }>;
  props: Array<{
    gameId: string;
    gameLabel: string;
    marketKey: string;
    marketLabel: string;
    playerId: string | null;
    playerName: string;
    pick: string;
    odds: number;
    line: number | null;
    side: "Over" | "Under";
    startsAt: string | null;
    isAlt: boolean;
  }>;
};

/**
 * Registry of sport adapters — core engine resolves adapters by sportId.
 * New sports register here at server startup; no engine rewrite required.
 */
export type CoachSportRegistry = {
  register(adapter: CoachSportAdapter): void;
  get(sportId: CoachSportIdOrCustom): CoachSportAdapter | undefined;
  has(sportId: CoachSportIdOrCustom): boolean;
  all(): CoachSportAdapter[];
  sportIds(): CoachSportIdOrCustom[];
};

/** Type guard helper for adapter authors. */
export type CoachSportAdapterFactory = () => CoachSportAdapter;

export type CoachRankAdjustment = {
  sport: CoachSportIdOrCustom;
  marketKey: string;
  rankWeightMultiplier: number;
  confidenceAdjustmentPct: number;
  sampleSize: number;
};

export type CoachLearningState = {
  version: number;
  updatedAt: string;
  adjustments: CoachRankAdjustment[];
};

/** Post-gate grading hook — optional sport-specific grade nudges (never bypass gates). */
export type CoachSportGradeHook = (
  candidate: CoachCandidateLeg,
  base: CoachGradeResult,
  context: CoachSportContext,
) => CoachGradeResult;
