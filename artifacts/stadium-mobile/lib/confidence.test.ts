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

test("deriveConfidenceScore: null edge -> null score", () => {
  assert.equal(deriveConfidenceScore(null, "Medium"), null);
});

test("deriveConfidenceScore: matches the 5.5 + gap*0.45 +/- variance formula", () => {
  // +6.8% edge, Medium variance -> 5.5 + 3.06 = 8.56 -> 8.6 (the reported card)
  assert.equal(deriveConfidenceScore(6.8, "Medium"), 8.6);
  // Low variance adds 0.6
  assert.equal(deriveConfidenceScore(6.8, "Low"), 9.2);
  // High variance subtracts 0.6
  assert.equal(deriveConfidenceScore(6.8, "High"), 8.0);
  // Clamped to 9.9 ceiling
  assert.equal(deriveConfidenceScore(40, "Low"), 9.9);
  // Clamped to 1.0 floor
  assert.equal(deriveConfidenceScore(-40, "High"), 1);
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
