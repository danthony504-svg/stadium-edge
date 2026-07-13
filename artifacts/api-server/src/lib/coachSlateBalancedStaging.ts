// Balanced server ticket assembly — independent optimization per leg count.

import {
  BALANCED_BACKFILL_ORDER,
  balancedMixSlots,
  type BoardMarketCategory,
} from "./coachSlateBalancedMix.js";
import {
  partitionServerRankedByCategory,
  type PartitionedServerPools,
  type ServerRankedLeg,
} from "./coachSlateMarketPools.js";
import type { FullBoardScanResult, ParsedPick } from "./coachSlateTypes.js";

function legFingerprint(p: ParsedPick): string {
  if (p.isProp) {
    return `prop|${p.game}|${p.player}|${p.propMarketKey ?? p.market}|${p.propLine}|${p.propSide}`;
  }
  return `game|${p.game}|${p.market}|${p.pick}`;
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

type SizeProfile = {
  poolRotate: number;
  orderShift: number;
};

const SIZE_PROFILES: Partial<Record<number, SizeProfile>> = {
  3: { poolRotate: 3, orderShift: 5 },
  4: { poolRotate: 4, orderShift: 3 },
  5: { poolRotate: 5, orderShift: 2 },
  6: { poolRotate: 6, orderShift: 4 },
  8: { poolRotate: 7, orderShift: 1 },
  9: { poolRotate: 4, orderShift: 6 },
  10: { poolRotate: 8, orderShift: 3 },
  15: { poolRotate: 2, orderShift: 0 },
};

function sizeProfile(target: number): SizeProfile {
  return (
    SIZE_PROFILES[target] ?? {
      poolRotate: (target * 3) % 9,
      orderShift: target % ASSEMBLY_CATEGORY_ORDERS.length,
    }
  );
}

function rotatePool<T>(pool: T[], rotate: number): T[] {
  if (!pool.length || rotate <= 0) return pool;
  const skip = rotate % pool.length;
  if (!skip) return pool;
  return [...pool.slice(skip), ...pool.slice(0, skip)];
}

function rotatePoolsForTarget(
  pools: PartitionedServerPools,
  profile: SizeProfile,
): PartitionedServerPools {
  return {
    props: rotatePool(pools.props, profile.poolRotate),
    gameLines: rotatePool(pools.gameLines, profile.poolRotate + 2),
    teamTotals: rotatePool(pools.teamTotals, profile.poolRotate + 4),
    alternateLines: rotatePool(pools.alternateLines, profile.poolRotate + 1),
  };
}

function appendFromPool(
  out: ParsedPick[],
  used: Set<string>,
  pool: ServerRankedLeg[],
  want: number,
): number {
  if (want <= 0) return 0;
  let added = 0;
  for (const row of pool) {
    if (added >= want) break;
    const fp = legFingerprint(row.pick);
    if (used.has(fp)) continue;
    used.add(fp);
    out.push({ ...row.pick, ticketRole: row.isAlt ? "alt" : "main" });
    added += 1;
  }
  return added;
}

function applyBalancedBackfill(
  picks: ParsedPick[],
  target: number,
  pools: PartitionedServerPools,
): ParsedPick[] {
  const out = [...picks];
  if (out.length >= target) return out.slice(0, target);

  const used = new Set(out.map(legFingerprint));
  for (const cat of BALANCED_BACKFILL_ORDER) {
    if (out.length >= target) break;
    for (const row of pools[cat]) {
      if (out.length >= target) break;
      const fp = legFingerprint(row.pick);
      if (used.has(fp)) continue;
      used.add(fp);
      out.push({ ...row.pick, ticketRole: row.isAlt ? "alt" : "main" });
    }
  }
  return out.slice(0, target);
}

/** Legacy mains-then-alts staging for 1–2 leg tickets. */
export function stageServerTicketLegacy(
  ranked: ServerRankedLeg[],
  target: number,
): { picks: ParsedPick[]; breakdown: FullBoardScanResult["staging"] } {
  const mains = ranked.filter((r) => !r.isAlt).sort((a, b) => b.rankScore - a.rankScore);
  const alts = ranked.filter((r) => r.isAlt).sort((a, b) => b.rankScore - a.rankScore);
  const used = new Set<string>();
  const picks: ParsedPick[] = [];

  for (const row of mains) {
    const fp = legFingerprint(row.pick);
    if (used.has(fp)) continue;
    used.add(fp);
    picks.push({ ...row.pick, ticketRole: "main" });
    if (picks.length >= target) break;
  }

  for (const row of alts) {
    if (picks.length >= target) break;
    const fp = legFingerprint(row.pick);
    if (used.has(fp)) continue;
    used.add(fp);
    picks.push({ ...row.pick, ticketRole: "alt" });
    if (picks.length >= target) break;
  }

  const finalPicks = picks.slice(0, target);
  return {
    picks: finalPicks,
    breakdown: {
      mainQualified: mains.length,
      altQualified: alts.length,
      mainOnTicket: finalPicks.filter((p) => p.ticketRole === "main").length,
      altOnTicket: finalPicks.filter((p) => p.ticketRole === "alt").length,
    },
  };
}

/** Balanced ticket with per-size pool rotation and category order — not a prefix slice. */
export function stageServerTicketBalanced(
  ranked: ServerRankedLeg[],
  target: number,
): { picks: ParsedPick[]; breakdown: FullBoardScanResult["staging"] } {
  if (target < 3) return stageServerTicketLegacy(ranked, target);

  const profile = sizeProfile(target);
  const pools = rotatePoolsForTarget(partitionServerRankedByCategory(ranked), profile);
  const slots = balancedMixSlots(target);
  const categoryOrder = ASSEMBLY_CATEGORY_ORDERS[profile.orderShift % ASSEMBLY_CATEGORY_ORDERS.length]!;
  const used = new Set<string>();
  const out: ParsedPick[] = [];

  for (const cat of categoryOrder) {
    appendFromPool(out, used, pools[cat], slots[cat]);
  }

  const finalPicks = applyBalancedBackfill(out, target, pools);
  const mains = ranked.filter((r) => !r.isAlt);
  const alts = ranked.filter((r) => r.isAlt);

  return {
    picks: finalPicks,
    breakdown: {
      mainQualified: mains.length,
      altQualified: alts.length,
      mainOnTicket: finalPicks.filter((p) => p.ticketRole === "main").length,
      altOnTicket: finalPicks.filter((p) => p.ticketRole === "alt").length,
    },
  };
}

/** True when shorter leg keys are the prefix of a longer ticket. */
export function isPrefixServerTicket(
  longer: readonly ParsedPick[],
  shorter: readonly ParsedPick[],
): boolean {
  if (!shorter.length || shorter.length >= longer.length) return false;
  for (let i = 0; i < shorter.length; i++) {
    if (legFingerprint(longer[i]!) !== legFingerprint(shorter[i]!)) return false;
  }
  return true;
}
