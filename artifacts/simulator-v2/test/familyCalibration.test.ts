import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareDistributions,
  effectiveSampleSize,
  evaluateFamilyGate,
  formatGateTable,
  overconfidenceBand,
} from "../eval/familyCalibration.js";

describe("familyCalibration helpers", () => {
  it("computes Kish effective N and family gate thresholds", () => {
    assert.equal(effectiveSampleSize(["a", "a", "b", "b"]), 2);
    const rows = Array.from({ length: 600 }, (_, i) => ({
      y: (i % 2 === 0 ? 1 : 0) as 0 | 1,
      p: 0.5,
      eventId: `g${Math.floor(i / 2)}`,
      family: "ml",
      slice: "ml_home",
      fold: "holdout" as const,
    }));
    const gate = evaluateFamilyGate("nhl:ml", rows);
    assert.equal(gate.verdict, "PASS");
    assert.ok(gate.n >= 500);
    assert.ok((gate.ece ?? 1) <= 0.04);
    const table = formatGateTable([gate]);
    assert.ok(table[1]!.includes("nhl:ml"));
  });

  it("flags overconfidence bands and compares distributions", () => {
    const hot = Array.from({ length: 30 }, (_, i) => ({
      y: 0 as 0 | 1,
      p: 0.92,
      eventId: `e${i}`,
      family: "ml",
      slice: "ml",
      fold: "holdout" as const,
    }));
    const band = overconfidenceBand(hot, 0.9);
    assert.equal(band.n, 30);
    assert.equal(band.hitRate, 0);
    const gate = evaluateFamilyGate("nhl:ml_hot", [
      ...hot,
      ...Array.from({ length: 500 }, (_, i) => ({
        y: (i % 2 === 0 ? 1 : 0) as 0 | 1,
        p: 0.5,
        eventId: `x${i}`,
        family: "ml",
        slice: "ml",
        fold: "holdout" as const,
      })),
    ]);
    assert.equal(gate.verdict, "FAIL");
    assert.ok(gate.reasons.some((r) => r.startsWith("overconfident_p90")));

    const dist = compareDistributions(
      "goals",
      [1, 2, 3, 4, 5, 2, 3],
      [1.5, 2.5, 3.1, 3.8, 4.2, 2.2, 2.9],
    );
    assert.ok(dist);
    assert.equal(dist!.n, 7);
  });
});
