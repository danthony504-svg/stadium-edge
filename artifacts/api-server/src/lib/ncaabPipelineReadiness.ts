/** NCAAB operator progress. Never stands in for independent validation. */
import type { ResearchDb } from "./ncaafValidationPipeline.js";
import {
  NCAAB_MIN_INDEPENDENT_GAMES,
  NCAAB_MIN_SEASONS,
} from "./ncaabValidationPipeline.js";
import { ncaabCoachEnablementDecision } from "./ncaabCoachReadiness.js";

export async function ncaabPipelineReadiness(db: ResearchDb) {
  const rows = (
    await db.query(
      "SELECT key,value FROM public.app_kv WHERE key=ANY($1::text[])",
      [
        [
          "research:ncaab:pipeline:latest",
          "research:ncaab:settlement-check:latest",
          "research:ncaab:adjusted-model:latest",
          "research:ncaab:adjusted-journal:latest",
        ],
      ],
    )
  ).rows;
  const reports = new Map(rows.map((r) => [r.key, r.value]));
  const inventory = (
    await db.query(
      `SELECT
        (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaab:forecast:%')::int AS forecasts,
        (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaab:settlement:%')::int AS settlements,
        (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaab:live-inputs:%')::int AS live_archives,
        (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaab:forecast:%' AND value->>'datasetRole'='independent_holdout')::int AS independent_holdout_forecasts,
        (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaab:context-input:%' AND value->>'datasetRole'='holdout_context' AND (value->'target'->>'kickoff')::timestamptz>clock_timestamp())::int AS future_holdout_contexts,
        (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaab:forecast:%' AND (value->'target'->>'season')::int < EXTRACT(YEAR FROM clock_timestamp())::int)::int AS prior_season_forecasts,
        clock_timestamp() AS now`,
    )
  ).rows[0];
  const live = (
    await db.query(
      "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaab:live-inputs:%' ORDER BY key DESC LIMIT 1",
    )
  ).rows[0];
  const pipeline = reports.get("research:ncaab:pipeline:latest");
  const settlement = reports.get("research:ncaab:settlement-check:latest");
  const adjusted = reports.get("research:ncaab:adjusted-model:latest");
  const journal = reports.get("research:ncaab:adjusted-journal:latest");
  const matched = Array.isArray(live?.value?.matched) ? live.value.matched : [];
  const nowMs = Date.parse(new Date(inventory.now).toISOString());
  const upcomingMatched = matched.filter(
    (m: { target?: { kickoff?: string } }) =>
      Number.isFinite(Date.parse(m?.target?.kickoff ?? "")) &&
      Date.parse(m.target!.kickoff!) > nowMs,
  ).length;

  const enablement = ncaabCoachEnablementDecision({
    oddsEvents: upcomingMatched || null,
    playerPropsEventsWithRows: null,
    researchPipelineExists: true,
    now: new Date(inventory.now),
  });

  return {
    checkedAt: new Date(inventory.now).toISOString(),
    sport: "ncaab",
    pipelineVersion: 1,
    researchOnly: true,
    coachEnabled: false,
    releaseEligible: false,
    researchPipelineExists: true,
    inheritsNcaafArtifacts: false,
    inventory: {
      savedForecasts: inventory.forecasts,
      researchSettlements: inventory.settlements,
      liveArchives: inventory.live_archives,
      futureHoldoutContexts: inventory.future_holdout_contexts,
      independentHoldoutForecasts: inventory.independent_holdout_forecasts,
      priorSeasonForecasts: inventory.prior_season_forecasts,
      upcomingMatchedTargets: upcomingMatched,
    },
    collectionEvidence: {
      pipelineState: pipeline?.state ?? null,
      pipelinePhase: pipeline?.phase ?? null,
      pipelineBlockers: pipeline?.blockers ?? {},
      liveArchiveKey: live?.key ?? null,
    },
    settlement: settlement
      ? {
          state: settlement.state,
          finishedAt: settlement.finishedAt ?? null,
          note: settlement.note ?? null,
        }
      : null,
    adjustedModel: {
      state: adjusted?.state ?? "not_fitted_or_registered",
      modelSha256: adjusted?.modelSha256 ?? null,
      researchOnly: true,
      validationReady: false,
    },
    adjustedJournal: {
      state: journal?.state ?? "not_run",
      recordedThisRun: journal?.recorded ?? 0,
      existing: journal?.existing ?? 0,
      releaseEligible: false,
    },
    coachEnablementDecision: {
      ...enablement,
      unmet: [
        ...enablement.unmet,
        ...(inventory.independent_holdout_forecasts >= NCAAB_MIN_INDEPENDENT_GAMES
          ? []
          : [
              `independent_holdout_forecasts=${inventory.independent_holdout_forecasts} (need ${NCAAB_MIN_INDEPENDENT_GAMES})`,
            ]),
        ...(inventory.prior_season_forecasts > 0
          ? []
          : ["prior_season_independent_holdout_missing"]),
        ...(adjusted?.modelSha256 ? [] : ["frozen_ncaab_candidate_missing"]),
        "human_release_approval_required",
      ],
    },
    release: {
      minimumIndependentGames: NCAAB_MIN_INDEPENDENT_GAMES,
      minimumSeasons: NCAAB_MIN_SEASONS,
      qualifiedHoldoutGames: null,
      qualificationState: "independent_validation_and_release_review_required",
      stages: [
        { step: "live_input_capture", state: live ? "archives_present" : "waiting" },
        {
          step: "adjusted_model",
          state: adjusted?.modelSha256
            ? "frozen_research_candidate"
            : "not_fitted_or_registered",
        },
        { step: "independent_holdout", state: "not_evaluated" },
        {
          step: "release_approval_and_coach_integration",
          state: "blocked",
        },
      ],
    },
    limitations: [
      "ncaab_must_not_inherit_ncaaf_validation_claims",
      "research_counts_are_not_qualified_holdout_counts",
      "development_and_holdout_must_use_distinct_games",
      "ncaab_score_v2_is_not_a_release_approved_model",
      "frozen_research_candidate_does_not_authorize_coach_unlock",
    ],
  };
}
