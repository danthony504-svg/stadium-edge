import assert from "node:assert/strict";
import { test } from "node:test";

import {
  confidenceSatisfiesThreshold,
  deriveConfidenceScore,
  deriveVariance,
  describeConfidenceThreshold,
  parseConfidenceThreshold,
} from "./confidence.ts";

test("deriveVariance: props are High, longshots High, heavy favs Low", () => {
  assert.equal(deriveVariance(-110, true), "High");
  assert.equal(deriveVariance(150, false), "High");
  assert.equal(deriveVariance(-300, false), "Low");
  assert.equal(deriveVariance(-110, false), "Medium");
  assert.equal(deriveVariance(undefined, false), "Medium");
});

test("deriveConfidenceScore: null edge -> null score (no de-vig basis)", () => {
  assert.equal(deriveConfidenceScore(null, -110), null);
});

test("deriveConfidenceScore: null odds -> null score (no price to de-vig)", () => {
  assert.equal(deriveConfidenceScore(2.0, null), null);
  assert.equal(deriveConfidenceScore(2.0, undefined), null);
});

test("deriveConfidenceScore: win chance = implied(odds) + edge, on the 0-10 scale", () => {
  // -110 (52.38% implied) + 6.8 edge = 59.18 -> 59% -> 5.9/10.
  assert.equal(deriveConfidenceScore(6.8, -110), 5.9);
  // A coin-flip price with no edge honestly reads ~5/10, never inflated.
  assert.equal(deriveConfidenceScore(0, -110), 5.2);
  // A heavy favorite (-300 = 75% implied) + 1.0 edge = 76% -> 7.6/10.
  assert.equal(deriveConfidenceScore(1.0, -300), 7.6);
});

test("deriveConfidenceScore: real no-vig fair prob grounds confidence even with null edge", () => {
  // The non-+EV side of a main market carries no edge but does carry a fair prob,
  // so it reads a real confidence instead of null ("Market price").
  assert.equal(deriveConfidenceScore(null, -110, 0.46), 4.6);
  assert.equal(deriveConfidenceScore(null, -110, 0.58), 5.8);
  // fairProb is preferred over the price+edge basis when present.
  assert.equal(deriveConfidenceScore(6.8, -110, 0.55), 5.5);
});

test("deriveConfidenceScore: clamped to the 5-95% win-chance band", () => {
  // Huge favorite + edge clamps at 95% -> 9.5/10 (never a certainty).
  assert.equal(deriveConfidenceScore(10, -2000), 9.5);
  // Longshot with a negative edge floors at 5% -> 0.5/10.
  assert.equal(deriveConfidenceScore(-20, 800), 0.5);
});

test("parseConfidenceThreshold: the reported user phrasing", () => {
  assert.deepEqual(parseConfidenceThreshold("5 leg with 9 to 10 confidence"), {
    min: 9,
    max: 10,
  });
});

test("parseConfidenceThreshold: range forms", () => {
  assert.deepEqual(parseConfidenceThreshold("9-10 confidence"), { min: 9, max: 10 });
  assert.deepEqual(parseConfidenceThreshold("confidence 8 to 9"), { min: 8, max: 9 });
  assert.deepEqual(parseConfidenceThreshold("confidence between 7 and 9"), {
    min: 7,
    max: 9,
  });
  assert.deepEqual(parseConfidenceThreshold("8.5 to 9.5 confidence"), {
    min: 8.5,
    max: 9.5,
  });
});

test("parseConfidenceThreshold: min forms", () => {
  assert.deepEqual(parseConfidenceThreshold("5 leg, 9+ confidence"), { min: 9, max: 10 });
  assert.deepEqual(parseConfidenceThreshold("confidence 9+"), { min: 9, max: 10 });
  assert.deepEqual(parseConfidenceThreshold("confidence of 9 or higher"), {
    min: 9,
    max: 10,
  });
  assert.deepEqual(parseConfidenceThreshold("at least 8 confidence"), {
    min: 8,
    max: 10,
  });
  assert.deepEqual(parseConfidenceThreshold("8 confidence"), { min: 8, max: 10 });
  assert.deepEqual(parseConfidenceThreshold("9/10 confidence"), { min: 9, max: 10 });
  assert.deepEqual(parseConfidenceThreshold("9 out of 10 confidence"), {
    min: 9,
    max: 10,
  });
});

test("parseConfidenceThreshold: max forms", () => {
  assert.deepEqual(parseConfidenceThreshold("confidence under 8"), { min: 1, max: 8 });
  assert.deepEqual(parseConfidenceThreshold("7 or lower confidence"), {
    min: 1,
    max: 7,
  });
});

test("parseConfidenceThreshold: no confidence word -> null (never trips on leg counts/odds)", () => {
  assert.equal(parseConfidenceThreshold("5 leg parlay"), null);
  assert.equal(parseConfidenceThreshold("10 leg with -300 or less"), null);
  assert.equal(parseConfidenceThreshold("give me 3 legs"), null);
  assert.equal(parseConfidenceThreshold("9 leg alt"), null);
  assert.equal(parseConfidenceThreshold(""), null);
  assert.equal(parseConfidenceThreshold(undefined), null);
});

test("parseConfidenceThreshold: out-of-range numbers rejected", () => {
  assert.equal(parseConfidenceThreshold("confidence 95"), null);
});

test("confidenceSatisfiesThreshold: band membership + null exclusion", () => {
  const band = { min: 9, max: 10 };
  assert.equal(confidenceSatisfiesThreshold(9.2, band), true);
  assert.equal(confidenceSatisfiesThreshold(8.6, band), false);
  assert.equal(confidenceSatisfiesThreshold(null, band), false);
  assert.equal(confidenceSatisfiesThreshold(8.6, null), true);
});

test("describeConfidenceThreshold: readable bands", () => {
  // A band whose ceiling is 10 reads as "or higher" (10 is the score ceiling).
  assert.equal(describeConfidenceThreshold({ min: 9, max: 10 }), "9/10 or higher");
  assert.equal(describeConfidenceThreshold({ min: 8, max: 10 }), "8/10 or higher");
  assert.equal(describeConfidenceThreshold({ min: 1, max: 7 }), "7/10 or lower");
  // A true interior range keeps both bounds.
  assert.equal(describeConfidenceThreshold({ min: 8, max: 9 }), "8–9/10");
});
