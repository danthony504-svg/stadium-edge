import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFixtureScenarioTensor,
  validateScenarioConsistency,
} from "../src/index.js";

describe("joint outcome consistency", () => {
  it("fixture tensor conserves h1+h2 = FG for every draw", () => {
    const tensor = buildFixtureScenarioTensor({
      sport: "nfl",
      eventId: "e1",
      seed: "consistency-1",
      nDraws: 500,
    });
    const report = validateScenarioConsistency(tensor, { periodSumGroup: ["h1", "h2"] });
    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(tensor.meta.isFixture, true);
    assert.equal(tensor.meta.nDraws, 500);
  });

  it("detects broken period sums", () => {
    const tensor = buildFixtureScenarioTensor({
      sport: "nba",
      eventId: "e2",
      seed: "broken",
      nDraws: 10,
    });
    tensor.team.homeByPeriod.h1![0] = 999;
    const report = validateScenarioConsistency(tensor, { periodSumGroup: ["h1", "h2"] });
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((i) => i.code === "period_sum_ne_fg"));
  });
});
