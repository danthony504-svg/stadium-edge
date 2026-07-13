// Board ranking — best edge first; variety only when scores are nearly equal.

import type { BoardScoredLeg } from "./ticketStaging.ts";
import { parlayLegKey } from "./parlayVarietyMemory.ts";
import { varietyRankKey } from "./varietySeed.ts";

/** Composite rank scores within this band may tie-break on varietySeed. */
export const NEAR_EQUAL_RANK_SCORE_BAND = 2;

/** Edge (pct points) and confidence (pct points) must both be close to rotate. */
export const NEAR_EQUAL_EDGE_PCT = 1.5;
export const NEAR_EQUAL_CONFIDENCE_PCT = 6;

export function boardLegsNearlyEqual(a: BoardScoredLeg, b: BoardScoredLeg): boolean {
  if (Math.abs(b.rankScore - a.rankScore) > NEAR_EQUAL_RANK_SCORE_BAND) return false;
  const edgeA = a.edgePct ?? 0;
  const edgeB = b.edgePct ?? 0;
  const confA = a.confidencePct ?? 0;
  const confB = b.confidencePct ?? 0;
  return (
    Math.abs(edgeA - edgeB) <= NEAR_EQUAL_EDGE_PCT &&
    Math.abs(confA - confB) <= NEAR_EQUAL_CONFIDENCE_PCT
  );
}

/** Sort legs: highest rankScore wins unless nearly equal — then varietySeed shuffles. */
export function compareBoardLegsForRank(
  a: BoardScoredLeg,
  b: BoardScoredLeg,
  varietySeed?: string,
): number {
  const diff = b.rankScore - a.rankScore;
  if (!boardLegsNearlyEqual(a, b)) return diff;
  if (varietySeed) {
    return (
      varietyRankKey(varietySeed, parlayLegKey(a.pick)) -
      varietyRankKey(varietySeed, parlayLegKey(b.pick))
    );
  }
  return diff;
}

export function sortBoardLegsForRank(
  legs: BoardScoredLeg[],
  varietySeed?: string,
): BoardScoredLeg[] {
  return [...legs].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
}
