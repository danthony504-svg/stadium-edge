// Independent high-quality parlay tickets — multiple candidates, diversity-aware selection.

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
import { parlayLegKey, ticketOverlapRatio } from "./parlayVarietyMemory.ts";
import { shuffleWithSeed, varietyRankKey } from "./varietySeed.ts";
import {
  boardLegPoolRole,
  capThinStatMarketsOnTicket,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

export const TICKET_CANDIDATE_COUNT = 8;
/** Only repeat a player when edge beats the best alternative by this much. */
export const SIGNIFICANT_EDGE_GAP_PCT = 3;
/** Near-equal edge band for diversity swaps (user: ~1–2%). */
export const NEAR_EQUAL_TICKET_EDGE_PCT = 2;
/** Max leg overlap vs a recent ticket before we prefer another candidate. */
export const MAX_RECENT_TICKET_OVERLAP = 0.45;

export type CoachTicketBuildOpts = {
  varietySeed: string;
  recentTickets?: readonly (readonly string[])[];
};

type TicketCandidate = {
  picks: ParsedPick[];
  legKeys: string[];
  qualityScore: number;
  diversityScore: number;
};

type AssemblyConfig = {
  seed: string;
  diversityWeight: number;
  bandOffset: number;
  recentLegKeys?: Set<string>;
};

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
  return 28;
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
    const skip = config.bandOffset % Math.min(poolCopy.length, 4);
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
        row.rankScore - corr * config.diversityWeight - samePlayerRepeatPenalty(
          row,
          poolCopy,
          ticket,
          selected,
        );
      if (config.recentLegKeys?.has(parlayLegKey(row.pick))) {
        const altEdge = bestAlternativeEdge(row, poolCopy, ticket, selected);
        const legEdge = row.edgePct ?? 0;
        if (legEdge - altEdge < SIGNIFICANT_EDGE_GAP_PCT) {
          effective -= 32;
        }
      }

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
      const effChosen =
        chosen.rankScore - corrChosen * config.diversityWeight - repeatChosen;
      const effAlt = alt.rankScore - corrAlt * config.diversityWeight - repeatAlt;
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
      const trial = capThinStatMarketsOnTicket(
        [
          ...current,
          { ...row.pick, ticketRole: role, highRiskValuePlay: false },
        ],
        target,
      );
      if (trial.length > current.length && row.rankScore - corr * 0.4 - repeat > 0) {
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

  appendFromCategory(ticket, used, pools.props, slots.props, target, config);
  appendFromCategory(ticket, used, pools.gameLines, slots.gameLines, target, config);
  appendFromCategory(ticket, used, pools.teamTotals, slots.teamTotals, target, config);
  appendFromCategory(ticket, used, pools.alternateLines, slots.alternateLines, target, config);

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
  return gameRatio * 32 + playerRatio * 28 + markets.size * 1.5 - dupPlayers * 12;
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
      diversityWeight: 0.3 + (i % 5) * 0.12,
      bandOffset: i,
      recentLegKeys: recentFlat.size ? recentFlat : undefined,
    };
    const picks = assembleBalancedDiverseTicket(qualifying, target, config);
    if (!picks.length) continue;
    const legKeys = picks.map((p) => parlayLegKey(p));
    out.push({
      picks,
      legKeys,
      qualityScore: ticketQualityScore(picks, qualifying),
      diversityScore: ticketDiversityScore(picks),
    });
  }
  return out;
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
  recentTickets: readonly (readonly string[])[],
): TicketCandidate | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort(
    (a, b) =>
      b.qualityScore + b.diversityScore * 0.18 - (a.qualityScore + a.diversityScore * 0.18),
  );
  if (!recentTickets.length) return sorted[0]!;

  for (const c of sorted) {
    if (maxRecentOverlap(c, recentTickets) < 1) return c;
  }

  for (const c of sorted) {
    if (maxRecentOverlap(c, recentTickets) <= MAX_RECENT_TICKET_OVERLAP) return c;
  }

  const topTier = sorted.slice(0, Math.min(3, sorted.length));
  const diversePick = [...topTier].sort((a, b) => b.diversityScore - a.diversityScore)[0];
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
  const chosen = pickBestDistinctCandidate(candidates, opts.recentTickets ?? []);
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
