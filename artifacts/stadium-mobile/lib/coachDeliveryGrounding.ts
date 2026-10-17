/**
 * Final delivery gate — strip proven player/team/game mismatches before the
 * ticket ships, refill only from already-qualified candidates, and leave
 * honest shortfall when the pool cannot recover.
 *
 * Unknown identity (missing abbr / unparseable game) is NOT a mismatch and
 * must not be removed. Observe-only reliability reporting stays separate.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  pickHasPlayerGameGroundingMismatch,
  type CoachReliabilityGroundingPick,
} from "./coachReliabilityGrounding.ts";
import { withholdUnverifiableSeatedGrades } from "./coachSimProvenance.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";

export type DeliveryGroundingResult = {
  picks: ParsedPick[];
  /** Legs removed because player/team did not bind onto the pick's game. */
  removedCount: number;
  /** Qualified replacements seated after removals. */
  replacedCount: number;
  /** max(0, target − final length) after remove + replace. */
  shortfall: number;
  /** First mismatched game label among removed legs, else null. */
  affectedGame: string | null;
};

function asGroundingPick(p: ParsedPick): CoachReliabilityGroundingPick {
  return {
    game: p.game,
    teamAbbr: p.teamAbbr,
    player: p.player,
    isProp: p.isProp,
    propMarketKey: p.propMarketKey,
    athleteId: p.athleteId,
    market: p.market,
    sport: p.sport,
  };
}

/** Drop only confirmed mismatches; unknown identity stays. */
export function filterPicksForPlayerGameGrounding(
  picks: readonly ParsedPick[],
): ParsedPick[] {
  return picks.filter((p) => !pickHasPlayerGameGroundingMismatch(asGroundingPick(p)));
}

/**
 * After final slate/team belts: remove proven mismatches, top up from
 * qualified leftovers that also pass grounding, report shortfall vs target.
 */
export function applyDeliveryGroundingGate(opts: {
  picks: readonly ParsedPick[];
  qualifiedCandidates?: readonly ParsedPick[] | null;
  target: number;
}): DeliveryGroundingResult {
  const target =
    typeof opts.target === "number" && Number.isFinite(opts.target)
      ? Math.max(0, Math.floor(opts.target))
      : 0;
  const incoming = opts.picks.slice();
  let affectedGame: string | null = null;
  let removedCount = 0;
  const kept: ParsedPick[] = [];
  for (const p of incoming) {
    if (pickHasPlayerGameGroundingMismatch(asGroundingPick(p))) {
      removedCount += 1;
      if (!affectedGame) {
        const g = String(p.game ?? "").trim();
        if (g) affectedGame = g.slice(0, 120);
      }
      continue;
    }
    kept.push(p);
  }

  const used = new Set(kept.map(pickLegFingerprint));
  const out = kept.slice();
  let replacedCount = 0;
  const pool = opts.qualifiedCandidates ?? [];
  if (out.length < target && pool.length) {
    for (const cand of pool) {
      if (out.length >= target) break;
      const fp = pickLegFingerprint(cand);
      if (used.has(fp)) continue;
      if (pickHasPlayerGameGroundingMismatch(asGroundingPick(cand))) continue;
      used.add(fp);
      out.push(cand);
      replacedCount += 1;
    }
  }

  const sliced = target > 0 ? out.slice(0, target) : out;
  // Recompute edge/EV after substitutions; withhold unverifiable grades.
  const finalPicks = withholdUnverifiableSeatedGrades(sliced);
  return {
    picks: finalPicks,
    removedCount,
    replacedCount,
    shortfall: Math.max(0, target - finalPicks.length),
    affectedGame,
  };
}
