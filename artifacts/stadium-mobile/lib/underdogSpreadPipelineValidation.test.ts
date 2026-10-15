import assert from "node:assert/strict";
import test from "node:test";
import { NCAAF_GAME_LINE_SIM_VALIDATED } from "./coachP0UnvalidatedTotals.ts";
import {
  BROADER_EVAL_FIXTURES,
  HISTORICAL_SIM_DRAWS,
  REGRESSION_SAMPLE_FIXTURES,
  runHistoricalUnderdogSpreadValidation,
  simulateCoverRatesAtSelection,
  traceUnderdogSpreadPipeline,
} from "./underdogSpreadPipelineValidation.ts";
import { qualifiesCoachSimEvalLine } from "./gameSimQualityGates.ts";
import { p0UnvalidatedSimDecision } from "./coachP0UnvalidatedTotals.ts";

test("selection-time cover sim uses exactly 10_000 draws", () => {
  const g = REGRESSION_SAMPLE_FIXTURES[0]!;
  const { sim } = simulateCoverRatesAtSelection(g);
  assert.equal(sim.simulations, HISTORICAL_SIM_DRAWS);
  assert.equal(HISTORICAL_SIM_DRAWS, 10_000);
});

test("trace: higher Final AI/value underdog survives board→delivery", () => {
  const game = REGRESSION_SAMPLE_FIXTURES[0]!;
  const { homeWinProb, awayCover, homeCover } = simulateCoverRatesAtSelection(game);
  assert.ok(homeWinProb > 0.5, "Chiefs favored outright");

  const trace = traceUnderdogSpreadPipeline(game);
  assert.equal(
    trace.steps.map((s) => s.stage).join(">"),
    "board-scoring>side-consistency>optimizer>delivery",
  );
  assert.ok(trace.delivered);
  assert.equal(trace.bestCandidateSurvived, true);
  assert.doesNotMatch(trace.sideResult.resolutions?.[0]?.reason ?? "", /win-prob/i);
  assert.match(trace.sideResult.resolutions?.[0]?.reason ?? "", /Final AI\/value/i);

  if (awayCover > homeCover && (trace.bestCandidate.finalAiScore?.edgePct ?? -999) > 0) {
    assert.match(trace.delivered!.pick, /Lions/i);
  }
});

test("regression sample: 2/4 underdog deliveries; Jets+Bucs fail-closed when best is unqualified", () => {
  const report = runHistoricalUnderdogSpreadValidation(
    REGRESSION_SAMPLE_FIXTURES,
    "regression_sample",
  );
  assert.equal(report.label, "regression_sample");
  assert.equal(report.traces.length, 4);

  const eligible = report.traces.filter((t) => !t.p0Blocked);
  assert.equal(eligible.length, 4);

  // Best *still-qualified* candidate survives (or both empty when none qualify).
  const bestOk = eligible.filter((t) => t.bestCandidateSurvived).length;
  assert.equal(bestOk, 4, "best qualified survival / fail-closed must hold every game");

  // Underdog delivered on 2/4 (Lions, Falcons). Jets + Bucs: no side clears
  // shared delivery qualification (edge≤0) → delivered null.
  const dogOk = eligible.filter((t) => t.underdogDelivered).length;
  assert.equal(dogOk, 2);

  const jets = eligible.find((t) => /Jets.*Bills/i.test(t.game));
  assert.ok(jets);
  assert.equal(jets!.delivered, null);
  assert.equal(jets!.underdogDelivered, false);
  assert.equal(jets!.bestCandidateSurvived, true);

  const fourth = eligible.find((t) => /Panthers.*Buccaneers/i.test(t.game));
  assert.ok(fourth);
  assert.equal(fourth!.delivered, null);
  assert.equal(fourth!.underdogDelivered, false);
  assert.equal(fourth!.bestCandidateSurvived, true);

  // Full delivery trace for the fourth game — favorite wins side-consistency,
  // but fails shared qualification → cannot reach the ticket.
  const bucs = REGRESSION_SAMPLE_FIXTURES.find((g) => /Panthers.*Buccaneers/i.test(g.game))!;
  const trace = traceUnderdogSpreadPipeline(bucs);
  assert.match(trace.sideResult.picks[0]?.pick ?? "", /Buccaneers/i);
  assert.equal(trace.delivered, null);
  assert.ok((trace.sideResult.picks[0]?.finalAiScore?.edgePct ?? 0) <= 0);
  const board = trace.steps[0]!.picks.join(" | ");
  assert.match(board, /Buccaneers/);
  assert.match(board, /Panthers/);
  assert.match(trace.sideResult.resolutions?.[0]?.reason ?? "", /Final AI\/value/i);
  assert.equal(trace.steps.at(-1)?.stage, "delivery");
  assert.deepEqual(trace.steps.at(-1)?.picks, []);
});

