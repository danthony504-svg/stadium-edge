import assert from "node:assert/strict";
import test from "node:test";

import { fantasyPoints } from "./fantasyScoring.ts";

const statLine = {
  passingYards: 250,
  passingTouchdowns: 2,
  interceptions: 1,
  rushingYards: 20,
  receptions: 5,
  receivingYards: 50,
  receivingTouchdowns: 1,
};

test("fantasy scoring supports PPR, half PPR, and standard", () => {
  assert.equal(fantasyPoints(statLine, "ppr"), 34);
  assert.equal(fantasyPoints(statLine, "halfPpr"), 31.5);
  assert.equal(fantasyPoints(statLine, "standard"), 29);
});

test("fantasy scoring treats omitted real stat fields as zero", () => {
  assert.equal(fantasyPoints({}, "ppr"), 0);
});
