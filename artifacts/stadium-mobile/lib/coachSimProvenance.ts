/**
 * Sim provenance through seating / substitution / delivery.
 *
 * Probability (simHit), market/line/side, odds, and cover-query identity must
 * stay bound together. Derived edge (percentage points) and EV% are recomputed
 * from simHit + odds after any substitution — never copied from a stale ALT
 * grade. Grades whose provenance cannot be verified are withheld.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FinalAiScore } from "./finalAiScore.ts";
import { simEdgeFromHit, simEvPct } from "./gameSimQualityGates.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";

export type DerivedEdgeEv = {
  /** Probability-point edge vs book-implied win rate (push-adjusted). */
  edgePct: number | null;
  /** Expected-value percent with integer-line push refunds. */
  evPct: number | null;
};

/**
 * Recompute derived edge/EV from a verified hit probability + posted odds.
 * Pass `pushRate` for integer lines (land-on-number stake refund); half-points
 * leave it at 0.
 */
export function recomputeDerivedEdgeEv(
  simHit: number | null | undefined,
  odds: number | null | undefined,
  pushRate = 0,
): DerivedEdgeEv {
  if (simHit == null || !Number.isFinite(simHit) || simHit <= 0 || simHit >= 1) {
    return { edgePct: null, evPct: null };
  }
  if (odds == null || !Number.isFinite(odds) || odds === 0) {
    return { edgePct: null, evPct: null };
  }
  return {
    edgePct: simEdgeFromHit(simHit, odds, pushRate),
    evPct: simEvPct(simHit, odds, pushRate),
  };
}

/**
 * True when a seated grade can be verified against simHit + market/line/side + odds.
 * Letter grades without a finite simHit are unverifiable and must be withheld.
 */
export function simProvenanceIsVerifiable(
  pick: ParsedPick,
  simHit?: number | null,
): boolean {
  const hit = simHit !== undefined ? simHit : (pick.finalAiScore?.simHit ?? null);
  if (!pick.game || !pick.market || !pick.pick) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return false;
  if (!pickHasSimGrade(pick, hit)) return false;
  return true;
}

function withholdScore(prev: FinalAiScore | null | undefined): FinalAiScore | null | undefined {
  if (!prev) return prev;
  return {
    ...prev,
    simHit: null,
    edgePct: null,
    grade: null,
    confidencePct: null,
    composite: null,
    recommends: false,
    simAligned: false,
    highRiskValuePlay: false,
    rubric: {
      ...prev.rubric,
      edgePct: null,
      grade: null,
      confidencePct: null,
      composite: null,
    },
  };
}

/**
 * Sync simHit onto the pick and recompute edge/EV from the pick's current odds.
 * Withholds grade/confidence/composite when provenance cannot be verified.
 */
export function attachSeatedSimProvenance(
  pick: ParsedPick,
  simHit: number | null | undefined,
): ParsedPick {
  const hit =
    simHit != null && Number.isFinite(simHit) && simHit > 0 && simHit < 1 ? simHit : null;
  const verifiable = simProvenanceIsVerifiable(pick, hit);
  if (!verifiable) {
    const withheld = withholdScore(pick.finalAiScore);
    return {
      ...pick,
      finalAiScore: withheld ?? pick.finalAiScore,
      scores: pick.scores
        ? {
            ...pick.scores,
            edgePct: null,
            grade: null,
            confidencePct: null,
            composite: null,
          }
        : pick.scores,
    };
  }

  const { edgePct } = recomputeDerivedEdgeEv(hit, pick.odds ?? null);
  const prev = pick.finalAiScore;
  if (!prev) {
    return pick;
  }
  const nextScore: FinalAiScore = {
    ...prev,
    simHit: hit,
    edgePct,
    rubric: {
      ...prev.rubric,
      edgePct,
    },
  };
  return {
    ...pick,
    finalAiScore: nextScore,
    scores: pick.scores
      ? {
          ...pick.scores,
          edgePct,
        }
      : pick.scores,
  };
}

/** Withhold unverifiable grades on an already-seated ticket (delivery belt). */
export function withholdUnverifiableSeatedGrades(
  picks: readonly ParsedPick[],
): ParsedPick[] {
  return picks.map((p) => {
    if (simProvenanceIsVerifiable(p)) {
      // Still recompute edge/EV so stale ALT odds cannot keep a mismatched edge.
      return attachSeatedSimProvenance(p, p.finalAiScore?.simHit ?? null);
    }
    return attachSeatedSimProvenance(p, null);
  });
}

/** Label probability-point edge for cards — never "% EV". */
export function formatSimEdgePp(edgePct: number): string {
  const sign = edgePct >= 0 ? "+" : "";
  return `${sign}${edgePct.toFixed(1)} pp`;
}

/** Label EV% separately from probability-point edge. */
export function formatSimEvPctLabel(evPct: number): string {
  const sign = evPct >= 0 ? "+" : "";
  return `${sign}${evPct.toFixed(1)}% EV`;
}
