import assert from "node:assert/strict";
import test from "node:test";
import { alignPropPickGames } from "./propGameAlign.ts";

test("alignPropPickGames rewrites mismatched prop game from pool", () => {
  const picks = [
    {
      game: "Seattle Mariners @ Miami Marlins",
      market: "Total Bases",
      pick: "Josh Naylor Over 1.5 Total Bases",
      odds: 135,
      isProp: true,
      player: "Josh Naylor",
      propLine: 1.5,
      propSide: "Over",
      propMarketKey: "batter_total_bases",
      teamAbbr: "CLE",
    },
  ];
  const pool = [
    {
      sport: "baseball_mlb",
      game: "Cleveland Guardians @ Kansas City Royals",
      marketLabel: "Total Bases",
      player: "Josh Naylor",
      line: 1.5,
      side: "Over",
      odds: 135,
      teamAbbr: "CLE",
      marketKey: "batter_total_bases",
    },
  ];
  const out = alignPropPickGames(picks as any, pool as any);
  assert.equal(out[0]!.game, "Cleveland Guardians @ Kansas City Royals");
});

test("alignPropPickGames keeps pick when game already matches pool", () => {
  const game = "Cleveland Guardians @ Kansas City Royals";
  const picks = [
    {
      game,
      market: "Total Bases",
      pick: "Josh Naylor Over 1.5 Total Bases",
      odds: 135,
      isProp: true,
      player: "Josh Naylor",
      propLine: 1.5,
      propSide: "Over",
      propMarketKey: "batter_total_bases",
      teamAbbr: "CLE",
    },
  ];
  const pool = [
    {
      game,
      marketLabel: "Total Bases",
      player: "Josh Naylor",
      line: 1.5,
      side: "Over",
      odds: 135,
      teamAbbr: "CLE",
      marketKey: "batter_total_bases",
    },
  ];
  const out = alignPropPickGames(picks as any, pool as any);
  assert.equal(out[0]!.game, game);
});
