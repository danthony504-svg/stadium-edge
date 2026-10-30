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
          "research:ncaab:development-dataset:latest",
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
  const development = reports.get("research:ncaab:development-dataset:latest");
  const matched = Array.isArray(live?.value?.matched) ? live.value.matched : [];
  const unmatched = Array.isArray(live?.value?.unmatched)
    ? live.value.unmatched
    : [];
  const nowMs = Date.parse(new Date(inventory.now).toISOString());
  const upcomingMatched = matched.filter(
    (m: { target?: { kickoff?: string } }) =>
      Number.isFinite(Date.parse(m?.target?.kickoff ?? "")) &&
      Date.parse(m.target!.kickoff!) > nowMs,
  ).length;
  const unmatchedReasons: Record<string, number> = {};
  for (const row of unmatched) {
    const reason =
      typeof row?.reason === "string" && /^[a-z0-9_]+$/.test(row.reason)
        ? row.reason
        : "unmatched_unspecified";
    unmatchedReasons[reason] = (unmatchedReasons[reason] ?? 0) + 1;
  }
  const oddsReceivedAt =
    typeof live?.value?.odds?.receivedAt === "string"
      ? live.value.odds.receivedAt
      : null;
  const archiveObservedAt =
    typeof live?.value?.observedAt === "string" ? live.value.observedAt : null;
  const scoreboardDays = Array.isArray(live?.value?.scoreboards)
    ? live.value.scoreboards
        .map((s: { day?: string }) => s?.day)
        .filter((d: unknown): d is string => typeof d === "string")
    : [];

  const enablement = ncaabCoachEnablementDecision({
    oddsEvents: upcomingMatched || null,
    playerPropsEventsWithRows: null,
    researchPipelineExists: true,
    now: new Date(inventory.now),
  });

  const freezeState =
    pipeline?.freezeState ??
    adjusted?.state ??
    "not_fitted_or_registered";
  const freezeModelSha256 =
    pipeline?.freezeModelSha256 ?? adjusted?.modelSha256 ?? null;

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
      authenticatedDevelopmentGames:
        development?.authenticatedDevelopmentGames ??
        pipeline?.authenticatedDevelopmentGames ??
        0,
      featureCompleteDevelopmentGames:
        development?.featureCompleteGames ??
        pipeline?.featureCompleteDevelopmentGames ??
        0,
    },
    development: development
      ? {
          state: development.state ?? null,
          preparedAt: development.preparedAt ?? null,
          manifestSha256: development.manifestSha256 ?? null,
          authenticatedDevelopmentGames:
            development.authenticatedDevelopmentGames ?? 0,
          featureCompleteGames: development.featureCompleteGames ?? 0,
          holdoutEligible: false,
          researchOnly: true,
        }
      : {
          state: pipeline?.developmentState ?? "not_prepared",
          authenticatedDevelopmentGames:
            pipeline?.authenticatedDevelopmentGames ?? 0,
          featureCompleteGames:
            pipeline?.featureCompleteDevelopmentGames ?? 0,
          holdoutEligible: false,
          researchOnly: true,
        },
    collectionEvidence: {
      pipelineState: pipeline?.state ?? null,
      pipelinePhase: pipeline?.phase ?? null,
      pipelineBlockers: pipeline?.blockers ?? {},
      liveArchiveKey: live?.key ?? null,
      liveArchive: live
        ? {
            key: live.key,
            observedAt: archiveObservedAt,
            oddsReceivedAt,
            matchedCount: matched.length,
            unmatchedCount: unmatched.length,
            upcomingMatchedTargets: upcomingMatched,
            unmatchedReasons,
            scoreboardDays,
            // Zero matched with zero unmatched and a fresh archive usually means
            // the paid odds response had no upcoming NCAAB events in-window —
            // early-season evidence absence, not a binder/parser crash.
            diagnosis:
              matched.length === 0 && unmatched.length === 0
                ? "archive_empty_no_upcoming_odds_events"
                : matched.length === 0 && unmatched.length > 0
                  ? "odds_present_but_espn_identity_unmatched"
                  : upcomingMatched === 0 && matched.length > 0
                    ? "matched_targets_all_kickoffs_passed"
                    : "matched_targets_present",
          }
        : null,
      paidCollectionSkipped: pipeline?.paidCollectionSkipped === true,
      freezeState,
      freezeModelSha256,
      authenticatedDevelopmentGames:
        development?.authenticatedDevelopmentGames ??
        pipeline?.authenticatedDevelopmentGames ??
        0,
      featureCompleteDevelopmentGames:
        development?.featureCompleteGames ??
        pipeline?.featureCompleteDevelopmentGames ??
        0,
    },
    settlement: settlement
      ? {
          state: settlement.state,
          finishedAt: settlement.finishedAt ?? null,
          settlementsRecorded: settlement.settlementsRecorded ?? 0,
          unsettledInBatch: settlement.unsettledInBatch ?? null,
          blockers: settlement.blockers ?? {},
          note: settlement.note ?? null,
        }
      : null,
    adjustedModel: {
      state: freezeState,
      modelSha256: freezeModelSha256,
      researchOnly: true,
      validationReady: false,
    },
    adjustedJournal: {
      state: journal?.state ?? pipeline?.journalState ?? "not_run",
      recordedThisRun: journal?.recorded ?? pipeline?.journalRecorded ?? 0,
      existing: journal?.existing ?? 0,
      withheld: journal?.withheld ?? pipeline?.journalWithheld ?? 0,
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
