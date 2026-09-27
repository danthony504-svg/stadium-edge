/**
 * Pure local grading for NFL/NCAAF props-only tickets.
 * Kept free of api.ts so node:test can prove history → sim hit without the
 * network import graph.
 *
 * Phone empties after #539: candidates selected, but enrich/server race still
 * produced 0 propLegsScored. This module grades from already-fetched game logs.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";
import { clipPropSimHitForGrade, pickHasSimGrade } from "./simMarketSupport.ts";

export type PropsOnlyHit = { hitProbability: number | null; nullReason?: string | null };

export type PropsOnlyHistorySlice = {
  player?: string;
  labels?: string[];
  recent?: { stats?: Record<string, string> }[];
};

type PoolRow = {
  player: string;
  side: string;
  line: number | null;
  game?: string;
  marketKey?: string | null;
};

function propSimKey(
  player: string,
  market: string,
  line: number,
  side: string,
): string {
  return `${player}|${market}|${line}|${side}`;
}

export function propsOnlySimLookupKey(
  pick: {
    player?: string;
    propMarketKey?: string | null;
    market?: string;
    propLine?: number | null;
    propSide?: string | null;
  },
  poolRow?: { marketKey?: string | null } | null,
): string | null {
  if (!pick.player || pick.propLine == null || !pick.propSide) return null;
  const side = pick.propSide === "Under" ? "Under" : pick.propSide === "Over" ? "Over" : null;
  if (!side) return null;
  const market = pick.propMarketKey ?? poolRow?.marketKey ?? pick.market ?? "";
  return propSimKey(pick.player, market, pick.propLine, side);
}

function lookupHit(
  pick: Parameters<typeof propsOnlySimLookupKey>[0],
  poolRow: Parameters<typeof propsOnlySimLookupKey>[1],
  hits: Map<string, PropsOnlyHit>,
): number | null {
  const keys = new Set<string>();
  const primary = propsOnlySimLookupKey(pick, poolRow);
  if (primary) keys.add(primary);
  const altMarket = pick.propMarketKey ? pick.market : pick.propMarketKey;
  if (altMarket) {
    const alt = propsOnlySimLookupKey({ ...pick, propMarketKey: altMarket }, poolRow);
    if (alt) keys.add(alt);
  }
  for (const key of keys) {
    const hit = hits.get(key)?.hitProbability;
    if (hit != null && Number.isFinite(hit)) return hit;
  }
  return null;
}

function historyForPick(
  pick: ParsedPick,
  histories: Record<string, PropsOnlyHistorySlice | undefined>,
): PropsOnlyHistorySlice | null {
  if (!pick.player) return null;
  if (pick.athleteId) {
    const keyed = histories[`${pick.player}#${pick.athleteId}`];
    if (keyed?.recent?.length) return keyed;
  }
  const byName = Object.entries(histories).find(
    ([k, v]) => k.startsWith(`${pick.player}#`) && (v?.recent?.length ?? 0) > 0,
  )?.[1];
  return byName ?? null;
}

function poolRowForPick(pick: ParsedPick, pool: PoolRow[]): PoolRow | undefined {
  const side = pick.propSide === "Under" ? "Under" : pick.propSide === "Over" ? "Over" : null;
  if (!side || pick.propLine == null) return undefined;
  return (
    pool.find(
      (e) =>
        e.player === pick.player &&
        e.side === side &&
        e.line === pick.propLine &&
        (pick.game ? e.game === pick.game : true),
    ) ?? pool.find((e) => e.player === pick.player && e.side === side)
  );
}

/** Same hit-rate math as simulatorLocalSim — inlined to stay api-free for tests. */
function localHitFromHistory(
  history: PropsOnlyHistorySlice | null | undefined,
  args: { market: string; line: number; side: "Over" | "Under" },
): number | null {
  const recent = history?.recent ?? [];
  if (!recent.length) return null;
  const ambiguous = computeAmbiguous(history?.labels);
  const vals = recent
    .map((g) => gameValueForMarket(args.market, g.stats ?? {}, ambiguous))
    .filter((v): v is number => v != null)
    .slice(0, 10);
  if (vals.length < 3) return null;
  const hits = vals.filter((v) => (args.side === "Under" ? v < args.line : v >= args.line)).length;
  const hitProbRaw = hits / vals.length;
  return hitProbRaw <= 0 ? 0.02 : hitProbRaw >= 1 ? 0.98 : hitProbRaw;
}

/** Grade one pick from real ESPN game-log history. Soft-clips binary TD 0/1. */
export function gradeFootballPropFromHistory(
  pick: ParsedPick,
  hist: PropsOnlyHistorySlice | null | undefined,
  poolRow?: { marketKey?: string | null } | null,
): PropsOnlyHit {
  const market = pick.propMarketKey ?? poolRow?.marketKey ?? null;
  const side = pick.propSide === "Under" ? "Under" : pick.propSide === "Over" ? "Over" : null;
  if (!market || pick.propLine == null || !side || !pick.player) {
    return { hitProbability: null, nullReason: "incomplete_prop" };
  }
  if (!hist?.recent?.length) {
    return { hitProbability: null, nullReason: "no_player_history" };
  }
  const hitProb = localHitFromHistory(hist, {
    market,
    line: pick.propLine,
    side,
  });
  if (hitProb == null) {
    return {
      hitProbability: null,
      nullReason:
        (hist.recent?.length ?? 0) >= 3 ? "insufficient_mapped_stats" : "insufficient_game_log",
    };
  }
  const clipped = clipPropSimHitForGrade(pick, hitProb);
  return { hitProbability: clipped, nullReason: null };
}

export function gradeFootballPropsOnlyFromHistory(
  picks: ParsedPick[],
  histories: Record<string, PropsOnlyHistorySlice | undefined>,
  pool: PoolRow[] = [],
): Map<string, PropsOnlyHit> {
  const hits = new Map<string, PropsOnlyHit>();
  for (const pick of picks) {
    const row = poolRowForPick(pick, pool);
    const key = propsOnlySimLookupKey(pick, row);
    if (!key) continue;
    const hist = historyForPick(pick, histories);
    hits.set(key, gradeFootballPropFromHistory(pick, hist, row));
  }
  return hits;
}

export function softClipPropsOnlyHits(
  picks: ParsedPick[],
  hits: Map<string, PropsOnlyHit>,
  pool: PoolRow[] = [],
): void {
  for (const pick of picks) {
    const row = poolRowForPick(pick, pool);
    const key = propsOnlySimLookupKey(pick, row);
    if (!key) continue;
    const raw = hits.get(key)?.hitProbability;
    const clipped = clipPropSimHitForGrade(pick, raw);
    if (clipped != null && clipped !== raw) {
      hits.set(key, { hitProbability: clipped, nullReason: null });
    }
  }
}

export function propsOnlyPickHasGrade(
  pick: ParsedPick,
  hits: Map<string, PropsOnlyHit>,
  pool: PoolRow[] = [],
): boolean {
  const row = poolRowForPick(pick, pool);
  const raw = lookupHit(pick, row, hits);
  const clipped = clipPropSimHitForGrade(pick, raw);
  return pickHasSimGrade(pick, clipped);
}
