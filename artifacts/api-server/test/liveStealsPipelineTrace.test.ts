import { test } from "node:test";
import assert from "node:assert/strict";

import {
  failLiveStealsStage,
  liveStealsPipelineStages,
  logLiveStealsStage,
  resetLiveStealsPipelineTrace,
} from "../src/lib/liveStealsPipelineTrace.ts";

test("liveSteals pipeline trace records stages and STOP on failure", () => {
  resetLiveStealsPipelineTrace();
  logLiveStealsStage("1-scan-start", 8);
  logLiveStealsStage("2-odds-api-fetch", 0);
  assert.throws(
    () => failLiveStealsStage("2-odds-api-fetch", new Error("HTTP 502: ODDS_API_KEY not configured")),
    /ODDS_API_KEY/,
  );
  const stages = liveStealsPipelineStages();
  assert.equal(stages.length, 3);
  assert.equal(stages[2]?.ok, false);
  assert.equal(stages[2]?.stage, "2-odds-api-fetch");
});
