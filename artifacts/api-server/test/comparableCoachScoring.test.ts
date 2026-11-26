import assert from "node:assert/strict";
import test from "node:test";
import { comparableDistributionFingerprint, comparablePropMatchup } from "../src/lib/comparablePropMatchup.js";
import { serverPickFinalAiScore, serverPickRankScore } from "../src/lib/coachSlatePickScore.js";
import { scoreSharedDistribution, scoreTargetsFromSamples } from "../src/lib/monteCarlo.js";

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
