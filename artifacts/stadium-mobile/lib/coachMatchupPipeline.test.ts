import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CoachMatchupStageError,
  COACH_MATCHUP_TIMEOUT_MS,
  runCoachMatchupAnalysis,
} from "./coachMatchupPipeline.ts";

const helpers = {
  computeMlLean: () => ({ side: "Home", edge: 3, reasons: ["form"] }),
  detectUpset: (lean: { upset?: { dogOdds: number } }) => lean,
};

test("runCoachMatchupAnalysis logs progress and completes with bounded concurrency", async () => {
  const targets = [
    { sport: "mlb", gameLabel: "A @ B", homeTeamId: "h1", awayTeamId: "a1" },
    { sport: "mlb", gameLabel: "C @ D", homeTeamId: "h2", awayTeamId: "a2" },
    { sport: "nba", gameLabel: "E @ F", homeTeamId: "h3", awayTeamId: "a3" },
  ];
  let calls = 0;
  const result = await runCoachMatchupAnalysis(
    targets,
    {},
    async () => {
      calls += 1;
      return {
        home: { last10: { wins: 5, losses: 5, ptsFor: 100, ptsAgainst: 100, avgMargin: 0 } },
        away: { last10: { wins: 4, losses: 6, ptsFor: 90, ptsAgainst: 100, avgMargin: -1 } },
      };
    },
    helpers,
    { requestId: "req-matchup-1", requireUsable: true },
  );
  assert.equal(calls, 3);
  assert.equal(result.inputCount, 3);
  assert.equal(result.outputCount, 3);
  assert.ok(result.durationMs >= 0);
});

test("runCoachMatchupAnalysis continues when one game fails", async () => {
  const targets = [
    { sport: "mlb", gameLabel: "A @ B", homeTeamId: "h1", awayTeamId: "a1" },
    { sport: "mlb", gameLabel: "C @ D", homeTeamId: "h2", awayTeamId: "a2" },
  ];
  const result = await runCoachMatchupAnalysis(
    targets,
    {},
    async (_s, _h, awayId) => {
      if (awayId === "a2") throw new Error("espn down");
      return {
        home: { last10: { wins: 5, losses: 5, ptsFor: 100, ptsAgainst: 100, avgMargin: 0 } },
      };
    },
    helpers,
    { requestId: "req-matchup-2", requireUsable: true },
  );
  assert.equal(result.outputCount, 1);
});

test("runCoachMatchupAnalysis throws empty when no usable output", async () => {
  await assert.rejects(
    () =>
      runCoachMatchupAnalysis(
        [{ sport: "mlb", gameLabel: "A @ B", homeTeamId: "h1", awayTeamId: "a1" }],
        {},
        async () => ({}),
        helpers,
        { requestId: "req-empty", requireUsable: true },
      ),
    (err: unknown) => err instanceof CoachMatchupStageError && err.empty,
  );
});

test("runCoachMatchupAnalysis does not hang on a stuck fetch", async () => {
  const started = Date.now();
  const result = await runCoachMatchupAnalysis(
    [{ sport: "mlb", gameLabel: "A @ B", homeTeamId: "h1", awayTeamId: "a1" }],
    {},
    () => new Promise(() => {}),
    helpers,
    { requestId: "req-timeout", requireUsable: false },
  );
  assert.ok(Date.now() - started < COACH_MATCHUP_TIMEOUT_MS + 2_000);
  assert.equal(result.outputCount, 0);
});
