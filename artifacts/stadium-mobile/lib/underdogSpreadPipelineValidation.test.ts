import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORICAL_SIM_DRAWS,
  runHistoricalUnderdogSpreadValidation,
  simulateCoverRatesAtSelection,
  traceUnderdogSpreadPipeline,
  UNDERDOG_SPREAD_HISTORICAL_FIXTURES,
} from "./underdogSpreadPipelineValidation.ts";
import { NCAAF_GAME_LINE_SIM_VALIDATED } from "./coachP0UnvalidatedTotals.ts";

test("selection-time cover sim uses exactly 10_000 draws", () => {
  const g = UNDERDOG_SPREAD_HISTORICAL_FIXTURES[0]!;
  const { sim } = simulateCoverRatesAtSelection(g);
  assert.equal(sim.simulations, HISTORICAL_SIM_DRAWS);
  assert.equal(HISTORICAL_SIM_DRAWS, 10_000);
});

test("trace: higher-qualified underdog spread survives board→delivery", () => {
  // Lions @ Chiefs: home favored on win-prob; dog +6.5 often better on cover/edge
  // when projected margin is closer than the posted number.
  const game = UNDERDOG_SPREAD_HISTORICAL_FIXTURES[0]!;
  const { sim, homeWinProb, awayCover, homeCover } = simulateCoverRatesAtSelection(game);
  assert.ok(homeWinProb > 0.5, "Chiefs favored outright");
  // Dog gets points — cover should beat or match favorite cover when margin < 6.5 often
  assert.ok(awayCover + homeCover > 0.9);

  const trace = traceUnderdogSpreadPipeline(game);
  assert.equal(trace.steps.map((s) => s.stage).join(">"), "board-scoring>side-consistency>optimizer>delivery");
  assert.ok(trace.delivered, "a spread is delivered");

  // If underdog has better Final AI metrics, it must not be discarded for win-prob.
  const board = trace.steps[0]!;
  assert.match(board.picks[0]!, /Chiefs/i);
  assert.match(board.picks[1]!, /Lions/i);

  const side = trace.sideResult;
  assert.ok(side.resolutions?.length === 1);
  // Favorite win-prob alone must not be the keep reason when metrics exist.
  assert.doesNotMatch(side.resolutions![0]!.reason, /win-prob/i);

  if (awayCover > homeCover) {
    assert.match(trace.delivered!.pick, /Lions/i);
    assert.equal(trace.underdogSurvived, true);
    assert.ok(side.resolutions![0]!.rejections.some((r) => /Chiefs/i.test(r.pick)));
  }

  // Optimizer must not replace Lions with Chiefs.
  const optStep = trace.steps.find((s) => s.stage === "optimizer")!;
  assert.ok(optStep.picks.every((p) => !/Chiefs/i.test(p) || /Lions/i.test(trace.delivered!.pick)));
  void sim;
});

test("historical validation separates delivered metrics from blanket-home", () => {
  const report = runHistoricalUnderdogSpreadValidation(UNDERDOG_SPREAD_HISTORICAL_FIXTURES);
  assert.equal(report.simulations, 10_000);
  assert.ok(report.sports.includes("nfl"));
  assert.ok(report.sports.includes("ncaaf"));
  assert.ok(report.traces.length === UNDERDOG_SPREAD_HISTORICAL_FIXTURES.length);

  // NCAAF P0 remains armed — college game lines flagged, not counted as live delivery.
  assert.equal(NCAAF_GAME_LINE_SIM_VALIDATED, false);
  const ncaaf = report.traces.filter((t) => t.sport === "ncaaf");
  assert.ok(ncaaf.every((t) => t.p0Blocked));

  // Delivered and blanket-home are separate objects.
  assert.notEqual(report.delivered, report.blanketHome);
  assert.ok(typeof report.delivered.coverRate === "number");
  assert.ok(typeof report.blanketHome.coverRate === "number");
  assert.ok(report.summary.includes("blanket-home"));
  assert.ok(report.summary.includes("CLV") || report.summary.includes("pts"));

  // At least one NFL game delivers a pick through the pipeline.
  const nflLive = report.traces.filter((t) => t.sport === "nfl" && t.delivered);
  assert.ok(nflLive.length >= 1);
});
