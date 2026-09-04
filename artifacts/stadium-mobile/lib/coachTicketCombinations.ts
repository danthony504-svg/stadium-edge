// Independent high-quality parlay tickets — many candidates, diversity-aware selection.

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  BALANCED_BACKFILL_ORDER,
  balancedMixSlots,
  type BoardMarketCategory,
} from "./balancedTicketMix.ts";
import { partitionScoredLegsByCategory } from "./boardMarketPools.ts";
import { compareBoardLegsForRank, sortBoardLegsForRank } from "./coachBoardRankVariety.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";
import {
  isThinPropStatMarket,
  maxLegsPerThinStatMarket,
  parlayCorrelationPenalty,
} from "./parlayCorrelationScore.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import {
  isPrefixLegKeys,
  parlayLegKey,
  parlayPlayerKey,
  ticketOverlapRatio,
  type CoachParlayVarietyContext,
} from "./parlayVarietyMemory.ts";
import { shuffleWithSeed, varietyRankKey } from "./varietySeed.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";
import { coachMarketFamily, type CoachMarketFamily } from "./coachMarketDiagnostics.ts";
import {
  absoluteFloorForStyle,
  type CoachTicketStyle,
  type QualityTierGrade,
  poolRoleAtMinGrade,
  qualityTiersForStyle,
} from "./coachTicketQualityTiers.ts";
import {
  boardLegPoolRole,
  capThinStatMarketsOnTicket,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

/** Build 25–50 independent candidate tickets per request (user: more variety). */
export const TICKET_CANDIDATE_COUNT = 40;
/** Only repeat a player when edge beats the best alternative by this much. */
export const SIGNIFICANT_EDGE_GAP_PCT = 3;
/** Near-equal edge band for diversity swaps (user: ~1–2%). */
export const NEAR_EQUAL_TICKET_EDGE_PCT = 2;
/** Max leg overlap vs a recent ticket before we prefer another candidate. */
export const MAX_RECENT_TICKET_OVERLAP = 0.4;
/** Lead-player repeat penalty unless edge gap exceeds this. */
export const SIGNIFICANT_LEAD_EDGE_GAP_PCT = 2.5;

export type CoachTicketBuildOpts = {
  varietySeed: string;
  /** Safe / Balanced / Value / Longshot — controls how far quality relaxes when filling legs. */
  ticketStyle?: CoachTicketStyle;
  /** Rank all market categories together; used by the final Coach board scan. */
  marketAgnostic?: boolean;
} & Partial<CoachParlayVarietyContext>;

type TicketCandidate = {
  picks: ParsedPick[];
  legKeys: string[];
  qualityScore: number;
  diversityScore: number;
  varietyPenalty: number;
  familyVariety: TicketFamilyVarietyAudit;
};

export type TicketFamilyVarietyAudit = {
  qualifiedByFamily: Record<CoachMarketFamily, number>;
  selectedByFamily: Record<CoachMarketFamily, number>;
  skippedFamilies: Array<{
    marketFamily: CoachMarketFamily;
    qualifiedCount: number;
    reason: string;
  }>;
};

function emptyFamilyCounts(): Record<CoachMarketFamily, number> {
  return {
    moneyline: 0,
    spread: 0,
    gameTotal: 0,
    teamTotal: 0,
    playerOu: 0,
    milestone: 0,
    alternate: 0,
  };
}

function familyCounts(
  rows: readonly BoardScoredLeg[] | readonly ParsedPick[],
): Record<CoachMarketFamily, number> {
  const counts = emptyFamilyCounts();
  for (const row of rows) {
    const pick = "rankScore" in row ? row.pick : row;
    counts[coachMarketFamily(pick)]++;
  }
  return counts;
}

type AssemblyConfig = {
  seed: string;
  diversityWeight: number;
  bandOffset: number;
  categoryOrder: readonly BoardMarketCategory[];
  poolRotate: number;
  recentLegKeys?: Set<string>;
  recentLeadPlayers?: readonly string[];
  recentPlayerCounts?: ReadonlyMap<string, number>;
  lineShoppingBias: number;
};

/** Per-leg-count optimization — different pools, weights, and assembly for each size. */
type TicketSizeProfile = {
  diversityBase: number;
  poolRotate: number;
  orderShift: number;
  lineShoppingBias: number;
  candidateCount: number;
};

const SIZE_PROFILES: Partial<Record<number, TicketSizeProfile>> = {
  3: { diversityBase: 0.58, poolRotate: 3, orderShift: 5, lineShoppingBias: 1.1, candidateCount: 32 },
  4: { diversityBase: 0.54, poolRotate: 4, orderShift: 3, lineShoppingBias: 1.05, candidateCount: 36 },
  5: { diversityBase: 0.5, poolRotate: 5, orderShift: 2, lineShoppingBias: 1.0, candidateCount: 40 },
  6: { diversityBase: 0.45, poolRotate: 6, orderShift: 4, lineShoppingBias: 0.95, candidateCount: 40 },
  8: { diversityBase: 0.4, poolRotate: 7, orderShift: 1, lineShoppingBias: 0.9, candidateCount: 40 },
  9: { diversityBase: 0.36, poolRotate: 4, orderShift: 6, lineShoppingBias: 0.85, candidateCount: 40 },
  10: { diversityBase: 0.32, poolRotate: 8, orderShift: 3, lineShoppingBias: 0.8, candidateCount: 40 },
  15: { diversityBase: 0.28, poolRotate: 2, orderShift: 0, lineShoppingBias: 0.75, candidateCount: 40 },
};

function ticketSizeProfile(target: number): TicketSizeProfile {
  const known = SIZE_PROFILES[target];
  if (known) return known;
  return {
    diversityBase: 0.3 + (target % 6) * 0.06,
    poolRotate: (target * 3) % 9,
    orderShift: target % ASSEMBLY_CATEGORY_ORDERS.length,
    lineShoppingBias: 0.7 + (target % 4) * 0.1,
    candidateCount: TICKET_CANDIDATE_COUNT,
  };
}

function sizeScopedSeed(varietySeed: string, target: number): string {
  return `${varietySeed}|legs-${target}`;
}

function rotateLegPoolForSize<T>(pool: T[], rotate: number): T[] {
  if (!pool.length || rotate <= 0) return pool;
  const skip = rotate % pool.length;
  if (!skip) return pool;
  return [...pool.slice(skip), ...pool.slice(0, skip)];
}

function largerTicketsForTarget(
  target: number,
  bySize?: ReadonlyMap<number, readonly (readonly string[])[]>,
): readonly (readonly string[])[] {
  if (!bySize?.size) return [];
  const out: (readonly string[])[] = [];
  for (const [size, tickets] of bySize.entries()) {
    if (size <= target) continue;
    for (const ticket of tickets) out.push(ticket);
  }
  return out;
}

const ASSEMBLY_CATEGORY_ORDERS: readonly (readonly BoardMarketCategory[])[] = [
  ["props", "gameLines", "teamTotals", "alternateLines"],
  ["gameLines", "props", "teamTotals", "alternateLines"],
  ["props", "teamTotals", "gameLines", "alternateLines"],
  ["gameLines", "teamTotals", "props", "alternateLines"],
  ["props", "alternateLines", "gameLines", "teamTotals"],
  ["teamTotals", "props", "gameLines", "alternateLines"],
  ["alternateLines", "props", "gameLines", "teamTotals"],
  ["props", "gameLines", "alternateLines", "teamTotals"],
];

function qualifyingScoredLegs(scored: BoardScoredLeg[]): BoardScoredLeg[] {
  return scored.filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null);
}

