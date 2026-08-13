import assert from "node:assert/strict";
import { test } from "node:test";

import {
  captureCoachPicks,
  oddsBucket,
  oddsRole,
  trackedPickFromParsedPick,
  type CapturablePick,
  type TrackedPick,
} from "./pickTracker.ts";
import {
  computeRoiPct,
  computeSignalPerfMap,
  computeTrackedAnalytics,
  trackedSignalBias,
} from "./pickTrackerAnalytics.ts";

// One stable scheduled start for this module: repeated captures model the same
// Coach card and must therefore generate the same ledger identity.
const FUTURE_START = new Date(Date.now() + 3600_000).toISOString();

const basePick = (over: Partial<CapturablePick> = {}): CapturablePick => ({
  game: "Yankees @ Red Sox",
  market: "Total",
  pick: "Over 8.5",
  odds: -110,
  sport: "mlb",
  startsAt: FUTURE_START,
  scores: {
    grade: "B",
    confidencePct: 58,
    edgePct: 3.2,
  },
  ...over,
});

test("trackedPickFromParsedPick captures pregame coach leg", () => {
  const t = trackedPickFromParsedPick(basePick());
  assert.ok(t);
  assert.equal(t!.sport, "mlb");
  assert.equal(t!.status, "pending");
  assert.equal(t!.aiGrade, "B");
  assert.equal(t!.confidence, 58);
  assert.equal(t!.edge, 3.2);
});

test("trackedPickFromParsedPick skips started games", () => {
  const t = trackedPickFromParsedPick(
    basePick({ startsAt: new Date(Date.now() - 3600_000).toISOString() }),
  );
  assert.equal(t, null);
});

test("captureCoachPicks dedupes by id and updates scores", () => {
  const first = captureCoachPicks([], [basePick()]);
  assert.equal(first.length, 1);
  const updated = captureCoachPicks(first, [
    basePick({
      scores: {
        grade: "B+",
        confidencePct: 62,
        edgePct: 4.1,
      },
    }),
  ]);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].aiGrade, "B+");
  assert.equal(updated[0].confidence, 62);
});

test("odds buckets classify favorites and longshots", () => {
  assert.equal(oddsBucket(-250), "heavyFav");
  assert.equal(oddsBucket(-120), "fav");
  assert.equal(oddsBucket(130), "plus");
  assert.equal(oddsBucket(300), "longshot");
  assert.equal(oddsRole(-110), "favorite");
  assert.equal(oddsRole(150), "underdog");
  assert.equal(oddsRole(250), "longshot");
});

test("computeTrackedAnalytics aggregates settled picks", () => {
  const picks: TrackedPick[] = [
    {
      id: "a",
      capturedAt: 1,
      date: "2026-06-01",
      sport: "mlb",
      game: "A @ B",
      player: null,
      market: "Total",
      line: 8.5,
      pick: "Over 8.5",
      odds: -110,
      aiGrade: "B",
      confidence: 55,
      edge: 2,
      ev: 1.2,
      simHitPct: 54,
      isProp: false,
      status: "win",
      settledAt: 2,
      source: "coach",
    },
    {
      id: "b",
      capturedAt: 1,
      date: "2026-06-02",
      sport: "nba",
      game: "C @ D",
      player: "LeBron James",
      market: "Points",
      line: 25.5,
      pick: "LeBron James Over 25.5 Points",
      odds: -115,
      aiGrade: "A",
      confidence: 65,
      edge: 4,
      ev: 2,
      simHitPct: 58,
      isProp: true,
      propMarketKey: "player_points",
      status: "loss",
      settledAt: 3,
      source: "coach",
    },
  ];
  const a = computeTrackedAnalytics(picks);
  assert.equal(a.legTally.wins, 1);
  assert.equal(a.legTally.losses, 1);
  assert.ok(a.roiPct != null);
  assert.equal(a.bySport.length, 2);
  assert.equal(a.byMarketType.length, 2);
});

test("trackedSignalBias nudges cold categories down", () => {
  const perf = computeSignalPerfMap(
    Array.from({ length: 14 }, (_, i) => ({
      id: `x${i}`,
      capturedAt: 1,
      date: "2026-06-01",
      sport: "mlb",
      game: "A @ B",
      player: null,
      market: "Total",
      line: 8.5,
      pick: "Over 8.5",
      odds: -110,
      aiGrade: "B",
      confidence: 55,
      edge: 2,
      ev: null,
      simHitPct: null,
      isProp: false,
      status: i < 4 ? "win" : "loss",
      settledAt: 2,
      source: "coach" as const,
    })),
  );
  const bias = trackedSignalBias(basePick(), perf);
  assert.ok(bias < 0);
});

test("computeRoiPct on flat units", () => {
  const { roiPct, units } = computeRoiPct([
    {
      id: "w",
      capturedAt: 1,
      date: "2026-06-01",
      sport: "mlb",
      game: "A @ B",
      player: null,
      market: "ML",
      line: null,
      pick: "Team A ML",
      odds: 100,
      aiGrade: null,
      confidence: null,
      edge: null,
      ev: null,
      simHitPct: null,
      isProp: false,
      status: "win",
      settledAt: 2,
      source: "coach",
    },
    {
      id: "l",
      capturedAt: 1,
      date: "2026-06-01",
      sport: "mlb",
      game: "C @ D",
      player: null,
      market: "ML",
      line: null,
      pick: "Team C ML",
      odds: 100,
      aiGrade: null,
      confidence: null,
      edge: null,
      ev: null,
      simHitPct: null,
      isProp: false,
      status: "loss",
      settledAt: 2,
      source: "coach",
    },
  ]);
  assert.equal(units, 0);
  assert.equal(roiPct, 0);
});
