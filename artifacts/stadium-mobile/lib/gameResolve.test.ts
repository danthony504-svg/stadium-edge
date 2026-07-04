import assert from "node:assert/strict";
import test from "node:test";

import {
  findOddsByTeams,
  gameNickKey,
  oddsGameFromEspnOdds,
  oddsGameFromEspnShell,
} from "./gameResolve.ts";
import type { EspnGame, OddsGame } from "./api.ts";

test("gameNickKey matches on team nicknames", () => {
  assert.equal(gameNickKey("Minnesota Twins", "New York Yankees"), "twins|yankees");
  assert.equal(
    findOddsByTeams(
      [
        {
          id: "odds-1",
          sport: "mlb",
          awayTeam: "Minnesota Twins",
          homeTeam: "New York Yankees",
          commenceTime: "2026-07-04T17:05:00Z",
          markets: [],
        },
      ],
      "Minnesota Twins",
      "New York Yankees",
    )?.id,
    "odds-1",
  );
});

test("oddsGameFromEspnOdds builds markets from pickcenter snapshot", () => {
  const espn: EspnGame = {
    id: "401234567",
    sport: "mlb",
    name: "Twins @ Yankees",
    shortName: "MIN @ NYY",
    status: "In Progress",
    startsAt: "2026-07-04T17:05:00Z",
    homeTeam: "New York Yankees",
    awayTeam: "Minnesota Twins",
    state: "in",
  };
  const game = oddsGameFromEspnOdds("mlb", espn, {
    homeTeam: "New York Yankees",
    awayTeam: "Minnesota Twins",
    moneyline: { home: -150, away: 130 },
    spread: { homeLine: -1.5, awayLine: 1.5, homePrice: -110, awayPrice: -110 },
    total: { line: 8.5, over: -105, under: -115 },
  });
  assert.ok(game);
  assert.equal(game?.id, "401234567");
  assert.equal(game?.markets.length, 3);
});

test("oddsGameFromEspnShell keeps live games visible without lines", () => {
  const espn: EspnGame = {
    id: "401234567",
    sport: "mlb",
    name: "Twins @ Yankees",
    shortName: "MIN @ NYY",
    status: "In Progress",
    startsAt: "2026-07-04T17:05:00Z",
    homeTeam: "New York Yankees",
    awayTeam: "Minnesota Twins",
    awayScore: 3,
    homeScore: 0,
    state: "in",
  };
  const game = oddsGameFromEspnShell("mlb", espn);
  assert.ok(game);
  assert.equal(game?.markets.length, 0);
});
