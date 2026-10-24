/** Operator progress. Archive counts never stand in for independent validation. */
import { MIN_ADJUSTED_DEVELOPMENT_GAMES } from "./ncaafAdjustedModel.js";
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
          "research:ncaaf:adjusted-model:latest",
          "research:ncaaf:adjusted-journal:latest",
        ],
      ],
    )
  ).rows;
  const reports = new Map(rows.map((r) => [r.key, r.value]));
  const inventory = (
    await db.query(
      "SELECT (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:forecast:%')::int AS forecasts, (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:settlement:%')::int AS settlements, (SELECT count(DISTINCT (value->'target'->>'season')||':'||(value->'target'->>'eventId')) FROM public.app_kv WHERE key LIKE 'research:ncaaf:context-input:v2:%' AND value->>'datasetRole'='development_only')::int AS development_games, (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:forecast:%' AND (value->'target'->>'season')::int < 2026)::int AS prior_season_forecasts, clock_timestamp() AS now",
    )
  ).rows[0];
  const lifecycle = reports.get("research:ncaaf:lifecycle:latest"),
    development = reports.get("research:ncaaf:development-dataset:latest"),
    settlement = reports.get("research:ncaaf:settlement-check:latest"),
    adjusted = reports.get("research:ncaaf:adjusted-model:latest"),
    journal = reports.get("research:ncaaf:adjusted-journal:latest");
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
    adjustedModel: {
      trainerImplemented: true,
      state: adjusted?.state ?? "not_run",
      modelSha256: adjusted?.modelSha256 ?? null,
      trainingGames: adjusted?.trainingGames ?? 0,
      minimumDevelopmentGames:
        adjusted?.minimumDevelopmentGames ?? MIN_ADJUSTED_DEVELOPMENT_GAMES,
      reasons: adjusted?.reasons ?? [],
      checkedAt: adjusted?.checkedAt ?? null,
      researchOnly: true,
      validationReady: false,
    },
    adjustedJournal: {
      implemented: true,
      state: journal?.state ?? "not_run",
      recordedThisRun: journal?.recorded ?? 0,
      existing: journal?.existing ?? 0,
      withheld: journal?.withheld ?? {},
      checkedAt: journal?.checkedAt ?? null,
      releaseEligible: false,
    },
    release: {
      minimumIndependentGames: 500,
      minimumSeasons: 2,
      qualifiedHoldoutGames: null,
      qualificationState: adjusted?.modelSha256
        ? "independent_validation_and_release_review_required"
        : "not_evaluated_no_fitted_adjusted_model",
      stages: [
        {
          step: "development_outcomes",
          state:
            development?.authenticatedDevelopmentGames > 0
              ? "examples_available"
              : "waiting_for_verified_finals",
        },
        {
          step: "adjusted_model",
          state: adjusted?.modelSha256
            ? "frozen_research_candidate"
            : (adjusted?.state ?? "not_fitted_or_registered"),
        },
        {
          step: "frozen_model_and_holdout_protocol",
          state: adjusted?.modelSha256
            ? "research_protocol_frozen"
            : "awaiting_fitted_model",
        },
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
