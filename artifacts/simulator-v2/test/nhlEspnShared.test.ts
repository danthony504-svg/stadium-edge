import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boxStatIndices,
  detectNhlBoxColumnMode,
  nhlSampleDays,
  parseToiSeconds,
} from "../eval/nhlEspnShared.js";

const SKATER_KEYS = [
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

const SKATER_LABELS = [
  "BS",
  "HT",
  "TK",
  "+/-",
  "TOI",
  "PPTOI",
  "SHTOI",
  "ESTOI",
  "SHFT",
  "G",
  "YTDG",
  "A",
  "S",
  "SM",
  "SOG",
];

const GOALIE_KEYS = [
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

const GOALIE_LABELS = [
  "GA",
  "SA",
  "SOS",
  "SOSA",
  "SV",
  "SV%",
  "ESSV",
  "PPSV",
  "SHSV",
  "TOI",
  "YTDG",
  "PIM",
];

describe("nhlEspnShared boxscore / calendar helpers", () => {
  it("maps ESPN skater machine keys (shotsTotal SOG, assists, plusMinus)", () => {
    assert.equal(detectNhlBoxColumnMode(SKATER_KEYS), "keys");
    const legacy = SKATER_KEYS.findIndex((k) => /^(sog|shots?)$/i.test(k));
    assert.equal(legacy, -1, "legacy regex must miss shotsTotal");
    const idx = boxStatIndices(SKATER_KEYS);
    assert.equal(idx.columnMode, "keys");
    assert.equal(idx.goals, 9);
    assert.equal(idx.assists, 11);
    assert.equal(idx.plusMinus, 3);
    assert.equal(idx.sog, 12);
    assert.equal(SKATER_KEYS[idx.sog], "shotsTotal");
    assert.notEqual(SKATER_KEYS[idx.sog], "shootoutGoals");
    assert.equal(idx.points, -1, "ESPN omits points column on skater keys");
    assert.equal(idx.isGoalieGrp, false);
  });

  it("maps skater labels without treating SOG label as shots", () => {
    assert.equal(detectNhlBoxColumnMode(SKATER_LABELS), "labels");
    const idx = boxStatIndices(SKATER_LABELS);
    assert.equal(idx.columnMode, "labels");
    assert.equal(idx.goals, 9);
    assert.equal(idx.assists, 11);
    assert.equal(idx.plusMinus, 3);
    assert.equal(idx.sog, 12);
    assert.equal(SKATER_LABELS[idx.sog], "S");
    assert.notEqual(SKATER_LABELS[idx.sog], "SOG");
    assert.equal(idx.isGoalieGrp, false);
  });

  it("maps goalie keys/labels without goalsAgainst→goals or shootoutSaves→saves", () => {
    const byKeys = boxStatIndices(GOALIE_KEYS);
    assert.equal(byKeys.goals, -1);
    assert.equal(byKeys.saves, 4);
    assert.equal(GOALIE_KEYS[byKeys.saves], "saves");
    assert.equal(byKeys.isGoalieGrp, true);

    const byLabels = boxStatIndices(GOALIE_LABELS);
    assert.equal(byLabels.goals, -1);
    assert.equal(byLabels.saves, 4);
    assert.equal(GOALIE_LABELS[byLabels.saves], "SV");
    assert.equal(byLabels.isGoalieGrp, true);
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
