import type { CoachSportIdOrCustom } from "./sports";
import type { CoachGateEvaluation } from "./gates";

export type CoachCandidateKind = "player_prop" | "game_line";

export type CoachPropSide = "Over" | "Under";

export type CoachCandidateLeg = {
  /** Stable id for logging and cache keys. */
  legId: string;
  legFingerprint: string;
  kind: CoachCandidateKind;
  sport: CoachSportIdOrCustom;
  gameId: string;
  gameLabel: string;
  marketKey: string;
  marketLabel: string;
  pick: string;
  odds: number;
  line: number | null;
  startsAt: string | null;
  isAlt: boolean;
  playerId?: string | null;
  playerName?: string | null;
  propSide?: CoachPropSide;
  book?: string | null;
};

export type CoachQualifiedLeg = CoachCandidateLeg & {
  simHitPct: number;
  evPct: number;
  edgePct: number;
  confidencePct: number;
  compositeScore: number;
  grade: string;
  gateEvaluation: CoachGateEvaluation;
};
