// Server-side Monte Carlo result cache. Quick-tier results return fast for pick
// cards; deep-tier results warm in the background and are reused on repeat asks.

import { cacheGet, cacheSet } from "./store.js";

export type SimTier = "quick" | "deep";

const TTL_MS: Record<SimTier, number> = {
  quick: 5 * 60 * 1000,
  deep: 30 * 60 * 1000,
};

export function simCacheKey(
  sport: string,
  player: string,
  market: string,
  line: number,
  side: string,
  tier: SimTier,
  additionalLines?: number[],
): string {
  const base = `sim:${tier}:${sport}:${player}:${market}:${line}:${side}`;
  if (!additionalLines?.length) return base;
  const alts = [...additionalLines].sort((a, b) => a - b).join(",");
  return `${base}:alts=${alts}`;
}

export async function getCachedSim<T>(key: string): Promise<T | undefined> {
  return cacheGet<T>(key);
}

export async function setCachedSim<T>(key: string, value: T, tier: SimTier): Promise<void> {
  await cacheSet(key, value, TTL_MS[tier]);
}
