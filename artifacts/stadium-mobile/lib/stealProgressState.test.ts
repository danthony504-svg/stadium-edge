import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialStealProgress,
  mergeStealProgress,
  stealProgressFromLiveScan,
  stealProgressStageLabel,
  STEAL_PROGRESS_TOTAL_STEPS,
} from "./stealProgressState.ts";

test("initial steal progress starts at step 1", () => {
  const p = initialStealProgress("scan-1");
  assert.equal(p.stepIndex, 1);
  assert.equal(p.totalSteps, STEAL_PROGRESS_TOTAL_STEPS);
  assert.equal(p.percent, 10);
});

test("mergeStealProgress advances monotonically", () => {
  let p = initialStealProgress("scan-1");
  const next = mergeStealProgress(p, { scanId: "scan-1", stage: "games-loaded", gamesLoaded: 12 });
  assert.ok(next);
  p = next!;
  assert.equal(p.gamesLoaded, 12);
  assert.equal(stealProgressStageLabel("games-loaded", { gamesLoaded: 12, propsLoaded: 0 }), "Loaded 12 games");
});

test("stealProgressFromLiveScan terminalizes on scanComplete", () => {
  const patch = stealProgressFromLiveScan("scan-1", {
    booksScanned: 18,
    gamesScanned: 40,
    marketsChecked: 2000,
    longshotsAnalyzed: 90,
    scanComplete: true,
    stealsFound: 0,
  });
  assert.equal(patch.terminal, true);
  assert.equal(patch.percent, 100);
});
