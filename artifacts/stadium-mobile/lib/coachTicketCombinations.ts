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
  parlayLegKey,
  parlayPlayerKey,
  ticketOverlapRatio,
  type CoachParlayVarietyContext,
} from "./parlayVarietyMemory.ts";
import { shuffleWithSeed, varietyRankKey } from "./varietySeed.ts";
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
} & Partial<CoachParlayVarietyContext>;

type TicketCandidate = {
  picks: ParsedPick[];
  legKeys: string[];
  qualityScore: number;
  diversityScore: number;
  varietyPenalty: number;
};

type AssemblyConfig = {
  seed: string;
  diversityWeight: number;
  bandOffset: number;
  categoryOrder: readonly BoardMarketCategory[];
  recentLegKeys?: Set<string>;
  recentLeadPlayers?: readonly string[];
  recentPlayerCounts?: ReadonlyMap<string, number>;
  lineShoppingBias: number;
};

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
      const thinOnTicket = current.filter(
        (p) => p.isProp && isThinPropStatMarket(p.market),
      ).length;
      const maxThin = maxLegsPerThinStatMarket(target);
      if (
        row.pick.isProp &&
        isThinPropStatMarket(row.pick.market) &&
        thinOnTicket >= maxThin
      ) {
        continue;
      }
      const corr = parlayCorrelationPenalty(row.pick, current);
      const repeat = samePlayerRepeatPenalty(row, ranked, current, []);
      const recent = recentLegPenalty(row, ranked, current, [], config.recentLegKeys);
      const trial = capThinStatMarketsOnTicket(
        [
          ...current,
          { ...row.pick, ticketRole: role, highRiskValuePlay: false },
        ],
        target,
      );
      if (trial.length > current.length && row.rankScore - corr * 0.4 - repeat - recent > 0) {
        current = trial;
        used.add(fp);
      }
    }
  }
  return current.slice(0, target);
}

function assembleBalancedDiverseTicket(
  qualifying: BoardScoredLeg[],
  target: number,
  config: AssemblyConfig,
): ParsedPick[] {
  const pools = partitionScoredLegsByCategory(qualifying);
  const slots = balancedMixSlots(target);
  const ticket: ParsedPick[] = [];
  const used = new Set<string>();

  for (const cat of config.categoryOrder) {
    appendFromCategory(ticket, used, pools[cat], slots[cat], target, config);
  }

  return backfillDiverseTicket(ticket, target, pools, config);
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

function generateTicketCandidates(
  qualifying: BoardScoredLeg[],
  target: number,
  opts: CoachTicketBuildOpts,
): TicketCandidate[] {
  const out: TicketCandidate[] = [];
  const recentFlat = new Set((opts.recentTickets ?? []).flatMap((r) => [...r]));
  for (let i = 0; i < TICKET_CANDIDATE_COUNT; i++) {
    const config: AssemblyConfig = {
      seed: `${opts.varietySeed}|ticket-${i}`,
      diversityWeight: 0.28 + (i % 8) * 0.1,
      bandOffset: i,
      categoryOrder: ASSEMBLY_CATEGORY_ORDERS[i % ASSEMBLY_CATEGORY_ORDERS.length]!,
      recentLegKeys: recentFlat.size ? recentFlat : undefined,
      recentLeadPlayers: opts.recentLeadPlayers,
      recentPlayerCounts: opts.recentPlayerCounts,
      lineShoppingBias: 0.6 + (i % 5) * 0.2,
    };
    const picks = assembleBalancedDiverseTicket(qualifying, target, config);
    if (!picks.length) continue;
    const legKeys = picks.map((p) => parlayLegKey(p));
    const candidate: TicketCandidate = {
      picks,
      legKeys,
      qualityScore: ticketQualityScore(picks, qualifying),
      diversityScore: ticketDiversityScore(picks),
      varietyPenalty: 0,
    };
    candidate.varietyPenalty = candidateVarietyPenalty(candidate, qualifying, opts);
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

function pickBestDistinctCandidate(
  candidates: TicketCandidate[],
  opts: CoachTicketBuildOpts,
): TicketCandidate | null {
  if (!candidates.length) return null;
  const recentTickets = opts.recentTickets ?? [];
  const sorted = [...candidates].sort(
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
  const pool = viable.length ? viable : sorted;
  const diversePick = [...pool].sort((a, b) => {
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
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const qualifying = qualifyingScoredLegs(scored);
  const candidates = generateTicketCandidates(qualifying, target, opts);
  const chosen = pickBestDistinctCandidate(candidates, opts);
  const picks = chosen?.picks ?? [];
  return {
    picks,
    breakdown: stagingBreakdown(picks, qualifying),
  };
}

/** True when `shorter` is exactly the first N legs of `longer` (same order). */
export function isPrefixTicket(
  longer: readonly ParsedPick[],
  shorter: readonly ParsedPick[],
): boolean {
  if (shorter.length >= longer.length || shorter.length === 0) return false;
  for (let i = 0; i < shorter.length; i++) {
    if (pickLegFingerprint(longer[i]!) !== pickLegFingerprint(shorter[i]!)) return false;
  }
  return true;
}
