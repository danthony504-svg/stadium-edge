import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProjectionMean } from "../src/lib/monteCarlo.js";
import { buildPropSimulationContext } from "../src/lib/monteCarloBuild.js";
import {
  aggregateReceivingMatchupForQb,
  buildPreSimShiftFactors,
  filterSeriesForMarket,
  marketShiftKind,
  VOLUME_SIGNAL_WEIGHT,
  dampenFactorTowardOne,
} from "../src/lib/preSimShift/index.js";
import {
  buildOpportunityShiftForGame,
  lookupOpportunityShift,
} from "../src/lib/opportunityShift/index.js";
import { deriveSideFromTeamIds, stampPropSideContext } from "../src/lib/propSimSideContext.js";
import { gameValueForMarket, computeAmbiguous } from "../src/lib/propStatValue.js";
import { opportunityMarketFamily } from "../src/lib/opportunityShift/marketFamily.js";

function series(n: number, value: number): number[] {
  return Array.from({ length: n }, () => value);
}

describe("propSimSideContext team-id wiring", () => {
  it("derives isHome + opponentTeamId from team ids only", () => {
    const home = deriveSideFromTeamIds("21", "14", "21");
    assert.deepEqual(home, {
      isHome: true,
      opponentTeamId: "14",
      playerTeamId: "21",
    });
    const away = deriveSideFromTeamIds("21", "14", "14");
    assert.deepEqual(away, {
      isHome: false,
      opponentTeamId: "21",
      playerTeamId: "14",
    });
    const unknown = deriveSideFromTeamIds("21", "14", "99");
    assert.equal(unknown.isHome, null);
    assert.equal(unknown.opponentTeamId, null);
  });

  it("HTTP and Coach stamp identical side context for the same player/game", () => {
    const http = stampPropSideContext(
      { player: "Jalen Hurts", athleteId: "4040715", market: "player_pass_yds" },
      "21",
      "14",
      "14",
    );
    const coach = stampPropSideContext(
      {
        player: "Jalen Hurts",
        athleteId: "4040715",
        market: "player_pass_yds",
        playerTeamId: "14",
      },
      "21",
      "14",
    );
    assert.equal(http.isHome, coach.isHome);
    assert.equal(http.opponentTeamId, coach.opponentTeamId);
    assert.equal(http.isHome, false);
    assert.equal(http.opponentTeamId, "21");

    const factorsHttp = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_pass_yds",
      isHome: http.isHome,
      seasonValues: series(12, 240),
      homeValues: series(6, 260),
      awayValues: series(6, 220),
      vsOpponentValues: series(4, 270),
    });
    const factorsCoach = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_pass_yds",
      isHome: coach.isHome,
      seasonValues: series(12, 240),
      homeValues: series(6, 260),
      awayValues: series(6, 220),
      vsOpponentValues: series(4, 270),
    });
    assert.deepEqual(factorsHttp, factorsCoach);
  });
});

