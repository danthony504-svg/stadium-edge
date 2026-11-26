import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerProp } from "./api";
import { topPlayersByPosition } from "./topPlayersByPosition";

function postedProp(player: string, position: string | null, market: string, line: number): PlayerProp {
  return {
    player,
    position,
    market,
    line,
    athleteId: player,
    playerTeamId: "team",
    headshot: null,
    overPrice: -110,
    underPrice: -110,
    alt: false,
  };
}

test("ranks unique athletes with verified positions by the number of distinct main markets", () => {
  const points = postedProp("Baker", " pg ", "player_points", 20.5);
  const board = { props: [
    postedProp("Adams", "PG", "player_points", 26.5),
    points,
    points,
    postedProp("Baker", "PG", "player_assists", 8.5),
    postedProp("Carter", "PG", "player_points", 24.5),
    postedProp("Diaz", "C", "player_points", 18.5),
    postedProp("Evans", null, "player_points", 32.5),
    { ...postedProp("Foster", "PG", "player_points", 40.5), alt: true },
  ] };
  const groups = topPlayersByPosition([{ props: [points] }, board], null);
  assert.deepEqual(groups.map(({ position, players }) => [position, players.map(({ prop }) => prop.player)]), [
    ["C", ["Diaz"]],
    ["PG", ["Baker", "Adams"]],
  ]);
  assert.equal(groups[1]?.players[0]?.marketCount, 2);
  assert.equal(groups[1]?.players[0]?.game, board);
});

test("a market filter ranks exact posted lines within each position and opens that market's prop", () => {
  const passingYards = "player_pass_yds";
  const highestPassingLine = postedProp("Baker", "QB", passingYards, 268.5);
  const groups = topPlayersByPosition([{ props: [
    postedProp("Adams", "QB", passingYards, 244.5),
    postedProp("Baker", "QB", "player_rush_yds", 12.5),
    highestPassingLine,
    postedProp("Carter", "RB", "player_rush_yds", 55.5),
  ] }], passingYards);
  assert.deepEqual(groups.map(({ position, players }) => [position, players.map(({ prop }) => prop.player)]), [
    ["QB", ["Baker", "Adams"]],
  ]);
  assert.equal(groups[0]?.players[0]?.prop, highestPassingLine);
});
