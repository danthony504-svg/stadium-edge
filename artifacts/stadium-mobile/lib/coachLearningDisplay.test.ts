import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPerformanceHeadlines,
  computeLearningCardStats,
  gradeTierColor,
  unitsForPicks,
} from "./coachLearningDisplay.ts";
import { emptyTrackedAnalytics } from "./pickTrackerAnalytics.ts";
import type { TrackedPick } from "./pickTracker.ts";

const COLORS = {
  success: "#10b981",
  primary: "#3b82f6",
  warning: "#f59e0b",
  destructive: "#ef4444",
  foreground: "#f1f5f9",
};

test("gradeTierColor maps letter tiers to palette", () => {
  assert.equal(gradeTierColor("A-", COLORS), COLORS.success);
  assert.equal(gradeTierColor("B+", COLORS), COLORS.primary);
  assert.equal(gradeTierColor("C", COLORS), COLORS.warning);
  assert.equal(gradeTierColor("D", COLORS), COLORS.destructive);
});

test("buildPerformanceHeadlines includes yesterday and last 7 days", () => {
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  yesterdayDate.setHours(12, 0, 0, 0);
  const yesterday = yesterdayDate.getTime();
  const picks: TrackedPick[] = [
    {
      id: "1",
      capturedAt: yesterday,
      date: "2026-07-07",
      sport: "mlb",
      game: "A @ B",
      player: "P",
      market: "Strikeouts",
      line: 5.5,
      pick: "Over 5.5",
      odds: 150,
      aiGrade: "B+",
      confidence: 55,
      edge: 3.2,
      ev: null,
      simHitPct: null,
      isProp: true,
      status: "win",
      settledAt: yesterday,
      source: "coach",
    },
    {
      id: "2",
      capturedAt: yesterday,
      date: "2026-07-07",
      sport: "mlb",
      game: "C @ D",
      player: "Q",
      market: "Strikeouts",
      line: 4.5,
      pick: "Under 4.5",
      odds: -110,
      aiGrade: "B",
      confidence: 52,
      edge: 2.1,
      ev: null,
      simHitPct: null,
      isProp: true,
      status: "loss",
      settledAt: yesterday,
      source: "coach",
    },
  ];

  const lines = buildPerformanceHeadlines(picks);
  assert.ok(lines.some((l) => l.startsWith("Yesterday:")));
  assert.ok(lines.some((l) => l.startsWith("Last 7 Days:")));
});

test("computeLearningCardStats surfaces avg line value from settled edges", () => {
  const picks: TrackedPick[] = [
    {
      id: "1",
      capturedAt: Date.now(),
      date: "2026-07-08",
      sport: "mlb",
      game: "A @ B",
      player: "P",
      market: "Strikeouts",
      line: 5.5,
      pick: "Over 5.5",
      odds: 120,
      aiGrade: "B+",
      confidence: 55,
      edge: 4,
      ev: null,
      simHitPct: null,
      isProp: true,
      status: "win",
      settledAt: Date.now(),
      source: "coach",
    },
    {
      id: "2",
      capturedAt: Date.now(),
      date: "2026-07-08",
      sport: "mlb",
      game: "C @ D",
      player: "Q",
      market: "Strikeouts",
      line: 4.5,
      pick: "Under 4.5",
      odds: -110,
      aiGrade: "B",
      confidence: 52,
      edge: 2,
      ev: null,
      simHitPct: null,
      isProp: true,
      status: "loss",
      settledAt: Date.now(),
      source: "coach",
    },
  ];

  const analytics = {
    ...emptyTrackedAnalytics(),
    total: 2,
    legTally: { wins: 1, losses: 1, pushes: 0 },
    roiPct: 5,
    recentWindow: {
      windowSize: 30,
      sampleSize: 2,
      wins: 1,
      losses: 1,
      pushes: 0,
      winPct: 50,
    },
    bySport: [{ key: "mlb", label: "MLB", tally: { wins: 1, losses: 1, pushes: 0 } }],
    byFamily: [{ key: "strikeouts", label: "Strikeouts", tally: { wins: 1, losses: 1, pushes: 0 } }],
  };

  const stats = computeLearningCardStats(picks, analytics);
  assert.equal(stats.avgLineValuePct, 3);
  assert.equal(stats.winRatePct, 50);
});

test("unitsForPicks sums flat units", () => {
  const units = unitsForPicks([
    {
      id: "1",
      capturedAt: 0,
      date: "d",
      sport: "mlb",
      game: "g",
      player: null,
      market: "ML",
      line: null,
      pick: "Team ML",
      odds: 100,
      aiGrade: null,
      confidence: null,
      edge: null,
      ev: null,
      simHitPct: null,
      isProp: false,
      status: "win",
      source: "coach",
    },
  ]);
  assert.equal(units, 1);
});
