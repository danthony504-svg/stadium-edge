import assert from "node:assert/strict";
import test from "node:test";

import {
  footballRushDefenseTilt,
  isFootballRushYardsMarket,
  shouldBlockRushOverVsDefense,
} from "./footballRushDefense.ts";
import { opponentTeamIdForProp } from "./footballOppTeamId.ts";
import { buildCoachGameTeamIdMap } from "./coachTeamIdResolve.ts";
import { buildPropHolisticScore } from "./propHolisticRecommendation.ts";

test("isFootballRushYardsMarket matches rush yards keys", () => {
  assert.equal(isFootballRushYardsMarket("player_rush_yds"), true);
  assert.equal(isFootballRushYardsMarket("Player Rush Yds"), true);
  assert.equal(isFootballRushYardsMarket("rushing_yards"), true);
  assert.equal(isFootballRushYardsMarket("player_rush_tds"), false);
  assert.equal(isFootballRushYardsMarket("player_reception_yds"), false);
});

test("stingy Eagles-like run D hard-blocks rush OVER (Monangai case)", () => {
  const eagles = {
    rushingYardsAllowedPerGame: 88.4,
    yardsPerRushAllowed: 3.4,
    sampleSize: 4,
    teamName: "Eagles",
  };
  assert.equal(
    shouldBlockRushOverVsDefense({
      market: "player_rush_yds",
      side: "Over",
      defense: eagles,
    }),
    true,
  );
  const over = footballRushDefenseTilt({
    market: "player_rush_yds",
    side: "Over",
    defense: eagles,
  });
  assert.ok(over.tilt <= -0.8);
  assert.ok(over.display?.includes("88.4"));

  const under = footballRushDefenseTilt({
    market: "player_rush_yds",
    side: "Under",
    defense: eagles,
  });
  assert.equal(under.blockOver, false);
  assert.ok(under.tilt > 0);
});

test("soft stingy band demotes Over without hard block", () => {
  const soft = {
    rushingYardsAllowedPerGame: 100,
    yardsPerRushAllowed: 4.0,
    sampleSize: 3,
  };
  assert.equal(
    shouldBlockRushOverVsDefense({
      market: "player_rush_yds",
      side: "Over",
      defense: soft,
    }),
    false,
  );
  const tilt = footballRushDefenseTilt({
    market: "player_rush_yds",
    side: "Over",
    defense: soft,
  });
  assert.ok(tilt.tilt < 0);
});

test("fail closed when sample thin or yards missing", () => {
  assert.equal(
    shouldBlockRushOverVsDefense({
      market: "player_rush_yds",
      side: "Over",
      defense: {
        rushingYardsAllowedPerGame: 70,
        yardsPerRushAllowed: 3.0,
        sampleSize: 1,
      },
    }),
    false,
  );
  assert.equal(
    footballRushDefenseTilt({
      market: "player_rush_yds",
      side: "Over",
      defense: {
        rushingYardsAllowedPerGame: null,
        yardsPerRushAllowed: null,
        sampleSize: 5,
      },
    }).tilt,
    0,
  );
});

test("opponentTeamIdForProp resolves CHI → PHI for Bears @ Eagles", () => {
  const games = [
    {
      id: "1",
      sport: "nfl",
      name: "Bears at Eagles",
      shortName: "CHI @ PHI",
      status: "pre",
      startsAt: "2026-09-29T00:00:00Z",
      homeTeam: "Philadelphia Eagles",
      awayTeam: "Chicago Bears",
      homeTeamId: "21",
      awayTeamId: "3",
      homeAbbr: "PHI",
      awayAbbr: "CHI",
    },
  ];
  const map = buildCoachGameTeamIdMap(games);
  assert.equal(
    opponentTeamIdForProp({
      sport: "nfl",
      game: "Chicago Bears @ Philadelphia Eagles",
      teamAbbr: "CHI",
      espnGames: games,
      teamIdMap: map,
    }),
    "21",
  );
  assert.equal(
    opponentTeamIdForProp({
      sport: "nfl",
      game: "Chicago Bears @ Philadelphia Eagles",
      teamAbbr: "PHI",
      espnGames: games,
      teamIdMap: map,
    }),
    "3",
  );
});

test("prop holistic opponentTendency uses rush defense for NFL rush Over", () => {
  const score = buildPropHolisticScore({
    sport: "nfl",
    marketKey: "player_rush_yds",
    propSide: "Over",
    rubricScores: {
      matchup: null,
      trend: 6,
      lineValue: 6,
      injury: null,
      lineShopping: 5.5,
      simulation: 6,
    },
    edgePct: 4,
    simHit: 0.55,
    rushDefense: {
      rushingYardsAllowedPerGame: 85,
      yardsPerRushAllowed: 3.3,
      sampleSize: 5,
      teamName: "Eagles",
    },
  });
  const opp = score.factors.find((f) => f.key === "opponentTendency");
  assert.ok(opp?.present);
  assert.ok((opp?.score ?? 10) < 5);
  assert.ok(opp?.display?.includes("Eagles"));
});
