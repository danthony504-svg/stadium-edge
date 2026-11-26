import { propSharedDistributionKey } from "../src/lib/propSharedDistribution.js";
import assert from "node:assert/strict";
import test from "node:test";
import { comparableDistributionFingerprint, comparablePropMatchup } from "../src/lib/comparablePropMatchup.js";
import { serverPickFinalAiScore, serverPickRankScore } from "../src/lib/coachSlatePickScore.js";
import { explainProjection, scoreSharedDistribution, scoreTargetsFromSamples } from "../src/lib/monteCarlo.js";

const base = {
  sport: "nfl",
  market: "player_rush_yds",
  position: "RB",
  cutoff: Date.parse("2026-11-25"),
  recent: [18, 19, 20].map(day => ({
    date: `2026-11-${day}`,
    stats: { rushingYards: "100", rushingAttempts: "20" },
  })),
};

function snapshot(yards: number, games = 6) {
  return [{
    position: "RB", market: "player_rush_yds",
    games: Array.from({ length: games }, (_, index) => ({
      date: `2026-11-0${index + 1}`,
      eventId: String(index + 1),
      values: [yards, 180],
      carries: [20, 4],
    })),
  }];
}

test("prepared opponent evidence crosses the Coach grade threshold at a fixed seed", () => {
  const targets = [{ line: 100, side: "Over" }, { line: 100, side: "Under" }, { line: 105.5, side: "Over" }] as const;
  const odds = 105;

  function run(yards: number) {
    const comparableMatchup = comparablePropMatchup({ ...base, thresholds: snapshot(yards) });
    const ctx = {
      sport: base.sport, market: base.market, line: 100, side: "Over" as const,
      recentValues: [100, 100, 100, 100, 100], discrete: true, comparableMatchup,
    };
    const fresh = scoreSharedDistribution(ctx, [...targets], 10_000, { seed: 12345 });
    assert.ok(fresh.samples && fresh.shared);
    const reused = scoreTargetsFromSamples(fresh.samples, fresh.shared, [...targets], ctx);
    assert.deepEqual(reused.results, fresh.results);
    const [over, under] = fresh.results;
    assert.ok(over?.hitProbability != null && under?.hitProbability != null);
    assert.ok(over.hitProbability + under.hitProbability < 1, "pushes belong to neither side");
    const hit = over.hitProbability;
    return { hit, grade: serverPickFinalAiScore(hit, odds, 0)?.grade, rank: serverPickRankScore(odds, 0, hit) };
  }

  const tough = run(50);
  const favorable = run(150);
  assert.equal(tough.grade, "C+");
  assert.equal(favorable.grade, "B");
  assert.ok(tough.hit < 0.52 && favorable.hit >= 0.58);
  assert.ok(favorable.rank > tough.rank);
  console.log({ tough, favorable });
});

test("new snapshots have distinct distribution keys even when the multiplier is capped", () => {
  const first = comparablePropMatchup({ ...base, thresholds: snapshot(150) });
  const next = comparablePropMatchup({ ...base, thresholds: snapshot(151) });
  const firstKey = comparableDistributionFingerprint("same-player-history", first);
  assert.equal(first.multiplier, next.multiplier);
  assert.equal(firstKey, comparableDistributionFingerprint("same-player-history", first));
  assert.notEqual(firstKey, comparableDistributionFingerprint("same-player-history", next));
  const limited = comparablePropMatchup({ ...base, thresholds: snapshot(50, 2) });
  assert.equal(limited.status, "limited");
  assert.equal(limited.games, 2);
  assert.equal(limited.multiplier, 1);
});

