import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boxStatIndices,
  nhlSampleDays,
  parseToiSeconds,
} from "../eval/nhlEspnShared.js";

describe("nhlEspnShared boxscore / calendar helpers", () => {
  it("maps ESPN skater shotsTotal as SOG (legacy sog|shots regex misses)", () => {
    const keys = [
      "blockedShots",
      "hits",
      "takeaways",
      "plusMinus",
      "timeOnIce",
      "powerPlayTimeOnIce",
      "shortHandedTimeOnIce",
      "evenStrengthTimeOnIce",
      "shifts",
      "goals",
      "ytdGoals",
      "assists",
      "shotsTotal",
      "shotsMissed",
      "shootoutGoals",
    ];
    const legacy = keys.findIndex((k) => /^(sog|shots?)$/i.test(k));
    assert.equal(legacy, -1, "legacy regex must miss shotsTotal");
    const idx = boxStatIndices(keys);
    assert.equal(idx.goals, 9);
    assert.equal(idx.sog, 12);
    assert.equal(keys[idx.sog], "shotsTotal");
    assert.equal(idx.isGoalieGrp, false);
  });

  it("maps goalie saves group without treating goalsAgainst as goals", () => {
    const keys = [
      "goalsAgainst",
      "shotsAgainst",
      "shootoutSaves",
      "shootoutShotsAgainst",
      "saves",
      "savePct",
      "evenStrengthSaves",
      "powerPlaySaves",
      "shortHandedSaves",
      "timeOnIce",
      "ytdGoals",
      "penaltyMinutes",
    ];
    const idx = boxStatIndices(keys);
    assert.equal(idx.goals, -1);
    assert.equal(idx.saves, 4);
    assert.equal(idx.isGoalieGrp, true);
  });

  it("parses MM:SS TOI and densifies sample days vs step=2", () => {
    assert.equal(parseToiSeconds("18:08"), 18 * 60 + 8);
    assert.equal(parseToiSeconds("bad"), null);
    const dense = nhlSampleDays(2024, 1);
    const sparse = nhlSampleDays(2024, 2);
    assert.ok(dense.length > sparse.length);
    assert.ok(dense.includes("20241012"));
    assert.ok(dense.includes("20250315"));
  });
});
