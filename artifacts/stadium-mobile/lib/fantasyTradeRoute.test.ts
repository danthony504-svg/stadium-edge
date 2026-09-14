import assert from "node:assert/strict";
import test from "node:test";
import { preselectedTradeGiveIds } from "./fantasyTradeRoute.ts";

test("saved player deep link is preserved as the Trade Analyzer give selection", () => {
  assert.deepEqual(preselectedTradeGiveIds([], "athlete-1", new Set(["athlete-1"])), ["athlete-1"]);
});
