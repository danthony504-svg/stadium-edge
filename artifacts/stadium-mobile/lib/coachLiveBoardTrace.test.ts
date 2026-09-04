import assert from "node:assert/strict";
import test from "node:test";
import {
  beginCoachLiveBoardTrace,
  classifyCoachLiveBoardExit,
  coachLiveBoardStageLabel,
  emitCoachLiveBoardSummary,
  firstCoachLiveBoardZeroStage,
  logCoachLiveBoardEmptyTicketFallback,
  markCoachLiveBoardScanEnded,
  recordCoachLiveBoardApiResult,
  recordCoachLiveBoardConfidencePassed,
  recordCoachLiveBoardDelivered,
  recordCoachLiveBoardEvScored,
  recordCoachLiveBoardFeedCounts,
  recordCoachLiveBoardGrounded,
  recordCoachLiveBoardPriced,
  recordCoachLiveBoardSimulated,
  recordCoachLiveBoardValidated,
  resetCoachLiveBoardTrace,
  snapshotCoachLiveBoardTrace,
} from "./coachLiveBoardTrace.ts";

test("firstCoachLiveBoardZeroStage finds earliest zero count", () => {
  const emptyTail = {
    simulated: 0,
    confidencePassed: 0,
    grounded: 0,
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
      confidencePassed: 0,
      grounded: 0,
      delivered: 0,
    }),
    "evScored",
  );
  assert.equal(coachLiveBoardStageLabel("evScored"), "Candidates after EV");
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
      confidencePassed: 0,
      grounded: 0,
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
      confidencePassed: 0,
      grounded: 0,
      delivered: 0,
      httpStatus: "ok",
      error: "",
      exitReason: "none",
    }),
    "ev_filter",
  );
});

test("coach live board logs started, stages, and completed", () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown) => {
    if (typeof msg === "string" && msg.includes("[coach-live-board]")) lines.push(msg);
  };
  try {
    beginCoachLiveBoardTrace("trace-1");
    recordCoachLiveBoardFeedCounts({ games: 8, props: 120 });
    recordCoachLiveBoardValidated(200);
    recordCoachLiveBoardPriced(80);
    recordCoachLiveBoardEvScored([
      {
        pick: {
          game: "Lakers @ Celtics",
          market: "Moneyline",
          pick: "Lakers",
          odds: -110,
          sport: "nba",
          isProp: false,
          finalAiScore: { edgePct: 5, simHit: 0.58, grade: "B", highRiskValuePlay: false },
        },
      } as never,
    ]);
    recordCoachLiveBoardSimulated(80);
    recordCoachLiveBoardConfidencePassed(12);
    recordCoachLiveBoardGrounded(5);
    recordCoachLiveBoardDelivered(0);
    markCoachLiveBoardScanEnded(true);
    const snap = emitCoachLiveBoardSummary("test");
    assert.ok(snap);
    assert.equal(snap?.games, 8);
    assert.equal(snap?.firstZeroStage, "delivered");
    assert.equal(snap?.firstZeroStageLabel, "Final delivered picks");
    assert.ok(lines.some((l) => l.includes("Live board request started")));
    assert.ok(lines.some((l) => l.includes("Games loaded: 8")));
    assert.ok(lines.some((l) => l.includes("Candidates after EV: 1")));
    assert.ok(lines.some((l) => l.includes("Live board request completed")));
    assert.ok(lines.some((l) => l.includes("empty-ticket-fallback")));
  } finally {
    console.log = orig;
    resetCoachLiveBoardTrace();
  }
});

test("empty ticket fallback detects scan not finished", () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown) => {
    if (typeof msg === "string" && msg.includes("[coach-live-board]")) lines.push(msg);
  };
  try {
    beginCoachLiveBoardTrace("trace-early");
    recordCoachLiveBoardFeedCounts({ games: 20, props: 100 });
    logCoachLiveBoardEmptyTicketFallback({
      delivered: 0,
      scanComplete: false,
      hasManifestReply: false,
      legTarget: 3,
    });
    const line = lines.find((l) => l.includes("empty-ticket-fallback")) ?? "";
    assert.match(line, /fallbackBeforeScanFinished=true/);
    assert.match(line, /stageReturnedZero=/);
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
