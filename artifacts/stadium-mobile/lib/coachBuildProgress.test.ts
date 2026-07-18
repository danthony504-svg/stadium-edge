import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COACH_BUILD_STAGES,
  coachBuildProgressFromPhase,
  coachBuildProgressSignature,
  coachBuildProgressViewFromSnapshot,
  coachBuildProgressTick,
  coachBuildStageFromParlayPhase,
  createCoachBuildProgress,
  advanceCoachBuildStage,
  type ParlayBuildPhase,
} from "./coachBuildProgress.ts";

test("coachBuildProgressFromPhase maps idle → 0 and complete → 100", () => {
  const idle = coachBuildProgressFromPhase(undefined, 0);
  assert.equal(idle.percent, 0);
  assert.equal(idle.label, "Starting analysis");
  assert.equal(idle.ticketComplete, false);

  const done = coachBuildProgressFromPhase("score", 3);
  assert.equal(done.percent, 100);
  assert.equal(done.ticketComplete, true);
  assert.equal(done.simulationComplete, true);
});

test("coachBuildProgressFromPhase maps phases to 0–100 ladder", () => {
  const phases: { phase: ParlayBuildPhase | undefined; percent: number }[] = [
    { phase: undefined, percent: 0 },
    { phase: "context", percent: 25 },
    { phase: "board-scan", percent: 70 },
    { phase: "stream", percent: 85 },
    { phase: "score", percent: 90 },
  ];
  for (const { phase, percent } of phases) {
    const snap = coachBuildProgressFromPhase(phase, 0);
    assert.equal(snap.percent, percent, `phase ${phase ?? "idle"}`);
  }
});

test("coachBuildProgressFromPhase uses lifecycle state when provided", () => {
  let state = createCoachBuildProgress({ requestId: "r1", sendGeneration: 1, legTarget: 5 });
  state = advanceCoachBuildStage(state, "starting", { requestId: "r1", sendGeneration: 1 });
  state = advanceCoachBuildStage(state, "loading-games", { requestId: "r1", sendGeneration: 1 });
  state = advanceCoachBuildStage(state, "matchups", { requestId: "r1", sendGeneration: 1 });
  const snap = coachBuildProgressFromPhase(undefined, 0, state);
  assert.equal(snap.percent, state.displayPercent);
  assert.equal(snap.matchupComplete, true);
  assert.equal(snap.injuryComplete, false);
});

test("coachBuildProgressViewFromSnapshot mirrors checklist flags", () => {
  const snap = coachBuildProgressFromPhase("stream", 0);
  const view = coachBuildProgressViewFromSnapshot(snap);
  assert.equal(view.percent, 85);
  assert.equal(view.headline, snap.label);
  assert.ok(view.checklist.length === COACH_BUILD_STAGES.length);
});

test("coachBuildStageFromParlayPhase maps scan phases", () => {
  assert.equal(coachBuildStageFromParlayPhase("board-scan"), "simulations");
  assert.equal(coachBuildStageFromParlayPhase("stream"), "correlation");
});

test("coachBuildProgressSignature dedupes identical updates", () => {
  const a = coachBuildProgressSignature({
    requestId: "req-1",
    stage: "board-scan",
    percent: 70,
    ticketId: "t-1",
  });
  const b = coachBuildProgressSignature({
    requestId: "req-1",
    stage: "board-scan",
    percent: 70,
    ticketId: "t-1",
  });
  assert.equal(a, b);
});

test("coachBuildProgressTick never decreases displayPercent", () => {
  let state = createCoachBuildProgress({ requestId: "r-mono", sendGeneration: 1, legTarget: 5 });
  for (const stageId of ["starting", "loading-games", "matchups", "injuries", "line-value", "simulations", "correlation"] as const) {
    state = advanceCoachBuildStage(state, stageId, { requestId: "r-mono", sendGeneration: 1 });
  }
  state = { ...state, displayPercent: 89 };
  const ticked = coachBuildProgressTick(state);
  assert.ok(ticked.displayPercent >= 89);
});

test("advanceCoachBuildStage ignores stale requestId", () => {
  let state = createCoachBuildProgress({ requestId: "r-live", sendGeneration: 1, legTarget: 5 });
  state = advanceCoachBuildStage(state, "correlation", {
    requestId: "r-stale",
    sendGeneration: 1,
  });
  assert.equal(state.completedThroughIndex, -1);
});
test("coachBuildProgressFromPhase walks 3/5/9/15-leg lifecycle to 100%", () => {
  for (const legs of [3, 5, 9, 15]) {
    let state = createCoachBuildProgress({ requestId: `r-${legs}`, sendGeneration: 1, legTarget: legs });
    const stageIds = COACH_BUILD_STAGES.map((s) => s.id);
    for (const stageId of stageIds) {
      state = advanceCoachBuildStage(state, stageId, {
        requestId: `r-${legs}`,
        sendGeneration: 1,
      });
    }
    const snap = coachBuildProgressFromPhase("score", legs, { ...state, status: "complete", displayPercent: 100 });
    assert.equal(snap.percent, 100, `${legs}-leg`);
    assert.equal(snap.ticketComplete, true, `${legs}-leg ticket`);
  }
});
