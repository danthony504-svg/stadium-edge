import type { ParsedPick } from "../components/PickCard.tsx";
import { propSharedDistributionMarketKey } from "./propSharedDistribution.ts";
import { propsOnlySimLookupKey } from "./coachFootballPropsOnlyGrade.ts";

/** One exact player/event/stat draw covers posted thresholds and both sides. */
export function propDistributionIdentity(p: ParsedPick): string | null {
  if (!p.athleteId || !p.eventId || !p.sport || !p.propMarketKey) return null;
  return [p.sport.toLowerCase(), p.eventId, p.athleteId,
    propSharedDistributionMarketKey(p.propMarketKey)].join("|");
}

/** Spend the existing request cap on distinct distributions, not repeated rungs. */
export function distinctPropSimSeeds<T extends ParsedPick>(picks: readonly T[]): T[] {
  const seen = new Set<string>();
  return picks.filter(p => {
    const key = propDistributionIdentity(p);
    if (!key) return true; // missing identity still fails the independent provenance gate
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Legacy response keys lack event id. Ambiguous keys must never bind evidence. */
export function postedPropCoverageForBatch<T extends ParsedPick>(
  posted: readonly T[], seeds: readonly ParsedPick[],
): Map<string, T> {
  const distributions = new Set(seeds.map(propDistributionIdentity).filter(Boolean));
  const ambiguous = new Set<string>();
  const out = new Map<string, T>();
  const globalKeys = new Map<string, string | null>();
  for (const p of posted) {
    const key = propsOnlySimLookupKey(p);
    if (!key) continue;
    const identity = propDistributionIdentity(p);
    if (globalKeys.has(key) && globalKeys.get(key) !== identity) ambiguous.add(key);
    globalKeys.set(key, identity);
    if (identity && distributions.has(identity)) out.set(key, p);
  }
  for (const key of ambiguous) out.delete(key);
  return out;
}

/** New participants and stat families first; retain every remaining seed. */
export function prioritizeUnscannedPropSeeds<T extends ParsedPick>(remaining: readonly T[], attempted: readonly ParsedPick[]): T[] {
  const player = (p: ParsedPick) => [p.sport,p.eventId??p.game,p.athleteId??p.player].join("|");
  const family = (p: ParsedPick) => propSharedDistributionMarketKey(p.propMarketKey??p.market);
  const players=new Set(attempted.map(player)), families=new Set(attempted.map(family));
  return remaining.map((pick,index)=>({pick,index,p:Number(players.has(player(pick))),f:Number(families.has(family(pick)))})).sort((a,b)=>a.p-b.p||a.f-b.f||a.index-b.index).map(x=>x.pick);
}
