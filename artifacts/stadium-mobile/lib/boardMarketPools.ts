// Partition board-scored legs into separate ranked pools for balanced ticket assembly.

import type { ParsedPick } from "../components/PickCard.tsx";
import { isAltBoardPick, isMainLineGameLeg, isPeriodMainMarket, marketFamily } from "./altLinePool.ts";
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
  // Period mains stay "main" for badges, but staging treats them as alts so
  // reserved game-line slots prefer full-game spread/ML over Q1–Q4 / 1H sides.
  if (isPeriodMainMarket(pick.market)) return "alternateLines";
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

/** Heavy minus juice — still postable for discovery, but mix slots prefer near-even sides. */
export const HEAVY_SIDE_JUICE_ODDS = -250;

export function isHeavySideJuice(odds: number | null | undefined): boolean {
  return typeof odds === "number" && Number.isFinite(odds) && odds <= HEAVY_SIDE_JUICE_ODDS;
}

export function isFullGameSideMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "");
  if (!m.trim()) return false;
  if (isPeriodMainMarket(m)) return false;
  const fam = gameLineFamily({ market: m });
  return fam === "spread" || fam === "moneyline";
}

/**
 * Re-order a game-line / alt pool so sides (spread, then ML) are considered
 * before totals when filling reserved slots. Full-game sides beat period sides;
 * reasonable juice beats heavy favorites. Rank within each bucket is preserved.
 */
export function orderLegsPreferringSides(pool: BoardScoredLeg[]): BoardScoredLeg[] {
  const { sides, rest } = partitionPoolPreferringSides(pool);
  return [...sides, ...rest];
}

function isPeriodSideMarket(market: string): boolean {
  if (isPeriodMainMarket(market)) return true;
  return /(?:\b|\s)(q[1-4]|1h|2h|f5)\b/i.test(market);
}

function bySpreadThenMl(legs: BoardScoredLeg[]): BoardScoredLeg[] {
  const spreads = legs.filter((leg) => gameLineFamily(leg.pick) === "spread");
  const moneylines = legs.filter((leg) => gameLineFamily(leg.pick) === "moneyline");
  const other = legs.filter((leg) => {
    const fam = gameLineFamily(leg.pick);
    return fam !== "spread" && fam !== "moneyline";
  });
  return [...spreads, ...moneylines, ...other];
}

/**
 * Ordered side tiers for slot fill. Kept separate so rank re-sort inside a tier
 * cannot let Q4 / -415 alts beat full-game fair spreads across tiers.
 */
export function sidePriorityTiers(pool: BoardScoredLeg[]): BoardScoredLeg[][] {
  const fgFair: BoardScoredLeg[] = [];
  const periodFair: BoardScoredLeg[] = [];
  const fgHeavy: BoardScoredLeg[] = [];
  const periodHeavy: BoardScoredLeg[] = [];
  for (const leg of pool) {
    const fam = gameLineFamily(leg.pick);
    if (fam !== "spread" && fam !== "moneyline") continue;
    const period = isPeriodSideMarket(String(leg.pick.market ?? ""));
    const heavy = isHeavySideJuice(leg.pick.odds);
    if (!period && !heavy) fgFair.push(leg);
    else if (period && !heavy) periodFair.push(leg);
    else if (!period && heavy) fgHeavy.push(leg);
    else periodHeavy.push(leg);
  }
  return [
    bySpreadThenMl(fgFair),
    bySpreadThenMl(periodFair),
    bySpreadThenMl(fgHeavy),
    bySpreadThenMl(periodHeavy),
  ].filter((tier) => tier.length > 0);
}

/** Split sides (spread / ML) from totals & other — FG / fair juice first for slot fill. */
export function partitionPoolPreferringSides(pool: BoardScoredLeg[]): {
  sides: BoardScoredLeg[];
  rest: BoardScoredLeg[];
} {
  const rest: BoardScoredLeg[] = [];
  for (const leg of pool) {
    const fam = gameLineFamily(leg.pick);
    if (fam !== "spread" && fam !== "moneyline") rest.push(leg);
  }
  const sides = sidePriorityTiers(pool).flat();
  return { sides, rest };
}

/** Over / Under / other for soft prop-side diversity on mix tickets. */
export type PropOuSide = "over" | "under" | "other";

export function propOuSide(pick: {
  pick?: string | null;
  propSide?: string | null;
  side?: string | null;
}): PropOuSide {
  const explicit = String(pick.propSide ?? pick.side ?? "").toLowerCase();
  if (explicit === "under") return "under";
  if (explicit === "over") return "over";
  const label = String(pick.pick ?? "");
  if (/\bunder\b/i.test(label)) return "under";
  if (/\bover\b/i.test(label)) return "over";
  return "other";
}

/**
 * Soft Over/Under balance among already-qualified props: reserve up to half the
 * prop slots for Unders when they exist so tickets are not all "Over 0.5 …".
 */
export function partitionPropPoolPreferringSideBalance(pool: BoardScoredLeg[]): {
  unders: BoardScoredLeg[];
  overs: BoardScoredLeg[];
  other: BoardScoredLeg[];
} {
  const unders: BoardScoredLeg[] = [];
  const overs: BoardScoredLeg[] = [];
  const other: BoardScoredLeg[] = [];
  for (const leg of pool) {
    const side = propOuSide(leg.pick);
    if (side === "under") unders.push(leg);
    else if (side === "over") overs.push(leg);
    else other.push(leg);
  }
  return { unders, overs, other };
}

/**
 * Prefer spread/ML ahead of totals among non-prop legs so the lead card is not
 * another Over (e.g. Over 48) when a qualifying Falcons +6 exists.
 */
function orderSidesPreferringSpreadMl<
  T extends { market?: string | null; pick?: string | null; isProp?: boolean },
>(sides: T[]): T[] {
  const spreads: T[] = [];
  const moneylines: T[] = [];
  const rest: T[] = [];
  for (const s of sides) {
    const fam = gameLineFamily(s);
    if (fam === "spread") spreads.push(s);
    else if (fam === "moneyline") moneylines.push(s);
    else rest.push(s);
  }
  return [...spreads, ...moneylines, ...rest];
}

/**
 * Re-order a staged ticket so the first viewport is not a wall of Over props.
 * Keeps the same legs; prefers spread/ML for the lead card, then alternates.
 */
export function interleaveSidesWithProps<
  T extends { isProp?: boolean; market?: string | null; pick?: string | null },
>(picks: T[]): T[] {
  if (picks.length < 3) return picks;
  const props: T[] = [];
  const sidesRaw: T[] = [];
  for (const p of picks) {
    if (p.isProp) props.push(p);
    else sidesRaw.push(p);
  }
  if (!props.length || !sidesRaw.length) return picks;

  const sides = orderSidesPreferringSpreadMl(sidesRaw);
  const out: T[] = [];
  let pi = 0;
  let si = 0;
  // Lead with spread/ML when available so "7 leg nfl" does not open on Overs.
  out.push(sides[si++]!);
  while (out.length < picks.length && (pi < props.length || si < sides.length)) {
    // Two props per side when props are the majority (~50–60% mix).
    if (pi < props.length) out.push(props[pi++]!);
    if (out.length >= picks.length) break;
    if (pi < props.length) out.push(props[pi++]!);
    if (out.length >= picks.length) break;
    if (si < sides.length) out.push(sides[si++]!);
  }
  while (pi < props.length && out.length < picks.length) out.push(props[pi++]!);
  while (si < sides.length && out.length < picks.length) out.push(sides[si++]!);
  return out;
}
