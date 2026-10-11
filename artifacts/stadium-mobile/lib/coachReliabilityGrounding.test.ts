import assert from "node:assert/strict";
import { test } from "node:test";

import {
  affectedGameFromPicks,
  evaluateReturnedPicksGrounding,
  pickHasPlayerGameGroundingMismatch,
} from "./coachReliabilityGrounding.ts";

test("Kyler Murray on Vikings @ Saints is a player/game grounding mismatch", () => {
  const pick = {
    game: "Minnesota Vikings @ New Orleans Saints",
    player: "Kyler Murray",
    teamAbbr: "ARI",
    isProp: true,
    market: "Pass TDs",
    propMarketKey: "player_pass_tds",
  };
  assert.equal(pickHasPlayerGameGroundingMismatch(pick), true);
  const g = evaluateReturnedPicksGrounding([pick]);
  assert.equal(g.hasMismatch, true);
  assert.equal(g.affectedGame, "Minnesota Vikings @ New Orleans Saints");
});

test("player prop with matching teamAbbr passes grounding", () => {
  const pick = {
    game: "Arizona Cardinals @ New Orleans Saints",
    player: "Kyler Murray",
    teamAbbr: "ARI",
    isProp: true,
    market: "Pass TDs",
  };
  // ARI may not nick-match "Arizona Cardinals" via MLB map — use clear NFL nick path.
  // resolvePropPlayerSides uses compact.includes(abbr) — "arizonacardinals".includes("ari") true.
  assert.equal(pickHasPlayerGameGroundingMismatch(pick), false);
});

test("game-line picks are not treated as player/game mismatches", () => {
  const pick = {
    game: "Minnesota Vikings @ New Orleans Saints",
    market: "Moneyline",
    teamAbbr: "NO",
    isProp: false,
  };
  assert.equal(pickHasPlayerGameGroundingMismatch(pick), false);
  assert.equal(evaluateReturnedPicksGrounding([pick]).hasMismatch, false);
});

test("affectedGameFromPicks prefers mismatch game then first game", () => {
  assert.equal(
    affectedGameFromPicks([
      {
        // Grounded: NO resolves onto New Orleans Saints.
        game: "Minnesota Vikings @ New Orleans Saints",
        teamAbbr: "NO",
        isProp: true,
        player: "Alvin Kamara",
        market: "Rush Yds",
      },
      {
        game: "Arizona Cardinals @ Seattle Seahawks",
        teamAbbr: "MIN",
        isProp: true,
        player: "Wrong Player",
        market: "Pass TDs",
      },
    ]),
    "Arizona Cardinals @ Seattle Seahawks",
  );
  assert.equal(
    affectedGameFromPicks([
      { game: "Away @ Home", market: "Spread", isProp: false },
    ]),
    "Away @ Home",
  );
});
