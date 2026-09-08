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
import {
  applyCoachDiversityTag,
  canAddPickToTicket,
  capMarketConcentrationOnTicket,
  coachTicketDiversityScore,
  dominantMarketShare,
  logDiversityRelaxed,
  maxPicksPerMarket,
  marketFamilyKey,
  normalizedCoachPickKey,
  ticketReuseFromPriorRatio,
  type CoachDiversityTag,
  type DiversityRelaxation,
} from "./coachPickDiversity.ts";
import {
  isPrefixLegKeys,
  parlayLegKey,
  parlayPlayerKey,
  ticketOverlapRatio,
  type CoachParlayVarietyContext,
} from "./parlayVarietyMemory.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { shuffleWithSeed, varietyRankKey } from "./varietySeed.ts";
import { correlationTimedOut } from "./coachScanPipeline.ts";
import { traceCoachTicket } from "./coachTicketTrace.ts";
import {
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
/** Max share of a smaller prior ticket that may reappear on a larger follow-up ask. */
export const MAX_PRIOR_TICKET_REUSE_RATIO = 0.2;
/** Lead-player repeat penalty unless edge gap exceeds this. */
export const SIGNIFICANT_LEAD_EDGE_GAP_PCT = 2.5;

export type CoachTicketBuildOpts = {
  varietySeed: string;
  /** Safe / Balanced / Value / Longshot — controls how far quality relaxes when filling legs. */
  ticketStyle?: CoachTicketStyle;
  correlationDeadlineAt?: number;
  /** Skip expensive reference-ticket prefix checks during correlation scoring. */
  correlationFastMode?: boolean;
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
  poolRotate: number;
  recentLegKeys?: Set<string>;
  recentLeadPlayers?: readonly string[];
  recentPlayerCounts?: ReadonlyMap<string, number>;
  lineShoppingBias: number;
  sameTicketRepeat?: boolean;
  blockRecentRepeats?: boolean;
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
  15: { diversityBase: 0.38, poolRotate: 4, orderShift: 0, lineShoppingBias: 0.75, candidateCount: 40 },
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
  if (!recentLegKeys?.has(normalizedCoachPickKey(leg.pick))) return 0;
  const legEdge = leg.edgePct ?? 0;
  const altEdge = bestAlternativeEdge(leg, pool, ticket, selected);
  if (legEdge - altEdge >= SIGNIFICANT_EDGE_GAP_PCT) return 8;
  return 80;
}

function diversityNoveltyBonus(
  leg: BoardScoredLeg,
  ticket: ParsedPick[],
  selected: ParsedPick[],
  recentLegKeys?: Set<string>,
): number {
  const pick = leg.pick;
  const gk = pick.game;
  const onTicket = [...ticket, ...selected];
  const newGame = onTicket.every((p) => p.game !== pick.game);
  const newPlayer =
    pick.player &&
    onTicket.every((p) => (p.player ?? "").toLowerCase() !== pick.player!.toLowerCase());
  const newMarket =
    onTicket.every(
      (p) =>
        (p.propMarketKey ?? p.market ?? "").toLowerCase() !==
        (pick.propMarketKey ?? pick.market ?? "").toLowerCase(),
    );
  let bonus = 0;
  if (newGame) bonus += 6;
  if (newPlayer) bonus += 5;
  if (newMarket) bonus += 4;
  if (recentLegKeys && !recentLegKeys.has(normalizedCoachPickKey(pick))) bonus += 8;
  return bonus;
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
  let structureRelaxation: 0 | 1 | 2 = 0;
  let allowRecentRepeats = false;

  while (selected.length < want && poolCopy.length) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    let bestTag: CoachDiversityTag | undefined;
    let sawStructureReject = false;
    let sawRecentReject = false;
    let sawMarketReject = false;
    let sawGameReject = false;

    for (let i = 0; i < poolCopy.length; i++) {
      const row = poolCopy[i]!;
      const fp = pickLegFingerprint(row.pick);
      if (used.has(fp)) continue;
      if (selected.some((p) => pickLegFingerprint(p) === fp)) continue;
      if (
        config.blockRecentRepeats &&
        config.recentLegKeys?.has(normalizedCoachPickKey(row.pick))
      ) {
        sawRecentReject = true;
        continue;
      }

      const verdict = canAddPickToTicket(row.pick, [...ticket, ...selected], target, {
        structureRelaxation,
        allowRecentRepeats,
        allowMarketOverflow: false,
        recentPickKeys: config.recentLegKeys,
        sameTicketRepeat: config.sameTicketRepeat,
      });
      if (!verdict.ok) {
        if (verdict.reason === "recent-pick") sawRecentReject = true;
        else if (verdict.reason === "market-concentration") {
          sawMarketReject = true;
          sawStructureReject = true;
        } else if (verdict.reason === "same-game-limit" || verdict.reason === "same-player") {
          sawGameReject = true;
          sawStructureReject = true;
        } else if (verdict.reason !== "duplicate" && verdict.reason !== "conflicting-side") {
          sawStructureReject = true;
        }
        continue;
      }

      const corr = parlayCorrelationPenalty(row.pick, [...ticket, ...selected]);
      let effective =
        row.rankScore -
        corr * config.diversityWeight -
        samePlayerRepeatPenalty(row, poolCopy, ticket, selected) -
        recentLegPenalty(row, poolCopy, ticket, selected, config.recentLegKeys) +
        lineShoppingTieBonus(row, config) +
        diversityNoveltyBonus(row, ticket, selected, config.recentLegKeys);

      if (effective > bestScore) {
        bestScore = effective;
        bestIdx = i;
        bestTag = verdict.tag;
      }
    }

    if (bestIdx < 0) {
      if (!allowRecentRepeats && sawRecentReject && !config.blockRecentRepeats) {
        logDiversityRelaxed(0, 1, target);
        allowRecentRepeats = true;
        continue;
      }
      if (structureRelaxation < 2 && sawGameReject) {
        const next = (structureRelaxation + 1) as 1 | 2;
        logDiversityRelaxed(structureRelaxation, next, target);
        structureRelaxation = next;
        continue;
      }
      break;
    }

    const chosen = poolCopy[bestIdx]!;
    const chosenEdge = chosen.edgePct ?? 0;
    for (let i = 0; i < poolCopy.length; i++) {
      if (i === bestIdx) continue;
      const alt = poolCopy[i]!;
      if (!legsNearlyEqualEdge(chosen, alt)) continue;
      const verdict = canAddPickToTicket(alt.pick, [...ticket, ...selected], target, {
        structureRelaxation,
        allowRecentRepeats,
        allowMarketOverflow: false,
        recentPickKeys: config.recentLegKeys,
        sameTicketRepeat: config.sameTicketRepeat,
      });
      if (!verdict.ok) continue;
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
        lineShoppingTieBonus(chosen, config) +
        diversityNoveltyBonus(chosen, ticket, selected, config.recentLegKeys);
      const effAlt =
        alt.rankScore -
        corrAlt * config.diversityWeight -
        repeatAlt -
        recentAlt +
        lineShoppingTieBonus(alt, config) +
        diversityNoveltyBonus(alt, ticket, selected, config.recentLegKeys);
      if (effAlt > effChosen && Math.abs((alt.edgePct ?? 0) - chosenEdge) <= NEAR_EQUAL_TICKET_EDGE_PCT) {
        bestIdx = i;
        bestTag = verdict.tag;
      }
    }

    const row = poolCopy[bestIdx]!;
    const role = boardLegPoolRole(row.pick, row.pick.finalAiScore)!;
    const pick = applyCoachDiversityTag(
      { ...row.pick, ticketRole: role, highRiskValuePlay: false as const },
      bestTag,
    );
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
  const verdict = canAddPickToTicket(row.pick, current, target, {
    structureRelaxation: 0,
    allowRecentRepeats: !config.blockRecentRepeats,
    allowMarketOverflow: false,
    recentPickKeys: config.recentLegKeys,
    sameTicketRepeat: config.sameTicketRepeat,
  });
  if (
    config.blockRecentRepeats &&
    config.recentLegKeys?.has(normalizedCoachPickKey(row.pick))
  ) {
    return null;
  }
  if (!verdict.ok && verdict.reason === "duplicate") return null;
  if (!verdict.ok && verdict.reason === "conflicting-side") return null;

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
  const staged = applyCoachDiversityTag(stagedPickFromRow(row, role, fillTier), verdict.tag);
  const trial = capThinStatMarketsOnTicket([...current, staged], target);
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

function fillTicketToTarget(
  ticket: ParsedPick[],
  target: number,
  allScored: BoardScoredLeg[],
  config: AssemblyConfig,
): ParsedPick[] {
  let current = [...ticket];
  const used = new Set(current.map(pickLegFingerprint));
  const ranked = sortBoardLegsForRank(
    allScored.filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null),
    config.seed,
  );
  for (const row of ranked) {
    if (current.length >= target) break;
    const fp = pickLegFingerprint(row.pick);
    if (used.has(fp)) continue;
    if (
      config.blockRecentRepeats &&
      config.recentLegKeys?.has(normalizedCoachPickKey(row.pick))
    ) {
      continue;
    }
    let verdict = canAddPickToTicket(row.pick, current, target, {
      structureRelaxation: 0,
      allowRecentRepeats: !config.blockRecentRepeats,
      allowMarketOverflow: current.length < target,
      recentPickKeys: config.recentLegKeys,
      sameTicketRepeat: config.sameTicketRepeat,
    });
    if (!verdict.ok && verdict.reason !== "duplicate" && verdict.reason !== "conflicting-side") {
      const reason = verdict.reason;
      verdict = canAddPickToTicket(row.pick, current, target, {
        structureRelaxation: 2,
        allowRecentRepeats: !config.blockRecentRepeats,
        allowMarketOverflow: current.length < target,
        recentPickKeys: config.recentLegKeys,
        sameTicketRepeat: config.sameTicketRepeat,
      });
    }
    if (!verdict.ok) continue;
    const role = boardLegPoolRole(row.pick, row.pick.finalAiScore)!;
    current.push(
      applyCoachDiversityTag(
        { ...row.pick, ticketRole: role, highRiskValuePlay: false as const },
        verdict.tag,
      ),
    );
    used.add(fp);
  }
  return current.slice(0, target);
}

function rebalanceTicketMarketMix(
  ticket: ParsedPick[],
  target: number,
  allScored: BoardScoredLeg[],
  config: AssemblyConfig,
): ParsedPick[] {
  let current = [...ticket];
  const maxMarket = maxPicksPerMarket(target);
  for (let attempt = 0; attempt < 24 && current.length >= target; attempt++) {
    const counts = new Map<string, number>();
    for (const p of current) {
      const mk = marketFamilyKey(p);
      counts.set(mk, (counts.get(mk) ?? 0) + 1);
    }
    const overflow = [...counts.entries()].find(([, count]) => count > maxMarket);
    if (!overflow) return current.slice(0, target);
    const [mk] = overflow;
    const dropIdx = current.findIndex((p) => marketFamilyKey(p) === mk);
    if (dropIdx < 0) return current.slice(0, target);
    const trialTicket = current.filter((_, i) => i !== dropIdx);
    const replacement = allScored.find((row) => {
      if (boardLegPoolRole(row.pick, row.pick.finalAiScore) == null) return false;
      if (marketFamilyKey(row.pick) === mk) return false;
      const fp = pickLegFingerprint(row.pick);
      if (trialTicket.some((p) => pickLegFingerprint(p) === fp)) return false;
      const verdict = canAddPickToTicket(row.pick, trialTicket, target, {
        structureRelaxation: 0,
        allowRecentRepeats: true,
        allowMarketOverflow: false,
        recentPickKeys: config.recentLegKeys,
        sameTicketRepeat: config.sameTicketRepeat,
      });
      return verdict.ok;
    });
    if (!replacement) return current.slice(0, target);
    const role = boardLegPoolRole(replacement.pick, replacement.pick.finalAiScore)!;
    current = [
      ...trialTicket,
      { ...replacement.pick, ticketRole: role, highRiskValuePlay: false as const },
    ];
  }
  return current.slice(0, target);
}

function assembleBalancedDiverseTicket(
  qualifying: BoardScoredLeg[],
  allScored: BoardScoredLeg[],
  target: number,
  config: AssemblyConfig,
  ticketStyle: CoachTicketStyle = "balanced",
): ParsedPick[] {
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
  const tiered = tieredBackfillStagedTicket(afterStrict, target, allScored, ticketStyle, config.seed);
  const rebalanced = rebalanceTicketMarketMix(tiered, target, allScored, config);
  const capped = capMarketConcentrationOnTicket(rebalanced, target);
  return fillTicketToTarget(capped, target, allScored, config);
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
    const reuse = ticketReuseFromPriorRatio(
      candidate.legKeys,
      recent.length < candidate.legKeys.length ? [...recent] : [...recent],
    );
    const recency = 1 - i / Math.max(recentTickets.length, 1);
    penalty += overlap * recency * 52;
    if (reuse > MAX_PRIOR_TICKET_REUSE_RATIO) {
      penalty += (reuse - MAX_PRIOR_TICKET_REUSE_RATIO) * 90 * recency;
    }
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
  const picks = assembleBalancedDiverseTicket(qualifying, qualifying, largerTarget, config);
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

function buildSingleTicketCandidate(
  scored: BoardScoredLeg[],
  target: number,
  opts: CoachTicketBuildOpts,
  index: number,
): TicketCandidate | null {
  const qualifying = qualifyingScoredLegs(scored);
  const ticketStyle = opts.ticketStyle ?? "balanced";
  const profile = ticketSizeProfile(target);
  const sizeSeed = sizeScopedSeed(opts.varietySeed, target);
  const recentFlat = new Set((opts.recentTickets ?? []).flatMap((r) => [...r]));
  const priorTicketSize = opts.recentTickets?.[0]?.length ?? 0;
  const orderIdx = (index + profile.orderShift) % ASSEMBLY_CATEGORY_ORDERS.length;
  const config: AssemblyConfig = {
    seed: `${sizeSeed}|ticket-${index}`,
    diversityWeight: profile.diversityBase + (index % 6) * 0.08,
    bandOffset: index + target * 5,
    categoryOrder: ASSEMBLY_CATEGORY_ORDERS[orderIdx]!,
    poolRotate: profile.poolRotate + index,
    recentLegKeys: recentFlat.size ? recentFlat : undefined,
    recentLeadPlayers: opts.recentLeadPlayers,
    recentPlayerCounts: opts.recentPlayerCounts,
    lineShoppingBias: profile.lineShoppingBias + (index % 4) * 0.12,
    blockRecentRepeats: priorTicketSize > 0 && target > priorTicketSize,
  };
  const picks = assembleBalancedDiverseTicket(
    qualifying,
    scored,
    target,
    config,
    ticketStyle,
  );
  if (!picks.length) return null;
  const legKeys = picks.map((p) => normalizedCoachPickKey(p));
  const candidate: TicketCandidate = {
    picks,
    legKeys,
    qualityScore: ticketQualityScore(picks, qualifying),
    diversityScore: coachTicketDiversityScore(picks, recentFlat.size ? recentFlat : undefined),
    varietyPenalty: 0,
  };
  candidate.varietyPenalty =
    candidateVarietyPenalty(candidate, qualifying, opts) +
    prefixPenaltyForTarget(candidate, target, opts);
  return candidate;
}

function generateTicketCandidates(
  scored: BoardScoredLeg[],
  target: number,
  opts: CoachTicketBuildOpts,
): TicketCandidate[] {
  const profile = ticketSizeProfile(target);
  const candidateCount = profile.candidateCount;
  const deadlineAt = opts.correlationDeadlineAt;
  const out: TicketCandidate[] = [];
  for (let i = 0; i < candidateCount; i++) {
    if (deadlineAt != null && correlationTimedOut(deadlineAt)) break;
    const candidate = buildSingleTicketCandidate(scored, target, opts, i);
    if (candidate) out.push(candidate);
  }
  return out;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Batched async candidate generation — yields between candidates for deadline checks. */
export async function buildIndependentCoachTicketAsync(
  scored: BoardScoredLeg[],
  target: number,
  opts: CoachTicketBuildOpts,
  runtime: {
    batchSize: number;
    deadlineAt: number;
    maxCandidates?: number;
    isAborted?: () => boolean;
    onProgress?: (correlationsScored: number, candidateTicketCount: number) => void;
    onTicketError?: (index: number, err: unknown) => void;
  },
): Promise<{
  picks: ParsedPick[];
  breakdown: TicketStagingBreakdown;
  candidateTicketCount: number;
  correlationsScored: number;
  timedOut: boolean;
  exceptions: string[];
}> {
  const qualifying = qualifyingScoredLegs(scored);
  const profile = ticketSizeProfile(target);
  const candidateTicketCount = Math.min(
    profile.candidateCount,
    runtime.maxCandidates ?? profile.candidateCount,
  );
  const candidates: TicketCandidate[] = [];
  const exceptions: string[] = [];
  let timedOut = false;

  const shouldStop = (): boolean =>
    correlationTimedOut(runtime.deadlineAt) || runtime.isAborted?.() === true;

  for (let i = 0; i < candidateTicketCount; i++) {
    if (shouldStop()) {
      timedOut = true;
      break;
    }
    await yieldToEventLoop();
    if (shouldStop()) {
      timedOut = true;
      break;
    }
    try {
      const candidate = buildSingleTicketCandidate(scored, target, opts, i);
      if (candidate) candidates.push(candidate);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      exceptions.push(`ticket-${i}: ${message}`);
      runtime.onTicketError?.(i, err);
    }
    if ((i + 1) % Math.max(1, runtime.batchSize) === 0 || i === candidateTicketCount - 1) {
      runtime.onProgress?.(candidates.length, candidateTicketCount);
    }
  }

  traceCoachTicket("combinator-candidates", {
    requestedLegs: target,
    candidateIds: candidates.map((c, i) => `c${i}:${c.legKeys.slice(0, 2).join("+")}`),
    extra: { candidateCount: candidates.length, candidateTicketCount, timedOut },
  });

  let chosen: TicketCandidate | null = null;
  if (candidates.length) {
    if (!timedOut && !shouldStop()) {
      chosen = pickBestDistinctCandidate(candidates, opts, target, qualifying);
    }
    if (!chosen) {
      chosen = [...candidates].sort((a, b) => candidateTotalScore(b, target) - candidateTotalScore(a, target))[0]!;
    }
  }
  const picks = chosen?.picks ?? [];
  traceCoachTicket("combinator-selected", {
    requestedLegs: target,
    candidateId: chosen ? `score:${candidateTotalScore(chosen, target).toFixed(1)}` : "none",
    pickIds: picks,
  });

  return {
    picks,
    breakdown: stagingBreakdown(picks, qualifying),
    candidateTicketCount,
    correlationsScored: candidates.length,
    timedOut,
    exceptions,
  };
}

function candidateTotalScore(candidate: TicketCandidate, legTarget = 0): number {
  const diversityWeight = legTarget >= 15 ? 0.35 : legTarget >= 9 ? 0.28 : 0.2;
  return (
    candidate.qualityScore +
    candidate.diversityScore * diversityWeight -
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
  const largerTickets = opts.correlationFastMode
    ? largerTicketsForTarget(target, opts.recentTicketsByLegCount)
    : [
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

  if (recentTickets.length) {
    const lastTicket = recentTickets[0]!;
    const reuseCap =
      lastTicket.length < target
        ? MAX_PRIOR_TICKET_REUSE_RATIO
        : MAX_RECENT_TICKET_OVERLAP;
    const byReuse = [...pool].sort(
      (a, b) =>
        ticketReuseFromPriorRatio(a.legKeys, [...lastTicket]) -
        ticketReuseFromPriorRatio(b.legKeys, [...lastTicket]),
    );
    const lowReuse = byReuse.filter(
      (c) => ticketReuseFromPriorRatio(c.legKeys, [...lastTicket]) <= reuseCap,
    );
    pool = lowReuse.length ? lowReuse : byReuse.slice(0, Math.max(3, Math.ceil(byReuse.length * 0.25)));
    const lowOverlap = pool.filter(
      (c) => ticketOverlapRatio(c.legKeys, [...lastTicket]) <= MAX_RECENT_TICKET_OVERLAP,
    );
    if (lowOverlap.length) pool = lowOverlap;
  }

  const maxMarketShare = maxPicksPerMarket(target) / Math.max(target, 1) + 0.01;
  const byMarket = [...pool].sort(
    (a, b) => dominantMarketShare(a.picks) - dominantMarketShare(b.picks),
  );
  const diversified = byMarket.filter((c) => dominantMarketShare(c.picks) <= maxMarketShare);
  pool = diversified.length ? diversified : byMarket.slice(0, Math.max(3, Math.ceil(byMarket.length * 0.25)));

  const sorted = [...pool].sort(
    (a, b) => candidateTotalScore(b, target) - candidateTotalScore(a, target),
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
    const scoreA = candidateTotalScore(a, target) - maxRecentOverlap(a, recentTickets) * 25;
    const scoreB = candidateTotalScore(b, target) - maxRecentOverlap(b, recentTickets) * 25;
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
  const candidates = generateTicketCandidates(scored, target, opts);
  traceCoachTicket("combinator-candidates", {
    requestedLegs: target,
    candidateIds: candidates.map((c, i) => `c${i}:${c.legKeys.slice(0, 2).join("+")}`),
    extra: { candidateCount: candidates.length },
  });
  const chosen = pickBestDistinctCandidate(candidates, opts, target, qualifying);
  const picks = chosen?.picks ?? [];
  traceCoachTicket("combinator-selected", {
    requestedLegs: target,
    candidateId: chosen
      ? `score:${candidateTotalScore(chosen, target).toFixed(1)}`
      : "none",
    pickIds: picks,
  });
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
  const longerKeys = longer.map((p) => parlayLegKey(p));
  const shorterKeys = shorter.map((p) => parlayLegKey(p));
  return isPrefixLegKeys(shorterKeys, longerKeys);
}
