/**
 * Log-space combination of Opportunity × Venue × Opponent Matchup
 * with volume vs efficiency kind-weighting.
 *
 *   combined = exp( log(opp) + log(venueAdj) + log(matchupAdj) )
 *   combined = clamp(combined, 0.78, 1.35)
 *
 * Cap proof: 1.28 × 1.12 × 1.14 = 1.634 → clamped to 1.35
 */

import {
  PRE_SIM_SHIFT_CAPS,
  type CombinePreSimInput,
  type PreSimShiftFactors,
} from "./types.js";
import { kindWeightedVenueMatchup, type ShiftKind } from "./volumeEfficiency.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function pos(n: number | null | undefined, fallback = 1): number {
  if (n == null || !Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/** Prove the absolute combined ceiling used in docs/tests. */
export function combinedCapProof(): {
  oppMax: number;
  venueMax: number;
  matchupMax: number;
  rawProduct: number;
  capped: number;
} {
  const oppMax = 1.28;
  const venueMax = PRE_SIM_SHIFT_CAPS.venueMax;
  const matchupMax = PRE_SIM_SHIFT_CAPS.matchupMax;
  const rawProduct = oppMax * venueMax * matchupMax;
  return {
    oppMax,
    venueMax,
    matchupMax,
    rawProduct,
    capped: clamp(rawProduct, PRE_SIM_SHIFT_CAPS.combinedMin, PRE_SIM_SHIFT_CAPS.combinedMax),
  };
}

export function combinePreSimShifts(input: CombinePreSimInput): PreSimShiftFactors {
  const opportunityShift = pos(input.opportunityShift, 1);
  const venueRaw = pos(input.venueRaw ?? input.venueShift, 1);
  const matchupRaw = pos(input.matchupRaw ?? input.opponentMatchupShift, 1);
  const kind: ShiftKind = input.shiftKind ?? "neutral";

  const weighted = kindWeightedVenueMatchup(venueRaw, matchupRaw, kind);
  const venueShift = weighted.venueShift;
  const opponentMatchupShift = weighted.opponentMatchupShift;

  const logSum =
    Math.log(opportunityShift) +
    Math.log(venueShift) +
    Math.log(opponentMatchupShift);
  let combinedShift = Math.exp(logSum);
  combinedShift = clamp(
    combinedShift,
    PRE_SIM_SHIFT_CAPS.combinedMin,
    PRE_SIM_SHIFT_CAPS.combinedMax,
  );

  // Explicit volume / efficiency paths for explainability + tests.
  const volW = kindWeightedVenueMatchup(venueRaw, matchupRaw, "volume");
  const effW = kindWeightedVenueMatchup(venueRaw, matchupRaw, "efficiency");
  const volumeShift = clamp(
    opportunityShift * volW.venueShift * volW.opponentMatchupShift,
    PRE_SIM_SHIFT_CAPS.combinedMin,
    PRE_SIM_SHIFT_CAPS.combinedMax,
  );
  const efficiencyShift = clamp(
    opportunityShift * effW.venueShift * effW.opponentMatchupShift,
    PRE_SIM_SHIFT_CAPS.combinedMin,
    PRE_SIM_SHIFT_CAPS.combinedMax,
  );

  const parts: string[] = [];
  if (opportunityShift !== 1) {
    parts.push(`opportunity×${opportunityShift.toFixed(3)}`);
  }
  if (venueShift !== 1) parts.push(`venue×${venueShift.toFixed(3)}`);
  if (opponentMatchupShift !== 1) {
    parts.push(`matchup×${opponentMatchupShift.toFixed(3)}`);
  }
  if (kind === "volume" && (venueRaw !== venueShift || matchupRaw !== opponentMatchupShift)) {
    parts.push(`volDamp`);
  }

  return {
    opportunityShift,
    venueShift,
    opponentMatchupShift,
    combinedShift,
    volumeShift,
    efficiencyShift,
    shiftKind: kind,
    family: input.family,
    opportunityExplain: input.opportunityExplain ?? null,
    venueExplain: input.venueExplain ?? null,
    matchupExplain: input.matchupExplain ?? null,
    combinedExplain:
      parts.length > 0
        ? `Pre-sim combined(${kind}): ${parts.join(" · ")} → ×${combinedShift.toFixed(3)}`
        : null,
    suppressSoftVenueBlend: Boolean(input.suppressSoftVenueBlend && venueRaw !== 1),
    suppressSoftVsOpponentBlend: Boolean(
      input.suppressSoftVsOpponentBlend && matchupRaw !== 1,
    ),
    venueSample: input.venueSample ?? 0,
    matchupSample: input.matchupSample ?? 0,
  };
}

export function identityPreSimFactors(family: string | null = null): PreSimShiftFactors {
  return {
    opportunityShift: 1,
    venueShift: 1,
    opponentMatchupShift: 1,
    combinedShift: 1,
    volumeShift: 1,
    efficiencyShift: 1,
    shiftKind: "neutral",
    family,
    opportunityExplain: null,
    venueExplain: null,
    matchupExplain: null,
    combinedExplain: null,
    suppressSoftVenueBlend: false,
    suppressSoftVsOpponentBlend: false,
    venueSample: 0,
    matchupSample: 0,
  };
}
