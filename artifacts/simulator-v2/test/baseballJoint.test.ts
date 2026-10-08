import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_DEEP_DRAWS,
  assertBaseballF5Conserved,
  buildBaseballMlMarket,
  buildBaseballPlayerPropMarket,
  buildBaseballSpreadMarket,
  buildBaseballTeamTotalMarket,
  buildBaseballTotalMarket,
  buildJointBaseballTensor,
  impliedProbFromAmerican,
  settleMarket,
} from "../src/index.js";

const now = new Date().toISOString();
function od(id: string, am: number) {
  return {
    marketId: id,
    american: am,
    book: "test",
    capturedAt: now,
    impliedProbRaw: impliedProbFromAmerican(am),
    provenance: { provider: "test", fetchedAt: now },
  };
}

describe("MLB joint milestone F.2 (shadow)", () => {
  it("F5≤FG; settles ML/RL/totals/TT/F5 + props; rejects non-starter pitcher", () => {
    const tensor = buildJointBaseballTensor({
      sport: "mlb",
      eventId: "mlb-f2",
      seed: "mlb-f2",
      nDraws: SIM_V2_DEEP_DRAWS,
      home: { teamId: "h", runsFor: 4.6, runsAgainst: 4.1 },
      away: { teamId: "a", runsFor: 4.2, runsAgainst: 4.5 },
      players: [
        {
          playerId: "bat1",
          teamSide: "home",
          kind: "batter",
          usage: 0.9,
          battingOrder: 3,
          confirmedStarter: true,
          oppPitcherKPer9: 9.5,
        },
        {
          playerId: "pit1",
          teamSide: "away",
          kind: "pitcher",
          usage: 1,
          confirmedStarter: true,
        },
        {
          playerId: "pit_bullpen",
          teamSide: "away",
          kind: "pitcher",
          usage: 1,
          confirmedStarter: false,
        },
      ],
    });
    assert.ok(tensor.meta.modelVersion.startsWith("0.3"));
    assert.doesNotThrow(() => assertBaseballF5Conserved(tensor));

    const markets = [
      buildBaseballMlMarket({ marketId: "ml", eventId: "mlb-f2", side: "home" }),
      buildBaseballSpreadMarket({
        marketId: "rl",
        eventId: "mlb-f2",
        side: "home",
        postedSpread: -1.5,
      }),
      buildBaseballTotalMarket({ marketId: "tot", eventId: "mlb-f2", side: "over", line: 8.5 }),
      buildBaseballTeamTotalMarket({
        marketId: "tt",
        eventId: "mlb-f2",
        teamSide: "home",
        side: "over",
        line: 4.5,
      }),
      buildBaseballTotalMarket({
        marketId: "f5",
        eventId: "mlb-f2",
        period: "f5",
        side: "under",
        line: 4.5,
      }),
      buildBaseballMlMarket({ marketId: "f5ml", eventId: "mlb-f2", period: "f5", side: "away" }),
      buildBaseballPlayerPropMarket({
        marketId: "h",
        eventId: "mlb-f2",
        playerId: "bat1",
        stat: "hits",
        side: "over",
        line: 0.5,
        alternate: true,
      }),
      buildBaseballPlayerPropMarket({
        marketId: "hr",
        eventId: "mlb-f2",
        playerId: "bat1",
        stat: "home_runs",
        side: "over",
        line: 0.5,
      }),
      buildBaseballPlayerPropMarket({
        marketId: "sb",
        eventId: "mlb-f2",
        playerId: "bat1",
        stat: "stolen_bases",
        side: "over",
        line: 0.5,
      }),
      buildBaseballPlayerPropMarket({
        marketId: "k",
        eventId: "mlb-f2",
        playerId: "pit1",
        stat: "strikeouts",
        side: "over",
        line: 5.5,
        alternate: true,
      }),
    ];
    for (const m of markets) {
      const r = settleMarket({ tensor, market: m, odds: od(m.marketId, -110) });
      assert.equal(r.status, "ok", `${m.marketId}:${r.reason}`);
    }

    const bull = buildBaseballPlayerPropMarket({
      marketId: "bull",
      eventId: "mlb-f2",
      playerId: "pit_bullpen",
      stat: "strikeouts",
      side: "over",
      line: 1.5,
    });
    assert.equal(settleMarket({ tensor, market: bull, odds: od("bull", -110) }).status, "missing_data");

    const benchBat = buildJointBaseballTensor({
      sport: "mlb",
      eventId: "mlb-bench",
      seed: "mlb-bench",
      nDraws: 500,
      home: { teamId: "h", runsFor: 4.5 },
      away: { teamId: "a", runsFor: 4.2 },
      players: [
        {
          playerId: "bench",
          teamSide: "home",
          kind: "batter",
          usage: 0.8,
          confirmedStarter: false,
          battingOrder: null,
        },
      ],
    });
    const benchM = buildBaseballPlayerPropMarket({
      marketId: "bench",
      eventId: "mlb-bench",
      playerId: "bench",
      stat: "hits",
      side: "over",
      line: 0.5,
    });
    assert.equal(
      settleMarket({ tensor: benchBat, market: benchM, odds: od("bench", -110) }).status,
      "missing_data",
    );
  });
});
