/** Operator progress. Archive counts never stand in for independent validation. */
import type { ResearchDb } from "./ncaafValidationPipeline.js";
export async function ncaafPipelineReadiness(db: ResearchDb) {
  const rows = (
    await db.query(
      "SELECT key,value FROM public.app_kv WHERE key=ANY($1::text[])",
      [
        [
          "research:ncaaf:lifecycle:latest",
          "research:ncaaf:development-dataset:latest",
          "research:ncaaf:context-labels:latest",
          "research:ncaaf:lifecycle:metrics",
          "research:ncaaf:settlement-check:latest",
        ],
      ],
    )
  ).rows;
  const reports = new Map(rows.map((r) => [r.key, r.value]));
  const inventory = (
    await db.query(
      "SELECT (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:forecast:%')::int AS forecasts, (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:settlement:%')::int AS settlements, (SELECT count(DISTINCT (value->'target'->>'season')||':'||(value->'target'->>'eventId')) FROM public.app_kv WHERE key LIKE 'research:ncaaf:context-input:v2:%')::int AS development_games, (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:forecast:%' AND (value->'target'->>'season')::int < 2026)::int AS prior_season_forecasts, clock_timestamp() AS now",
    )
  ).rows[0];
  const lifecycle = reports.get("research:ncaaf:lifecycle:latest"),
    development = reports.get("research:ncaaf:development-dataset:latest"),
    settlement = reports.get("research:ncaaf:settlement-check:latest");
  return {
    checkedAt: new Date(inventory.now).toISOString(),
    pipelineVersion: 2,
    researchOnly: true,
    coachEnabled: false,
    releaseEligible: false,
    inventory: {
      savedForecasts: inventory.forecasts,
      researchSettlements: inventory.settlements,
      developmentGames: inventory.development_games,
      priorSeasonForecasts: inventory.prior_season_forecasts,
      authenticatedDevelopmentGames:
        development?.authenticatedDevelopmentGames ?? 0,
      featureCompleteDevelopmentGames: development?.featureCompleteGames ?? 0,
    },
    lifecycle: lifecycle
      ? {
          state: lifecycle.state,
          finishedAt: lifecycle.finishedAt,
          stages: lifecycle.stages,
        }
      : null,
    settlement: settlement
      ? {
          state: settlement.state,
          finishedAt: settlement.finishedAt,
          blockers: settlement.blockers,
        }
      : null,
    development: development
      ? {
          state: development.state,
          checkedAt: development.checkedAt,
          pendingFinals: development.pendingFinals,
          rejectedRecords: development.rejectedRecords,
          blockers: development.blockers,
          modelFit: development.modelFit,
        }
      : null,
    release: {
      minimumIndependentGames: 500,
      minimumSeasons: 2,
      qualifiedHoldoutGames: null,
      qualificationState:
        "not_evaluated_no_registered_adjusted_model_or_holdout",
      stages: [
        {
          step: "development_outcomes",
          state:
            development?.authenticatedDevelopmentGames > 0
              ? "examples_available"
              : "waiting_for_verified_finals",
        },
        { step: "adjusted_model", state: "not_fitted_or_registered" },
        { step: "frozen_model_and_holdout_protocol", state: "not_registered" },
        { step: "independent_holdout", state: "not_evaluated" },
        {
          step: "market_calibration_injury_venue_and_ot_review",
          state: "not_passed",
        },
        { step: "release_approval_and_coach_integration", state: "blocked" },
      ],
    },
    limitations: [
      "research_counts_are_not_qualified_holdout_counts",
      "development_and_holdout_must_use_distinct_games",
      "old_forecasts_are_not_relabelled_as_new_model_predictions",
      "model_fit_validation_and_release_are_not_automatically_claimed_by_collection_success",
    ],
  };
}
