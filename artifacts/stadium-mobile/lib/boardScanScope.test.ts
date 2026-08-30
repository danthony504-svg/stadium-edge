import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanMaxPropsToSim,
  boardScanPropSimBatchTimeoutMs,
  BOARD_PROP_SIM_CAP_MAX,
  BOARD_PROP_SIM_CAP_MIN,
} from "./boardScanScope.ts";

test("boardScanMaxPropsToSim caps deep MC well below full 5k+ boards", () => {
  assert.equal(boardScanMaxPropsToSim(6, 5585), BOARD_PROP_SIM_CAP_MIN);
  assert.equal(boardScanMaxPropsToSim(8, 5585), BOARD_PROP_SIM_CAP_MIN);
  assert.equal(boardScanMaxPropsToSim(15, 5585), Math.min(BOARD_PROP_SIM_CAP_MAX, Math.max(700, 15 * 45)));
  assert.ok(boardScanMaxPropsToSim(15, 5585) <= BOARD_PROP_SIM_CAP_MAX);
  assert.ok(boardScanMaxPropsToSim(3, 100) <= 100);
});

test("boardScanPropSimBatchTimeoutMs is bounded", () => {
  assert.ok(boardScanPropSimBatchTimeoutMs() <= 60_000);
  assert.ok(boardScanPropSimBatchTimeoutMs() >= 10_000);
});
