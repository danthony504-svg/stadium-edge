import assert from "node:assert/strict";
import test from "node:test";
import {
  beginCoachLiveBoardTrace,
  classifyCoachLiveBoardExit,
  emitCoachLiveBoardSummary,
  firstCoachLiveBoardZeroStage,
  recordCoachLiveBoardApiResult,
  recordCoachLiveBoardDeduped,
  recordCoachLiveBoardFeedCounts,
  resetCoachLiveBoardTrace,
  snapshotCoachLiveBoardTrace,
} from "./coachLiveBoardTrace.ts";

test("firstCoachLiveBoardZeroStage finds earliest zero count", () => {
  const emptyTail = {
    simulated: 0,
    deduped: 0,
    confidencePassed: 0,
    correlationPassed: 0,
    delivered: 0,
  };
  assert.equal(
    firstCoachLiveBoardZeroStage({ games: 0, props: 0, validated: 0, priced: 0, evScored: 0, ...emptyTail }),
    "games",
  );
  assert.equal(
    firstCoachLiveBoardZeroStage({ games: 12, props: 0, validated: 0, priced: 0, evScored: 0, ...emptyTail }),
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
      deduped: 80,
      confidencePassed: 0,
      correlationPassed: 0,
      delivered: 0,
    }),
    "evScored",
  );
  assert.equal(
    firstCoachLiveBoardZeroStage({
      games: 12,
      props: 400,
      validated: 350,
      priced: 80,
      evScored: 40,
      simulated: 80,
      deduped: 0,
      confidencePassed: 0,
      correlationPassed: 0,
      delivered: 0,
    }),
    "deduped",
  );
});

test("classifyCoachLiveBoardExit maps first zero stage to exit reason", () => {
  assert.equal(
    classifyCoachLiveBoardExit({
      games: 0,
      props: 0,
      validated: 0,
      priced: 0,
      evScored: 0,
      simulated: 0,
      deduped: 0,
      confidencePassed: 0,
      correlationPassed: 0,
      delivered: 0,
      httpStatus: "ok",
      error: "",
      exitReason: "none",
    }),
    "no_games",
  );
  assert.equal(
    classifyCoachLiveBoardExit({
      games: 20,
      props: 100,
      validated: 100,
      priced: 50,
      evScored: 0,
      simulated: 50,
      deduped: 50,
      confidencePassed: 0,
      correlationPassed: 0,
      delivered: 0,
      httpStatus: "ok",
      error: "",
      exitReason: "none",
    }),
    "ev_filter",
  );
  assert.equal(
    classifyCoachLiveBoardExit({
      games: 20,
      props: 100,
      validated: 100,
      priced: 50,
      evScored: 10,
      simulated: 50,
      deduped: 10,
      confidencePassed: 0,
      correlationPassed: 0,
      delivered: 0,
      httpStatus: "ok",
      error: "",
      exitReason: "none",
    }),
    "confidence_filter",
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
    assert.match(lines[0] ?? "", /deduped=0/);
  } finally {
    console.log = orig;
    resetCoachLiveBoardTrace();
  }
});

test("optional live-odds 404 does not poison primary http status", () => {
  beginCoachLiveBoardTrace("trace-optional");
  recordCoachLiveBoardApiResult({
    endpoint: "/sports/odds?sport=nfl",
    status: 200,
    ok: true,
    games: 75,
  });
  recordCoachLiveBoardApiResult({
    endpoint: "/sports/live-odds?sport=nfl",
    status: 404,
    ok: false,
    error: "HTTP 404",
    optional: true,
  });
  recordCoachLiveBoardFeedCounts({ games: 75, props: 120 });
  const snap = snapshotCoachLiveBoardTrace();
  assert.equal(snap?.httpStatus, "ok");
  assert.notEqual(snap?.exitReason, "api_failure");
  resetCoachLiveBoardTrace();
});

test("api failure on primary feed records error and firstZero games", () => {
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
  assert.equal(snap?.exitReason, "api_failure");
  assert.equal(snap?.firstZeroStage, "games");
  resetCoachLiveBoardTrace();
});
