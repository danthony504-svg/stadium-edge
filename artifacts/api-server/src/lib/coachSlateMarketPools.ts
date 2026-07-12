// Partition server-ranked legs into category pools for balanced ticket assembly.

import type { ParsedPick } from "./coachSlateTypes.js";
import type { BoardMarketCategory } from "./coachSlateBalancedMix.js";
import { BOARD_MARKET_CATEGORIES } from "./coachSlateBalancedMix.js";

export type ServerRankedLeg = { pick: ParsedPick; rankScore: number; isAlt: boolean };

function isTeamTotalMarket(market: string): boolean {
  return /team total/i.test(String(market ?? ""));
}

function isGameLinePick(pick: ParsedPick): boolean {
  if (pick.isProp) return false;
  const m = String(pick.market ?? "").toLowerCase();
  if (/team total|race to/.test(m)) return true;
  if (/spread|run ?line|puck ?line|total|over|under|o\/u|money|h2h|\bml\b/.test(m)) return true;
  return false;
}

function isAlternateOrPeriodMarket(market: string): boolean {
  const m = String(market ?? "").toLowerCase();
  return /^alt\s/i.test(m) || /\balt\b/i.test(m) || /^1h|^2h|^q[1-4]|^f5|period|inning/i.test(m);
}

function isMainLineGameLeg(pick: ParsedPick): boolean {
  if (pick.isProp) return false;
  if (isAlternateOrPeriodMarket(pick.market) && !/^1h|^2h|^q[1-4]|^f5|period|inning/i.test(pick.market)) {
    return false;
  }
  const m = pick.market.trim().toLowerCase();
  if (/^moneyline$|^ml$|^h2h$|money line/.test(m)) return true;
  if (/^spread$/i.test(m)) return true;
  if (/^total$/i.test(m)) return true;
  if (/\bml\b/i.test(pick.pick) && !/\balt\b/i.test(m)) return true;
  if (/^1h|^2h|^q[1-4]|^f5|period|inning/i.test(m)) return true;
  return false;
}

function isAltBoardPick(pick: ParsedPick): boolean {
  if (pick.isProp) return !!pick.propIsAlt || /\balt\b/i.test(pick.market);
  if (isMainLineGameLeg(pick)) return false;
  return isAlternateOrPeriodMarket(pick.market) || /\balt\b/i.test(pick.market);
}

/** Classify a ranked leg into props / main game lines / team totals / alternate lines. */
export function serverBoardMarketCategory(pick: ParsedPick): BoardMarketCategory {
  if (pick.isProp) return "props";
  if (!isGameLinePick(pick)) return "gameLines";
  if (isTeamTotalMarket(pick.market)) return "teamTotals";
  if (isMainLineGameLeg(pick) && !isAltBoardPick(pick)) return "gameLines";
  return "alternateLines";
}

export type PartitionedServerPools = Record<BoardMarketCategory, ServerRankedLeg[]>;

export function emptyPartitionedServerPools(): PartitionedServerPools {
  return { props: [], gameLines: [], teamTotals: [], alternateLines: [] };
}

/** Split qualifying ranked legs into four independently rankable pools. */
export function partitionServerRankedByCategory(ranked: ServerRankedLeg[]): PartitionedServerPools {
  const pools = emptyPartitionedServerPools();
  for (const leg of ranked) {
    pools[serverBoardMarketCategory(leg.pick)].push(leg);
  }
  for (const key of BOARD_MARKET_CATEGORIES) {
    pools[key].sort((a, b) => b.rankScore - a.rankScore);
  }
  return pools;
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
    counts[serverBoardMarketCategory(p)] += 1;
  }
  const total = picks.length || 1;
  return { ...counts, propShare: counts.props / total };
}
