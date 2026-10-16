/**
 * Injury vacancy honesty — unknown/empty status never redistributes opportunity
 * (never treated as healthy OR as OUT).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyVacancyConfirmation,
  vacancyFractionForConfirmation,
} from "../src/lib/opportunityShift/confirmation.ts";

test("empty / unknown injury status → unknown confirmation, zero vacancy", () => {
  assert.equal(classifyVacancyConfirmation(""), "unknown");
  assert.equal(classifyVacancyConfirmation("   "), "unknown");
  assert.equal(classifyVacancyConfirmation("listed"), "unknown");
  assert.equal(vacancyFractionForConfirmation("unknown"), 0);
  assert.equal(vacancyFractionForConfirmation("probable"), 0);
  assert.equal(vacancyFractionForConfirmation("questionable"), 0);
});

test("OUT / doubtful redistribute; healthy words are not invented from silence", () => {
  assert.equal(classifyVacancyConfirmation("Out"), "out");
  assert.equal(vacancyFractionForConfirmation("out"), 1);
  assert.equal(classifyVacancyConfirmation("Doubtful"), "doubtful");
  assert.equal(vacancyFractionForConfirmation("doubtful"), 0.75);
  // Silence is not "Active/Healthy" — callers must not invent status.
  assert.notEqual(classifyVacancyConfirmation(""), "probable");
});