describe("volume vs efficiency", () => {
  it("classifies attempts as volume and yards as efficiency", () => {
    assert.equal(marketShiftKind("player_rush_attempts", "nfl"), "volume");
    assert.equal(marketShiftKind("player_pass_attempts", "nfl"), "volume");
    assert.equal(marketShiftKind("player_pass_completions", "nfl"), "volume");
    assert.equal(marketShiftKind("player_targets", "nfl"), "volume");
    assert.equal(marketShiftKind("player_receptions", "nfl"), "volume");
    assert.equal(marketShiftKind("player_rush_yds", "nfl"), "efficiency");
    assert.equal(marketShiftKind("player_pass_yds", "nfl"), "efficiency");
    assert.equal(marketShiftKind("player_reception_yds", "nfl"), "efficiency");
  });

  it("volume dampening preserves opportunity above baseline under tough matchup", () => {
    const venueRaw = 0.9;
    const matchupRaw = 0.9;
    const opportunity = 1.22; // redistributed carries
    const venueVol = dampenFactorTowardOne(venueRaw, VOLUME_SIGNAL_WEIGHT);
    const matchVol = dampenFactorTowardOne(matchupRaw, VOLUME_SIGNAL_WEIGHT);
    const volumeShift = opportunity * venueVol * matchVol;
    const efficiencyShift = opportunity * venueRaw * matchupRaw;
    assert.ok(volumeShift > 1, `attempts must stay elevated, got ${volumeShift}`);
    assert.ok(efficiencyShift < volumeShift);
    // Yardage can land near/below baseline while attempts stay up.
    assert.ok(efficiencyShift < 1.05);
  });

  it("regression: starter OUT + difficult run D — attempts stay up, yards can soften", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "PHI @ DAL",
      homeTeam: "Cowboys",
      awayTeam: "Eagles",
      injuries: [
        {
          team: "Eagles",
          entries: [
            { player: "Saquon Barkley", status: "Out", position: "RB", athleteId: "sb" },
          ],
        },
      ],
      players: [
        {
          player: "Backup RB",
          athleteId: "brb",
          team: "Eagles",
          position: "RB",
          isHome: false,
          channelUsage: { carries: 8, rz_carries: 1.2, gl_carries: 0.6 },
        },
        {
          player: "Saquon Barkley",
          athleteId: "sb",
          team: "Eagles",
          position: "RB",
          isHome: false,
          channelUsage: { carries: 18 },
        },
      ],
    });
    const attOpp = lookupOpportunityShift(table, {
      player: "Backup RB",
      athleteId: "brb",
      market: "player_rush_attempts",
      sport: "nfl",
    });
    const ydsOpp = lookupOpportunityShift(table, {
      player: "Backup RB",
      athleteId: "brb",
      market: "player_rush_yds",
      sport: "nfl",
    });
    assert.ok(attOpp.multiplier > 1);

    const attempts = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_rush_attempts",
      isHome: false,
      seasonValues: series(10, 10),
      homeValues: series(5, 12),
      awayValues: series(5, 8),
      vsOpponentValues: series(4, 6),
      opportunityShift: attOpp.multiplier,
      defenseIndex: 0.85, // tough run D
    });
    const yards = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_rush_yds",
      isHome: false,
      seasonValues: series(10, 55),
      homeValues: series(5, 70),
      awayValues: series(5, 40),
      vsOpponentValues: series(4, 30),
      opportunityShift: ydsOpp.multiplier,
      defenseIndex: 0.85,
    });

    assert.equal(attempts.shiftKind, "volume");
    assert.equal(yards.shiftKind, "efficiency");
    assert.ok(attempts.combinedShift > 1, "extra carries must not be erased");
    assert.ok(attempts.volumeShift > 1);
    // Efficiency path absorbs more of the defensive penalty.
    assert.ok(yards.combinedShift < attempts.combinedShift);
  });
});

describe("targets wiring", () => {
  it("maps player_targets through family + gameValueForMarket (ESPN TGTS)", () => {
    assert.equal(opportunityMarketFamily("player_targets", "nfl"), "targets");
    const amb = computeAmbiguous(["TGTS", "REC", "YDS"]);
    const v = gameValueForMarket(
      "player_targets",
      { TGTS: "9", receivingTargets: "9", receptions: "5" },
      amb,
    );
    assert.equal(v, 9);
    const missing = gameValueForMarket("player_targets", { receptions: "5" }, amb);
    assert.equal(missing, null);
  });

  it("targets receive volume venue/matchup treatment", () => {
    const pre = buildPreSimShiftFactors({
      sport: "nfl",
      market: "player_targets",
      isHome: true,
      seasonValues: series(10, 8),
      homeValues: series(6, 10),
      awayValues: series(6, 6),
      vsOpponentValues: series(4, 11),
      opportunityShift: 1.1,
    });
    assert.equal(pre.shiftKind, "volume");
    assert.ok(pre.combinedShift !== 1);
  });
});

