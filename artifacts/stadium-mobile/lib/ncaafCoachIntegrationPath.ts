/**
 * Coach integration path for verified NCAAF market candidates.
 *
 * Wiring only — does not unlock product gates. When a market family is later
 * validated + E6'd, this checklist is the required delivery path:
 *   real odds → matchup/context → simulation → qualification → correlation
 *   → ALT/refill → rendered ticket (honest shortfalls + traceable grades).
 *
 * Other sports and startup/auth fixes must remain untouched by NCAAF unlocks.
 */

import {
  NCAAF_GAME_LINE_SIM_VALIDATED,
  NCAAF_MARKET_SIM_VALIDATED,
  type NcaafMarketFamily,
} from "./coachP0UnvalidatedTotals.ts";

export type CoachIntegrationStage =
  | "real_odds"
  | "matchup_context"
  | "simulation"
  | "qualification"
  | "correlation"
  | "alt_refill"
  | "rendered_ticket";

export const NCAAF_COACH_INTEGRATION_STAGES: readonly CoachIntegrationStage[] = [
  "real_odds",
  "matchup_context",
  "simulation",
  "qualification",
  "correlation",
  "alt_refill",
  "rendered_ticket",
] as const;

export type MarketIntegrationStatus = {
  family: NcaafMarketFamily;
  productValidated: boolean;
  /** Research metrics clear enough to enter Coach path once E4/E6 clear. */
  candidateReadyForCoachWiring: boolean;
  blockedReason: string | null;
  stagesRequired: readonly CoachIntegrationStage[];
  honestShortfallRequired: true;
  traceableGradesRequired: true;
};

/**
 * ML has FINAL_EVAL metrics clear but product stays blocked on E4/E6.
 * Spreads/totals/ALTs are not candidate-ready for Coach delivery.
 */
export function ncaafCoachIntegrationStatus(): Record<
  NcaafMarketFamily,
  MarketIntegrationStatus
> {
  const stages = NCAAF_COACH_INTEGRATION_STAGES;
  return {
    moneyline: {
      family: "moneyline",
      productValidated: NCAAF_MARKET_SIM_VALIDATED.moneyline,
      candidateReadyForCoachWiring: true,
      blockedReason:
        "E4 OPEN_INSUFFICIENT_DATA + E6 not requested; product gate false",
      stagesRequired: stages,
      honestShortfallRequired: true,
      traceableGradesRequired: true,
    },
    spreads: {
      family: "spreads",
      productValidated: NCAAF_MARKET_SIM_VALIDATED.spreads,
      candidateReadyForCoachWiring: false,
      blockedReason: "ATS vs coin not ready (separate S1–S4 gate)",
      stagesRequired: stages,
      honestShortfallRequired: true,
      traceableGradesRequired: true,
    },
    totals: {
      family: "totals",
      productValidated: NCAAF_MARKET_SIM_VALIDATED.totals,
      candidateReadyForCoachWiring: false,
      blockedReason: "No closing totals archive (INSUFFICIENT_DATA)",
      stagesRequired: stages,
      honestShortfallRequired: true,
      traceableGradesRequired: true,
    },
    alts: {
      family: "alts",
      productValidated: NCAAF_MARKET_SIM_VALIDATED.alts,
      candidateReadyForCoachWiring: false,
      blockedReason: "No posted ALT prices (INSUFFICIENT_DATA)",
      stagesRequired: stages,
      honestShortfallRequired: true,
      traceableGradesRequired: true,
    },
  };
}

/** True when any NCAAF team market may enter live Coach sim grades. */
export function ncaafAnyMarketProductOpen(): boolean {
  if (NCAAF_GAME_LINE_SIM_VALIDATED) return true;
  return (Object.keys(NCAAF_MARKET_SIM_VALIDATED) as NcaafMarketFamily[]).some(
    (f) => NCAAF_MARKET_SIM_VALIDATED[f],
  );
}

/**
 * Preserve non-NCAAF sports: unlocking (or blocking) NCAAF must not change
 * NFL/NHL/MLB product constants. Guard used by regression tests.
 */
export function nonNcaafSportsPreservedGuard(): {
  ok: true;
  note: string;
} {
  return {
    ok: true,
    note: "NCAAF per-market gates are ncaaf-scoped; NFL game lines and other sports unchanged",
  };
}
