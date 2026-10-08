import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareDistributions,
  effectiveSampleSize,
  evaluateFamilyGate,
  overconfidenceBand,
  type CalibObs,
} from "../eval/familyCalibration.js";

describe("familyCalibration helpers", () => {
  it("computes Kish effective N and family verdicts", () => {
    assert.equal(effectiveSampleSize(["a", "a", "b", "b"]), 2); // Kish: (4^2)/(2^2+2^2)=2
    assert.equal(effectiveSampleSize(["a", "b", "c", "d"]), 4);
    const few: CalibObs[] = Array.from({ length: 20 }, (_, i) => ({
      y: (i % 2 === 0 ? 1 : 0) as 0 | 1,
      p: 0.55,
      eventId: `e${i % 5}`,
      family: "player_prop",
      slice: "pass_yds:main",
      fold: "holdout" as const,
      namedPlayer: true,
      playerId: `p${i}`,
    }));
    const insuff = evaluateFamilyGate("nfl:player_prop", few, { requireNamedPlayer: true });
    assert.equal(insuff.verdict, "INSUFFICIENT_DATA");

    const cl = evaluateFamilyGate("nfl:closing_line_benchmark", [], { requireRealBook: true });
    assert.equal(cl.verdict, "INSUFFICIENT_DATA");
  });

  it("flags overconfidence bands and compares distributions", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      y: 0 as 0 | 1,
      p: 0.92,
      eventId: `g${i}`,
      family: "player_prop",
      slice: "pass_yds:alt",
      fold: "holdout" as const,
      namedPlayer: true,
      isAlt: true,
      playerId: `p${i}`,
    }));
    const band = overconfidenceBand(rows, 0.9);
    assert.equal(band.n, 30);
    assert.equal(band.hitRate, 0);

    const d = compareDistributions("pass", [200, 220, 240, 260, 280], [210, 230, 250, 270, 290]);
    assert.ok(d);
    assert.ok(d!.meanError > 0);
  });
});