function legsNearlyEqualEdge(a: BoardScoredLeg, b: BoardScoredLeg): boolean {
  const edgeA = a.edgePct ?? 0;
  const edgeB = b.edgePct ?? 0;
  return Math.abs(edgeA - edgeB) <= NEAR_EQUAL_TICKET_EDGE_PCT;
}

function rotateNearEqualBands(
  legs: BoardScoredLeg[],
  bandOffset: number,
  seed: string,
): BoardScoredLeg[] {
  if (legs.length <= 1) return legs;
  const bands: BoardScoredLeg[][] = [];
  let current: BoardScoredLeg[] = [legs[0]!];
  for (let i = 1; i < legs.length; i++) {
    const prev = legs[i - 1]!;
    const row = legs[i]!;
    if (legsNearlyEqualEdge(prev, row) && boardLegsNearlyEqualRank(prev, row)) {
      current.push(row);
    } else {
      bands.push(current);
      current = [row];
    }
  }
  bands.push(current);

  const out: BoardScoredLeg[] = [];
  for (const band of bands) {
    if (band.length <= 1) {
      out.push(...band);
      continue;
    }
    const rot =
      (bandOffset + varietyRankKey(seed, parlayLegKey(band[0]!.pick))) % band.length;
    out.push(...band.slice(rot), ...band.slice(0, rot));
  }
  return out;
}

function boardLegsNearlyEqualRank(a: BoardScoredLeg, b: BoardScoredLeg): boolean {
  return Math.abs(b.rankScore - a.rankScore) <= 3;
}

function bestAlternativeEdge(
  leg: BoardScoredLeg,
  pool: BoardScoredLeg[],
  ticket: ParsedPick[],
  selected: ParsedPick[],
): number {
  const onTicket = new Set(
    [...ticket, ...selected].map((p) => pickLegFingerprint(p)),
  );
  const player = leg.pick.player?.toLowerCase();
  let best = -Infinity;
  for (const row of pool) {
    const fp = pickLegFingerprint(row.pick);
    if (onTicket.has(fp)) continue;
    if (player && row.pick.player?.toLowerCase() === player) continue;
    if (boardLegPoolRole(row.pick, row.pick.finalAiScore) == null) continue;
    const edge = row.edgePct ?? 0;
    if (edge > best) best = edge;
  }
  return best === -Infinity ? 0 : best;
}

