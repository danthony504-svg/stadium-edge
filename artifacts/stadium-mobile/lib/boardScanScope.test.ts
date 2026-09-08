import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_PROP_SIM_CAP_MAX,
  BOARD_PROP_SIM_CAP_MIN,
  boardScanMaxPropsToSim,
} from "./boardScanScope.ts";

test("boardScanMaxPropsToSim uses dynamic 500-1000 cap instead of 70/120", () => {
  assert.equal(boardScanMaxPropsToSim(5, 10_000), BOARD_PROP_SIM_CAP_MIN);
  assert.equal(boardScanMaxPropsToSim(15, 10_000), 700);
  assert.ok(boardScanMaxPropsToSim(5, 10_000) >= 500);
  assert.ok(boardScanMaxPropsToSim(15, 10_000, { longshotAsk: true }) >= 700);
  assert.equal(boardScanMaxPropsToSim(25, 10_000), BOARD_PROP_SIM_CAP_MAX);
  assert.equal(boardScanMaxPropsToSim(5, 200), 200);
});

test("longshot cap is at least standard cap", () => {
  const standard = boardScanMaxPropsToSim(5, 5000);
  const longshot = boardScanMaxPropsToSim(15, 5000, { longshotAsk: true });
  assert.ok(longshot >= standard);
});
