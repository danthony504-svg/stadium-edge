import assert from "node:assert/strict";
import { test } from "node:test";

import {
  americanToDecimal,
  formatOdds,
  formatPct,
  inStealBand,
  recordLabel,
  recordWinPct,
  STEAL_MAX_ODDS,
  STEAL_MIN_ODDS,
  type StealRecord,
} from "./steals.ts";

const rec = (over: Partial<StealRecord> = {}): StealRecord => ({
  wins: 0,
  losses: 0,
  pushes: 0,
  pending: 0,
  ungraded: 0,
  graded: 0,
  ...over,
});

test("inStealBand only accepts +500..+30000", () => {
  assert.equal(inStealBand(STEAL_MIN_ODDS), true);
  assert.equal(inStealBand(STEAL_MAX_ODDS), true);
  assert.equal(inStealBand(650), true);
  assert.equal(inStealBand(499), false);
  assert.equal(inStealBand(STEAL_MAX_ODDS + 1), false);
  assert.equal(inStealBand(-120), false);
  assert.equal(inStealBand(null), false);
  assert.equal(inStealBand(undefined), false);
});

test("formatOdds always signs positive American odds", () => {
  assert.equal(formatOdds(650), "+650");
  assert.equal(formatOdds(-120), "-120");
});

test("formatPct signs, rounds, and blanks null", () => {
  assert.equal(formatPct(12.37), "+12.4%");
  assert.equal(formatPct(-3), "-3%");
  assert.equal(formatPct(null), "");
  assert.equal(formatPct(undefined), "");
  assert.equal(formatPct(NaN), "");
});

test("recordWinPct counts only decided W/L, null when none", () => {
  assert.equal(recordWinPct(rec()), null); // nothing decided
  assert.equal(recordWinPct(rec({ pushes: 2, pending: 3 })), null); // no W/L
  assert.equal(recordWinPct(rec({ wins: 7, losses: 3 })), 70);
  assert.equal(recordWinPct(rec({ wins: 1, losses: 2, pushes: 5 })), 33.3);
});

test("recordLabel shows push only when present", () => {
  assert.equal(recordLabel(rec({ wins: 7, losses: 3 })), "7-3");
  assert.equal(recordLabel(rec({ wins: 7, losses: 3, pushes: 1 })), "7-3-1");
});

test("americanToDecimal", () => {
  assert.equal(americanToDecimal(100), 2);
  assert.equal(americanToDecimal(-100), 2);
  assert.equal(americanToDecimal(650), 7.5);
});
