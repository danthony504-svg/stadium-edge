// Per-market ladder exhaustion — distinct thresholds score independently;
// ticket seating still allows only one correlated rung (see marketLadderKey).

import type { ParsedPick } from "../components/PickCard.tsx";
import { isAltPropPick, isMainBoardPick, isMainLineGameLeg } from "./altLinePool.ts";
import { boardLegPoolRole, type BoardScoredLeg } from "./ticketStaging.ts";
import { marketLadderKey, marketLadderScoreKey } from "./marketLadderKey.ts";

export {
  marketLadderKey,
  marketLadderScoreKey,
  postedLineKey,
  wouldRepeatMarketLadder,
  dedupePicksByMarketLadder,
} from "./marketLadderKey.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function ladderSortRank(leg: BoardScoredLeg): number {
  const pick = leg.pick;
  if (pick.isProp) {
    if (!isAltPropPick(pick)) return 0;
    return 1;
  }
  if (isMainLineGameLeg(pick)) return 0;
  return 1;
}

function isYardsPropMarketLabel(market: string | null | undefined): boolean {
  const m = norm(market ?? "");
  return (
    /\brush yds\b/.test(m) ||
    /\bpass yds\b/.test(m) ||
    /\brec yds\b/.test(m) ||
    /\breceiving yards\b/.test(m) ||
    /\brushing yards\b/.test(m) ||
    /\bpassing yards\b/.test(m)
  );
}

/** Near-tie on yards ladders: prefer higher posted milestone numbers. */
const YARDS_LADDER_SCORE_TIE_EPS = 0.5;

function comparePropLadderRungs(a: BoardScoredLeg, b: BoardScoredLeg): number {
  const scoreDiff = b.rankScore - a.rankScore;
  if (Math.abs(scoreDiff) > YARDS_LADDER_SCORE_TIE_EPS) return scoreDiff;
  if (isYardsPropMarketLabel(a.pick.market)) {
    const lineA = a.pick.propLine ?? 0;
    const lineB = b.pick.propLine ?? 0;
    if (lineB !== lineA) return lineB - lineA;
  }
  if (scoreDiff !== 0) return scoreDiff;
  return ladderSortRank(a) - ladderSortRank(b);
}

/**
 * Keep the best qualifying copy of each distinct posted threshold.
 * Different lines (main 67.5 vs alt 149.5, spread +1.5 vs +3.5) survive so they
 * can compete fairly in staging. Final tickets still call
 * {@link wouldRepeatMarketLadder} / {@link dedupePicksByMarketLadder} so only
 * one correlated rung per side seats.
 */
export function collapseScoredLegsByMarketLadder(scored: BoardScoredLeg[]): BoardScoredLeg[] {
  const byScoreKey = new Map<string, BoardScoredLeg[]>();
  for (const leg of scored) {
    const key = marketLadderScoreKey(leg.pick);
    const arr = byScoreKey.get(key) ?? [];
    arr.push(leg);
    byScoreKey.set(key, arr);
  }

  const out: BoardScoredLeg[] = [];
  for (const ladder of byScoreKey.values()) {
    const propLadder = ladder.some((leg) => !!leg.pick.isProp);
    ladder.sort((a, b) => {
      if (propLadder) {
        return comparePropLadderRungs(a, b);
      }
      // Fair competition: best rankScore wins among identical score-keys
      // (duplicate rows). No mains-first preference across different lines —
      // those are separate score-keys.
      const scoreDiff = b.rankScore - a.rankScore;
      if (scoreDiff !== 0) return scoreDiff;
      return ladderSortRank(a) - ladderSortRank(b);
    });
    for (const leg of ladder) {
      const role = boardLegPoolRole(leg.pick, leg.pick.finalAiScore);
      if (role === "main" || role === "alt") {
        out.push(leg);
        break;
      }
    }
  }
  return out;
}

/** Classify a pick's ladder tier for server/mobile parity. */
export function isMainLadderRung(pick: ParsedPick): boolean {
  if (pick.isProp) return !isAltPropPick(pick);
  return isMainLineGameLeg(pick) || isMainBoardPick(pick);
}
