import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEEP_SIMULATIONS,
  hitRateFromSamples,
  runMonteCarloSimulation,
  scoreSharedDistribution,
  type PropSimulationContext,
} from "../src/lib/monteCarlo.ts";
import {
  propSharedDistributionKey,
  propSharedDistributionMarketKey,
} from "../src/lib/propSharedDistribution.ts";
import {
  simulateProp,
  simulatePropGroupShared,
  type GameSimContext,
  type PlayerHistoryShape,
  type SimPropRequest,
} from "../src/lib/monteCarloBuild.ts";

function baseCtx(
  overrides: Partial<PropSimulationContext> = {},
): PropSimulationContext {
  return {
    sport: "nfl",
    market: "player_pass_yds",
    line: 224.5,
    side: "Over",
    recentValues: [265, 248, 291, 210, 277, 233, 255, 240, 268, 252],
    discrete: false,
    ...overrides,
  };
}

test("propSharedDistributionMarketKey strips only _alternate", () => {
  assert.equal(propSharedDistributionMarketKey("player_pass_yds_alternate"), "player_pass_yds");
  assert.equal(propSharedDistributionMarketKey("player_pass_yds_q1"), "player_pass_yds_q1");
  assert.equal(
    propSharedDistributionMarketKey("player_pass_yds_q1_alternate"),
    "player_pass_yds_q1",
  );
});

test("shared distribution keys isolate period and context", () => {
  const fg = propSharedDistributionKey({
    sport: "nfl",
    player: "Mahomes",
    market: "player_pass_yds",
    athleteId: "1",
    opponentTeamId: "12",
    isHome: true,
    homeTeamId: "1",
    awayTeamId: "12",
  });
  const alt = propSharedDistributionKey({
    sport: "nfl",
    player: "Mahomes",
    market: "player_pass_yds_alternate",
    athleteId: "1",
    opponentTeamId: "12",
    isHome: true,
    homeTeamId: "1",
    awayTeamId: "12",
  });
  const q1 = propSharedDistributionKey({
    sport: "nfl",
    player: "Mahomes",
    market: "player_pass_yds_q1",
    athleteId: "1",
    opponentTeamId: "12",
    isHome: true,
    homeTeamId: "1",
    awayTeamId: "12",
  });
  const otherOpp = propSharedDistributionKey({
    sport: "nfl",
    player: "Mahomes",
    market: "player_pass_yds",
    athleteId: "1",
    opponentTeamId: "99",
    isHome: true,
    homeTeamId: "1",
    awayTeamId: "99",
  });
  assert.equal(fg, alt, "main and _alternate share a distribution");
  assert.notEqual(fg, q1, "FG must never share with Q1");
  assert.notEqual(fg, otherOpp, "opponent/matchup context must differ");
});

test("equivalence: shared ladder matches seeded per-line sims", () => {
  const seed = 0xc0ffee;
  const lines = [224.5, 249.5, 274.5, 299.5];
  const sides = ["Over", "Under"] as const;
  const ctx = baseCtx();

  const perLine: Array<{
    line: number;
    side: "Over" | "Under";
    hitProbability: number | null;
    confidenceScore: number | null;
  }> = [];
  for (const line of lines) {
    for (const side of sides) {
      const r = runMonteCarloSimulation(
        { ...ctx, line, side },
        DEEP_SIMULATIONS,
        { seed },
      );
      perLine.push({
        line,
        side,
        hitProbability: r.hitProbability,
        confidenceScore: r.confidenceScore,
      });
    }
  }

  const targets = lines.flatMap((line) => sides.map((side) => ({ line, side })));
  const shared = scoreSharedDistribution(ctx, targets, DEEP_SIMULATIONS, {
    seed,
    evaluateLines: lines,
  });

  assert.equal(shared.results.length, perLine.length);
  for (let i = 0; i < perLine.length; i++) {
    const a = perLine[i]!;
    const b = shared.results[i]!;
    assert.equal(b.line, a.line);
    assert.equal(b.side, a.side);
    assert.equal(
      b.hitProbability,
      a.hitProbability,
      `hit mismatch ${a.side} ${a.line}`,
    );
    assert.equal(
      b.confidenceScore,
      a.confidenceScore,
      `confidence mismatch ${a.side} ${a.line}`,
    );
  }
});

test("HR 0.5 vs 1.5 produce distinct Over probs from one shared draw", () => {
  const seed = 42;
  const ctx = baseCtx({
    sport: "mlb",
    market: "batter_home_runs",
    recentValues: [0, 1, 0, 2, 0, 1, 0, 0, 1, 0],
    discrete: true,
    line: 0.5,
    side: "Over",
  });
  const bundle = scoreSharedDistribution(
    ctx,
    [
      { line: 0.5, side: "Over" },
      { line: 1.5, side: "Over" },
      { line: 0.5, side: "Under" },
      { line: 1.5, side: "Under" },
    ],
    DEEP_SIMULATIONS,
    { seed, evaluateLines: [0.5, 1.5] },
  );
  const over05 = bundle.results[0]!.hitProbability!;
  const over15 = bundle.results[1]!.hitProbability!;
  assert.ok(over05 > over15, `P(X>0.5)=${over05} must exceed P(X>1.5)=${over15}`);
  assert.ok(over05 > 0.05 && over05 < 0.95);
});

