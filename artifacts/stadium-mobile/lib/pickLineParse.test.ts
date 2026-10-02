import assert from "node:assert/strict";
import test from "node:test";

import { compactPickLineLabel, parsePickLineNumber } from "./pickLineParse.ts";

test("phone: 49ers +27.5 line is 27.5 — never the 49 in the nickname", () => {
  assert.equal(parsePickLineNumber("49ers +27.5"), 27.5);
  assert.equal(parsePickLineNumber("Charlotte 49ers +27.5"), 27.5);
  assert.equal(compactPickLineLabel("49ers +27.5"), "+27.5");
  assert.equal(compactPickLineLabel("49ers +27.5"), "+27.5");
  // Regression: first-number grab used to render BEST LINE as "+49".
  assert.notEqual(compactPickLineLabel("49ers +27.5"), "+49");
});

test("76ers / 49ers moneylines have no line number", () => {
  assert.equal(parsePickLineNumber("49ers"), null);
  assert.equal(parsePickLineNumber("76ers"), null);
  assert.equal(compactPickLineLabel("49ers"), null);
  assert.equal(parsePickLineNumber("76ers -4.5"), -4.5);
  assert.equal(compactPickLineLabel("76ers -4.5"), "-4.5");
});

test("standard spreads and totals still parse", () => {
  assert.equal(parsePickLineNumber("Knicks -3.5"), -3.5);
  assert.equal(compactPickLineLabel("Knicks -3.5"), "-3.5");
  assert.equal(parsePickLineNumber("Over 8.5"), 8.5);
  assert.equal(compactPickLineLabel("Over 8.5", "Over"), "O 8.5");
  assert.equal(compactPickLineLabel("Under 45.5", "Under"), "U 45.5");
  assert.equal(parsePickLineNumber("Panthers +2.5"), 2.5);
  assert.equal(compactPickLineLabel("Panthers +2.5"), "+2.5");
});
