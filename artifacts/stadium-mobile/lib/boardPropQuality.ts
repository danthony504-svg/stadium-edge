// "Best on today's board" gate — only recommend a prop when player AND matchup
// agree AND the play ranks among the top options on the slate for its market.

import type { PropDualScore } from "./propDualScore.ts";
import { boardRankScore, playerMatchupAgree } from "./propDualScore.ts";

/** Top ~12% of the scored board, or #1 in a market family. */
export const BOARD_TOP_PERCENTILE = 0.88;

/** Must be within this fraction of the family leader to count as "best". */
export const BOARD_FAMILY_LEADER_EPS = 0.97;

export type BoardQualityCtx = {
  rankScore: number;
  /** 1 = best on board, 0 = worst among scored entries. */
  globalPercentile: number;
  bestInFamily: boolean;
  familyRank: number;
  familySize: number;
};

export function marketFamilyKey(marketKey: string): string {
  return String(marketKey || "")
    .toLowerCase()
    .replace(/^player_/, "")
    .replace(/^batter_/, "")
    .replace(/^pitcher_/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export type BoardScoredEntry = {
  key: string;
  marketFamily: string;
  triple: PropDualScore;
};

/** Rank today's board. Only entries with agreeing player+matchup scores compete. */
export function buildBoardQualityIndex(
  entries: BoardScoredEntry[],
): Map<string, BoardQualityCtx> {
  const out = new Map<string, BoardQualityCtx>();
  const scored = entries
    .map((e) => {
      const rankScore = boardRankScore(e.triple);
      return rankScore != null ? { ...e, rankScore } : null;
    })
    .filter((x): x is BoardScoredEntry & { rankScore: number } => x != null);

  if (scored.length === 0) return out;

  const globalSorted = [...scored].sort((a, b) => b.rankScore - a.rankScore);
  const globalRank = new Map<string, number>();
  globalSorted.forEach((e, i) => globalRank.set(e.key, i));

  const byFamily = new Map<string, Array<BoardScoredEntry & { rankScore: number }>>();
  for (const e of scored) {
    const fam = e.marketFamily || "other";
    const list = byFamily.get(fam) ?? [];
    list.push(e);
    byFamily.set(fam, list);
  }

  const familyBest = new Map<string, number>();
  const familyRank = new Map<string, number>();
  for (const [fam, list] of byFamily) {
    const sorted = [...list].sort((a, b) => b.rankScore - a.rankScore);
    familyBest.set(fam, sorted[0]?.rankScore ?? 0);
    sorted.forEach((e, i) => familyRank.set(e.key, i));
  }

  const n = globalSorted.length;
  for (const e of scored) {
    const gIdx = globalRank.get(e.key) ?? n - 1;
    const percentile = n <= 1 ? 1 : 1 - gIdx / (n - 1);
    const fam = e.marketFamily || "other";
    const best = familyBest.get(fam) ?? e.rankScore;
    const fIdx = familyRank.get(e.key) ?? 0;
    const fSize = byFamily.get(fam)?.length ?? 1;
    out.set(e.key, {
      rankScore: e.rankScore,
      globalPercentile: percentile,
      bestInFamily: e.rankScore >= best * BOARD_FAMILY_LEADER_EPS,
      familyRank: fIdx,
      familySize: fSize,
    });
  }

  return out;
}

export function passesBoardQuality(ctx: BoardQualityCtx | null | undefined): boolean {
  if (!ctx) return false;
  return ctx.bestInFamily || ctx.globalPercentile >= BOARD_TOP_PERCENTILE;
}

export function boardQualityExplanation(
  ctx: BoardQualityCtx | null | undefined,
  marketFamily: string,
): string {
  if (!ctx) {
    return "Not one of today's best plays — player and matchup must both agree and rank near the top of the board.";
  }
  if (passesBoardQuality(ctx)) return "";
  const fam = marketFamily.replace(/_/g, " ");
  if (ctx.familySize > 1 && !ctx.bestInFamily) {
    return `Not the best ${fam} bet on today's board — we only recommend the top play in each market when both player and matchup agree.`;
  }
  return `Solid read, but not elite enough for today's slate (top ${Math.round((1 - BOARD_TOP_PERCENTILE) * 100)}% only).`;
}

/** Score entire pool rows for board indexing (Coach / Simulator). */
export function scoreBoardCandidate(triple: PropDualScore): number | null {
  if (!playerMatchupAgree(triple.playerScore, triple.matchupScore).agrees) return null;
  return boardRankScore(triple);
}
