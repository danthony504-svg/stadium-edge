/**
 * Per-market NCAAF P0 gates — P3 independence on the product path.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BLOCKED_UNVALIDATED_MARKET_REASON,
  classifyNcaafMarketFamily,
  isNcaafMarketProductValidated,
  isP0UnvalidatedNcaafGameLineMarket,
  isP0UnvalidatedSimTotalMarket,
  NCAAF_GAME_LINE_SIM_VALIDATED,
  NCAAF_MARKET_SIM_VALIDATED,
  p0BlockedNcaafGameLineAskNote,
} from "./coachP0UnvalidatedTotals.ts";

test("product gates stay false per market", () => {
  assert.equal(NCAAF_GAME_LINE_SIM_VALIDATED, false);
  assert.equal(NCAAF_MARKET_SIM_VALIDATED.moneyline, false);
  assert.equal(NCAAF_MARKET_SIM_VALIDATED.spreads, false);
  assert.equal(isNcaafMarketProductValidated("moneyline"), false);
});

test("classifyNcaafMarketFamily separates ML / spreads / alts / totals", () => {
  assert.equal(classifyNcaafMarketFamily("h2h"), "moneyline");
  assert.equal(classifyNcaafMarketFamily("Moneyline"), "moneyline");
  assert.equal(classifyNcaafMarketFamily("spreads"), "spreads");
  assert.equal(classifyNcaafMarketFamily("alt_spreads"), "alts");
  assert.equal(classifyNcaafMarketFamily("alternate spreads"), "alts");
  assert.equal(classifyNcaafMarketFamily("totals"), "totals");
  assert.equal(classifyNcaafMarketFamily("alt totals"), "alts");
  assert.equal(classifyNcaafMarketFamily("player_pass_yds"), null);
});

test("P3: NCAAF ML blocked independently of spreads identity", () => {
  assert.equal(
    isP0UnvalidatedNcaafGameLineMarket({
      sport: "ncaaf",
      market: "h2h",
    }),
    true,
  );
  assert.equal(
    isP0UnvalidatedNcaafGameLineMarket({
      sport: "ncaaf",
      market: "spreads",
    }),
    true,
  );
  assert.equal(
    isP0UnvalidatedNcaafGameLineMarket({
      sport: "ncaaf",
      market: "alternate_spreads",
    }),
    true,
  );
});

test("NCAAF totals blocked on totals family gate", () => {
  assert.equal(
    isP0UnvalidatedSimTotalMarket({
      sport: "ncaaf",
      market: "totals",
    }),
    true,
  );
});

test("blocked ask note is short unavailable copy", () => {
  assert.equal(
    p0BlockedNcaafGameLineAskNote(8),
    "College football team picks are temporarily unavailable while validation is completed. No ticket was built.",
  );
  assert.equal(BLOCKED_UNVALIDATED_MARKET_REASON, "blocked_unvalidated_market");
});

test("NFL game lines not affected by NCAAF per-market gates", () => {
  assert.equal(
    isP0UnvalidatedNcaafGameLineMarket({
      sport: "nfl",
      market: "spreads",
    }),
    false,
  );
});