test("server board scan excludes the tough matchup and stages the favorable one", async (t) => {
  const { runServerBoardScan } = await import("../src/lib/coachSlateBoardScan.js");
  type Options = NonNullable<Parameters<typeof runServerBoardScan>[1]>;
  type Decision = Parameters<NonNullable<Options["onPropDecision"]>>[0];
  const candidate = {
    sport: "nfl", game: "Away @ Home", player: "Fixture Back",
    marketLabel: "Rushing yards", marketKey: base.market, line: 100, side: "Over" as const,
    odds: 105, athleteId: "1", eventId: "fixture",
    startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
  const board = {
    context: { selectedSports: ["nfl"], currentSlip: [], realGames: [], realOdds: [], realProps: [] },
    propPool: [candidate], gameMeta: [], upsetSpots: [], todayOnly: false, tomorrowOnly: false,
  };
  let matchup = comparablePropMatchup(base);
  let simRequests = 0;
  let providerRequests = 0;
  const distributions = new Map<string, ReturnType<typeof scoreSharedDistribution>>();
  const priorMode = process.env.COACH_SLATE_SIM_MODE;
  const priorWorker = process.env.COACH_SLATE_WORKER;
  process.env.COACH_SLATE_SIM_MODE = "loopback";
  delete process.env.COACH_SLATE_WORKER;
  t.after(() => {
    if (priorMode === undefined) delete process.env.COACH_SLATE_SIM_MODE;
    else process.env.COACH_SLATE_SIM_MODE = priorMode;
    if (priorWorker === undefined) delete process.env.COACH_SLATE_WORKER;
    else process.env.COACH_SLATE_WORKER = priorWorker;
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (!url.endsWith("/sports/simulate/props")) {
      providerRequests++;
      throw new Error("Unexpected provider request");
    }
    simRequests++;
    const body = JSON.parse(String(init.body));
    assert.equal(body.tier, "deep");
    assert.equal(body.props[0].line, candidate.line);
    assert.equal(body.props[0].athleteId, candidate.athleteId);
    const ctx = {
      sport: "nfl", market: base.market, line: candidate.line, side: candidate.side,
      recentValues: [100, 100, 100, 100, 100], discrete: true, comparableMatchup: matchup,
    };
    const targets = [{ line: ctx.line, side: ctx.side }];
    const key = comparableDistributionFingerprint("fixture-history", matchup);
    const saved = distributions.get(key);
    let scored;
    if (saved?.samples && saved.shared) {
      scored = scoreTargetsFromSamples(saved.samples, saved.shared, targets, ctx);
    } else {
      scored = scoreSharedDistribution(ctx, targets, 10_000, { seed: 12345 });
      distributions.set(key, scored);
    }
    return Response.json({ props: [{ ...body.props[0], hitProbability: scored.results[0]?.hitProbability }] });
  });

  async function run() {
    const decisions: Decision[] = [];
    const started = performance.now();
    const result = await runServerBoardScan(board, { onPropDecision: decision => decisions.push(decision) });
    assert.equal(decisions.length, 1);
    return { milliseconds: performance.now() - started, decision: decisions[0]!, eligible: result.scan.totalQualified };
  }

  const neutral = await run();
  const neutralCached = await run();
  matchup = comparablePropMatchup({ ...base, thresholds: snapshot(50) });
  const tough = await run();
  const toughCached = await run();
  matchup = comparablePropMatchup({ ...base, thresholds: snapshot(150) });
  const favorable = await run();
  const favorableCached = await run();

  assert.equal(tough.decision.exclusion, "below_scan_probability");
  assert.equal(tough.eligible, 0);
  assert.equal(favorable.decision.exclusion, null);
  assert.equal(favorable.eligible, 1);
  assert.deepEqual(neutral.decision, neutralCached.decision);
  assert.deepEqual(tough.decision, toughCached.decision);
  assert.deepEqual(favorable.decision, favorableCached.decision);
  assert.equal(distributions.size, 3);
  assert.equal(providerRequests, 0);
  assert.equal(simRequests, 6);
  for (const [label, fresh, cached] of [
    ["Neutral", neutral, neutralCached], ["Tough", tough, toughCached], ["Favorable", favorable, favorableCached],
  ] as const) {
    console.log(label, { ...fresh.decision, entry: undefined, freshMs: fresh.milliseconds, cachedMs: cached.milliseconds });
  }
});

test("projected carries independently offset a fixed rushing matchup penalty", () => {
  const comparableMatchup = comparablePropMatchup({ ...base, thresholds: snapshot(50) });
  const ctx = {
    sport: "nfl", market: base.market, line: 100, side: "Over" as const,
    recentValues: [100, 100, 100, 100, 100], discrete: true, comparableMatchup,
  };
  const targets = [{ line: ctx.line, side: ctx.side }];
  const former = scoreSharedDistribution(ctx, targets, 10_000, { seed: 12345 });
  const withCarries = (expectedCarries: number) => {
    const scenario = { ...ctx, expectedCarries };
    return {
      breakdown: explainProjection(scenario)!,
      hit: scoreSharedDistribution(scenario, targets, 10_000, { seed: 12345 }).results[0]?.hitProbability,
    };
  };
  const partial = withCarries(21);
  const full = withCarries(24);
  assert.equal(partial.breakdown.workloadComparison?.offset, "partial");
  assert.equal(full.breakdown.workloadComparison?.offset, "full");
  assert.ok(Math.abs(full.breakdown.adjusted - 110.4) < 1e-9);
  assert.ok(Math.abs(full.breakdown.workloadComparison!.yardsGained - 18.4) < 1e-9);
  assert.equal(full.breakdown.workloadComparison?.matchupPenalty, 8);
  assert.equal(full.breakdown.comparable?.snapshotId, comparableMatchup.snapshotId);
  assert.equal(former.results[0]?.hitProbability, 0.224);
  assert.ok(partial.hit! > former.results[0]!.hitProbability! && full.hit! > partial.hit!);
  const key = { sport: ctx.sport, market: ctx.market, player: "Fixture Back" };
  assert.notEqual(propSharedDistributionKey({ ...key, expectedCarries: 21 }),
    propSharedDistributionKey({ ...key, expectedCarries: 24 }));
  console.log("Workload fixture", {
    original: former.results[0]?.hitProbability, partial: partial.hit, full: full.hit,
    adjustedAt21: partial.breakdown.adjusted, adjustedAt24: full.breakdown.adjusted,
  });
});