test("benchmark: one distribution scores an alternate ladder", () => {
  const seed = 7;
  const lines = [224.5, 249.5, 274.5, 299.5];
  const ctx = baseCtx();
  const targets = lines.flatMap((line) =>
    (["Over", "Under"] as const).map((side) => ({ line, side })),
  );

  const t0 = performance.now();
  let perLineDraws = 0;
  for (const t of targets) {
    runMonteCarloSimulation({ ...ctx, ...t }, DEEP_SIMULATIONS, { seed });
    perLineDraws += DEEP_SIMULATIONS;
  }
  const perLineMs = performance.now() - t0;

  const t1 = performance.now();
  const shared = scoreSharedDistribution(ctx, targets, DEEP_SIMULATIONS, {
    seed,
    evaluateLines: lines,
  });
  const sharedMs = performance.now() - t1;
  const sharedDraws = DEEP_SIMULATIONS;

  assert.equal(targets.length, 8, "provider lines evaluated unchanged");
  assert.equal(shared.results.length, 8);
  assert.equal(sharedDraws, DEEP_SIMULATIONS);
  assert.equal(perLineDraws, DEEP_SIMULATIONS * 8);
  assert.ok(
    sharedMs < perLineMs * 0.6,
    `shared ${sharedMs.toFixed(1)}ms should beat per-line ${perLineMs.toFixed(1)}ms`,
  );

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      benchmark: "prop-shared-dist",
      providerLinesEvaluated: targets.length,
      distributionsGenerated: { before: 8, after: 1 },
      monteCarloDraws: { before: perLineDraws, after: sharedDraws },
      propSimMs: { before: Math.round(perLineMs), after: Math.round(sharedMs) },
    }),
  );
});

test("multi-sport ladders share within sport architecture", () => {
  const seed = 99;
  const sports: Array<{ sport: string; market: string; values: number[]; lines: number[] }> = [
    { sport: "nfl", market: "player_pass_yds", values: [240, 255, 270, 220, 260, 245, 280, 230, 250, 265], lines: [224.5, 249.5] },
    { sport: "ncaaf", market: "player_rush_yds", values: [90, 110, 75, 130, 95, 105, 88, 120, 100, 115], lines: [84.5, 99.5] },
    { sport: "nba", market: "player_points", values: [28, 31, 24, 33, 29, 27, 30, 26, 32, 25], lines: [24.5, 27.5] },
    { sport: "wnba", market: "player_rebounds", values: [9, 11, 8, 12, 10, 7, 11, 9, 10, 8], lines: [8.5, 10.5] },
    { sport: "mlb", market: "batter_hits", values: [1, 2, 0, 2, 1, 3, 1, 0, 2, 1], lines: [0.5, 1.5] },
    { sport: "nhl", market: "player_shots_on_goal", values: [3, 4, 2, 5, 3, 4, 2, 3, 4, 3], lines: [2.5, 3.5] },
    { sport: "soccer", market: "player_shots_on_target", values: [1, 2, 0, 1, 2, 1, 0, 1, 2, 1], lines: [0.5, 1.5] },
  ];

  for (const s of sports) {
    const ctx = baseCtx({
      sport: s.sport,
      market: s.market,
      recentValues: s.values,
      discrete: /hits|shots|home_run/i.test(s.market),
      line: s.lines[0]!,
      side: "Over",
    });
    const targets = s.lines.flatMap((line) =>
      (["Over", "Under"] as const).map((side) => ({ line, side })),
    );
    const shared = scoreSharedDistribution(ctx, targets, 2_000, {
      seed,
      evaluateLines: s.lines,
    });
    for (let i = 0; i < targets.length; i++) {
      const per = runMonteCarloSimulation(
        { ...ctx, ...targets[i]! },
        2_000,
        { seed },
      );
      assert.equal(
        shared.results[i]!.hitProbability,
        per.hitProbability,
        `${s.sport} ${targets[i]!.side} ${targets[i]!.line}`,
      );
    }
  }
});

function fakeHistory(values: number[]): PlayerHistoryShape {
  return {
    labels: ["passingYards"],
    recent: values.map((v) => ({ stats: { passingYards: String(v) } })),
    vsOpponent: [],
  };
}

test("simulatePropGroupShared expands one draw across requests", () => {
  const history = fakeHistory([265, 248, 291, 210, 277, 233, 255, 240, 268, 252]);
  const game: GameSimContext = {
    sport: "nfl",
    playerHistories: new Map(),
  };
  const requests: SimPropRequest[] = [224.5, 249.5, 274.5, 299.5].flatMap((line) => [
    { player: "Mahomes", market: "player_pass_yds", line, side: "Over" as const, sport: "nfl", athleteId: "1" },
    { player: "Mahomes", market: "player_pass_yds_alternate", line, side: "Under" as const, sport: "nfl", athleteId: "1" },
  ]);
  const seed = 12345;
  const grouped = simulatePropGroupShared(requests, history, game, DEEP_SIMULATIONS, { seed });
  assert.equal(grouped.length, requests.length);
  for (let i = 0; i < requests.length; i++) {
    const solo = simulateProp(requests[i]!, history, game, DEEP_SIMULATIONS, { seed });
    assert.equal(grouped[i]!.hitProbability, solo.hitProbability);
    assert.equal(grouped[i]!.confidenceScore, solo.confidenceScore);
    assert.equal(grouped[i]!.market, requests[i]!.market);
  }
});

test("hitRateFromSamples Over/Under complement on continuous draws", () => {
  const samples = [100, 200, 300, 400, 500];
  const over = hitRateFromSamples(samples, 250, "Over");
  const under = hitRateFromSamples(samples, 250, "Under");
  assert.equal(over, 0.6);
  assert.equal(under, 0.4);
});