function samePlayerRepeatPenalty(
  leg: BoardScoredLeg,
  pool: BoardScoredLeg[],
  ticket: ParsedPick[],
  selected: ParsedPick[],
): number {
  const player = leg.pick.player?.toLowerCase();
  if (!player) return 0;
  const onTicket = [...ticket, ...selected].some(
    (p) => p.player?.toLowerCase() === player,
  );
  if (!onTicket) return 0;
  const legEdge = leg.edgePct ?? 0;
  const altEdge = bestAlternativeEdge(leg, pool, ticket, selected);
  if (legEdge - altEdge >= SIGNIFICANT_EDGE_GAP_PCT) return 0;
  if (legEdge - altEdge >= 1) return 36;
  return 52;
}

function recentLegPenalty(
  leg: BoardScoredLeg,
  pool: BoardScoredLeg[],
  ticket: ParsedPick[],
  selected: ParsedPick[],
  recentLegKeys?: Set<string>,
): number {
  if (!recentLegKeys?.has(parlayLegKey(leg.pick))) return 0;
  const legEdge = leg.edgePct ?? 0;
  const altEdge = bestAlternativeEdge(leg, pool, ticket, selected);
  if (legEdge - altEdge >= SIGNIFICANT_EDGE_GAP_PCT) return 8;
  return 38;
}

function lineShoppingTieBonus(
  leg: BoardScoredLeg,
  config: AssemblyConfig,
): number {
  const score = leg.lineShoppingScore;
  if (score == null || score <= 0) return 0;
  return score * 0.04 * config.lineShoppingBias;
}

function pickDiverseLegsFromPool(
  pool: BoardScoredLeg[],
  ticket: ParsedPick[],
  want: number,
  target: number,
  used: Set<string>,
  config: AssemblyConfig,
): ParsedPick[] {
  if (want <= 0) return [];
  const available = pool.filter((row) => {
    const fp = pickLegFingerprint(row.pick);
    return !used.has(fp) && boardLegPoolRole(row.pick, row.pick.finalAiScore) != null;
  });
  const ranked = sortBoardLegsForRank(available, config.seed);
  const rotated = rotateNearEqualBands(ranked, config.bandOffset, config.seed);
  const shuffled = shuffleWithSeed(rotated, `${config.seed}|pool-${want}`);
  let poolCopy = [...shuffled];
  if (config.bandOffset > 0 && poolCopy.length > 1) {
    const skip = config.bandOffset % Math.min(poolCopy.length, 6);
    if (skip > 0) {
      poolCopy = [...poolCopy.slice(skip), ...poolCopy.slice(0, skip)];
    }
  }
  const selected: ParsedPick[] = [];

  while (selected.length < want && poolCopy.length) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < poolCopy.length; i++) {
      const row = poolCopy[i]!;
      const fp = pickLegFingerprint(row.pick);
      if (used.has(fp)) continue;
      if (selected.some((p) => pickLegFingerprint(p) === fp)) continue;

      const corr = parlayCorrelationPenalty(row.pick, [...ticket, ...selected]);
      let effective =
        row.rankScore -
        corr * config.diversityWeight -
        samePlayerRepeatPenalty(row, poolCopy, ticket, selected) -
        recentLegPenalty(row, poolCopy, ticket, selected, config.recentLegKeys) +
        lineShoppingTieBonus(row, config);

      if (effective > bestScore) {
        bestScore = effective;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;

    const chosen = poolCopy[bestIdx]!;
    const chosenEdge = chosen.edgePct ?? 0;
    for (let i = 0; i < poolCopy.length; i++) {
      if (i === bestIdx) continue;
      const alt = poolCopy[i]!;
      if (!legsNearlyEqualEdge(chosen, alt)) continue;
      const corrChosen = parlayCorrelationPenalty(chosen.pick, [...ticket, ...selected]);
      const corrAlt = parlayCorrelationPenalty(alt.pick, [...ticket, ...selected]);
      const repeatChosen = samePlayerRepeatPenalty(chosen, poolCopy, ticket, selected);
      const repeatAlt = samePlayerRepeatPenalty(alt, poolCopy, ticket, selected);
      const recentChosen = recentLegPenalty(chosen, poolCopy, ticket, selected, config.recentLegKeys);
      const recentAlt = recentLegPenalty(alt, poolCopy, ticket, selected, config.recentLegKeys);
      const effChosen =
        chosen.rankScore -
        corrChosen * config.diversityWeight -
        repeatChosen -
        recentChosen +
        lineShoppingTieBonus(chosen, config);
      const effAlt =
        alt.rankScore -
        corrAlt * config.diversityWeight -
        repeatAlt -
        recentAlt +
        lineShoppingTieBonus(alt, config);
      if (effAlt > effChosen && Math.abs((alt.edgePct ?? 0) - chosenEdge) <= NEAR_EQUAL_TICKET_EDGE_PCT) {
        bestIdx = i;
      }
    }

    const row = poolCopy[bestIdx]!;
    const role = boardLegPoolRole(row.pick, row.pick.finalAiScore)!;
    const pick = { ...row.pick, ticketRole: role, highRiskValuePlay: false as const };
    selected.push(pick);
    used.add(pickLegFingerprint(pick));
    poolCopy.splice(bestIdx, 1);
  }

  return capThinStatMarketsOnTicket(selected, target);
}

