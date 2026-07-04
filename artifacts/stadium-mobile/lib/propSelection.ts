// Multi-factor prop SELECTION ranking — same six-signal rubric used for grading
// (matchup, trend, EV, injury, line-shopping, simulation) but applied to pick
// WHICH props to surface. Simulation is a major factor, never the sole driver.

import type { ParsedPick } from "@/components/PickCard";
import type { BuiltChatContext, PropPoolEntry, RealPropEntry } from "@/lib/api";
import { fetchPropSimulations } from "@/lib/api";
import {
  attachPickScores,
  type PlayerHistorySlice,
  type PropSimAttachOpts,
} from "@/lib/pickScoreContext";

const SIM_SELECTION_TIMEOUT_MS = 2200;

export type PropSelectionOpts = PropSimAttachOpts & {
  propSimulations?: Map<string, { hitProbability: number | null }>;
};

export function propSimKey(
  player: string,
  market: string,
  line: number | null | undefined,
  side: string,
): string | null {
  if (line == null || !Number.isFinite(line)) return null;
  const s = side === "Under" ? "Under" : side === "Over" ? "Over" : null;
  if (!s) return null;
  return `${player}|${market}|${line}|${s}`;
}

function parsedPickFromPoolEntry(e: PropPoolEntry): ParsedPick {
  const pick =
    e.line != null
      ? `${e.player} ${e.side} ${e.line} ${e.marketLabel}`
      : `${e.player} ${e.marketLabel}`;
  return {
    game: e.game,
    market: e.marketLabel,
    pick,
    odds: e.odds,
    sport: e.sport,
    isProp: true,
    startsAt: e.startsAt,
    headshot: e.headshot,
    teamAbbr: e.teamAbbr,
    player: e.player,
    athleteId: e.athleteId,
    propMarketKey: e.marketKey,
    propLine: e.line,
    propSide: e.side,
  };
}

/** Composite selection score for one prop pool row (null when ungradeable). */
export function selectionScoreForEntry(
  entry: PropPoolEntry,
  propPool: PropPoolEntry[],
  opts: PropSelectionOpts,
): number | null {
  const scored = attachPickScores([parsedPickFromPoolEntry(entry)], {
    ...opts,
    propPool,
  })[0];
  return scored?.scores?.composite ?? null;
}

/** Rank prop pool rows best-first by multi-factor composite (sim is one input). */
export function rankPropPoolEntries(
  entries: PropPoolEntry[],
  opts: PropSelectionOpts,
): PropPoolEntry[] {
  if (!entries.length) return entries;
  const pool = opts.propPool.length ? opts.propPool : entries;
  const withScore = entries.map((e) => ({
    e,
    score: selectionScoreForEntry(e, pool, opts),
  }));
  return withScore
    .sort((a, b) => {
      const as = a.score ?? -1;
      const bs = b.score ?? -1;
      if (bs !== as) return bs - as;
      return (b.e.edge ?? 0) - (a.e.edge ?? 0);
    })
    .map((x) => x.e);
}

/** Preferred side for a realProps row: +EV side when flagged, else Over if priced. */
export function preferredPropSide(rp: RealPropEntry): "Over" | "Under" | null {
  if (rp.evSide === "Over" || rp.evSide === "Under") return rp.evSide;
  if (rp.over != null && rp.under == null) return "Over";
  if (rp.under != null && rp.over == null) return "Under";
  if (rp.over != null && rp.under != null) {
    return (rp.over ?? 0) >= (rp.under ?? 0) ? "Over" : "Under";
  }
  return null;
}

/** Attach simHitPct from the simulation map and return props sorted by selection score. */
export function enrichAndSortRealProps(
  realProps: RealPropEntry[],
  propPool: PropPoolEntry[],
  opts: PropSelectionOpts,
): RealPropEntry[] {
  const sims = opts.propSimulations;
  const enriched = realProps.map((rp) => {
    const side = preferredPropSide(rp);
    const key = side ? propSimKey(rp.player, rp.market, rp.line, side) : null;
    const hit = key && sims ? sims.get(key)?.hitProbability : null;
    const poolEntry =
      side && rp.line != null
        ? propPool.find(
            (e) =>
              e.player === rp.player &&
              e.marketKey === rp.market &&
              e.line === rp.line &&
              e.side === side &&
              e.game === rp.game,
          )
        : undefined;
    const selectionScore =
      poolEntry != null ? selectionScoreForEntry(poolEntry, propPool, opts) : null;
    return {
      ...rp,
      ...(hit != null ? { simHitPct: Math.round(hit * 100) } : {}),
      ...(selectionScore != null ? { selectionScore } : {}),
    };
  });

  return [...enriched].sort((a, b) => {
    const as = (a as RealPropEntry & { selectionScore?: number }).selectionScore ?? -1;
    const bs = (b as RealPropEntry & { selectionScore?: number }).selectionScore ?? -1;
    if (bs !== as) return bs - as;
    const ae = a.edge ?? 0;
    const be = b.edge ?? 0;
    if (be !== ae) return be - ae;
    const ash = (a as RealPropEntry & { simHitPct?: number }).simHitPct ?? 0;
    const bsh = (b as RealPropEntry & { simHitPct?: number }).simHitPct ?? 0;
    return bsh - ash;
  });
}

/** Build ParsedPick stubs for quick simulation of main prop pool lines. */
export function picksForPropSimBatch(
  propPool: PropPoolEntry[],
  limit = 32,
): ParsedPick[] {
  const seen = new Set<string>();
  const out: ParsedPick[] = [];
  for (const e of propPool) {
    if (e.line == null) continue;
    const k = `${e.player}|${e.marketKey ?? e.marketLabel}|${e.line}|${e.side}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(parsedPickFromPoolEntry(e));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Quick-tier server sim + multi-factor sort for realProps (non-blocking).
 * Deep sims warm on the server in the background; context uses quick results only.
 */
export async function enrichChatContextProps(
  built: BuiltChatContext,
  signal?: AbortSignal,
): Promise<{
  built: BuiltChatContext;
  propSimulations: Map<string, { hitProbability: number | null }>;
}> {
  const { context, propPool } = built;
  if (!propPool.length || !context.realProps?.length) {
    return { built, propSimulations: new Map() };
  }

  let propSimulations = new Map<string, { hitProbability: number | null }>();
  try {
    const simPicks = picksForPropSimBatch(propPool, 28);
    if (simPicks.length) {
      propSimulations = await Promise.race([
        fetchPropSimulations(simPicks, propPool, { tier: "quick" }, signal).then((m) => {
          const out = new Map<string, { hitProbability: number | null }>();
          for (const [k, v] of m) out.set(k, { hitProbability: v.hitProbability });
          return out;
        }),
        new Promise<Map<string, { hitProbability: number | null }>>((resolve) => {
          setTimeout(() => resolve(new Map()), SIM_SELECTION_TIMEOUT_MS);
        }),
      ]);
    }
  } catch {
    /* selection proceeds without sim */
  }

  const selectionOpts: PropSelectionOpts = {
    propPool,
    matchupHistory: context.matchupHistory,
    matchupInjuries: context.matchupInjuries,
    playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
  };

  const sortedProps = enrichAndSortRealProps(context.realProps, propPool, {
    ...selectionOpts,
    propSimulations,
  });

  return {
    built: {
      ...built,
      context: { ...context, realProps: sortedProps },
    },
    propSimulations,
  };
}
