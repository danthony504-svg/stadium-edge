// Multi-factor prop SELECTION ranking — same six-signal rubric used for grading
// (matchup, trend, EV, injury, line-shopping, simulation) applied BEFORE the
// Coach model picks. Monte Carlo must complete before props enter realProps.

import type { ParsedPick } from "@/components/PickCard";
import type { BuiltChatContext, PropPoolEntry, RealPropEntry } from "@/lib/api";
import { fetchPropSimulations } from "@/lib/api";
import {
  coachPropHasMonteCarlo,
  coachPropSimMapFromResults,
  filterCoachPropsWithMonteCarlo,
  type CoachPropSimEntry,
} from "@/lib/coachPropMonteCarlo";
import { attachPickScores, type PlayerHistorySlice } from "@/lib/pickScoreContext";
import { resolveSimConfidence } from "@/lib/propSimFallback";
import type { PropSimAttachOpts } from "@/lib/propSimProgressive";
import { capGradeForSimHit } from "@/lib/simPropValidity";

const QUICK_SIM_TIMEOUT_MS = 6000;
const DEEP_SIM_TIMEOUT_MS = 18000;

export type PropSelectionOpts = PropSimAttachOpts & {
  propSimulations?: Map<string, CoachPropSimEntry>;
};

export type EnrichChatContextOpts = {
  /** Scale sim batch to ticket size (3–15 leg parlays). */
  requestedLegs?: number;
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

function cappedSelectionScore(
  entry: PropPoolEntry,
  propPool: PropPoolEntry[],
  opts: PropSelectionOpts,
): number | null {
  const scored = attachPickScores([parsedPickFromPoolEntry(entry)], {
    ...opts,
    propPool,
  })[0];
  if (!scored?.scores) return null;
  const key =
    entry.line != null
      ? propSimKey(entry.player, entry.marketKey ?? entry.marketLabel, entry.line, entry.side)
      : null;
  const sim = key ? opts.propSimulations?.get(key) : undefined;
  if (!sim || !coachPropHasMonteCarlo(sim)) return null;
  const simRow = {
    key: key!,
    player: entry.player,
    market: entry.marketKey ?? entry.marketLabel,
    line: entry.line!,
    side: entry.side,
    requestedSims: sim.completedSims ?? sim.simulations ?? 0,
    completedSims: sim.completedSims ?? sim.simulations ?? 0,
    failedSims: sim.failedSims ?? 0,
    actualSimCount: sim.completedSims ?? sim.simulations ?? 0,
    startedAt: "",
    finishedAt: "",
    runTimeMs: 0,
    simulations: sim.completedSims ?? sim.simulations ?? 0,
    hitProbability: sim.hitProbability,
    mostLikelyLine: sim.mostLikelyLine ?? null,
    meanProjection: sim.meanProjection ?? null,
    medianProjection: sim.medianProjection ?? null,
    confidenceScore: sim.confidenceScore ?? null,
    stdDev: null,
    sampleGames: 0,
    percentiles: null,
  };
  const capped = capGradeForSimHit(scored.scores, simRow);
  return capped.composite ?? null;
}

/** Composite selection score for one prop pool row (null when ungradeable or no MC). */
export function selectionScoreForEntry(
  entry: PropPoolEntry,
  propPool: PropPoolEntry[],
  opts: PropSelectionOpts,
): number | null {
  return cappedSelectionScore(entry, propPool, opts);
}

/** Rank prop pool rows best-first by multi-factor composite (sim required). */
export function rankPropPoolEntries(
  entries: PropPoolEntry[],
  opts: PropSelectionOpts,
): PropPoolEntry[] {
  if (!entries.length) return entries;
  const pool = opts.propPool.length ? opts.propPool : entries;
  const withScore = entries
    .map((e) => ({
      e,
      score: selectionScoreForEntry(e, pool, opts),
      simKey:
        e.line != null
          ? propSimKey(e.player, e.marketKey ?? e.marketLabel, e.line, e.side)
          : null,
      hit:
        e.line != null
          ? opts.propSimulations?.get(
              propSimKey(e.player, e.marketKey ?? e.marketLabel, e.line, e.side) ?? "",
            )?.hitProbability
          : null,
    }))
    .filter((x) => x.score != null && coachPropHasMonteCarlo(x.simKey ? opts.propSimulations?.get(x.simKey) : undefined));

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

/** Attach sim fields from Monte Carlo and return props sorted by selection score. */
export function enrichAndSortRealProps(
  realProps: RealPropEntry[],
  propPool: PropPoolEntry[],
  opts: PropSelectionOpts,
): RealPropEntry[] {
  const sims = opts.propSimulations;
  const enriched = realProps.map((rp) => {
    const side = preferredPropSide(rp);
    const key = side ? propSimKey(rp.player, rp.market, rp.line, side) : null;
    const sim = key && sims ? sims.get(key) : undefined;
    const hit = sim?.hitProbability ?? null;
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
      poolEntry != null && coachPropHasMonteCarlo(sim)
        ? selectionScoreForEntry(poolEntry, propPool, opts)
        : null;
    const simConf = sim ? resolveSimConfidence(sim) : null;
    return {
      ...rp,
      ...(hit != null ? { simHitPct: Math.round(hit * 100) } : {}),
      ...(simConf != null ? { simConfidencePct: simConf } : {}),
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

/** Build ParsedPick stubs for Monte Carlo on main prop pool lines. */
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

/** Sim batch size scales with requested leg count. */
export function propSimBatchLimitForLegs(requestedLegs: number): number {
  const n = requestedLegs > 0 ? requestedLegs : 6;
  return Math.min(48, Math.max(20, 12 + n * 2));
}

async function fetchCoachPropSimulations(
  simPicks: ParsedPick[],
  propPool: PropPoolEntry[],
  requestedLegs: number,
  signal?: AbortSignal,
): Promise<Map<string, CoachPropSimEntry>> {
  const preferDeep = requestedLegs >= 3;
  const tiers: Array<"deep" | "quick"> = preferDeep ? ["deep", "quick"] : ["quick"];

  for (const tier of tiers) {
    const timeoutMs = tier === "deep" ? DEEP_SIM_TIMEOUT_MS : QUICK_SIM_TIMEOUT_MS;
    try {
      const rows = await Promise.race([
        fetchPropSimulations(simPicks, propPool, { tier }, signal),
        new Promise<Map<string, import("@/lib/api").PropSimulationResult>>((resolve) => {
          setTimeout(() => resolve(new Map()), timeoutMs);
        }),
      ]);
      const mapped = coachPropSimMapFromResults(rows);
      if ([...mapped.values()].some((v) => coachPropHasMonteCarlo(v))) {
        return mapped;
      }
    } catch {
      /* try next tier */
    }
  }
  return new Map();
}

/**
 * Monte Carlo BEFORE Coach selection: sim the prop pool, rank realProps with the
 * full rubric, and drop any prop without server Monte Carlo backing.
 */
export async function enrichChatContextProps(
  built: BuiltChatContext,
  signal?: AbortSignal,
  enrichOpts?: EnrichChatContextOpts,
): Promise<{
  built: BuiltChatContext;
  propSimulations: Map<string, CoachPropSimEntry>;
}> {
  const { context, propPool } = built;
  if (!propPool.length || !context.realProps?.length) {
    return { built, propSimulations: new Map() };
  }

  const requestedLegs = enrichOpts?.requestedLegs ?? 0;
  const simLimit = propSimBatchLimitForLegs(requestedLegs);
  const simPicks = picksForPropSimBatch(propPool, simLimit);
  let propSimulations = await fetchCoachPropSimulations(simPicks, propPool, requestedLegs, signal);

  const selectionOpts: PropSelectionOpts = {
    propPool,
    matchupHistory: context.matchupHistory,
    matchupInjuries: context.matchupInjuries,
    playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
    propSimulations,
  };

  const sortedProps = enrichAndSortRealProps(context.realProps, propPool, selectionOpts);
  const parlayProps = filterCoachPropsWithMonteCarlo(sortedProps, propSimulations);

  return {
    built: {
      ...built,
      context: { ...context, realProps: parlayProps },
    },
    propSimulations,
  };
}
