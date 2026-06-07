import { test } from "node:test";
import assert from "node:assert/strict";

import { isGameLevelMarket, parsePropLeg } from "./propLegParse.ts";

test("isGameLevelMarket flags moneyline / spread / total markets", () => {
  for (const m of ["Moneyline", "Spread", "Alt Spread", "Total", "Run Line", "Puck Line"]) {
    assert.equal(isGameLevelMarket(m), true, m);
  }
});

test("isGameLevelMarket flags period variants of game markets", () => {
  for (const m of ["Q1 Total", "1H Spread", "F5 Total", "1st Inning Total"]) {
    assert.equal(isGameLevelMarket(m), true, m);
  }
});

test("isGameLevelMarket does NOT flag the 'Total Bases' prop", () => {
  assert.equal(isGameLevelMarket("Total Bases"), false);
});

test("isGameLevelMarket does NOT flag player-prop markets", () => {
  for (const m of ["Strikeouts", "Hits", "Points", "Rebounds", "Anytime TD", "Shots on Goal"]) {
    assert.equal(isGameLevelMarket(m), false, m);
  }
});

test("parsePropLeg parses an Over prop with a multi-word player name", () => {
  const r = parsePropLeg({ market: "Strikeouts", pick: "Jameson Taillon Over 3.5 Strikeouts" });
  assert.deepEqual(r, { player: "Jameson Taillon", side: "Over", line: 3.5 });
});

test("parsePropLeg parses an Under prop and normalizes the side casing", () => {
  const r = parsePropLeg({ market: "Hits", pick: "Jung Hoo Lee under 0.5 Hits" });
  assert.deepEqual(r, { player: "Jung Hoo Lee", side: "Under", line: 0.5 });
});

test("parsePropLeg handles a yes/no prop with no line", () => {
  const r = parsePropLeg({ market: "Anytime TD", pick: "Aaron Judge Anytime TD" });
  assert.deepEqual(r, { player: "Aaron Judge", side: "Yes", line: null });
});

test("parsePropLeg handles a market label with regex-special chars", () => {
  const r = parsePropLeg({ market: "Pts+Reb+Ast", pick: "Nikola Jokic Over 39.5 Pts+Reb+Ast" });
  assert.deepEqual(r, { player: "Nikola Jokic", side: "Over", line: 39.5 });
});

test("parsePropLeg returns null when no player name survives", () => {
  assert.equal(parsePropLeg({ market: "Total", pick: "Over 8" }), null);
});
