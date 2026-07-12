// Balanced server ticket assembly — ~50% props, category pools, props-first backfill.

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

/** Balanced ticket: ~50% props, ~25% game lines, ~15% team totals, ~10% alts. */
export function stageServerTicketBalanced(
  ranked: ServerRankedLeg[],
  target: number,
): { picks: ParsedPick[]; breakdown: FullBoardScanResult["staging"] } {
  if (target < 3) return stageServerTicketLegacy(ranked, target);

  const pools = partitionServerRankedByCategory(ranked);
  const slots = balancedMixSlots(target);
  const used = new Set<string>();
  const out: ParsedPick[] = [];

  const fillCategory = (cat: BoardMarketCategory, want: number) => {
    appendFromPool(out, used, pools[cat], want);
  };

  fillCategory("props", slots.props);
  fillCategory("gameLines", slots.gameLines);
  fillCategory("teamTotals", slots.teamTotals);
  fillCategory("alternateLines", slots.alternateLines);

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
