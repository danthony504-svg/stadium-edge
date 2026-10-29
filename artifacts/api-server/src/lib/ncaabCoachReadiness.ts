/**
 * NCAAB Coach enablement readiness — independent of the NCAAF research stack.
 *
 * There is no NCAAB holdout ledger, adjusted-model freeze, or release approval
 * artifact in this repo. Product may already surface NCAAB odds/sims, but that
 * is not a validated release. This module never flips Coach unlock flags.
 */
export type NcaabCoachEnablementDecision = {
  sport: "ncaab";
  decision: "BLOCKED";
  checkedAt: string;
  /** Scaffold may exist; existence alone never unlocks Coach. */
  researchPipelineExists: boolean;
  validatedApprovedModelExists: false;
  coachReleaseEligible: false;
  mobileP0GameLineGate: "none_armed_today";
  liveMarketsObserved?: {
    oddsEvents: number | null;
    gameLineFamilies: string[];
    playerPropsEventsWithRows: number | null;
  };
  unmet: string[];
  earliestEvidenceBasedPath: string[];
  limitations: string[];
};

export function ncaabCoachEnablementDecision(opts?: {
  oddsEvents?: number | null;
  playerPropsEventsWithRows?: number | null;
  researchPipelineExists?: boolean;
  now?: Date;
}): NcaabCoachEnablementDecision {
  const pipelineExists = opts?.researchPipelineExists === true;
  const unmet = [
    ...(pipelineExists
      ? []
      : ["no_ncaab_research_pipeline_or_holdout_ledger"]),
    "no_approved_model_version_or_validation_report",
    "no_independent_holdout_calibration_across_seasons",
    "no_human_release_approval_for_coach_game_lines",
    "player_props_may_be_absent_early_season_keep_unknown",
  ];
  return {
    sport: "ncaab",
    decision: "BLOCKED",
    checkedAt: (opts?.now ?? new Date()).toISOString(),
    researchPipelineExists: pipelineExists,
    validatedApprovedModelExists: false,
    coachReleaseEligible: false,
    mobileP0GameLineGate: "none_armed_today",
    liveMarketsObserved: {
      oddsEvents: opts?.oddsEvents ?? null,
      gameLineFamilies: ["h2h", "spreads", "totals"],
      playerPropsEventsWithRows: opts?.playerPropsEventsWithRows ?? null,
    },
    unmet,
    earliestEvidenceBasedPath: [
      "Capture NCAAB-specific prospective live inputs with exact pregame lines/odds timestamps (do not reuse NCAAF artifacts).",
      "Freeze a candidate only after authenticated development finals; evaluate on separate holdout games.",
      "Require multi-season independent holdout + calibration/ROI review + human signoff before any Coach unlock.",
      "Until then, treat ncaab-score-v2 as product-sim infrastructure, not a release-approved model.",
    ],
    limitations: [
      "ncaab_must_not_inherit_ncaaf_validation_claims",
      "odds_availability_is_not_model_validation",
      "zero_player_props_on_a_slate_is_evidence_absence_not_a_waiver",
      "research_pipeline_scaffold_does_not_authorize_coach_unlock",
    ],
  };
}
