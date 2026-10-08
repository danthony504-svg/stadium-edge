import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_DEEP_DRAWS,
  assertBaseballF5Conserved,
  baseballProfileLevers,
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

function totalDrawVariance(tensor: ReturnType<typeof buildJointBaseballTensor>): number {
  const n = tensor.meta.nDraws;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += tensor.team.homeFg[i]! + tensor.team.awayFg[i]!;
  mean /= n;
  let var_ = 0;
  for (let i = 0; i < n; i++) {
    const t = tensor.team.homeFg[i]! + tensor.team.awayFg[i]!;
    var_ += (t - mean) ** 2;
  }
  return var_ / n;
}

describe("MLB joint milestone F.2 (shadow)", () => {
  it("calibration profiles conserve F5⊆FG; shock profiles raise draw variance vs v0.2", () => {
    const base = {
      sport: "mlb" as const,
      eventId: "mlb-ab-profile",
      seed: "mlb-ab-same-seed",
      nDraws: 4000,
      home: { teamId: "h", runsFor: 5.2, runsAgainst: 3.8, recentFgRuns: [6, 5, 7, 4, 8] },
      away: { teamId: "a", runsFor: 3.5, runsAgainst: 5.1, recentFgRuns: [2, 3, 4, 3, 5] },
    };
    const v02 = buildJointBaseballTensor({ ...base, calibrationProfile: "v0.2" });
    const v03 = buildJointBaseballTensor({ ...base, calibrationProfile: "v0.3" });
    const v031 = buildJointBaseballTensor({ ...base, calibrationProfile: "v0.3.1" });
    const def = buildJointBaseballTensor(base);
    assert.equal(v02.meta.modelVersion, "0.2.0");
    assert.equal(v03.meta.modelVersion, "0.3.0");
    assert.equal(v031.meta.modelVersion, "0.3.1");
    assert.equal(def.meta.modelVersion, "0.3.1");
    assert.equal(baseballProfileLevers("v0.2").shrinkWeight, 0);
    assert.equal(baseballProfileLevers("v0.2").gameShockSigma, 0);
    assert.equal(baseballProfileLevers("v0.2").homeEdge, 0.1);
    assert.equal(baseballProfileLevers("v0.3").shrinkWeight, 0.4);
    assert.equal(baseballProfileLevers("v0.3").gameShockSigma, 0.18);
    assert.equal(baseballProfileLevers("v0.3").homeEdge, 0.05);
    assert.equal(baseballProfileLevers("v0.3.1").shrinkWeight, 0.2);
    assert.equal(baseballProfileLevers("v0.3.1").gameShockSigma, 0.22);
    assert.equal(baseballProfileLevers("v0.3.1").homeEdge, 0.07);
    assert.equal(baseballProfileLevers().profile, "v0.3.1");
    assert.doesNotThrow(() => assertBaseballF5Conserved(v02));
    assert.doesNotThrow(() => assertBaseballF5Conserved(v03));
    assert.doesNotThrow(() => assertBaseballF5Conserved(v031));
    assert.notEqual(v02.meta.dataFingerprint, v03.meta.dataFingerprint);
    assert.notEqual(v03.meta.dataFingerprint, v031.meta.dataFingerprint);
    const var02 = totalDrawVariance(v02);
    const var03 = totalDrawVariance(v03);
    const var031 = totalDrawVariance(v031);
    assert.ok(
      var03 > var02 * 1.05,
      `expected v0.3 draw var > v0.2: v02=${var02.toFixed(3)} v03=${var03.toFixed(3)}`,
    );
    assert.ok(
      var031 > var02 * 1.05,
      `expected v0.3.1 draw var > v0.2: v02=${var02.toFixed(3)} v031=${var031.toFixed(3)}`,
    );
  });

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
    assert.equal(tensor.meta.modelVersion, "0.3.1");
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
