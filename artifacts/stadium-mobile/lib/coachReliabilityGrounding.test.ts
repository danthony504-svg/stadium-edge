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

test("teamAbbr present + game missing => no mismatch", () => {
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      teamAbbr: "ARI",
      player: "Kyler Murray",
      isProp: true,
      market: "Pass TDs",
    }),
    false,
  );
});

test("teamAbbr present + game empty => no mismatch", () => {
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "",
      teamAbbr: "ARI",
      player: "Kyler Murray",
      isProp: true,
      market: "Pass TDs",
    }),
    false,
  );
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "   ",
      teamAbbr: "ARI",
      player: "Kyler Murray",
      isProp: true,
      market: "Pass TDs",
    }),
    false,
  );
});

test("teamAbbr present + malformed game string => no mismatch", () => {
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Saints",
      teamAbbr: "NO",
      player: "Alvin Kamara",
      isProp: true,
      market: "Rush Yds",
    }),
    false,
  );
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Vikings vs Saints",
      teamAbbr: "MIN",
      player: "JJ McCarthy",
      isProp: true,
      market: "Pass Yds",
    }),
    false,
  );
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Minnesota Vikings @",
      teamAbbr: "MIN",
      isProp: true,
      player: "X",
      market: "Pass Yds",
    }),
    false,
  );
});

test("valid parse + team matches away => no mismatch", () => {
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Minnesota Vikings @ New Orleans Saints",
      teamAbbr: "MIN",
      player: "Justin Jefferson",
      isProp: true,
      market: "Rec Yds",
    }),
    false,
  );
});

test("valid parse + team matches home => no mismatch", () => {
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Minnesota Vikings @ New Orleans Saints",
      teamAbbr: "NO",
      player: "Alvin Kamara",
      isProp: true,
      market: "Rush Yds",
    }),
    false,
  );
});

test("valid parse + team matches neither => mismatch", () => {
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Minnesota Vikings @ New Orleans Saints",
      teamAbbr: "ARI",
      player: "Kyler Murray",
      isProp: true,
      market: "Pass TDs",
      propMarketKey: "player_pass_tds",
    }),
    true,
  );
});

test("MLB Rays @ Guardians TB/CLE/TBR are grounded (greenfield false-positive fix)", () => {
  for (const teamAbbr of ["TB", "CLE", "TBR"] as const) {
    assert.equal(
      pickHasPlayerGameGroundingMismatch({
        game: "Rays @ Guardians",
        teamAbbr,
        player: "Junior Caminero",
        isProp: true,
        market: "Hits",
        propMarketKey: "batter_hits",
        sport: "mlb",
      }),
      false,
      `expected ${teamAbbr} grounded on Rays @ Guardians`,
    );
  }
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Tampa Bay Rays @ Cleveland Guardians",
      teamAbbr: "TBR",
      player: "Jose Ramirez",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    }),
    false,
  );
});

test("full 6/6 ticket still alerts when one leg is a real MLB mismatch", () => {
  const picks = [
    {
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "A",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    },
    {
      game: "Rays @ Guardians",
      teamAbbr: "CLE",
      player: "B",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    },
    {
      game: "Rays @ Guardians",
      teamAbbr: "NYY",
      player: "Aaron Judge",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    },
    {
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "C",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    },
    {
      game: "Rays @ Guardians",
      teamAbbr: "CLE",
      player: "D",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    },
    {
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "E",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    },
  ];
  const g = evaluateReturnedPicksGrounding(picks);
  assert.equal(g.hasMismatch, true);
  assert.equal(g.mismatchCount, 1);
  assert.equal(g.affectedGame, "Rays @ Guardians");
});

test("NFL Tampa Bay Buccaneers TB grounds; MLB sport does not treat Bucs as Rays", () => {
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Tampa Bay Buccaneers @ Atlanta Falcons",
      teamAbbr: "TB",
      player: "Baker Mayfield",
      isProp: true,
      market: "Pass Yds",
      propMarketKey: "player_pass_yds",
      sport: "nfl",
    }),
    false,
  );
  // Explicit MLB sport: TB nick map is Rays-only — Buccaneers label is a mismatch.
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Tampa Bay Buccaneers @ Atlanta Falcons",
      teamAbbr: "TB",
      player: "Junior Caminero",
      isProp: true,
      market: "Hits",
      propMarketKey: "batter_hits",
      sport: "mlb",
    }),
    true,
  );
  // Legitimate Rays (TBR) stay grounded on MLB labels — never bucs-token path.
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Rays @ Guardians",
      teamAbbr: "TBR",
      player: "Junior Caminero",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    }),
    false,
  );
});

test("legitimate doubleheader labels both ground TB/CLE (startsAt is identity, not grounding)", () => {
  for (const game of [
    "Rays @ Guardians",
    "Tampa Bay Rays @ Cleveland Guardians",
  ] as const) {
    for (const teamAbbr of ["TB", "TBR", "CLE"] as const) {
      assert.equal(
        pickHasPlayerGameGroundingMismatch({
          game,
          teamAbbr,
          player: "DH Player",
          isProp: true,
          market: "Hits",
          sport: "mlb",
        }),
        false,
        `${teamAbbr} should ground on ${game}`,
      );
    }
  }
});

test("wrong-game athlete is a verified mismatch; unknown identity is not", () => {
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Rays @ Guardians",
      teamAbbr: "NYY",
      player: "Aaron Judge",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    }),
    true,
  );
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Rays @ Guardians",
      teamAbbr: "",
      player: "Mystery",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    }),
    false,
  );
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Rays @ Guardians",
      teamAbbr: null,
      player: "Mystery",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    }),
    false,
  );
});

test("formatting-only player name difference is not a grounding mismatch", () => {
  // Gate keys off teamAbbr ↔ game sides, not display-name spelling.
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "J. Caminero",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    }),
    false,
  );
  assert.equal(
    pickHasPlayerGameGroundingMismatch({
      game: "Tampa Bay Rays @ Cleveland Guardians",
      teamAbbr: "TBR",
      player: "Junior  Caminero",
      isProp: true,
      market: "Hits",
      sport: "mlb",
    }),
    false,
  );
});
