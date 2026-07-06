// Pure qualified parlay reach — diversity relaxation without lowering quality.

import type { ParsedPick } from "../components/PickCard.tsx";
import { defaultDiversityCaps, defaultMarketQuotas, reachSelectDiverseQualified } from "./pickDiversity.ts";
import { isFullyQualifiedPick } from "./parlayQualifiedGate.ts";
import { reachParlayMix } from "./parlayReachCore.ts";

export type ReachSelectOpts = {
  maxGameLegs?: number;
  maxPerGame?: number;
  varietySeed?: string;
  avoidLegKeys?: Set<string>;
  recentPlayerKeys?: Set<string>;
  playerAppearanceCounts?: Map<string, number>;
  longshotAsk?: boolean;
};

/** Relax diversity caps so blocked games are replaced by other markets — never unqualified legs. */
export function reachSelectQualifiedToTarget(
  candidates: ParsedPick[],
  target: number,
  opts?: ReachSelectOpts,
): ParsedPick[] {
  if (target <= 0) return [];
  const qualified = candidates.filter(isFullyQualifiedPick);
  if (!qualified.length) return [];

  const base = defaultDiversityCaps(target);
  const mix = reachParlayMix(target);
  return reachSelectDiverseQualified(qualified, target, {
    target,
    varietySeed: opts?.varietySeed,
    avoidLegKeys: opts?.avoidLegKeys,
    recentPlayerKeys: opts?.recentPlayerKeys,
    playerAppearanceCounts: opts?.playerAppearanceCounts,
    longshotAsk: opts?.longshotAsk,
    quotas: defaultMarketQuotas(target, opts?.longshotAsk),
    caps: {
      maxPerGame: opts?.maxPerGame ?? base.maxPerGame,
      maxPerTeam: base.maxPerTeam,
      maxPerPlayer: base.maxPerPlayer,
      maxPerMarketFamily: base.maxPerMarketFamily,
      maxGameLegs: opts?.maxGameLegs ?? mix.maxGameLegs,
      maxSpreadLegs: base.maxSpreadLegs,
    },
  });
}
