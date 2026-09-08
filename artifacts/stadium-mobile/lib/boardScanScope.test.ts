import assert from "node:assert/strict";
import test from "node:test";
import {
  boardScanDeadlineMs,
  boardScanMaxPropGames,
  boardScanMaxPropsToSim,
  boardScanPropSimBatchTimeoutMs,
} from "./boardScanScope.ts";

test("boardScanMaxPropsToSim caps longshot prop sim volume", () => {
  assert.equal(boardScanMaxPropsToSim(15, 2000), 120);
  assert.equal(boardScanMaxPropsToSim(5, 2000), 70);
});

test("boardScanMaxPropGames limits pricing games for longshots", () => {
  assert.equal(boardScanMaxPropGames(15, 100), 28);
  assert.equal(boardScanMaxPropGames(5, 100), 100);
});

test("boardScanDeadlineMs stays inside 30s request scope", () => {
  assert.ok(boardScanDeadlineMs(15) <= 26_000);
  assert.ok(boardScanPropSimBatchTimeoutMs() <= 12_000);
});
