import assert from "node:assert/strict";
import test from "node:test";
import { resolveNbaOpeningScore, type NbaOpeningSummary } from "../src/lib/nbaOpeningScore.ts";
import { isScoringOrderMarket } from "../src/lib/propStatValue.ts";

const summary: NbaOpeningSummary = {
  header: {
    id: "123",
    competitions: [{
      id: "123",
      status: { type: { completed: true, name: "STATUS_FINAL" } },
      competitors: [{ id: "1", homeAway: "home" }, { id: "2", homeAway: "away" }],
    }],
  },
  plays: [
    { id: "a", sequenceNumber: "8", period: { number: 1 }, clock: { displayValue: "12:00" }, homeScore: 0, awayScore: 0 },
    { id: "b", sequenceNumber: "9", period: { number: 1 }, scoringPlay: true, scoreValue: 1, team: { id: "1" }, homeScore: 1, awayScore: 0 },
    { id: "c", sequenceNumber: "10", period: { number: 1 }, scoringPlay: true, scoreValue: 3, team: { id: "2" }, homeScore: 1, awayScore: 3, participants: [{ athlete: { id: "20" } }, { athlete: { id: "21" } }] },
  ],
};

test("team first points can differ from the player and team of the first field goal", () => {
  const result = resolveNbaOpeningScore({ ...summary, plays: [...summary.plays!].reverse() }, "123");
  assert.equal(result?.firstPoints.teamId, "1");
  assert.equal(result?.firstMadeFieldGoal.teamId, "2");
  assert.equal(result?.firstMadeFieldGoal.playerId, "20");
});

test("unbound, truncated, or inconsistent play-by-play cannot settle opening markets", () => {
  assert.equal(resolveNbaOpeningScore(summary, "124"), null);
  assert.equal(resolveNbaOpeningScore({ ...summary, plays: summary.plays!.slice(1) }, "123"), null);
  const plays = structuredClone(summary.plays!);
  plays[1]!.awayScore = 1;
  assert.equal(resolveNbaOpeningScore({ ...summary, plays }, "123"), null);
});

test("first basket cannot use the generic full-game stat projection", () => {
  assert.equal(isScoringOrderMarket("player_first_basket"), true);
  assert.equal(isScoringOrderMarket("player_first_basket_scorer_alternate"), true);
  assert.equal(isScoringOrderMarket("player_points"), false);
});
