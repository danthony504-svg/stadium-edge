import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PERFORMANCE_WINDOW,
  buildRollingWinRateSeries,
  summarizeRecentPerformance,
  wonPicks,
} from "./performanceChart.ts";

function hist(statuses: Array<"win" | "loss" | "push">) {
  return statuses.map((status, i) => ({
    status,
    gradedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  }));
}

test("buildRollingWinRateSeries returns [] until two decided picks exist", () => {
  assert.deepEqual(buildRollingWinRateSeries(hist(["win"])), []);
  assert.deepEqual(buildRollingWinRateSeries(hist(["push", "push"])), []);
});

test("buildRollingWinRateSeries tracks rolling win rate", () => {
  const series = buildRollingWinRateSeries(hist(["win", "loss", "win", "win"]), 4);
  assert.deepEqual(series, [100, 50, 67, 75]);
});

test("summarizeRecentPerformance uses the trailing window only", () => {
  const long = hist([
    "loss",
    "loss",
    "loss",
    "loss",
    "loss",
    "loss",
    "loss",
    "loss",
    "loss",
    "loss",
    "win",
    "win",
    "win",
    "win",
    "win",
  ]);
  const s = summarizeRecentPerformance(long, 10);
  assert.equal(s.sampleSize, 10);
  assert.equal(s.wins, 5);
  assert.equal(s.losses, 5);
  assert.equal(s.winPct, 50);
});

test("summarizeRecentPerformance caps at available history", () => {
  const s = summarizeRecentPerformance(hist(["win", "loss"]), PERFORMANCE_WINDOW);
  assert.equal(s.sampleSize, 2);
  assert.equal(s.winPct, 50);
});

test("wonPicks returns wins newest-first", () => {
  const wins = wonPicks(hist(["win", "loss", "win", "push"]));
  assert.equal(wins.length, 2);
  assert.equal(wins[0]!.gradedAt, hist(["win", "loss", "win", "push"])[2]!.gradedAt);
});