describe("QB usage-weighted coupling", () => {
  it("weights WR1/TE above low-usage backups", () => {
    const equal = aggregateReceivingMatchupForQb([1.12, 1.08, 1.05, 1.1, 1.14]);
    const usage = aggregateReceivingMatchupForQb([
      { factor: 1.12, recentTargets: 10 },
      { factor: 1.08, recentTargets: 8 },
      { factor: 1.05, recentTargets: 5 },
      { factor: 1.1, recentTargets: 5 },
      { factor: 1.14, recentTargets: 1 }, // backup noise
    ]);
    assert.ok(equal != null && usage != null);
    // Backup's elevated factor pulls equal mean up more than usage-weighted.
    assert.ok(usage! <= equal! + 1e-9);
    assert.ok(usage! >= 0.92 && usage! <= 1.08);
  });
});

describe("first-half isolation on live build path", () => {
  it("full-game context drops period-tagged yards/attempts/receptions", () => {
    const history = {
      labels: ["PTS", "passingYards", "rushingAttempts", "receptions"],
      recent: [
        { stats: { PTS: "20", passingYards: "200", rushingAttempts: "10", receptions: "4" }, isHome: true, periodTag: "full" },
        { stats: { PTS: "12", passingYards: "80", rushingAttempts: "3", receptions: "2" }, isHome: true, periodTag: "1h" },
        { stats: { PTS: "22", passingYards: "210", rushingAttempts: "12", receptions: "5" }, isHome: false, periodTag: "full" },
        { stats: { PTS: "18", passingYards: "190", rushingAttempts: "9", receptions: "3" }, isHome: true, periodTag: "full" },
        { stats: { PTS: "25", passingYards: "240", rushingAttempts: "11", receptions: "6" }, isHome: false, periodTag: "full" },
      ],
      vsOpponent: [
        { stats: { PTS: "24", passingYards: "230", rushingAttempts: "10", receptions: "5" }, periodTag: "full" },
        { stats: { PTS: "10", passingYards: "70", rushingAttempts: "2", receptions: "1" }, periodTag: "1h" },
        { stats: { PTS: "21", passingYards: "200", rushingAttempts: "8", receptions: "4" }, periodTag: "full" },
        { stats: { PTS: "19", passingYards: "180", rushingAttempts: "7", receptions: "3" }, periodTag: "full" },
      ],
      seasonGames: undefined as undefined,
      seasonHome: undefined as undefined,
      seasonAway: undefined as undefined,
    };
    // Ensure period filter works on the values that would enter venue/matchup.
    const pts = [20, 12, 22, 18, 25];
    const tags = ["full", "1h", "full", "full", "full"];
    assert.deepEqual(filterSeriesForMarket("player_points", pts, tags), [20, 22, 18, 25]);
    assert.deepEqual(
      filterSeriesForMarket("player_pass_yds", [200, 80, 210], ["full", "1h", "full"]),
      [200, 210],
    );
    assert.deepEqual(
      filterSeriesForMarket("player_rush_attempts", [10, 3, 12], ["full", "1h", "full"]),
      [10, 12],
    );
    assert.deepEqual(
      filterSeriesForMarket("player_receptions", [4, 2, 5], ["full", "1h", "full"]),
      [4, 5],
    );

    const ctx = buildPropSimulationContext(
      {
        player: "Test",
        athleteId: "t1",
        market: "player_points",
        line: 20.5,
        side: "Over",
        sport: "nba",
        isHome: true,
      },
      history,
      { sport: "nba" },
    );
    assert.ok(ctx);
    // 1H point row must not appear in recentValues used for full-game.
    assert.ok(!ctx!.recentValues.includes(12));
    assert.ok(ctx!.recentValues.includes(20));
  });
});

describe("NBA assists unblocked for basketball", () => {
  it("player_assists maps and is family-shift allowed on nba", () => {
    assert.equal(opportunityMarketFamily("player_assists", "nba"), "assists");
    const pre = buildPreSimShiftFactors({
      sport: "nba",
      market: "player_assists",
      isHome: true,
      seasonValues: series(10, 8),
      homeValues: series(6, 10),
      awayValues: series(6, 6),
      vsOpponentValues: series(4, 11),
    });
    assert.ok(pre.venueShift > 1 || pre.opponentMatchupShift > 1);
  });
});