function appendFromCategory(
  ticket: ParsedPick[],
  used: Set<string>,
  pool: BoardScoredLeg[],
  want: number,
  target: number,
  config: AssemblyConfig,
): void {
  const picked = pickDiverseLegsFromPool(pool, ticket, want, target, used, config);
  ticket.push(...picked);
}

function stagedPickFromRow(
  row: BoardScoredLeg,
  role: "main" | "alt",
  fillTier?: QualityTierGrade,
): ParsedPick {
  const strictRole = boardLegPoolRole(row.pick, row.pick.finalAiScore);
  return {
    ...row.pick,
    ticketRole: role,
    highRiskValuePlay: false,
    ...(strictRole || !fillTier ? {} : { coachFillTier: fillTier }),
  };
}

function tryAppendBackfillLeg(
  current: ParsedPick[],
  row: BoardScoredLeg,
  role: "main" | "alt",
  target: number,
  ranked: BoardScoredLeg[],
  config: AssemblyConfig,
  fillTier?: QualityTierGrade,
): ParsedPick[] | null {
  const thinOnTicket = current.filter(
    (p) => p.isProp && isThinPropStatMarket(p.market),
  ).length;
  const maxThin = maxLegsPerThinStatMarket(target);
  if (
    row.pick.isProp &&
    isThinPropStatMarket(row.pick.market) &&
    thinOnTicket >= maxThin
  ) {
    return null;
  }
  const corr = parlayCorrelationPenalty(row.pick, current);
  const repeat = samePlayerRepeatPenalty(row, ranked, current, []);
  const recent = recentLegPenalty(row, ranked, current, [], config.recentLegKeys);
  const trial = capThinStatMarketsOnTicket(
    [...current, stagedPickFromRow(row, role, fillTier)],
    target,
  );
  if (trial.length > current.length && row.rankScore - corr * 0.4 - repeat - recent > 0) {
    return trial;
  }
  return null;
}

function backfillDiverseTicket(
  ticket: ParsedPick[],
  target: number,
  pools: Record<BoardMarketCategory, BoardScoredLeg[]>,
  config: AssemblyConfig,
): ParsedPick[] {
  let current = capThinStatMarketsOnTicket(ticket, target);
  if (current.length >= target) return current.slice(0, target);

  const used = new Set(current.map(pickLegFingerprint));
  for (const cat of BALANCED_BACKFILL_ORDER) {
    if (current.length >= target) break;
    const ranked = sortBoardLegsForRank(pools[cat], config.seed);
    for (const row of ranked) {
      if (current.length >= target) break;
      const fp = pickLegFingerprint(row.pick);
      if (used.has(fp)) continue;
      const role = boardLegPoolRole(row.pick, row.pick.finalAiScore);
      if (!role) continue;
      const trial = tryAppendBackfillLeg(current, row, role, target, ranked, config);
      if (trial) {
        current = trial;
        used.add(fp);
      }
    }
  }
  return current.slice(0, target);
}

function backfillAtQualityTier(
  ticket: ParsedPick[],
  target: number,
  allScored: BoardScoredLeg[],
  minGrade: QualityTierGrade,
  config: AssemblyConfig,
): ParsedPick[] {
  let current = capThinStatMarketsOnTicket(ticket, target);
  if (current.length >= target) return current.slice(0, target);

  const tierLegs = allScored.filter(
    (leg) => poolRoleAtMinGrade(leg.pick, leg.pick.finalAiScore, minGrade) != null,
  );
  const pools = partitionScoredLegsByCategory(tierLegs);
  const used = new Set(current.map(pickLegFingerprint));

  for (const cat of BALANCED_BACKFILL_ORDER) {
    if (current.length >= target) break;
    const ranked = sortBoardLegsForRank(pools[cat], config.seed);
    for (const row of ranked) {
      if (current.length >= target) break;
      const fp = pickLegFingerprint(row.pick);
      if (used.has(fp)) continue;
      const role = poolRoleAtMinGrade(row.pick, row.pick.finalAiScore, minGrade);
      if (!role) continue;
      const trial = tryAppendBackfillLeg(current, row, role, target, ranked, config, minGrade);
      if (trial) {
        current = trial;
        used.add(fp);
      }
    }
  }
  return current.slice(0, target);
}

