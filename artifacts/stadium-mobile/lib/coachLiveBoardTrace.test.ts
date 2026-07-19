import assert from "node:assert/strict";
import test from "node:test";
import {
  beginCoachLiveBoardTrace,
  emitCoachLiveBoardSummary,
  firstCoachLiveBoardZeroStage,
  recordCoachLiveBoardApiResult,
  recordCoachLiveBoardFeedCounts,
  resetCoachLiveBoardTrace,
  snapshotCoachLiveBoardTrace,
} from "./coachLiveBoardTrace.ts";

test("firstCoachLiveBoardZeroStage finds earliest zero count", () => {
  assert.equal(
    firstCoachLiveBoardZeroStage({
      games: 0,
      props: 0,
      validated: 0,
      priced: 0,
      evScored: 0,
      simulated: 0,
      confidencePassed: 0,
      correlationPassed: 0,
      delivered: 0,
    }),
    "games",
  );
  assert.equal(
    firstCoachLiveBoardZeroStage({
      games: 12,
      props: 0,
      validated: 0,
      priced: 0,
      evScored: 0,
      simulated: 0,
      confidencePassed: 0,
      correlationPassed: 0,
      delivered: 0,
    }),
    "props",
  );
  assert.equal(
    firstCoachLiveBoardZeroStage({
      games: 12,
      props: 400,
      validated: 350,
      priced: 80,
      evScored: 0,
      simulated: 80,
      confidencePassed: 0,
      correlationPassed: 0,
      delivered: 0,
    }),
    "evScored",
  );
});

test("coach live board summary logs pipeline counts", () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown) => {
    if (typeof msg === "string" && msg.includes("[coach-live-board]")) lines.push(msg);
  };
  try {
    beginCoachLiveBoardTrace("trace-1");
    recordCoachLiveBoardApiResult({
      endpoint: "/sports/odds?sport=nba",
      status: 200,
      ok: true,
      games: 8,
    });
    recordCoachLiveBoardFeedCounts({ games: 8, props: 120 });
    const snap = emitCoachLiveBoardSummary("test");
    assert.ok(snap);
    assert.equal(snap?.games, 8);
    assert.equal(snap?.props, 120);
    assert.match(lines[0] ?? "", /status=ok/);
    assert.match(lines[0] ?? "", /games=8/);
    assert.match(lines[0] ?? "", /props=120/);
    assert.match(lines[0] ?? "", /firstZero=validated/);
  } finally {
    console.log = orig;
    resetCoachLiveBoardTrace();
  }
});

test("api failure records error and firstZero games", () => {
  beginCoachLiveBoardTrace("trace-2");
  recordCoachLiveBoardApiResult({
    endpoint: "/sports/odds?sport=nba",
    status: 500,
    ok: false,
    error: "HTTP 500",
  });
  const snap = snapshotCoachLiveBoardTrace();
  assert.equal(snap?.httpStatus, "500");
  assert.equal(snap?.error, "HTTP 500");
  assert.equal(snap?.firstZeroStage, "games");
  resetCoachLiveBoardTrace();
});
