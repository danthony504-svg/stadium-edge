import assert from "node:assert/strict";
import test from "node:test";

import {
  footballRushDefenseTilt,
  isFootballRushYardsMarket,
  pickDefenseAwareAlt,
  shouldBlockRushOverVsDefense,
  shouldPreferDefenseAltPick,
} from "./footballRushDefense.ts";
import { opponentTeamIdForProp } from "./footballOppTeamId.ts";
import { buildCoachGameTeamIdMap } from "./coachTeamIdResolve.ts";
import { buildPropHolisticScore } from "./propHolisticRecommendation.ts";

test("stingy pass D hard-blocks pass OVER and demotes recv OVER", () => {
  const pack = {
    pass: {
      passingYardsAllowedPerGame: 165,
      yardsPerPassAllowed: 5.5,
      sampleSize: 4,
      teamName: "Eagles",
    },
    teamName: "Eagles",
  };
  assert.equal(
    shouldBlockRushOverVsDefense({
      market: "player_pass_yds",
      side: "Over",
      pack,
    }),
    true,
  );
  const recv = footballRushDefenseTilt({
    market: "player_reception_yds",
    side: "Over",
    pack,
  });
  assert.equal(recv.blockOver, true);
  assert.ok(recv.tilt < 0);
});

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

test("multiSportOppDefenseTilt soft-demotes NBA Over vs stingy pts allowed", async () => {
  const { multiSportOppDefenseTilt } = await import("./footballRushDefense.ts");
  const tilt = multiSportOppDefenseTilt({
    sport: "nba",
    market: "player_points",
    side: "Over",
    pack: { pointsAgainst: 104, teamName: "Celtics", blocks: 6.2 },
  });
  assert.ok(tilt.tilt < 0);
  assert.equal(tilt.blockOver, false);
  assert.ok(tilt.display?.includes("104"));
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

test("shouldPreferDefenseAltPick: soft stingy Over swaps even without hard block", () => {
  assert.equal(
    shouldPreferDefenseAltPick({
      sport: "nfl",
      market: "player_rush_yds",
      side: "Over",
      pack: {
        rush: {
          rushingYardsAllowedPerGame: 100,
          yardsPerRushAllowed: 4.0,
          sampleSize: 3,
        },
      },
    }),
    true,
  );
  assert.equal(
    shouldPreferDefenseAltPick({
      sport: "nba",
      market: "player_points",
      side: "Over",
      pack: { pointsAgainst: 104 },
    }),
    false,
  );
});

test("pickDefenseAwareAlt: Under first, then softer Over alt", () => {
  const over40 = {
    game: "CHI @ PHI",
    player: "Kyle Monangai",
    market: "player_rush_yds",
    propMarketKey: "player_rush_yds",
    propSide: "Over",
    propLine: 40.5,
  };
  const under40 = { ...over40, propSide: "Under" as const };
  const over24 = { ...over40, propLine: 24.5, propIsAlt: true };
  assert.equal(pickDefenseAwareAlt(over40, [over40, under40, over24]), under40);
  assert.equal(pickDefenseAwareAlt(over40, [over40, over24]), over24);
  assert.equal(pickDefenseAwareAlt(over40, [over40]), null);
});

test("multiSport market-aware: assists use steals, rebounds use dreb", async () => {
  const { multiSportOppDefenseTilt } = await import("./footballRushDefense.ts");
  const ast = multiSportOppDefenseTilt({
    sport: "nba",
    market: "player_assists",
    side: "Over",
    pack: { steals: 9.2, pointsAgainst: 112, teamName: "Thunder" },
  });
  assert.ok(ast.tilt < 0);
  assert.ok(ast.display?.includes("stl"));

  const reb = multiSportOppDefenseTilt({
    sport: "nba",
    market: "player_rebounds",
    side: "Over",
    pack: { defRebounds: 36, pointsAgainst: 112 },
  });
  assert.ok(reb.tilt < 0);

  const sog = multiSportOppDefenseTilt({
    sport: "nhl",
    market: "player_shots_on_goal",
    side: "Over",
    pack: { shotsAgainst: 34, savePct: 0.91 },
  });
  assert.ok(sog.tilt > 0);

  const mlbHit = multiSportOppDefenseTilt({
    sport: "mlb",
    market: "batter_hits",
    side: "Over",
    pack: { era: 3.1, whip: 1.05, teamName: "Braves" },
  });
  assert.ok(mlbHit.tilt < 0);
});

test("NHL elite SV%/GAA hard-blocks Goals/Points Overs like NFL stingy D", async () => {
  const {
    shouldBlockRushOverVsDefense,
    multiSportOppDefenseTilt,
    shouldDropPropMissingOppDefense,
    isNhlScoringMarket,
  } = await import("./footballRushDefense.ts");

  assert.equal(isNhlScoringMarket("player_goals"), true);
  assert.equal(isNhlScoringMarket("player_points"), true);
  assert.equal(isNhlScoringMarket("player_shots_on_goal"), false);

  const hotGoalie = { savePct: 0.922, goalsAgainstAvg: 2.35, teamName: "Jets" };
  assert.equal(
    shouldBlockRushOverVsDefense({
      sport: "nhl",
      market: "player_goals",
      side: "Over",
      pack: hotGoalie,
    }),
    true,
  );
  assert.equal(
    shouldBlockRushOverVsDefense({
      sport: "nhl",
      market: "player_points",
      side: "Over",
      pack: hotGoalie,
    }),
    true,
  );
  // Under still allowed (and favored).
  assert.equal(
    shouldBlockRushOverVsDefense({
      sport: "nhl",
      market: "player_goals",
      side: "Under",
      pack: hotGoalie,
    }),
    false,
  );
  const underTilt = multiSportOppDefenseTilt({
    sport: "nhl",
    market: "player_goals",
    side: "Under",
    pack: hotGoalie,
  });
  assert.ok(underTilt.tilt > 0);

  // Soft band demotes without hard block.
  assert.equal(
    shouldBlockRushOverVsDefense({
      sport: "nhl",
      market: "player_goals",
      side: "Over",
      pack: { savePct: 0.908, goalsAgainstAvg: 2.7 },
    }),
    false,
  );

  // Sport must be passed — without it NHL blocks never fire (parity bug).
  assert.equal(
    shouldBlockRushOverVsDefense({
      market: "player_goals",
      side: "Over",
      pack: hotGoalie,
    }),
    false,
  );

  // Rare Goals Overs (≥1.5) require real opp goaltending — no blind EV stage.
  assert.equal(
    shouldDropPropMissingOppDefense({
      sport: "nhl",
      market: "player_goals",
      side: "Over",
      line: 1.5,
      pack: null,
    }),
    true,
  );
  assert.equal(
    shouldDropPropMissingOppDefense({
      sport: "nhl",
      market: "player_goals",
      side: "Over",
      line: 2.5,
      pack: { teamName: "Empty" },
    }),
    true,
  );
  assert.equal(
    shouldDropPropMissingOppDefense({
      sport: "nhl",
      market: "player_goals",
      side: "Over",
      line: 1.5,
      pack: hotGoalie,
    }),
    false,
  );
  // Anytime-goal Over 0.5 does NOT hard-drop (soft demote only) — recovers oddsOk.
  assert.equal(
    shouldDropPropMissingOppDefense({
      sport: "nhl",
      market: "player_goals",
      side: "Over",
      line: 0.5,
      pack: null,
    }),
    false,
  );
  // Unders never hard-drop for missing pack — demote via nhlScoringMissingOppContext.
  assert.equal(
    shouldDropPropMissingOppDefense({
      sport: "nhl",
      market: "player_points",
      side: "Under",
      line: 0.5,
      pack: null,
    }),
    false,
  );
  const { nhlScoringMissingOppContext } = await import("./footballRushDefense.ts");
  assert.equal(
    nhlScoringMissingOppContext({
      sport: "nhl",
      market: "player_points",
      pack: null,
    }),
    true,
  );
  assert.equal(
    nhlScoringMissingOppContext({
      sport: "nhl",
      market: "player_points",
      pack: hotGoalie,
    }),
    false,
  );
  assert.equal(
    nhlScoringMissingOppContext({
      sport: "nhl",
      market: "player_points",
      pack: null,
      vsOpponentGames: 3,
    }),
    false,
  );
  // SOG never requires scoring-pack gate.
  assert.equal(
    shouldDropPropMissingOppDefense({
      sport: "nhl",
      market: "player_shots_on_goal",
      side: "Over",
      line: 2.5,
      pack: null,
    }),
    false,
  );
});

test("NHL mid-tier goalie still grounds Match display (tilt may be 0)", async () => {
  const { multiSportOppDefenseTilt, propOppDefenseTilt } = await import(
    "./footballRushDefense.ts"
  );
  const mid = multiSportOppDefenseTilt({
    sport: "nhl",
    market: "player_points",
    side: "Under",
    pack: { savePct: 0.902, goalsAgainstAvg: 2.95, teamName: "Sabres" },
  });
  assert.ok(mid.display?.includes("SV%"));
  assert.ok(mid.display?.includes("GAA"));
  // Unified path must keep display so card Match is not grey.
  const unified = propOppDefenseTilt({
    sport: "nhl",
    market: "player_points",
    side: "Under",
    pack: { savePct: 0.902, goalsAgainstAvg: 2.95, teamName: "Sabres" },
  });
  assert.ok(unified.display);
});

test("propTeamAbbrBelongsToGame drops foreign franchise on labeled game", async () => {
  const { propTeamAbbrBelongsToGame, opponentTeamIdForProp } = await import(
    "./footballOppTeamId.ts"
  );
  const games = [
    {
      sport: "nhl",
      homeTeam: "Columbus Blue Jackets",
      awayTeam: "Buffalo Sabres",
      homeTeamId: "29",
      awayTeamId: "1",
      homeAbbr: "CBJ",
      awayAbbr: "BUF",
    },
  ];
  assert.equal(
    propTeamAbbrBelongsToGame({
      sport: "nhl",
      game: "Buffalo Sabres @ Columbus Blue Jackets",
      teamAbbr: "CBJ",
      espnGames: games,
    }),
    true,
  );
  assert.equal(
    propTeamAbbrBelongsToGame({
      sport: "nhl",
      game: "Buffalo Sabres @ Columbus Blue Jackets",
      teamAbbr: "VAN",
      espnGames: games,
    }),
    false,
  );

  // Initials when ESPN abbrs missing — CBJ must not wipe oddsOk.
  const noAbbr = [
    {
      sport: "nhl",
      homeTeam: "Columbus Blue Jackets",
      awayTeam: "Buffalo Sabres",
      homeTeamId: "29",
      awayTeamId: "1",
    },
  ];
  assert.equal(
    propTeamAbbrBelongsToGame({
      sport: "nhl",
      game: "Buffalo Sabres @ Columbus Blue Jackets",
      teamAbbr: "CBJ",
      espnGames: noAbbr,
    }),
    true,
  );
  assert.equal(
    opponentTeamIdForProp({
      sport: "nhl",
      game: "Buffalo Sabres @ Columbus Blue Jackets",
      teamAbbr: "CBJ",
      espnGames: noAbbr,
    }),
    "1",
  );
  assert.equal(
    opponentTeamIdForProp({
      sport: "nhl",
      game: "Buffalo Sabres @ Columbus Blue Jackets",
      teamAbbr: "BUF",
      espnGames: noAbbr,
    }),
    "29",
  );
});

test("perGameRate normalizes season totals; fails closed without gp", async () => {
  const { perGameRate } = await import("./footballRushDefense.ts");
  assert.equal(perGameRate(30, 10), 3);
  assert.equal(perGameRate(30, 1), null);
  assert.equal(perGameRate(null, 10), null);
});

test("strong D-front × porous O-line demotes pass Over; favors sack Over", async () => {
  const {
    footballRushDefenseTilt,
    adjustSimHitForOppDefenseTilt,
    isFootballSackMarket,
  } = await import("./footballRushDefense.ts");

  assert.equal(isFootballSackMarket("player_sacks"), true);
  assert.equal(isFootballSackMarket("player_pass_yds"), false);

  const strongFront = {
    pass: {
      passingYardsAllowedPerGame: 210,
      yardsPerPassAllowed: 6.5,
      sampleSize: 4,
      teamName: "Eagles",
    },
    teamName: "Eagles",
    sacks: 36, // 3.0/g over 12 — elite, not a raw ≥20 guess
    gamesPlayed: 12,
    interceptions: 6,
    passesDefended: 40,
  };
  const porousOline = {
    sacksAllowed: 42, // 3.5/g
    gamesPlayed: 12,
    interceptionPct: 2.2,
    ownRushYpc: 4.0,
    pointsFor: 22,
  };
  const stoutOline = {
    sacksAllowed: 12, // 1.0/g
    gamesPlayed: 12,
    interceptionPct: 1.2,
    ownRushYpc: 4.8,
    pointsFor: 28,
  };
  const weakFront = {
    pass: {
      passingYardsAllowedPerGame: 250,
      yardsPerPassAllowed: 7.6,
      sampleSize: 4,
      teamName: "Panthers",
    },
    teamName: "Panthers",
    sacks: 14, // 1.17/g
    gamesPlayed: 12,
    interceptions: 4,
  };

  const passVsStrong = footballRushDefenseTilt({
    market: "player_pass_yds",
    side: "Over",
    pack: strongFront,
    ownPack: porousOline,
  });
  const passVsWeak = footballRushDefenseTilt({
    market: "player_pass_yds",
    side: "Over",
    pack: weakFront,
    ownPack: stoutOline,
  });
  assert.ok(passVsStrong.tilt < passVsWeak.tilt, "porous OL vs elite rush should hurt pass Over more");
  assert.ok(passVsStrong.tilt < 0);
  assert.ok(passVsWeak.tilt > 0);

  // Under flips relative to Over
  const passUnderStrong = footballRushDefenseTilt({
    market: "player_pass_yds",
    side: "Under",
    pack: strongFront,
    ownPack: porousOline,
  });
  assert.ok(passUnderStrong.tilt > 0);

  // Sack prop: rusher (ownPack.sacks) vs OL (pack.sacksAllowed)
  const sackOver = footballRushDefenseTilt({
    market: "player_sacks",
    side: "Over",
    pack: { sacksAllowed: 42, gamesPlayed: 12, teamName: "Bears" },
    ownPack: { sacks: 36, gamesPlayed: 12 },
  });
  const sackOverStout = footballRushDefenseTilt({
    market: "player_sacks",
    side: "Over",
    pack: { sacksAllowed: 12, gamesPlayed: 12, teamName: "Chiefs" },
    ownPack: { sacks: 14, gamesPlayed: 12 },
  });
  assert.ok(sackOver.tilt > sackOverStout.tilt);
  assert.ok(sackOver.tilt > 0);
  assert.ok(sackOverStout.tilt < 0);

  // Sim hit moves with tilt (projection, not display-only)
  const base = 0.55;
  const adjDown = adjustSimHitForOppDefenseTilt(base, passVsStrong.tilt);
  const adjUp = adjustSimHitForOppDefenseTilt(base, passVsWeak.tilt);
  assert.ok(adjDown != null && adjDown < base);
  assert.ok(adjUp != null && adjUp > base);
});

test("QB INT Over rises vs ball-hawking D + high own INT%; Under when clean", async () => {
  const { footballRushDefenseTilt, isFootballQbIntMarket } = await import(
    "./footballRushDefense.ts"
  );
  assert.equal(isFootballQbIntMarket("player_pass_interceptions"), true);
  assert.equal(isFootballQbIntMarket("player_defensive_interceptions"), false);

  const hawk = {
    interceptions: 18, // 1.5/g
    passesDefended: 60, // 5/g
    totalTakeaways: 24,
    gamesPlayed: 12,
    teamName: "Bills",
  };
  const softSecondary = {
    interceptions: 3, // 0.25/g
    passesDefended: 20,
    gamesPlayed: 12,
    teamName: "Giants",
  };
  const recklessQb = { interceptionPct: 3.8, gamesPlayed: 12, intsThrown: 14 };
  const carefulQb = { interceptionPct: 1.0, gamesPlayed: 12, intsThrown: 3 };

  const intOver = footballRushDefenseTilt({
    market: "player_pass_interceptions",
    side: "Over",
    pack: hawk,
    ownPack: recklessQb,
  });
  const intOverClean = footballRushDefenseTilt({
    market: "player_pass_interceptions",
    side: "Over",
    pack: softSecondary,
    ownPack: carefulQb,
  });
  assert.ok(intOver.tilt > intOverClean.tilt);
  assert.ok(intOver.tilt > 0);
  assert.ok(intOverClean.tilt < 0);

  const intUnder = footballRushDefenseTilt({
    market: "player_pass_interceptions",
    side: "Under",
    pack: hawk,
    ownPack: recklessQb,
  });
  assert.ok(intUnder.tilt < 0);
});

test("pressure raises QB rush Over and receptions Over; not blanket Under", async () => {
  const { footballRushDefenseTilt } = await import("./footballRushDefense.ts");
  const pressurePack = {
    sacks: 40,
    gamesPlayed: 12,
    pass: {
      passingYardsAllowedPerGame: 220,
      yardsPerPassAllowed: 6.8,
      sampleSize: 4,
    },
    teamName: "Steelers",
  };
  const porous = { sacksAllowed: 38, gamesPlayed: 12 };

  const qbRush = footballRushDefenseTilt({
    market: "player_qb_rush_yds",
    side: "Over",
    pack: pressurePack,
    ownPack: porous,
  });
  const passYds = footballRushDefenseTilt({
    market: "player_pass_yds",
    side: "Over",
    pack: pressurePack,
    ownPack: porous,
  });
  const receptions = footballRushDefenseTilt({
    market: "player_receptions",
    side: "Over",
    pack: pressurePack,
    ownPack: porous,
  });
  // Scramble + checkdowns lean Over; pass yards lean Under under pressure
  assert.ok(qbRush.tilt > 0, `qb rush tilt ${qbRush.tilt}`);
  assert.ok(passYds.tilt < qbRush.tilt);
  assert.ok(receptions.tilt > passYds.tilt);
});

test("rush Over favored by strong own YPC vs leaky run D; demoted vs stingy", async () => {
  const { footballRushDefenseTilt } = await import("./footballRushDefense.ts");
  const leaky = {
    rush: {
      rushingYardsAllowedPerGame: 145,
      yardsPerRushAllowed: 5.0,
      sampleSize: 4,
      teamName: "Cowboys",
    },
    teamName: "Cowboys",
    stuffs: 8,
    gamesPlayed: 12,
  };
  const stingy = {
    rush: {
      rushingYardsAllowedPerGame: 88,
      yardsPerRushAllowed: 3.3,
      sampleSize: 4,
      teamName: "Eagles",
    },
    teamName: "Eagles",
    stuffs: 36,
    gamesPlayed: 12,
  };
  const strongOl = { ownRushYpc: 5.1, gamesPlayed: 12, pointsFor: 28 };
  const weakOl = { ownRushYpc: 3.4, gamesPlayed: 12, pointsFor: 17 };

  const good = footballRushDefenseTilt({
    market: "player_rush_yds",
    side: "Over",
    pack: leaky,
    ownPack: strongOl,
  });
  const bad = footballRushDefenseTilt({
    market: "player_rush_yds",
    side: "Over",
    pack: stingy,
    ownPack: weakOl,
  });
  assert.ok(good.tilt > bad.tilt);
  assert.ok(good.tilt > 0);
  assert.ok(bad.tilt < 0);
  assert.equal(bad.blockOver, true);
});

test("no arbitrary ≥20 sacks / ≥10 INT season-total lean without gamesPlayed", async () => {
  const { footballRushDefenseTilt } = await import("./footballRushDefense.ts");
  // Mid pass D + huge season totals but NO gamesPlayed → rates fail closed.
  // Pass yards band alone should drive tilt; sacks/INT must not invent a lean.
  const mid = footballRushDefenseTilt({
    market: "player_pass_yds",
    side: "Over",
    pack: {
      pass: {
        passingYardsAllowedPerGame: 220,
        yardsPerPassAllowed: 6.8,
        sampleSize: 4,
      },
      sacks: 45,
      interceptions: 15,
      passesDefended: 80,
      // gamesPlayed omitted on purpose
    },
  });
  const midNoTotals = footballRushDefenseTilt({
    market: "player_pass_yds",
    side: "Over",
    pack: {
      pass: {
        passingYardsAllowedPerGame: 220,
        yardsPerPassAllowed: 6.8,
        sampleSize: 4,
      },
    },
  });
  assert.equal(mid.tilt, midNoTotals.tilt);
});

test("ownTeamIdForProp is inverse of opponent for CHI @ PHI", async () => {
  const { ownTeamIdForProp, opponentTeamIdForProp } = await import(
    "./footballOppTeamId.ts"
  );
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
  assert.equal(
    ownTeamIdForProp({
      sport: "nfl",
      game: "Chicago Bears @ Philadelphia Eagles",
      teamAbbr: "CHI",
      espnGames: games,
    }),
    "3",
  );
  assert.equal(
    opponentTeamIdForProp({
      sport: "nfl",
      game: "Chicago Bears @ Philadelphia Eagles",
      teamAbbr: "CHI",
      espnGames: games,
    }),
    "21",
  );
});

test("holistic opponentTendency moves with O-line × pass-rush matchup", async () => {
  const { buildPropHolisticScore } = await import("./propHolisticRecommendation.ts");
  const base = {
    sport: "nfl" as const,
    marketKey: "player_pass_yds",
    propSide: "Over" as const,
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
  };
  const hostile = buildPropHolisticScore({
    ...base,
    footballOppDefense: {
      pass: {
        passingYardsAllowedPerGame: 200,
        yardsPerPassAllowed: 6.2,
        sampleSize: 4,
        teamName: "Eagles",
      },
      teamName: "Eagles",
      sacks: 36,
      gamesPlayed: 12,
    },
    footballOwnPack: { sacksAllowed: 40, gamesPlayed: 12 },
  });
  const friendly = buildPropHolisticScore({
    ...base,
    footballOppDefense: {
      pass: {
        passingYardsAllowedPerGame: 255,
        yardsPerPassAllowed: 7.8,
        sampleSize: 4,
        teamName: "Panthers",
      },
      teamName: "Panthers",
      sacks: 12,
      gamesPlayed: 12,
    },
    footballOwnPack: { sacksAllowed: 14, gamesPlayed: 12 },
  });
  const oppH = hostile.factors.find((f) => f.key === "opponentTendency");
  const oppF = friendly.factors.find((f) => f.key === "opponentTendency");
  assert.ok(oppH?.present && oppF?.present);
  assert.ok((oppH?.score ?? 10) < (oppF?.score ?? 0));
  assert.ok((hostile.composite ?? 10) <= (friendly.composite ?? 0) + 0.01);
});
