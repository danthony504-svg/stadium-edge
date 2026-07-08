import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExcludedPropFamilies,
  isPropExcluded,
  filterExcludedProps,
  filterExcludedPropPool,
  exclusionNote,
} from "./propMarketExclusions.ts";

test("parseExcludedPropFamilies: single and combined bans", () => {
  assert.deepEqual([...parseExcludedPropFamilies("no home runs")], ["home runs"]);
  assert.deepEqual([...parseExcludedPropFamilies("without stolen bases")], ["stolen bases"]);
  const both = parseExcludedPropFamilies("5 mlb player props no home runs or stolen bases");
  assert.ok(both.has("home runs"));
  assert.ok(both.has("stolen bases"));
});

test("isPropExcluded: home runs and stolen bases by market key", () => {
  const excluded = parseExcludedPropFamilies("no home runs or stolen bases");
  assert.equal(
    isPropExcluded({ isProp: true, propMarketKey: "batter_home_runs" }, excluded),
    true,
  );
  assert.equal(
    isPropExcluded({ isProp: true, propMarketKey: "batter_stolen_bases" }, excluded),
    true,
  );
  assert.equal(
    isPropExcluded({ isProp: true, propMarketKey: "pitcher_strikeouts" }, excluded),
    false,
  );
});

test("filterExcludedProps drops banned legs from parsed picks", () => {
  const excluded = parseExcludedPropFamilies("no home runs");
  const picks = [
    { isProp: true, propMarketKey: "batter_home_runs", market: "Home Runs", pick: "Over 0.5" },
    { isProp: true, propMarketKey: "pitcher_strikeouts", market: "Strikeouts", pick: "Over 5.5" },
  ];
  const kept = filterExcludedProps(picks, excluded);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.propMarketKey, "pitcher_strikeouts");
});

test("filterExcludedPropPool removes banned markets from the prop pool", () => {
  const excluded = parseExcludedPropFamilies("no stolen bases");
  const pool = filterExcludedPropPool(
    [
      {
        game: "A @ B",
        marketLabel: "Stolen Bases",
        marketKey: "batter_stolen_bases",
        player: "Player",
        line: 0.5,
        side: "Over",
        odds: 500,
      },
      {
        game: "A @ B",
        marketLabel: "Hits",
        marketKey: "batter_hits",
        player: "Player",
        line: 1.5,
        side: "Over",
        odds: -110,
      },
    ],
    excluded,
  );
  assert.equal(pool.length, 1);
  assert.equal(pool[0]!.marketKey, "batter_hits");
});

test("exclusionNote summarizes banned families", () => {
  const note = exclusionNote(parseExcludedPropFamilies("no home runs or stolen bases"));
  assert.match(note, /Home Runs/i);
  assert.match(note, /Stolen Bases/i);
});
