/** Operator progress. Archive counts never stand in for independent validation. */
import { MIN_ADJUSTED_DEVELOPMENT_GAMES } from "./ncaafAdjustedModel.js";
import type { ResearchDb } from "./ncaafValidationPipeline.js";
/** Public diagnostics use fixed labels, never arbitrary exception/provider text. */
export function safeCollectorDiagnostic(value: any) {
  const codes = new Set([
    "usage_history_missing", "usage_invalid_plan", "usage_overlap", "context_overlap",
    "context_target_budget", "usage_unexpected_database", "context_unexpected_database",
    "collector_database_timeout", "collector_database_resource_exhausted", "collector_internal_failure",
  ]);
  const phases = new Set(["database_check", "archive_lookup", "event_binding", "history_lookup",
    "usage_plan", "usage_capture", "usage_save", "context_assembly", "labels", "status_save"]);
  return {
    failureCode: codes.has(value?.failureCode) ? value.failureCode as string : null,
    failurePhase: phases.has(value?.failurePhase) ? value.failurePhase as string : null,
  };
}
export async function ncaafPipelineReadiness(db: ResearchDb) {
  const rows = (
    await db.query(
      "SELECT key,value FROM public.app_kv WHERE key=ANY($1::text[])",
      [
        [
          "research:ncaaf:lifecycle:latest",
          "research:ncaaf:development-dataset:latest",
          "research:ncaaf:context-labels:latest",
          "research:ncaaf:context-dataset:latest",
          "research:ncaaf:lifecycle:metrics",
          "research:ncaaf:settlement-check:latest",
          "research:ncaaf:adjusted-model:latest",
          "research:ncaaf:adjusted-journal:latest",
          "research:ncaaf:pipeline:latest",
          "research:ncaaf:usage-capture:latest",
          "research:ncaaf:development-catchup:latest",
        ],
      ],
    )
  ).rows;
  const reports = new Map(rows.map((r) => [r.key, r.value]));
  const inventory = (
    await db.query(
      "SELECT (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:forecast:%')::int AS forecasts, (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:settlement:%')::int AS settlements, (SELECT count(DISTINCT (value->'target'->>'season')||':'||(value->'target'->>'eventId')) FROM public.app_kv WHERE key LIKE 'research:ncaaf:context-input:v2:%' AND value->>'datasetRole'='development_only')::int AS development_games, (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:forecast:%' AND (value->'target'->>'season')::int < 2026)::int AS prior_season_forecasts, (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:context-input:v2:%' AND value->>'datasetRole'='holdout_context' AND (value->'target'->>'kickoff')::timestamptz>clock_timestamp())::int AS future_holdout_contexts, (SELECT count(*) FROM public.app_kv WHERE key LIKE 'research:ncaaf:forecast:%' AND value->>'datasetRole'='independent_holdout')::int AS independent_holdout_forecasts, clock_timestamp() AS now",
    )
  ).rows[0];
  const live = (
    await db.query(
      "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:live-inputs:%' ORDER BY key DESC LIMIT 1",
    )
  ).rows[0];
  const nowMs = Date.parse(new Date(inventory.now).toISOString());
  const matched = Array.isArray(live?.value?.matched) ? live.value.matched : [];
  const upcomingMatched = matched.filter(
    (m: { target?: { kickoff?: string } }) =>
      Number.isFinite(Date.parse(m?.target?.kickoff ?? "")) &&
      Date.parse(m.target!.kickoff!) > nowMs,
  ).length;
  const bindingRows = (
    await db.query(
      "SELECT DISTINCT ON (split_part(key, ':', 4)) key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:conference-bindings:%' ORDER BY split_part(key, ':', 4), key DESC LIMIT 8",
    )
  ).rows;
  let verifiedBindings = 0;
  let bindingReports = 0;
  const bindingReasons: Record<string, number> = {};
  for (const row of bindingRows) {
    const bindings = Array.isArray(row.value?.bindings) ? row.value.bindings : [];
    bindingReports += bindings.length;
    for (const b of bindings) {
      if (b?.eventBindingVerified) verifiedBindings += 1;
      else {
        const reason =
          typeof b?.reason === "string" && b.reason
            ? b.reason
            : "unverified_binding";
        bindingReasons[reason] = (bindingReasons[reason] ?? 0) + 1;
      }
    }
  }
  const lifecycle = reports.get("research:ncaaf:lifecycle:latest"),
    development = reports.get("research:ncaaf:development-dataset:latest"),
    settlement = reports.get("research:ncaaf:settlement-check:latest"),
    adjusted = reports.get("research:ncaaf:adjusted-model:latest"),
    journal = reports.get("research:ncaaf:adjusted-journal:latest"),
    contextDataset = reports.get("research:ncaaf:context-dataset:latest"),
    pipelineLatest = reports.get("research:ncaaf:pipeline:latest"),
    usageCapture = reports.get("research:ncaaf:usage-capture:latest"),
    developmentCatchup = reports.get(
      "research:ncaaf:development-catchup:latest",
    );
  // Derived waiting label when the frozen journal processed zero future
  // holdout contexts — sealed store files must not change implementationSha256.
  const waitingForHoldoutContexts =
    journal?.state === "processed" &&
    (journal?.recorded ?? 0) === 0 &&
    (journal?.existing ?? 0) === 0 &&
    (inventory.future_holdout_contexts ?? 0) === 0 &&
    !!adjusted?.modelSha256;
  const adjustedJournalState = waitingForHoldoutContexts
    ? "waiting_for_holdout_contexts"
    : (journal?.state ?? "not_run");
  const adjustedJournalReason =
    journal?.reason ??
    (waitingForHoldoutContexts
      ? "no_post_freeze_holdout_context_with_future_kickoff"
      : null);
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
      futureHoldoutContexts: inventory.future_holdout_contexts,
      independentHoldoutForecasts: inventory.independent_holdout_forecasts,
    },
    holdoutFunnel: {
      liveArchiveKey: live?.key ?? null,
      upcomingMatchedTargets: upcomingMatched,
      conferenceBindingReports: bindingReports,
      verifiedAvailabilityBindings: verifiedBindings,
      unverifiedBindingReasons: bindingReasons,
      contextDataset: contextDataset
        ? {
            state: contextDataset.state ?? null,
            ...safeCollectorDiagnostic(contextDataset),
            inputsRecorded: contextDataset.inputsRecorded ?? 0,
            inputsAlreadyPresent: contextDataset.inputsAlreadyPresent ?? 0,
            withheld: contextDataset.withheld ?? 0,
            blockers: contextDataset.blockers ?? {},
            bindingStats: contextDataset.bindingStats ?? null,
            finishedAt: contextDataset.finishedAt ?? null,
          }
        : null,
      adjustedJournalState,
      note:
        "Zero verified bindings usually means official conference reports have not published for the upcoming slate yet — that is source evidence, not a release waiver.",
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
      state: adjustedJournalState,
      recordedThisRun: journal?.recorded ?? 0,
      existing: journal?.existing ?? 0,
      withheld: journal?.withheld ?? {},
      checkedAt: journal?.checkedAt ?? null,
      reason: adjustedJournalReason,
      releaseEligible: false,
    },
    collectionEvidence: {
      pipelineState: pipelineLatest?.state ?? null,
      pipelinePhase: pipelineLatest?.phase ?? null,
      freeEvidenceRefresh: pipelineLatest?.freeEvidenceRefresh === true,
      pipelineBlockers: pipelineLatest?.blockers ?? {},
      usageCapture: usageCapture
        ? {
            state: usageCapture.state ?? null,
            ...safeCollectorDiagnostic(usageCapture),
            matchedTargets: usageCapture.matchedTargets ?? 0,
            saved: usageCapture.saved ?? 0,
            failed: usageCapture.failed ?? 0,
            reason: usageCapture.reason ?? null,
            finishedAt: usageCapture.finishedAt ?? null,
          }
        : null,
      developmentCatchup: developmentCatchup
        ? {
            state: developmentCatchup.state ?? null,
            finishedAt: developmentCatchup.finishedAt ?? null,
            startedAt: developmentCatchup.startedAt ?? null,
            slot: developmentCatchup.slot ?? null,
            upcomingTargets: developmentCatchup.upcomingTargets ?? 0,
            contextAssemblyFailed:
              developmentCatchup.contextAssemblyFailed === true,
            injuryRefreshFailed:
              developmentCatchup.injuryRefreshFailed === true,
            failedCollectors: Array.isArray(
              developmentCatchup.failedCollectors,
            )
              ? developmentCatchup.failedCollectors.filter(
                  (c: unknown) => typeof c === "string",
                )
              : [],
            failedReasons:
              developmentCatchup.failedReasons &&
              typeof developmentCatchup.failedReasons === "object"
                ? developmentCatchup.failedReasons
                : {},
            primaryFailureReason:
              typeof developmentCatchup.primaryFailureReason === "string" &&
              /^(pipeline|context|conference|usage|repair|history|injury|development|collector)_[a-z0-9_]+$/.test(
                developmentCatchup.primaryFailureReason,
              )
                ? developmentCatchup.primaryFailureReason
                : null,
          }
        : null,
      verifiedAvailabilityBindings: verifiedBindings,
      upcomingMatchedTargets: upcomingMatched,
    },
    /**
     * Explicit Coach unlock decision for operators. Always blocked until
     * independent holdout + multi-season + human release approval — a frozen
     * development candidate alone never authorizes unlocking.
     */
    coachEnablementDecision: {
      decision: "BLOCKED" as const,
      coachEnabled: false,
      releaseEligible: false,
      mobileGameLineGate: "NCAAF_GAME_LINE_SIM_VALIDATED=false",
      unmet: [
        ...(inventory.independent_holdout_forecasts >= 500
          ? []
          : [
              `independent_holdout_forecasts=${inventory.independent_holdout_forecasts} (need 500)`,
            ]),
        ...(inventory.prior_season_forecasts > 0
          ? []
          : ["prior_season_independent_holdout_missing (need ≥2 seasons)"]),
        ...(inventory.future_holdout_contexts > 0
          ? []
          : ["future_holdout_contexts=0 (need prospective contexts before kickoff)"]),
        ...(verifiedBindings > 0
          ? []
          : ["verified_availability_bindings=0 (conference reports not bound to upcoming slate)"]),
        "human_release_approval_required",
        "mobile_NCAAF_GAME_LINE_SIM_VALIDATED_still_false",
      ],
      frozenCandidateDoesNotAuthorizeUnlock: true,
      modelSha256: adjusted?.modelSha256 ?? null,
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
        {
          step: "release_approval_and_coach_integration",
          state: "blocked",
        },
      ],
    },
    limitations: [
      "research_counts_are_not_qualified_holdout_counts",
      "development_and_holdout_must_use_distinct_games",
      "old_forecasts_are_not_relabelled_as_new_model_predictions",
      "model_fit_validation_and_release_are_not_automatically_claimed_by_collection_success",
      "conference_availability_reports_are_partial_and_may_lag_upcoming_slates",
      "frozen_research_candidate_does_not_authorize_coach_unlock",
      "internal_research_tester_access_does_not_satisfy_release_gates",
    ],
  };
}
