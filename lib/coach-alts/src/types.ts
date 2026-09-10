import type { CoachCandidateKind, CoachQualifiedLeg } from "@workspace/coach-types";
import type { CoachRankedLeg } from "@workspace/coach-rank";

export type CoachAltTierLabel = "Safest" | "Best" | "Best Value" | "High Risk";

export const COACH_ALT_TIER_ORDER: CoachAltTierLabel[] = [
  "Safest",
  "Best",
  "Best Value",
  "High Risk",
];

export const MAX_ALT_LADDER_DISPLAY_RUNGS = 4;

export type CoachAltRung<T extends CoachQualifiedLeg = CoachRankedLeg> = T & {
  tierLabel: CoachAltTierLabel;
  ladderPosition: number;
  isMainRung: boolean;
};

export type CoachAltLadder<T extends CoachQualifiedLeg = CoachRankedLeg> = {
  ladderKey: string;
  sport: string;
  gameId: string;
  gameLabel: string;
  marketKey: string;
  kind: CoachCandidateKind;
  playerId?: string | null;
  playerName?: string | null;
  propSide?: string | null;
  /** All gate-qualified rungs in this ladder, safest → highest risk. */
  rungs: CoachAltRung<T>[];
  /** Best rung for ticket selection (main preferred, then highest rank). */
  champion: CoachAltRung<T> | null;
  /** Posted main line rung when present in the qualified set. */
  mainRung: CoachAltRung<T> | null;
  /** Up to four representative rungs for pick-card display. */
  displayRungs: CoachAltRung<T>[];
};

export type CoachAltLadderIndex<T extends CoachQualifiedLeg = CoachRankedLeg> = {
  ladders: CoachAltLadder<T>[];
  champions: CoachAltRung<T>[];
};
