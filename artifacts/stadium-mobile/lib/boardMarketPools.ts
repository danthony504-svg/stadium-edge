// Partition board-scored legs into separate ranked pools for balanced ticket assembly.

import type { ParsedPick } from "../components/PickCard.tsx";
import { isAltBoardPick, isMainLineGameLeg, marketFamily } from "./altLinePool.ts";
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


/** Spread / ML / total family for game-line submix (stops totals from owning every slot). */
export type GameLineFamily = "spread" | "moneyline" | "total" | "other";

export function gameLineFamily(pick: {
  market?: string | null;
  pick?: string | null;
  isProp?: boolean;
}): GameLineFamily {
  if (pick.isProp) return "other";
  const market = String(pick.market ?? "");
  const fam = marketFamily(market);
  if (fam.endsWith("spread") || /run ?line|puck ?line|spread/i.test(market)) return "spread";
  if (fam.endsWith("moneyline") || /moneyline|\bml\b|h2h/i.test(market)) return "moneyline";
  if (
    fam.endsWith("total") ||
    isTeamTotalMarket(market) ||
    /\btotal\b|over\/under|o\/u/i.test(market)
  ) {
    return "total";
  }
  const label = String(pick.pick ?? "");
  if (/[+-]\d+(?:\.\d+)?/.test(label) && !/\bover\b|\bunder\b/i.test(label)) return "spread";
  if (/\bover\b|\bunder\b/i.test(label)) return "total";
  return "other";
}

/**
 * Re-order a game-line / alt pool so sides (spread, then ML) are considered
 * before totals when filling reserved slots. Rank within each family is preserved.
 */
export function orderLegsPreferringSides(pool: BoardScoredLeg[]): BoardScoredLeg[] {
  const { sides, rest } = partitionPoolPreferringSides(pool);
  const spreads = sides.filter((leg) => gameLineFamily(leg.pick) === "spread");
  const moneylines = sides.filter((leg) => gameLineFamily(leg.pick) === "moneyline");
  return [...spreads, ...moneylines, ...rest];
}

/** Split sides (spread / ML) from totals & other — used for sides-first slot fill. */
export function partitionPoolPreferringSides(pool: BoardScoredLeg[]): {
  sides: BoardScoredLeg[];
  rest: BoardScoredLeg[];
} {
  const sides: BoardScoredLeg[] = [];
  const rest: BoardScoredLeg[] = [];
  for (const leg of pool) {
    const fam = gameLineFamily(leg.pick);
    if (fam === "spread" || fam === "moneyline") sides.push(leg);
    else rest.push(leg);
  }
  return { sides, rest };
}

