import test from "node:test";
import assert from "node:assert/strict";
import { scoreNcaabRecordedForecast } from "../src/lib/ncaabForecastSettlement.js";

const kickoff = "2026-03-15T19:30:00.000Z";

function forecast(overrides: Record<string, unknown> = {}) {
  return {
    researchOnly: true as const,
    modelVersion: "ncaab-research-fixture-v1",
    recordedAt: "2026-03-15T15:00:00.000Z",
    forecastAt: "2026-03-15T14:00:00.000Z",
    inputCutoffAt: "2026-03-15T14:00:00.000Z",
    target: {
      eventId: "401851388",
      season: 2026,
      homeId: "130",
      awayId: "2509",
      kickoff,
      ruleset: "full_game_including_overtime" as const,
    },
    markets: [
      {
        bookmaker: "draftkings",
        market: "ml" as const,
        line: null,
        firstPrice: -140,
        secondPrice: 120,
        conditionalWinProbability: 0.4,
      },
      {
        bookmaker: "draftkings",
        market: "total" as const,
        line: 150.5,
        firstPrice: -110,
        secondPrice: -110,
        conditionalWinProbability: 0.55,
      },
    ],
    ...overrides,
  };
}

const outcome = {
  eventId: "401851388",
  season: 2026,
  homeId: "130",
  awayId: "2509",
  kickoff,
  homePoints: 72,
  awayPoints: 80,
  ruleset: "full_game_including_overtime" as const,
};

test("scores saved NCAAB probabilities and excludes pushes", () => {
  const metrics = scoreNcaabRecordedForecast(forecast(), outcome);
  assert.equal(metrics[0].result, "loss");
  assert.ok(Math.abs(metrics[0].modelBrier! - 0.16) < 1e-12);
  assert.equal(metrics[1].result, "win");
  assert.ok(Math.abs(metrics[1].modelBrier! - 0.2025) < 1e-12);
  assert.equal(metrics.every((m) => m.releaseEligible === false), true);
  assert.equal(metrics.every((m) => m.validationReady === false), true);

  const push = scoreNcaabRecordedForecast(forecast(), {
    ...outcome,
    homePoints: 75,
    awayPoints: 75,
  });
  assert.equal(push[0].result, "push");
  assert.equal(push[0].modelBrier, null);
});

test("rejects late records and identity mismatches", () => {
  assert.throws(
    () =>
      scoreNcaabRecordedForecast(
        forecast({ recordedAt: kickoff }),
        outcome,
      ),
    /ncaab_settlement_unmatched_or_late_record/,
  );
  assert.throws(
    () =>
      scoreNcaabRecordedForecast(forecast(), {
        ...outcome,
        eventId: "999",
      }),
    /ncaab_settlement_unmatched_or_late_record/,
  );
});
