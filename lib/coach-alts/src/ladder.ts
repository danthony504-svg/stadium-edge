import type { CoachQualifiedLeg } from "@workspace/coach-types";
import type { CoachRankedLeg } from "@workspace/coach-rank";

import { marketLadderKey } from "./ladderKey";
import {
  championDisplayIndices,
  compareRungSafety,
  isMainRung,
  ladderTierForSiblingIndex,
} from "./tiers";
import type { CoachAltLadder, CoachAltLadderIndex, CoachAltRung } from "./types";

function scoreForChampion(leg: CoachQualifiedLeg & { rankScore?: number }): number {
  if ("rankScore" in leg && leg.rankScore != null) return leg.rankScore;
  return leg.compositeScore + leg.edgePct * 2;
}

function toAltRung<T extends CoachQualifiedLeg>(
  leg: T,
  ladderPosition: number,
  siblingCount: number,
): CoachAltRung<T> {
  return {
    ...leg,
    tierLabel: ladderTierForSiblingIndex(ladderPosition, siblingCount),
    ladderPosition,
    isMainRung: isMainRung(leg),
  };
}

function buildLadder<T extends CoachQualifiedLeg>(key: string, legs: T[]): CoachAltLadder<T> {
  const sorted = [...legs].sort((a, b) => {
    const mainA = isMainRung(a) ? 0 : 1;
    const mainB = isMainRung(b) ? 0 : 1;
    if (mainA !== mainB) return mainA - mainB;
    const safety = compareRungSafety(a, b);
    if (safety !== 0) return safety;
    return scoreForChampion(b) - scoreForChampion(a);
  });

  const rungs = sorted.map((leg, index) => toAltRung(leg, index, sorted.length));
  const mainRung = rungs.find((r) => r.isMainRung) ?? null;

  const championCandidates = [...rungs].sort((a, b) => {
    const mainA = a.isMainRung ? 0 : 1;
    const mainB = b.isMainRung ? 0 : 1;
    if (mainA !== mainB) return mainA - mainB;
    return scoreForChampion(b) - scoreForChampion(a);
  });
  const champion = championCandidates[0] ?? null;

  const displayRungs = championDisplayIndices(rungs.length)
    .map((index) => rungs[index])
    .filter((r): r is CoachAltRung<T> => r != null);

  const sample = legs[0]!;
  return {
    ladderKey: key,
    sport: String(sample.sport),
    gameId: sample.gameId,
    gameLabel: sample.gameLabel,
    marketKey: sample.marketKey,
    kind: sample.kind,
    playerId: sample.playerId,
    playerName: sample.playerName,
    propSide: sample.propSide ?? null,
    rungs,
    champion,
    mainRung,
    displayRungs,
  };
}

/** Group gate-qualified legs into per-market ladders with tier labels. */
export function buildAltLadders<T extends CoachQualifiedLeg>(legs: T[]): CoachAltLadder<T>[] {
  const groups = new Map<string, T[]>();
  for (const leg of legs) {
    const key = marketLadderKey(leg);
    const bucket = groups.get(key) ?? [];
    bucket.push(leg);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => buildLadder(key, bucket));
}

/** One champion per ladder — mains preferred, used before ticket assembly. */
export function collapseLadderChampions<T extends CoachQualifiedLeg>(
  ladders: CoachAltLadder<T>[],
): CoachAltRung<T>[] {
  return ladders
    .map((ladder) => ladder.champion)
    .filter((r): r is CoachAltRung<T> => r != null);
}

export function buildAltLadderIndex(legs: CoachRankedLeg[]): CoachAltLadderIndex {
  const ladders = buildAltLadders(legs);
  return {
    ladders,
    champions: collapseLadderChampions(ladders),
  };
}

/** When main fails gates, the next qualified alt in the same ladder may promote. */
export function findAltPromotion(
  ladder: CoachAltLadder,
): CoachAltRung | null {
  if (!ladder.mainRung) return ladder.champion;
  if (ladder.champion && !ladder.champion.isMainRung) return ladder.champion;
  const alt = ladder.rungs.find((r) => !r.isMainRung);
  return alt ?? null;
}
