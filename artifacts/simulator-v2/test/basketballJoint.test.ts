import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_DEEP_DRAWS,
  basketballPeriodAllowed,
  buildBasketballMlMarket,
  buildBasketballPlayerPropMarket,
  buildBasketballSpreadMarket,
  buildBasketballTeamTotalMarket,
  buildBasketballTotalMarket,
  buildJointBasketballTensor,
  impliedProbFromAmerican,
  settleMarket,
  validateScenarioConsistency,
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

describe("Basketball joint milestone E.2 (shadow)", () => {
  it("NBA settles ML/spread/total/TT/alts/combos/Q1; conserves quarters", () => {
    const tensor = buildJointBasketballTensor({
      sport: "nba",
      eventId: "nba-e2",
      seed: "nba-e2",
      nDraws: SIM_V2_DEEP_DRAWS,
      home: { teamId: "h", ptsFor: 114, ptsAgainst: 110 },
      away: { teamId: "a", ptsFor: 108, ptsAgainst: 112 },
      players: [{ playerId: "g1", teamSide: "home", usage: 0.28 }],
    });
    assert.ok(tensor.meta.modelVersion.startsWith("0.2"));
    const q = validateScenarioConsistency(tensor, {
      periodSumGroup: ["q1", "q2", "q3", "q4"],
      checkDerivedHalves: true,
    });
    assert.equal(q.ok, true, JSON.stringify(q.issues));

    const markets = [
      buildBasketballMlMarket({ marketId: "ml", eventId: "nba-e2", sport: "nba", side: "home" }),
      buildBasketballSpreadMarket({
        marketId: "sp",
        eventId: "nba-e2",
        sport: "nba",
        side: "home",
        postedSpread: -3.5,
      }),
      buildBasketballTotalMarket({
        marketId: "tot",
        eventId: "nba-e2",
        sport: "nba",
        side: "over",
        line: 224.5,
      }),
      buildBasketballTeamTotalMarket({
        marketId: "tt",
        eventId: "nba-e2",
        sport: "nba",
        teamSide: "home",
        side: "over",
        line: 112.5,
      }),
      buildBasketballTotalMarket({
        marketId: "q1",
        eventId: "nba-e2",
        sport: "nba",
        period: "q1",
        side: "under",
        line: 54.5,
      }),
      buildBasketballPlayerPropMarket({
        marketId: "pts",
        eventId: "nba-e2",
        sport: "nba",
        playerId: "g1",
        stat: "points",
        side: "over",
        line: 18.5,
        alternate: true,
      }),
      buildBasketballPlayerPropMarket({
        marketId: "pra",
        eventId: "nba-e2",
        sport: "nba",
        playerId: "g1",
        stat: "pra",
        side: "over",
        line: 28.5,
      }),
      buildBasketballPlayerPropMarket({
        marketId: "pq1",
        eventId: "nba-e2",
        sport: "nba",
        playerId: "g1",
        stat: "points_q1",
        side: "over",
        line: 4.5,
      }),
    ];
    for (const m of markets) {
      const r = settleMarket({ tensor, market: m, odds: od(m.marketId, -110) });
      assert.equal(r.status, "ok", `${m.marketId}:${r.reason}`);
    }
  });

  it("NCAAB allows halves only; WNBA has separate sport id", () => {
    assert.equal(basketballPeriodAllowed("ncaab", "q1"), false);
    assert.equal(basketballPeriodAllowed("ncaab", "h1"), true);
    assert.throws(() =>
      buildBasketballTotalMarket({
        marketId: "x",
        eventId: "e",
        sport: "ncaab",
        period: "q1",
        side: "over",
        line: 40.5,
      }),
    );
    assert.throws(() =>
      buildBasketballPlayerPropMarket({
        marketId: "x",
        eventId: "e",
        sport: "ncaab",
        playerId: "p",
        stat: "points_q1",
        side: "over",
        line: 4.5,
      }),
    );

    const ncaab = buildJointBasketballTensor({
      sport: "ncaab",
      eventId: "ncaab-e2",
      seed: "ncaab-e2",
      nDraws: 2000,
      home: { teamId: "h", ptsFor: 74 },
      away: { teamId: "a", ptsFor: 70 },
    });
    assert.equal(
      validateScenarioConsistency(ncaab, { periodSumGroup: ["h1", "h2"] }).ok,
      true,
    );
    const h1 = buildBasketballTotalMarket({
      marketId: "h1",
      eventId: "ncaab-e2",
      sport: "ncaab",
      period: "h1",
      side: "over",
      line: 68.5,
    });
    assert.equal(settleMarket({ tensor: ncaab, market: h1, odds: od("h1", -105) }).status, "ok");

    const wnba = buildJointBasketballTensor({
      sport: "wnba",
      eventId: "wnba-e2",
      seed: "wnba-e2",
      nDraws: 1000,
      home: { teamId: "h", ptsFor: 84 },
      away: { teamId: "a", ptsFor: 80 },
    });
    assert.equal(wnba.meta.sport, "wnba");
  });
});

describe("Basketball E.3 league profiles", () => {
  it("keeps defaultBasketballProfile at v0.2 for every league after failed promote", async () => {
    const { defaultBasketballProfile, basketballProfileLevers } = await import(
      "../src/models/basketball/jointBasketball.js"
    );
    assert.equal(defaultBasketballProfile("nba"), "v0.2");
    assert.equal(defaultBasketballProfile("wnba"), "v0.2");
    assert.equal(defaultBasketballProfile("ncaab"), "v0.2");
    assert.equal(basketballProfileLevers("nba_e3").shrinkWeight, 0.15);
    assert.equal(basketballProfileLevers("ncaab_e3").shrinkWeight, 0.2);
    assert.equal(basketballProfileLevers("wnba_e3").shrinkWeight, 0);
  });
});

describe("Basketball calibration profiles A/B", () => {
  it("v0.3 reports higher within-draw total variance than v0.2 on same seed", () => {
    const base = {
      sport: "nba" as const,
      eventId: "nba-ab",
      seed: "nba-ab-var",
      nDraws: 3000,
      home: { teamId: "h", ptsFor: 118, ptsAgainst: 108 },
      away: { teamId: "a", ptsFor: 105, ptsAgainst: 115 },
    };
    const a = buildJointBasketballTensor({ ...base, calibrationProfile: "v0.2" });
    const b = buildJointBasketballTensor({ ...base, calibrationProfile: "v0.3" });
    assert.equal(a.meta.modelVersion, "0.2.0");
    assert.equal(b.meta.modelVersion, "0.3.0");
    const varOf = (t: typeof a) => {
      let s = 0;
      let sq = 0;
      for (let i = 0; i < t.meta.nDraws; i++) {
        const tot = t.team.homeFg[i]! + t.team.awayFg[i]!;
        s += tot;
        sq += tot * tot;
      }
      const m = s / t.meta.nDraws;
      return sq / t.meta.nDraws - m * m;
    };
    assert.ok(varOf(b) > varOf(a) * 1.05, `v0.3 var ${varOf(b)} should exceed v0.2 ${varOf(a)}`);
  });
});
