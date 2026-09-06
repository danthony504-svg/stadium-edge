import assert from "node:assert/strict";
import test from "node:test";
import { buildTeamCoachFactor } from "./teamCoachFactor.ts";

test("Team Coach rewards a grounded matchup lean aligned with the pick", () => {
  const factor = buildTeamCoachFactor(
    { game: "Away @ Home", market: "Run Line", pick: "Home -1.5", odds: 110, isProp: false },
    {
      home: null, away: null, homePace: null, awayPace: null, homeVenueForm: null, awayVenueForm: null,
      homeStreak: null, awayStreak: null, homeSeason: null, awaySeason: null, homeRest: null, awayRest: null,
      h2h: null, lastMeeting: null,
      mlLean: { side: "Home", edge: 8, reasons: ["Home +1.4 L10 margin"] },
    },
  );
  assert.ok((factor.score ?? 0) > 5.5);
  assert.match(factor.display ?? "", /Home/);
});

test("Team Coach fails closed without grounded matchup context", () => {
  assert.equal(
    buildTeamCoachFactor(
      { game: "Away @ Home", market: "Run Line", pick: "Home -1.5", odds: 110, isProp: false },
      null,
    ).score,
    null,
  );
});
