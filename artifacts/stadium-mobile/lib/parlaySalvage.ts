// Honest parlay salvage from the live odds board — shared by pre- and post-sim paths.

import {
  backfillPicks,
  backfillProps,
  GENERIC_BACKFILL_ORDER,
  type ParsedPick,
} from "../components/PickCard.tsx";
import {
  buildRealOdds,
  getOdds,
  type GameMeta,
  type OddsGame,
  type PropPoolEntry,
  type RealOddsEntry,
} from "./api.ts";
import { focalSportsFromText, parlayPoolHint } from "./chatContextPriority.ts";
import {
  filterSalvageOddsPool,
  isPregameBettable,
  mentionsPropIntent,
  type SlateDay,
} from "./slate.ts";
import type { PropSelectionOpts } from "./propSelection.ts";

/** Pull named-sport pregame lines from the live feed when context.realOdds is thin. */
export async function fetchFreshSalvageOdds(
  trimmed: string,
  signal?: AbortSignal,
): Promise<RealOddsEntry[]> {
  const salvageSports = focalSportsFromText(trimmed);
  if (salvageSports.size === 0) return [];
  const rows = await Promise.all(
    [...salvageSports].map((sport) =>
      getOdds(sport, signal).catch(() => [] as OddsGame[]),
    ),
  );
  const out: RealOddsEntry[] = [];
  let i = 0;
  for (const sport of salvageSports) {
    const games = rows[i++] ?? [];
    for (const g of games) {
      if (!isPregameBettable(g.commenceTime)) continue;
      out.push(...buildRealOdds({ ...g, sport }));
    }
  }
  return out;
}

/**
 * Resolve the real-odds pool for salvage. Uses context first, then a fresh sport
 * fetch, and relaxes tonight-only when that filter empties a thin named slate.
 */
export async function resolveSalvageOddsPool(
  trimmed: string,
  slateDay: SlateDay,
  contextOdds: RealOddsEntry[],
  opts?: { minEntries?: number; signal?: AbortSignal },
): Promise<RealOddsEntry[]> {
  const minEntries = opts?.minEntries ?? 2;
  let pool = filterSalvageOddsPool(contextOdds, trimmed, slateDay);
  if (pool.length >= minEntries) return pool;

  const fresh = await fetchFreshSalvageOdds(trimmed, opts?.signal);
  if (!fresh.length) return pool;

  pool = filterSalvageOddsPool(fresh, trimmed, slateDay);
  if (pool.length >= minEntries) return pool;

  // Tonight filter can leave a single WC match while spread/total lines still
  // support a 2-leg ticket — fall back to the full pregame named-sport window.
  if (slateDay) {
    const broad = filterSalvageOddsPool(fresh, trimmed, null);
    if (broad.length > pool.length) return broad;
  }

  return pool.length > 0 ? pool : filterSalvageOddsPool(fresh, trimmed, null);
}

export type ParlaySalvageOpts = {
  trimmed: string;
  target: number;
  slateDay: SlateDay;
  contextOdds: RealOddsEntry[];
  mergedPropPool: PropPoolEntry[];
  gameMeta: GameMeta[];
  propsOnlyTicket: boolean;
  propBackfillOpts: {
    plusMoneyBias: boolean;
    diversify: boolean;
    maxPerMarket?: number;
    varietySeed: string;
    avoidLegKeys?: Set<string>;
    selectionOpts?: PropSelectionOpts;
  };
  signal?: AbortSignal;
};

function fillParlayFromPool(
  existing: ParsedPick[],
  salvagePool: RealOddsEntry[],
  opts: ParlaySalvageOpts,
): ParsedPick[] {
  const tgt = opts.target;
  const propsFirst =
    mentionsPropIntent(opts.trimmed) ||
    existing.every((p) => p.isProp) ||
    existing.some((p) => p.isProp);

  if (propsFirst) {
    let picks = backfillProps(existing, opts.mergedPropPool, salvagePool, opts.gameMeta, {
      target: tgt,
      ...opts.propBackfillOpts,
    });
    if (!opts.propsOnlyTicket && picks.length < tgt) {
      picks = backfillPicks(picks, salvagePool, opts.gameMeta, {
        target: tgt,
        order: GENERIC_BACKFILL_ORDER,
      });
    }
    return picks;
  }

  let picks = backfillPicks(existing, salvagePool, opts.gameMeta, {
    target: tgt,
    order: GENERIC_BACKFILL_ORDER,
  });
  picks = backfillProps(picks, opts.mergedPropPool, salvagePool, opts.gameMeta, {
    target: tgt,
    ...opts.propBackfillOpts,
  });
  return picks;
}

/** Build the best honest ticket from real posted prices when the model failed. */
export async function buildParlaySalvagePicks(opts: ParlaySalvageOpts): Promise<ParsedPick[]> {
  const salvagePool = await resolveSalvageOddsPool(
    opts.trimmed,
    opts.slateDay,
    opts.contextOdds,
    { minEntries: Math.min(2, opts.target), signal: opts.signal },
  );
  if (salvagePool.length === 0) return [];
  return fillParlayFromPool([], salvagePool, opts);
}

/** Reach-N top-up when the model (or sim gates) left the ticket short of the ask. */
export async function topUpParlayPicks(
  existing: ParsedPick[],
  opts: ParlaySalvageOpts,
): Promise<ParsedPick[]> {
  if (existing.length >= opts.target) return existing;
  const hint = parlayPoolHint(opts.trimmed, existing);
  const salvagePool = await resolveSalvageOddsPool(hint, opts.slateDay, opts.contextOdds, {
    minEntries: opts.target,
    signal: opts.signal,
  });
  if (salvagePool.length === 0) return existing;
  return fillParlayFromPool(existing, salvagePool, { ...opts, trimmed: hint });
}
