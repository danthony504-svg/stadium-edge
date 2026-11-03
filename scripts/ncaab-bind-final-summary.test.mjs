import test from "node:test";
import assert from "node:assert/strict";
import { ncaabSummaryFinal } from "./ncaab-bind-final-summary.mjs";

function summaryFixture({
  eventId = "401851388",
  season = 2026,
  completed = true,
  homeScore = 72,
  awayScore = 80,
  homePeriods = [38, 34],
  awayPeriods = [38, 42],
  kickoff = "2026-03-15T19:30Z",
  homeId = "130",
  awayId = "2509",
  league = "mens-college-basketball",
} = {}) {
  const periodRows = (periods) =>
    periods.map((value, i) => ({ displayValue: String(value), period: i + 1 }));
  return JSON.stringify({
    header: {
      id: eventId,
      season: { year: season },
      league: { slug: league },
      competitions: [
        {
          date: kickoff,
          status: {
            type: {
              completed,
              state: completed ? "post" : "pre",
            },
          },
          competitors: [
            {
              homeAway: "home",
              score: String(homeScore),
              team: { id: homeId },
              linescores: periodRows(homePeriods),
            },
            {
              homeAway: "away",
              score: String(awayScore),
              team: { id: awayId },
              linescores: periodRows(awayPeriods),
            },
          ],
        },
      ],
    },
  });
}

test("ncaabSummaryFinal authenticates a regulation final", () => {
  const archive = ncaabSummaryFinal(
    summaryFixture(),
    "401851388",
    2026,
    "2026-03-15T22:00:00.000Z",
    "2026-03-15T22:00:01.000Z",
  );
  assert.equal(archive.games.length, 1);
  const game = archive.games[0];
  assert.equal(game.homePoints, 72);
  assert.equal(game.awayPoints, 80);
  assert.equal(game.regulationHomePoints, 72);
  assert.equal(game.overtime, false);
  assert.equal(game.ruleset, "full_game_including_overtime");
  assert.equal(game.source, "espn_mens_college_basketball_summary");
  assert.equal(archive.releaseEligible, false);
});

test("ncaabSummaryFinal keeps OT points in the full-game final", () => {
  const archive = ncaabSummaryFinal(
    summaryFixture({
      homeScore: 89,
      awayScore: 84,
      homePeriods: [29, 44, 16],
      awayPeriods: [31, 42, 11],
    }),
    "401851388",
    2026,
    "2026-03-15T22:00:00.000Z",
    "2026-03-15T22:00:01.000Z",
  );
  const game = archive.games[0];
  assert.equal(game.overtime, true);
  assert.equal(game.homePoints, 89);
  assert.equal(game.regulationHomePoints, 73);
  assert.equal(game.periodCount, 3);
});

test("ncaabSummaryFinal rejects incomplete, mismatched, or wrong-league payloads", () => {
  const started = "2026-03-15T22:00:00.000Z";
  const received = "2026-03-15T22:00:01.000Z";
  assert.throws(
    () =>
      ncaabSummaryFinal(
        summaryFixture({ completed: false }),
        "401851388",
        2026,
        started,
        received,
      ),
    /ncaab_summary_not_final/,
  );
  assert.throws(
    () =>
      ncaabSummaryFinal(
        summaryFixture({ homeScore: 70 }),
        "401851388",
        2026,
        started,
        received,
      ),
    /ncaab_summary_score_mismatch/,
  );
  assert.throws(
    () =>
      ncaabSummaryFinal(
        summaryFixture({ league: "college-football" }),
        "401851388",
        2026,
        started,
        received,
      ),
    /ncaab_summary_identity/,
  );
  assert.throws(
    () =>
      ncaabSummaryFinal(
        summaryFixture({ homePeriods: [72], awayPeriods: [80] }),
        "401851388",
        2026,
        started,
        received,
      ),
    /ncaab_summary_periods_missing/,
  );
});
