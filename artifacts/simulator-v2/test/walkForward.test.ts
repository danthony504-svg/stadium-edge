import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTeamLogs,
  formBeforeKickoff,
  selectEligibleGames,
} from "../eval/walkForward.js";
import type { HistoricalGame } from "../eval/types.js";

function game(
  partial: Partial<HistoricalGame> & Pick<HistoricalGame, "eventId" | "kickoffIso" | "homeTeamId" | "awayTeamId">,
): HistoricalGame {
  return {
    sport: "nfl",
    season: 2024,
    week: 1,
    seasonType: 2,
    homeName: "Home",
    awayName: "Away",
    homeFg: 24,
    awayFg: 17,
    homeQuarters: [7, 7, 3, 7],
    awayQuarters: [0, 7, 3, 7],
    hadOt: false,
    source: "espn_scoreboard",
    ...partial,
  };
}

describe("walk-forward leakage control", () => {
  it("excludes same-kickoff and future games from team form", () => {
    const games = [
      game({
        eventId: "1",
        kickoffIso: "2024-09-08T17:00:00Z",
        homeTeamId: "A",
        awayTeamId: "B",
        homeFg: 20,
        awayFg: 10,
        homeQuarters: [3, 7, 3, 7],
        awayQuarters: [0, 3, 0, 7],
      }),
      game({
        eventId: "2",
        kickoffIso: "2024-09-15T17:00:00Z",
        homeTeamId: "A",
        awayTeamId: "C",
        homeFg: 27,
        awayFg: 14,
      }),
      game({
        eventId: "3",
        kickoffIso: "2024-09-22T17:00:00Z",
        homeTeamId: "A",
        awayTeamId: "D",
        homeFg: 31,
        awayFg: 28,
      }),
      game({
        eventId: "4",
        kickoffIso: "2024-09-29T17:00:00Z",
        homeTeamId: "A",
        awayTeamId: "E",
        homeFg: 17,
        awayFg: 21,
      }),
      game({
        eventId: "5",
        kickoffIso: "2024-10-06T17:00:00Z",
        homeTeamId: "A",
        awayTeamId: "F",
        homeFg: 24,
        awayFg: 20,
      }),
    ];
    const logs = buildTeamLogs(games);
    const kickoffMs = new Date("2024-10-06T17:00:00Z").getTime();
    const form = formBeforeKickoff(logs, "A", kickoffMs, { window: 4, minGames: 4 });
    assert.ok(form);
    assert.equal(form!.gamesUsed, 4);
    // Must not include game 5 (same kickoff / future).
    assert.deepEqual(form!.recentFgScores, [20, 27, 31, 17]);
  });

  it("skips cold-start games lacking min prior history", () => {
    const games = [
      game({
        eventId: "a",
        kickoffIso: "2024-09-08T17:00:00Z",
        homeTeamId: "H",
        awayTeamId: "X",
      }),
      game({
        eventId: "b",
        kickoffIso: "2024-09-15T17:00:00Z",
        homeTeamId: "H",
        awayTeamId: "Y",
      }),
    ];
    const { eligible, skippedColdStart } = selectEligibleGames(games, {
      window: 4,
      minGames: 4,
    });
    assert.equal(eligible.length, 0);
    assert.equal(skippedColdStart, 2);
  });
});