test("broader eval: Coach vs baselines on shared selection-time slate", () => {
  const report = runHistoricalUnderdogSpreadValidation(BROADER_EVAL_FIXTURES, "broader_eval");
  assert.equal(report.label, "broader_eval");
  assert.equal(report.simulations, 10_000);
  assert.ok(report.sports.includes("nfl"));
  assert.ok(report.sports.includes("ncaaf"));
  assert.ok(report.traces.length >= REGRESSION_SAMPLE_FIXTURES.length);

  const eligible = report.traces.filter((t) => !t.p0Blocked);
  const bestOk = eligible.filter((t) => t.bestCandidateSurvived).length;
  assert.equal(bestOk, eligible.length, "best candidate survives all non-P0 broader games");

  // Baselines are separate objects with independent tallies.
  assert.ok(report.baselines.coach);
  assert.ok(report.baselines.blanket_home);
  assert.ok(report.baselines.winprob_favorite);
  assert.ok(report.baselines.raw_higher_cover);
  assert.notEqual(report.baselines.coach, report.baselines.blanket_home);
  assert.ok(report.summary.includes("blanket-home"));
  assert.ok(report.summary.includes("raw-cover"));

  // NCAAF P0 still armed — college rows flagged, excluded from Coach live metrics.
  assert.equal(NCAAF_GAME_LINE_SIM_VALIDATED, false);
  assert.ok(report.traces.filter((t) => t.sport === "ncaaf").every((t) => t.p0Blocked));
});

test("quality gates and P0 blocks remain intact after side-resolution change", () => {
  assert.equal(NCAAF_GAME_LINE_SIM_VALIDATED, false);

  const ncaafBlock = p0UnvalidatedSimDecision({
    sport: "ncaaf",
    market: "Spread",
    pick: "Michigan +3.5",
    odds: -110,
    isProp: false,
    game: "Michigan Wolverines @ Ohio State Buckeyes",
  });
  assert.ok(ncaafBlock);
  assert.match(ncaafBlock!.reason, /unvalidated_ncaaf_game_line/);

  const nflOpen = p0UnvalidatedSimDecision({
    sport: "nfl",
    market: "Spread",
    pick: "Lions +6.5",
    odds: -110,
    isProp: false,
    game: "Detroit Lions @ Kansas City Chiefs",
  });
  assert.equal(nflOpen, null);

  // qualifiesCoachSimEvalLine still requires edge>0, grade, conf, hit floors.
  assert.equal(
    qualifiesCoachSimEvalLine({
      entry: {
        sport: "nfl",
        game: "A @ B",
        market: "Spread",
        pick: "A +3",
        odds: -110,
      },
      pick: { game: "A @ B", market: "Spread", pick: "A +3", odds: -110, isProp: false },
      finalAiScore: {
        composite: 8,
        grade: "B+",
        confidencePct: 60,
        edgePct: 2,
        simHit: 0.55,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: true,
        factors: [],
        rubric: { scores: {}, composite: 8, grade: "B+", confidencePct: 60, edgePct: 2 },
      },
      winProb: 0.55,
      edgePct: 2,
    }),
    true,
  );
  assert.equal(
    qualifiesCoachSimEvalLine({
      entry: {
        sport: "nfl",
        game: "A @ B",
        market: "Spread",
        pick: "A +3",
        odds: -110,
      },
      pick: { game: "A @ B", market: "Spread", pick: "A +3", odds: -110, isProp: false },
      finalAiScore: {
        composite: 8,
        grade: "B+",
        confidencePct: 60,
        edgePct: -1,
        simHit: 0.55,
        simAligned: true,
        highRiskValuePlay: false,
        recommends: false,
        factors: [],
        rubric: { scores: {}, composite: 8, grade: "B+", confidencePct: 60, edgePct: -1 },
      },
      winProb: 0.55,
      edgePct: -1,
    }),
    false,
  );
});
