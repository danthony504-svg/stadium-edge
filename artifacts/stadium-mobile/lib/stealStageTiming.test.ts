import assert from "node:assert/strict";
import { test } from "node:test";

import {
  stealClientStageTimeoutPatch,
  stealProgressStageToServerStage,
  stealServerStageLabel,
} from "./stealStageTiming.ts";
import {
  STEAL_STAGE_TIMEOUT_MS,
  stealProgressFromElapsedMs,
  type StealProgressStage,
} from "./stealProgressState.ts";

test("stealClientStageTimeoutPatch fires after 10s on same stage", () => {
  const started = 1_000_000;
  assert.equal(
    stealClientStageTimeoutPatch("scan-1", "comparing-odds", started, started + 9_999),
    null,
  );
  const patch = stealClientStageTimeoutPatch(
    "scan-1",
    "comparing-odds",
    started,
    started + STEAL_STAGE_TIMEOUT_MS,
  );
  assert.ok(patch);
  assert.equal(patch!.timedOut, true);
  assert.equal(patch!.stalledStage, "comparing-odds");
});

test("stealProgressFromElapsedMs does not leap through all stages", () => {
  const patch = stealProgressFromElapsedMs("scan-1", 60_000, "running-ev");
  assert.equal(patch.stage, "running-ev");
});

test("stealProgressFromElapsedMs hints games-loaded after 1.5s on connected", () => {
  const patch = stealProgressFromElapsedMs("scan-1", 2_000, "connected");
  assert.equal(patch.stage, "games-loaded");
});

test("stage label mapping covers UI stages", () => {
  const uiStage: StealProgressStage = "running-simulations";
  assert.equal(stealProgressStageToServerStage(uiStage), "running-simulations");
  assert.equal(stealServerStageLabel("running-ev"), "EV");
});
