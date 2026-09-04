import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { americanToDecimal, impliedProbabilityFromAmerican } from "../src/normalize";

describe("coach-data normalize", () => {
  it("converts negative american odds to decimal", () => {
    assert.equal(americanToDecimal(-110), 1 + 100 / 110);
  });

  it("converts positive american odds to decimal", () => {
    assert.equal(americanToDecimal(150), 2.5);
  });

  it("computes implied probability", () => {
    const neg = impliedProbabilityFromAmerican(-110);
    const pos = impliedProbabilityFromAmerican(150);
    assert.ok(neg > 0.5);
    assert.ok(pos < 0.5);
  });
});
