import test from "node:test";
import assert from "node:assert/strict";
import { ncaafPipelineReadiness } from "../src/lib/ncaafPipelineReadiness.js";
test("research and development counts cannot masquerade as qualified independent holdout or release", async () => {
  const db = {
    query: async (sql: string) => {
      if (sql.includes("conference-bindings")) return { rows: [] };
      if (sql.includes("live-inputs:")) return { rows: [] };
      if (sql.includes("key=ANY"))
        return {
          rows: [
            {
              key: "research:ncaaf:development-dataset:latest",
              value: {
                state: "development_examples_prepared",
                authenticatedDevelopmentGames: 500,
                featureCompleteGames: 500,
                modelFit: "not_run_no_registered_adjusted_trainer",
                pendingFinals: 0,
                rejectedRecords: 0,
                blockers: {},
              },
            },
          ],
        };
      return {
        rows: [
          {
            forecasts: 3000,
            settlements: 1200,
            development_games: 500,
            prior_season_forecasts: 1000,
            future_holdout_contexts: 0,
            independent_holdout_forecasts: 0,
            now: "2026-10-24T12:00:00Z",
          },
        ],
      };
    },
  };
  const report = await ncaafPipelineReadiness(db);
  assert.equal(report.inventory.researchSettlements, 1200);
  assert.equal(report.inventory.authenticatedDevelopmentGames, 500);
  assert.equal(report.inventory.futureHoldoutContexts, 0);
  assert.equal(report.inventory.independentHoldoutForecasts, 0);
  assert.equal(report.holdoutFunnel.verifiedAvailabilityBindings, 0);
  assert.equal(report.release.qualifiedHoldoutGames, null);
  assert.equal(report.coachEnabled, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.release.minimumIndependentGames, 500);
  assert.equal(report.release.minimumSeasons, 2);
  assert.ok(
    report.release.stages.some((s) => s.state === "not_fitted_or_registered"),
  );
});

test("holdout funnel surfaces upcoming matches and unverified binding reasons without claiming release", async () => {
  const db = {
    query: async (sql: string) => {
      if (sql.includes("conference-bindings"))
        return {
          rows: [
            {
              key: "research:ncaaf:conference-bindings:B10:2026-10-24T12:00:00.000Z",
              value: {
                bindings: [
                  {
                    eventBindingVerified: false,
                    reason: "missing_or_ambiguous_event",
                  },
                  {
                    eventBindingVerified: true,
                    reason: null,
                  },
                ],
              },
            },
          ],
        };
      if (sql.includes("live-inputs:"))
        return {
          rows: [
            {
              key: "research:ncaaf:live-inputs:2026-10-24T12:00",
              value: {
                matched: [
                  { target: { kickoff: "2026-10-31T16:00:00Z" } },
                  { target: { kickoff: "2026-10-23T16:00:00Z" } },
                ],
              },
            },
          ],
        };
      if (sql.includes("key=ANY"))
        return {
          rows: [
            {
              key: "research:ncaaf:context-dataset:latest",
              value: {
                state: "processed",
                inputsRecorded: 0,
                withheld: 6,
                blockers: { context_unverified_binding: 0 },
                bindingStats: {
                  reportsSeen: 6,
                  verified: 0,
                  unverifiedReasons: { missing_or_ambiguous_event: 6 },
                },
              },
            },
            {
              key: "research:ncaaf:adjusted-journal:latest",
              value: {
                state: "processed",
                recorded: 0,
                existing: 0,
                withheld: {},
              },
            },
            {
              key: "research:ncaaf:adjusted-model:latest",
              value: {
                state: "frozen_candidate_preserved",
                modelSha256: "a".repeat(64),
              },
            },
          ],
        };
      return {
        rows: [
          {
            forecasts: 49,
            settlements: 42,
            development_games: 24,
            prior_season_forecasts: 0,
            future_holdout_contexts: 0,
            independent_holdout_forecasts: 0,
            now: "2026-10-25T12:00:00Z",
          },
        ],
      };
    },
  };
  const report = await ncaafPipelineReadiness(db);
  assert.equal(report.holdoutFunnel.upcomingMatchedTargets, 1);
  assert.equal(report.holdoutFunnel.verifiedAvailabilityBindings, 1);
  assert.equal(
    report.holdoutFunnel.unverifiedBindingReasons.missing_or_ambiguous_event,
    1,
  );
  assert.equal(report.adjustedJournal.state, "waiting_for_holdout_contexts");
  assert.equal(
    report.holdoutFunnel.adjustedJournalState,
    report.adjustedJournal.state,
  );
  assert.equal(
    report.adjustedJournal.reason,
    "no_post_freeze_holdout_context_with_future_kickoff",
  );
  assert.equal(report.release.qualifiedHoldoutGames, null);
  assert.equal(report.releaseEligible, false);
});
