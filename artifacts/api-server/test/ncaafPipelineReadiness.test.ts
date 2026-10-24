import test from "node:test";
import assert from "node:assert/strict";
import { ncaafPipelineReadiness } from "../src/lib/ncaafPipelineReadiness.js";
test("research and development counts cannot masquerade as qualified independent holdout or release", async () => {
  const db = {
    query: async (sql: string) =>
      sql.startsWith("SELECT key,value")
        ? {
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
          }
        : {
            rows: [
              {
                forecasts: 3000,
                settlements: 1200,
                development_games: 500,
                prior_season_forecasts: 1000,
                now: "2026-10-24T12:00:00Z",
              },
            ],
          },
  };
  const report = await ncaafPipelineReadiness(db);
  assert.equal(report.inventory.researchSettlements, 1200);
  assert.equal(report.inventory.authenticatedDevelopmentGames, 500);
  assert.equal(report.release.qualifiedHoldoutGames, null);
  assert.equal(report.coachEnabled, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.release.minimumIndependentGames, 500);
  assert.equal(report.release.minimumSeasons, 2);
  assert.ok(
    report.release.stages.some((s) => s.state === "not_fitted_or_registered"),
  );
});
