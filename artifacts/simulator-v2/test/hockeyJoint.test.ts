import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_DEEP_DRAWS,
  DEFAULT_SIM_V2_FLAGS,
  HOCKEY_JOINT_MODEL_ID,
  buildHockeyPlayerPropMarket,
  buildHockeyTotalMarket,
  buildJointHockeyTensor,
  impliedProbFromAmerican,
  selectProductionSimResult,
  settleMarket,
  validateScenarioConsistency,
} from "../src/index.js";

const now = new Date().toISOString();

describe("NHL joint milestone D.1 (shadow)", () => {
  it("conserves P1+P2+P3 = FG on 10k draws and settles totals + props", () => {
    const tensor = buildJointHockeyTensor({
      sport: "nhl",
      eventId: "nhl-1",
      seed: "nhl-m1",
      nDraws: SIM_V2_DEEP_DRAWS,
      home: { teamId: "h", goalsFor: 3.2, goalsAgainst: 2.8 },
      away: { teamId: "a", goalsFor: 2.9, goalsAgainst: 3.1 },
      players: [{ playerId: "sk1", teamSide: "home", usage: 0.35 }],
    });
    assert.equal(tensor.meta.modelId, HOCKEY_JOINT_MODEL_ID);
    assert.equal(tensor.meta.nDraws, 10_000);
    const cons = validateScenarioConsistency(tensor, { periodSumGroup: ["p1", "p2", "p3"] });
    assert.equal(cons.ok, true, JSON.stringify(cons.issues));

    const total = buildHockeyTotalMarket({
      marketId: "t",
      eventId: "nhl-1",
      side: "over",
      line: 5.5,
    });
    const tr = settleMarket({
      tensor,
      market: total,
      odds: {
        marketId: "t",
        american: -110,
        book: "test",
        capturedAt: now,
        impliedProbRaw: impliedProbFromAmerican(-110),
        provenance: { provider: "test", fetchedAt: now },
      },
    });
    assert.equal(tr.status, "ok", tr.reason);
    assert.equal(tr.providerOddsAmerican, -110);

    const prop = buildHockeyPlayerPropMarket({
      marketId: "p",
      eventId: "nhl-1",
      playerId: "sk1",
      stat: "shots_on_goal",
      side: "over",
      line: 2.5,
      alternate: true,
    });
    assert.equal(prop.providerMarketKey, "player_shots_on_goal_alternate");
    const pr = settleMarket({
      tensor,
      market: prop,
      odds: {
        marketId: "p",
        american: -115,
        book: "test",
        capturedAt: now,
        impliedProbRaw: impliedProbFromAmerican(-115),
        provenance: { provider: "test", fetchedAt: now },
      },
    });
    assert.equal(pr.status, "ok", pr.reason);

    const prod = selectProductionSimResult({
      flags: DEFAULT_SIM_V2_FLAGS,
      sport: "nhl",
      family: "total",
      v1SimHit: 0.5,
      v2: tr,
    });
    assert.equal(prod.engine, "v1");
  });
});
