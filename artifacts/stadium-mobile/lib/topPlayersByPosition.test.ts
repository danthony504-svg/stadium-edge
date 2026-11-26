import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerProp, PropSimulationResult } from "./api";
import { positionRankingCandidates, topPlayersByPosition } from "./topPlayersByPosition";

function postedProp(player: string, position: string | null, market: string, line: number): PlayerProp {
  return {
    player, position, market, line, athleteId: player,
    playerTeamId: "team", headshot: null, overPrice: -110, underPrice: -110, alt: false,
  };
}

function simulation(prop: PlayerProp, over: number, under: number): PropSimulationResult {
  const { player, market, line } = prop;
  return {
    key: `${player}|${market}|${line}|Over`,
    player, market, line: line!, side: "Over", hitProbability: over, sampleGames: 8, simulations: 2000,
    mostLikelyLine: null, meanProjection: null, medianProjection: null,
    confidenceScore: null, stdDev: null, percentiles: null,
    lineHitRatesBySide: { Over: { [line!]: over }, Under: { [line!]: under } },
  };
}

test("ranks two distinct players per position by the highest simulated posted side", () => {
  const adams = postedProp("Adams", "PG", "player_points", 26.5);
  const baker = postedProp("Baker", " pg ", "player_points", 20.5);
  const bakerAssists = postedProp("Baker", "PG", "player_assists", 8.5);
  const carter = postedProp("Carter", "PG", "player_points", 24.5);
  const diaz = postedProp("Diaz", "C", "player_rebounds", 10.5);
  const props = [adams, baker, bakerAssists, carter, diaz];
  const groups = topPlayersByPosition([{
    game: "Game",
    candidates: positionRankingCandidates(props),
    simulations: [
      simulation(adams, 0.56, 0.44), simulation(baker, 0.33, 0.67),
      simulation(bakerAssists, 0.12, 0.81), simulation(carter, 0.58, 0.42),
      simulation(diaz, 0.64, 0.36),
    ],
  }]);
  assert.deepEqual(groups.map(({ position, players }) => [
    position, players.map(({ prop, side, probability }) => [prop.player, prop.market, side, probability]),
  ]), [
    ["C", [["Diaz", "player_rebounds", "Over", 0.64]]],
    ["PG", [["Baker", "player_assists", "Under", 0.81], ["Carter", "player_points", "Over", 0.58]]],
  ]);
});

test("excludes unposted sides, alternates, unknown positions, and simulations from other games", () => {
  const overOnly = { ...postedProp("Adams", "QB", "player_pass_yds", 244.5), underPrice: null };
  const noHistory = postedProp("Baker", "QB", "player_pass_yds", 268.5);
  const alt = { ...postedProp("Carter", "QB", "player_pass_yds", 50.5), alt: true };
  const unknown = postedProp("Diaz", null, "player_pass_yds", 200.5);
  const candidates = positionRankingCandidates([overOnly, noHistory, alt, unknown]);
  assert.deepEqual(candidates.map(({ prop }) => prop.player), ["Adams", "Baker"]);

  const groups = topPlayersByPosition([
    { game: "First game", candidates, simulations: [simulation(overOnly, 0.2, 0.8)] },
    { game: "Second game", candidates: [], simulations: [simulation(noHistory, 0.7, 0.3)] },
  ]);
  assert.deepEqual(groups[0]?.players.map(({ game, prop, side, probability }) => [game, prop.player, side, probability]), [
    ["First game", "Adams", "Over", 0.2],
  ]);
});
