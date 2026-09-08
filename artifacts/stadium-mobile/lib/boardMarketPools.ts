// Partition board-scored legs into separate ranked pools for balanced ticket assembly.

import type { ParsedPick } from "./parsedPick.ts";
import { isAltBoardPick, isMainLineGameLeg } from "./altLinePool.ts";
import { isGameLinePick } from "./gameSimScoring.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import type { BoardMarketCategory } from "./balancedTicketMix.ts";
import { BOARD_MARKET_CATEGORIES } from "./balancedTicketMix.ts";

export function isTeamTotalMarket(market: string): boolean {
  return /team total/i.test(String(market ?? ""));
}

/** Classify a scored leg into props / main game lines / team totals / alternate lines. */
export function boardMarketCategory(pick: ParsedPick): BoardMarketCategory {
  if (pick.isProp) return "props";
  if (!isGameLinePick(pick)) return "gameLines";
  if (isTeamTotalMarket(pick.market)) return "teamTotals";
  if (isMainLineGameLeg(pick) && !isAltBoardPick(pick)) return "gameLines";
  return "alternateLines";
}

export type PartitionedBoardPools = Record<BoardMarketCategory, BoardScoredLeg[]>;

export function emptyPartitionedPools(): PartitionedBoardPools {
  return { props: [], gameLines: [], teamTotals: [], alternateLines: [] };
}

/** Split qualifying scored legs into four independently rankable pools. */
export function partitionScoredLegsByCategory(scored: BoardScoredLeg[]): PartitionedBoardPools {
  const pools = emptyPartitionedPools();
  for (const leg of scored) {
    pools[boardMarketCategory(leg.pick)].push(leg);
  }
  for (const key of BOARD_MARKET_CATEGORIES) {
    pools[key].sort((a, b) => b.rankScore - a.rankScore);
  }
  return pools;
}

export function countPartitionedPools(pools: PartitionedBoardPools): Record<BoardMarketCategory, number> {
  return {
    props: pools.props.length,
    gameLines: pools.gameLines.length,
    teamTotals: pools.teamTotals.length,
    alternateLines: pools.alternateLines.length,
  };
}

export function ticketCategoryMix(picks: ParsedPick[]): {
  props: number;
  gameLines: number;
  teamTotals: number;
  alternateLines: number;
  propShare: number;
} {
  const counts = { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 };
  for (const p of picks) {
    counts[boardMarketCategory(p)] += 1;
  }
  const total = picks.length || 1;
  return { ...counts, propShare: counts.props / total };
}
