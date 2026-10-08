import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_DEEP_DRAWS,
  buildBasketballPlayerPropMarket,
  buildBasketballTotalMarket,
  buildJointBasketballTensor,
  impliedProbFromAmerican,
  settleMarket,
  validateScenarioConsistency,
} from "../src/index.js";

const now = new Date().toISOString();

describe("Basketball joint milestone E.1 (shadow)", () => {
  it("NBA conserves quarters+halves and settles alt points prop", () => {
    const tensor = buildJointBasketballTensor({
      sport: "nba",
      eventId: "nba-1",
      seed: "nba-m1",
      nDraws: SIM_V2_DEEP_DRAWS,
      home: { teamId: "h", ptsFor: 114, ptsAgainst: 110 },
      away: { teamId: "a", ptsFor: 108, ptsAgainst: 112 },
      players: [{ playerId: "g1", teamSide: "home", usage: 0.28 }],
    });
    const q = validateScenarioConsistency(tensor, {
      periodSumGroup: ["q1", "q2", "q3", "q4"],
      checkDerivedHalves: true,
    });
    assert.equal(q.ok, true, JSON.stringify(q.issues));

    const prop = buildBasketballPlayerPropMarket({
      marketId: "pts",
      eventId: "nba-1",
      sport: "nba",
      playerId: "g1",
      stat: "points",
      side: "over",
      line: 12.5,
      alternate: true,
    });
    assert.equal(prop.providerMarketKey, "player_points_alternate");
    const r = settleMarket({
      tensor,
      market: prop,
      odds: {
        marketId: "pts",
        american: -110,
        book: "test",
        capturedAt: now,
        impliedProbRaw: impliedProbFromAmerican(-110),
        provenance: { provider: "test", fetchedAt: now },
      },
    });
    assert.equal(r.status, "ok", r.reason);
  });

  it("NCAAB conserves halves; WNBA uses own sport id params", () => {
    const ncaab = buildJointBasketballTensor({
      sport: "ncaab",
      eventId: "ncaab-1",
      seed: "ncaab-m1",
      nDraws: 2000,
      home: { teamId: "h", ptsFor: 74 },
      away: { teamId: "a", ptsFor: 70 },
    });
    const h = validateScenarioConsistency(ncaab, { periodSumGroup: ["h1", "h2"] });
    assert.equal(h.ok, true, JSON.stringify(h.issues));
    assert.deepEqual(ncaab.meta.periodsPresent, ["fg", "h1", "h2"]);

    const wnba = buildJointBasketballTensor({
      sport: "wnba",
      eventId: "wnba-1",
      seed: "wnba-m1",
      nDraws: 1000,
      home: { teamId: "h", ptsFor: 84 },
      away: { teamId: "a", ptsFor: 80 },
    });
    assert.equal(wnba.meta.sport, "wnba");
    const total = buildBasketballTotalMarket({
      marketId: "t",
      eventId: "wnba-1",
      sport: "wnba",
      side: "under",
      line: 162.5,
    });
    const r = settleMarket({
      tensor: wnba,
      market: total,
      odds: {
        marketId: "t",
        american: -105,
        book: "test",
        capturedAt: now,
        impliedProbRaw: impliedProbFromAmerican(-105),
        provenance: { provider: "test", fetchedAt: now },
      },
    });
    assert.equal(r.status, "ok", r.reason);
  });
});