/** Walk A+→B tiers after strict assembly — only shortfall when all allowed tiers are exhausted. */
export function tieredBackfillStagedTicket(
  ticket: ParsedPick[],
  target: number,
  allScored: BoardScoredLeg[],
  ticketStyle: CoachTicketStyle,
  seed?: string,
): ParsedPick[] {
  if (ticket.length >= target) return ticket.slice(0, target);
  const config: AssemblyConfig = {
    seed: seed ?? "tiered-backfill",
    diversityWeight: 0.35,
    bandOffset: 0,
    categoryOrder: BALANCED_BACKFILL_ORDER,
    poolRotate: 0,
    lineShoppingBias: 1,
  };
  let current = ticket;
  for (const tier of qualityTiersForStyle(ticketStyle)) {
    if (current.length >= target) break;
    current = backfillAtQualityTier(current, target, allScored, tier, config);
  }
  return current.slice(0, target);
}

function assembleBalancedDiverseTicket(
  qualifying: BoardScoredLeg[],
  allScored: BoardScoredLeg[],
  target: number,
  config: AssemblyConfig,
  ticketStyle: CoachTicketStyle = "balanced",
  marketAgnostic = false,
): { picks: ParsedPick[]; familyVariety: TicketFamilyVarietyAudit } {
  if (marketAgnostic) {
    const qualifiedByFamily = familyCounts(qualifying);
    const selected: ParsedPick[] = [];
    const used = new Set<string>();
    const families = (Object.keys(qualifiedByFamily) as CoachMarketFamily[])
      .filter((family) => qualifiedByFamily[family] > 0)
      .sort((a, b) => {
        const best = (family: CoachMarketFamily) =>
          Math.max(...qualifying
            .filter((leg) => coachMarketFamily(leg.pick) === family)
            .map((leg) => leg.rankScore));
        return best(b) - best(a);
      });

    // Each family gets one correlation-aware opportunity before rank-based
    // backfill. All candidates have already passed the existing quality gates.
    for (const family of families) {
      if (selected.length >= target) break;
      selected.push(...pickDiverseLegsFromPool(
        qualifying.filter((leg) => coachMarketFamily(leg.pick) === family),
        selected,
        1,
        target,
        used,
        config,
      ));
    }
    const ticket = selected.length >= target
      ? selected
      : [...selected, ...pickDiverseLegsFromPool(
          qualifying,
          selected,
          target - selected.length,
          target,
          used,
          config,
        )];
    const picks = tieredBackfillStagedTicket(ticket, target, allScored, ticketStyle, config.seed);
    const selectedByFamily = familyCounts(picks);
    return {
      picks,
      familyVariety: {
        qualifiedByFamily,
        selectedByFamily,
        skippedFamilies: families
          .filter((family) => selectedByFamily[family] === 0)
          .map((marketFamily) => ({
            marketFamily,
            qualifiedCount: qualifiedByFamily[marketFamily],
            reason: families.indexOf(marketFamily) >= target
              ? `Requested ${target} legs; higher-ranked qualified families filled the family-coverage slots`
              : "No candidate from this qualified family survived correlation-aware selection",
          })),
      },
    };
  }
  const pools = partitionScoredLegsByCategory(qualifying);
  const rotatedPools: Record<BoardMarketCategory, BoardScoredLeg[]> = {
    props: rotateLegPoolForSize(pools.props, config.poolRotate),
    gameLines: rotateLegPoolForSize(pools.gameLines, config.poolRotate + 2),
    teamTotals: rotateLegPoolForSize(pools.teamTotals, config.poolRotate + 4),
    alternateLines: rotateLegPoolForSize(pools.alternateLines, config.poolRotate + 1),
  };
  const slots = balancedMixSlots(target);
  const ticket: ParsedPick[] = [];
  const used = new Set<string>();

  for (const cat of config.categoryOrder) {
    appendFromCategory(ticket, used, rotatedPools[cat], slots[cat], target, config);
  }

  const afterStrict = backfillDiverseTicket(ticket, target, rotatedPools, config);
  const picks = tieredBackfillStagedTicket(afterStrict, target, allScored, ticketStyle, config.seed);
  return {
    picks,
    familyVariety: {
      qualifiedByFamily: familyCounts(qualifying),
      selectedByFamily: familyCounts(picks),
      skippedFamilies: [],
    },
  };
}

function legRankOnTicket(pick: ParsedPick, qualifying: BoardScoredLeg[]): number {
  const fp = pickLegFingerprint(pick);
  const row = qualifying.find((l) => pickLegFingerprint(l.pick) === fp);
  return row?.rankScore ?? pick.finalAiScore?.composite ?? pick.scores?.composite ?? 0;
}

