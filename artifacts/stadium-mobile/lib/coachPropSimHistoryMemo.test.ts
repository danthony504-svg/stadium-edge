import test from "node:test";
import assert from "node:assert/strict";
import {
  athleteMemoKey,
  createCoachPropSimHistoryMemo,
  historyMemoKey,
} from "./coachPropSimHistoryMemo.ts";

test("history memo keys are sport-scoped", () => {
  assert.equal(historyMemoKey("NFL", "123"), "nfl:123");
  assert.equal(athleteMemoKey("MLB", "Aaron Judge"), "mlb:aaron judge");
});

test("createCoachPropSimHistoryMemo starts empty with zero stats (request-scoped)", () => {
  const a = createCoachPropSimHistoryMemo();
  const b = createCoachPropSimHistoryMemo();
  assert.notEqual(a, b);
  assert.notEqual(a.historyByAthlete, b.historyByAthlete);
  assert.equal(a.stats.historyCacheHits, 0);
  assert.equal(a.stats.historyCacheMisses, 0);
  assert.equal(a.stats.historyFetches, 0);
  assert.equal(a.stats.fallbackSkippedServerHit, 0);
  a.historyByAthlete.set("nfl:1", null);
  a.stats.historyCacheHits = 3;
  assert.equal(b.historyByAthlete.size, 0, "no cross-request memo sharing");
  assert.equal(b.stats.historyCacheHits, 0);
});
