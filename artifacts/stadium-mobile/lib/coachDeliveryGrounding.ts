/**
 * Final delivery gate — strip proven player/team/game mismatches before the
 * ticket ships, refill only from already-qualified candidates, and leave
 * honest shortfall when the pool cannot recover.
 *
 * Unknown identity (missing abbr / unparseable game) is NOT a mismatch and
 * must not be removed. Observe-only reliability reporting stays separate.
 */

type GroundablePick = CoachReliabilityGroundingPick & { pick?: string | null; odds?: number | null };
import {
  pickHasPlayerGameGroundingMismatch,
  type CoachReliabilityGroundingPick,
} from "./coachReliabilityGrounding.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";

export type DeliveryGroundingResult<T extends GroundablePick> = {
  picks: T[];
  /** Legs removed because player/team did not bind onto the pick's game. */
  removedCount: number;
  /** Qualified replacements seated after removals. */
  replacedCount: number;
  /** max(0, target − final length) after remove + replace. */
  shortfall: number;
  /** First mismatched game label among removed legs, else null. */
  affectedGame: string | null;
};

function asGroundingPick(p: GroundablePick): CoachReliabilityGroundingPick {
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

/** Player props cannot be delivered when their team has not been identified.
 * This is stricter than observe-only mismatch telemetry: unknown is not a
 * proven mismatch, but it is also not verified evidence for a ticket. */
function lacksPlayerTeamEvidence(p: GroundablePick): boolean {
  const prop = p.isProp === true ||
    !!String(p.propMarketKey ?? "").trim() ||
    !!String(p.athleteId ?? "").trim();
  return prop && !!String(p.game ?? "").trim() && !!String(p.player ?? "").trim() && !String(p.teamAbbr ?? "").trim();
}

function unsafePlayerGameSeat(p: GroundablePick): boolean {
  return lacksPlayerTeamEvidence(p) ||
    pickHasPlayerGameGroundingMismatch(asGroundingPick(p));
}

/** Exclude proven mismatches and player props without team evidence. */
export function filterPicksForPlayerGameGrounding<T extends GroundablePick>(
  picks: readonly T[],
): T[] {
  return picks.filter((p) => !unsafePlayerGameSeat(p));
}

/**
 * After final slate/team belts: remove proven mismatches, top up from
 * qualified leftovers that also pass grounding, report shortfall vs target.
 */
export function applyDeliveryGroundingGate<T extends GroundablePick>(opts: {
  picks: readonly T[];
  qualifiedCandidates?: readonly T[] | null;
  target: number;
}): DeliveryGroundingResult<T> {
  const target =
    typeof opts.target === "number" && Number.isFinite(opts.target)
      ? Math.max(0, Math.floor(opts.target))
      : 0;
  const incoming = opts.picks.slice();
  let affectedGame: string | null = null;
  let removedCount = 0;
  const kept: T[] = [];
  for (const p of incoming) {
    if (unsafePlayerGameSeat(p)) {
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
      if (unsafePlayerGameSeat(cand)) continue;
      used.add(fp);
      out.push(cand);
      replacedCount += 1;
    }
  }

  const finalPicks = target > 0 ? out.slice(0, target) : out;
  return {
    picks: finalPicks,
    removedCount,
    replacedCount,
    shortfall: Math.max(0, target - finalPicks.length),
    affectedGame,
  };
}