function ticketQualityScore(picks: ParsedPick[], qualifying: BoardScoredLeg[]): number {
  if (!picks.length) return 0;
  const ranks = picks.map((p) => legRankOnTicket(p, qualifying));
  const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  const edges = picks.map(
    (p) => p.finalAiScore?.edgePct ?? p.scores?.edgePct ?? 0,
  );
  const avgEdge = edges.reduce((a, b) => a + b, 0) / edges.length;
  return avgRank + avgEdge * 0.5;
}

function normGame(g: string): string {
  return String(g ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ticketDiversityScore(picks: ParsedPick[]): number {
  if (!picks.length) return 0;
  const games = new Set(picks.map((p) => normGame(p.game)));
  const propPicks = picks.filter((p) => p.player);
  const players = new Set(propPicks.map((p) => p.player!.toLowerCase()));
  const markets = new Set(picks.map((p) => String(p.market ?? "").toLowerCase()));
  const gameRatio = games.size / picks.length;
  const playerRatio = propPicks.length ? players.size / propPicks.length : 1;
  const dupPlayers = propPicks.length - players.size;
  return gameRatio * 32 + playerRatio * 28 + markets.size * 1.5 - dupPlayers * 14;
}

function bestAlternativeLeadEdge(
  excludePlayer: string,
  qualifying: BoardScoredLeg[],
): number {
  let best = -Infinity;
  for (const row of qualifying) {
    const player = row.pick.player?.toLowerCase();
    if (player && player === excludePlayer) continue;
    if (boardLegPoolRole(row.pick, row.pick.finalAiScore) == null) continue;
    const edge = row.edgePct ?? 0;
    if (edge > best) best = edge;
  }
  return best === -Infinity ? 0 : best;
}

function candidateVarietyPenalty(
  candidate: TicketCandidate,
  qualifying: BoardScoredLeg[],
  opts: CoachTicketBuildOpts,
): number {
  let penalty = 0;
  const recentTickets = opts.recentTickets ?? [];
  const recentLeads = opts.recentLeadPlayers ?? [];
  const playerCounts = opts.recentPlayerCounts;

  for (let i = 0; i < recentTickets.length; i++) {
    const recent = recentTickets[i]!;
    const overlap = ticketOverlapRatio(candidate.legKeys, [...recent]);
    const recency = 1 - i / Math.max(recentTickets.length, 1);
    penalty += overlap * recency * 52;
    if (overlap >= 1) penalty += 90 * recency;
    else if (overlap > MAX_RECENT_TICKET_OVERLAP) penalty += (overlap - MAX_RECENT_TICKET_OVERLAP) * 40 * recency;
  }

  const lead = candidate.picks[0];
  if (!lead) return penalty;

  const leadPlayer = parlayPlayerKey(lead);
  const leadEdge = lead.finalAiScore?.edgePct ?? lead.scores?.edgePct ?? 0;
  const altLeadEdge = leadPlayer ? bestAlternativeLeadEdge(leadPlayer, qualifying) : 0;
  const clearLeadEdge = leadEdge - altLeadEdge >= SIGNIFICANT_LEAD_EDGE_GAP_PCT;

  if (leadPlayer) {
    let leadRepeatCount = 0;
    for (let i = 0; i < recentLeads.length; i++) {
      if (recentLeads[i] !== leadPlayer) continue;
      leadRepeatCount += 1;
      const recency = 1 - i / Math.max(recentLeads.length, 1);
      if (!clearLeadEdge) {
        penalty += (42 + i * 10) * recency;
      } else if (i === 0) {
        penalty += 12 * recency;
      }
    }
    if (leadRepeatCount >= 2 && !clearLeadEdge) {
      penalty += leadRepeatCount * 28;
    }

    const onTicketCount = playerCounts?.get(leadPlayer) ?? 0;
    if (onTicketCount >= 3 && !clearLeadEdge) {
      penalty += (onTicketCount - 2) * 16;
    }
  }

  const leadLeg = parlayLegKey(lead);
  for (let i = 0; i < recentTickets.length; i++) {
    const recent = recentTickets[i]!;
    if (!recent.length || recent[0] !== leadLeg) continue;
    const recency = 1 - i / Math.max(recentTickets.length, 1);
    if (!clearLeadEdge) penalty += 35 * recency;
    break;
  }

  return penalty;
}

const REFERENCE_LARGER_SIZES = [15, 10, 9, 8, 6, 5] as const;

function referenceGreedyLegKeys(
  qualifying: BoardScoredLeg[],
  largerTarget: number,
  varietySeed: string,
): string[] {
  const config: AssemblyConfig = {
    seed: `${varietySeed}|ref-greedy-${largerTarget}`,
    diversityWeight: 0.22,
    bandOffset: 0,
    categoryOrder: ASSEMBLY_CATEGORY_ORDERS[0]!,
    poolRotate: 0,
    lineShoppingBias: 0.5,
  };
  const { picks } = assembleBalancedDiverseTicket(
    qualifying,
    qualifying,
    largerTarget,
    config,
  );
  return picks.map((p) => parlayLegKey(p));
}

function sameBoardLargerReferenceTickets(
  qualifying: BoardScoredLeg[],
  target: number,
  varietySeed: string,
): readonly (readonly string[])[] {
  if (target >= 15) return [];
  const out: string[][] = [];
  for (const size of REFERENCE_LARGER_SIZES) {
    if (size <= target) continue;
    const keys = referenceGreedyLegKeys(qualifying, size, varietySeed);
    if (keys.length > target) out.push(keys);
    if (out.length >= 2) break;
  }
  return out;
}

function prefixPenaltyForTarget(
  candidate: TicketCandidate,
  target: number,
  opts: CoachTicketBuildOpts,
): number {
  let penalty = 0;
  const larger = largerTicketsForTarget(target, opts.recentTicketsByLegCount);
  for (const ticket of larger) {
    if (isPrefixLegKeys(candidate.legKeys, ticket)) {
      penalty += 120;
      break;
    }
  }
  return penalty;
}

function generateTicketCandidates(
  scored: BoardScoredLeg[],
  target: number,
  opts: CoachTicketBuildOpts,
  qualifyingOverride?: BoardScoredLeg[],
): TicketCandidate[] {
  const qualifying = qualifyingOverride ?? qualifyingScoredLegs(scored);
  const ticketStyle = opts.ticketStyle ?? "balanced";
  const out: TicketCandidate[] = [];
  const profile = ticketSizeProfile(target);
  const sizeSeed = sizeScopedSeed(opts.varietySeed, target);
  const recentFlat = new Set((opts.recentTickets ?? []).flatMap((r) => [...r]));
  const candidateCount = profile.candidateCount;
  for (let i = 0; i < candidateCount; i++) {
    const orderIdx = (i + profile.orderShift) % ASSEMBLY_CATEGORY_ORDERS.length;
    const config: AssemblyConfig = {
      seed: `${sizeSeed}|ticket-${i}`,
      diversityWeight: profile.diversityBase + (i % 6) * 0.08,
      bandOffset: i + target * 5,
      categoryOrder: ASSEMBLY_CATEGORY_ORDERS[orderIdx]!,
      poolRotate: profile.poolRotate + i,
      recentLegKeys: recentFlat.size ? recentFlat : undefined,
      recentLeadPlayers: opts.recentLeadPlayers,
      recentPlayerCounts: opts.recentPlayerCounts,
      lineShoppingBias: profile.lineShoppingBias + (i % 4) * 0.12,
    };
    const assembled = assembleBalancedDiverseTicket(
      qualifying,
      scored,
      target,
      config,
      ticketStyle,
      opts.marketAgnostic,
    );
    const picks = assembled.picks;
    if (!picks.length) continue;
    const legKeys = picks.map((p) => parlayLegKey(p));
    const candidate: TicketCandidate = {
      picks,
      legKeys,
      qualityScore: ticketQualityScore(picks, qualifying),
      diversityScore: ticketDiversityScore(picks),
      varietyPenalty: 0,
      familyVariety: assembled.familyVariety,
    };
    candidate.varietyPenalty =
      candidateVarietyPenalty(candidate, qualifying, opts) +
      prefixPenaltyForTarget(candidate, target, opts);
    out.push(candidate);
  }
  return out;
}

function candidateTotalScore(candidate: TicketCandidate): number {
  return (
    candidate.qualityScore +
    candidate.diversityScore * 0.2 -
    candidate.varietyPenalty
  );
}

function maxRecentOverlap(
  candidate: TicketCandidate,
  recentTickets: readonly (readonly string[])[],
): number {
  if (!recentTickets.length) return 0;
  return Math.max(
    ...recentTickets.map((recent) => ticketOverlapRatio(candidate.legKeys, [...recent])),
  );
}

function leadingPrefixMatchLen(
  shorter: readonly string[],
  longer: readonly string[],
): number {
  const n = Math.min(shorter.length, longer.length);
  let matched = 0;
  for (let i = 0; i < n; i++) {
    if (shorter[i] !== longer[i]) break;
    matched++;
  }
  return matched;
}

function isExactPrefixOfLargerTicket(
  candidateKeys: readonly string[],
  largerTickets: readonly (readonly string[])[],
): boolean {
  return largerTickets.some(
    (larger) =>
      larger.length > candidateKeys.length &&
      isPrefixLegKeys(candidateKeys, larger),
  );
}

function pickBestDistinctCandidate(
  candidates: TicketCandidate[],
  opts: CoachTicketBuildOpts,
  target: number,
  qualifying: BoardScoredLeg[],
): TicketCandidate | null {
  if (!candidates.length) return null;
  const recentTickets = opts.recentTickets ?? [];
  const largerTickets = [
    ...largerTicketsForTarget(target, opts.recentTicketsByLegCount),
    ...sameBoardLargerReferenceTickets(qualifying, target, opts.varietySeed),
  ];

  // Hard reject: never return a ticket that exactly matches the first N legs of a larger ticket.
  const nonPrefix = candidates.filter(
    (c) => !isExactPrefixOfLargerTicket(c.legKeys, largerTickets),
  );
  if (!nonPrefix.length) {
    traceCoachTicket("combinator-selected", {
      requestedLegs: target,
      candidateId: "none",
      pickIds: [],
      extra: { rejectedAllPrefix: true, largerTicketCount: largerTickets.length },
    });
    return null;
  }
  let pool = nonPrefix;

  const sorted = [...pool].sort(
    (a, b) => candidateTotalScore(b) - candidateTotalScore(a),
  );
  if (!recentTickets.length) return sorted[0]!;

  const qualityFloor = sorted[0]!.qualityScore - 4;

  for (const c of sorted) {
    if (c.qualityScore < qualityFloor) break;
    if (maxRecentOverlap(c, recentTickets) < 1) return c;
  }

  for (const c of sorted) {
    if (c.qualityScore < qualityFloor) break;
    if (maxRecentOverlap(c, recentTickets) <= MAX_RECENT_TICKET_OVERLAP) return c;
  }

  const viable = sorted.filter((c) => c.qualityScore >= qualityFloor);
  const viablePool = viable.length ? viable : sorted;
  const diversePick = [...viablePool].sort((a, b) => {
    const scoreA = candidateTotalScore(a) - maxRecentOverlap(a, recentTickets) * 25;
    const scoreB = candidateTotalScore(b) - maxRecentOverlap(b, recentTickets) * 25;
    return scoreB - scoreA;
  })[0];
  if (diversePick) return diversePick;

  return [...sorted].sort(
    (a, b) => maxRecentOverlap(a, recentTickets) - maxRecentOverlap(b, recentTickets),
  )[0]!;
}

function stagingBreakdown(
  picks: ParsedPick[],
  qualifying: BoardScoredLeg[],
): TicketStagingBreakdown {
  const mains = qualifying.filter(
    (leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) === "main",
  );
  const alts = qualifying.filter(
    (leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) === "alt",
  );
  return {
    mainQualified: mains.length,
    altQualified: alts.length,
    mainOnTicket: picks.filter((p) => p.ticketRole === "main").length,
    altOnTicket: picks.filter((p) => p.ticketRole === "alt").length,
  };
}

/** Build an independent ticket for the requested leg count — not a slice of another size. */
export function buildIndependentCoachTicket(
  scored: BoardScoredLeg[],
  target: number,
  opts: CoachTicketBuildOpts,
): {
  picks: ParsedPick[];
  breakdown: TicketStagingBreakdown;
  familyVariety: TicketFamilyVarietyAudit;
} {
  const ticketStyle = opts.ticketStyle ?? "balanced";
  const qualifying = qualifyingScoredLegs(scored).filter(
    (leg) =>
      ticketStyle !== "safe" ||
      poolRoleAtMinGrade(leg.pick, leg.pick.finalAiScore, absoluteFloorForStyle(ticketStyle)) != null,
  );
  traceCoachTicket("combinator-candidates", {
    requestedLegs: target,
    extra: {
      varietyStage: "qualified_before_family_selection",
      qualifiedByFamily: familyCounts(qualifying),
    },
  });
  const candidates = generateTicketCandidates(scored, target, opts, qualifying);
  traceCoachTicket("combinator-candidates", {
    requestedLegs: target,
    candidateIds: candidates.map((c, i) => `c${i}:${c.legKeys.slice(0, 2).join("+")}`),
    extra: { candidateCount: candidates.length },
  });
  const chosen = pickBestDistinctCandidate(candidates, opts, target, qualifying);
  const picks = chosen?.picks ?? [];
  const familyVariety = chosen?.familyVariety ?? {
    qualifiedByFamily: familyCounts(qualifying),
    selectedByFamily: emptyFamilyCounts(),
    skippedFamilies: [],
  };
  traceCoachTicket("combinator-selected", {
    requestedLegs: target,
    candidateId: chosen
      ? `score:${candidateTotalScore(chosen).toFixed(1)}`
      : "none",
    pickIds: picks,
    extra: {
      qualifiedByFamily: familyVariety.qualifiedByFamily,
      selectedByFamily: familyVariety.selectedByFamily,
      skippedFamilies: familyVariety.skippedFamilies,
    },
  });
  return {
    picks,
    breakdown: stagingBreakdown(picks, qualifying),
    familyVariety,
  };
}

/** True when `shorter` is exactly the first N legs of `longer` (same order). */
export function isPrefixTicket(
  longer: readonly ParsedPick[],
  shorter: readonly ParsedPick[],
): boolean {
  if (shorter.length >= longer.length || shorter.length === 0) return false;
  const longerKeys = longer.map((p) => parlayLegKey(p));
  const shorterKeys = shorter.map((p) => parlayLegKey(p));
  return isPrefixLegKeys(shorterKeys, longerKeys);
}
