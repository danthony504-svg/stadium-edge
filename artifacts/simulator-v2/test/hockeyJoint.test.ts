import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIM_V2_DEEP_DRAWS,
  DEFAULT_SIM_V2_FLAGS,
  HOCKEY_JOINT_MODEL_ID,
  buildHockeyMlMarket,
  buildHockeyPlayerPropMarket,
  buildHockeySpreadMarket,
  buildHockeyTeamTotalMarket,
  buildHockeyTotalMarket,
  buildJointHockeyTensor,
  impliedProbFromAmerican,
  nhlFinalHomeSeries,
  selectProductionSimResult,
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

describe("NHL joint milestone D.2 (shadow)", () => {
  it("conserves regulation periods; OT/SO only when tied; settles ML/puck/totals/TT/props", () => {
    const tensor = buildJointHockeyTensor({
      sport: "nhl",
      eventId: "nhl-d2",
      seed: "nhl-d2",
      nDraws: SIM_V2_DEEP_DRAWS,
      home: { teamId: "h", goalsFor: 3.2, goalsAgainst: 2.8 },
      away: { teamId: "a", goalsFor: 2.9, goalsAgainst: 3.1 },
      players: [
        { playerId: "sk1", teamSide: "home", usage: 0.35 },
        { playerId: "g1", teamSide: "away", usage: 1, isGoalie: true },
      ],
    });
    assert.equal(tensor.meta.modelId, HOCKEY_JOINT_MODEL_ID);
    assert.ok(tensor.meta.modelVersion.startsWith("0.2"));
    const cons = validateScenarioConsistency(tensor, { periodSumGroup: ["p1", "p2", "p3"] });
    assert.equal(cons.ok, true, JSON.stringify(cons.issues));

    let otOnlyWhenTied = true;
    let soCount = 0;
    for (let i = 0; i < tensor.meta.nDraws; i++) {
      const tied = tensor.team.homeFg[i] === tensor.team.awayFg[i];
      const wentOt = tensor.team.homeByPeriod.went_ot![i] === 1;
      const wentSo = tensor.team.homeByPeriod.went_so![i] === 1;
      if (wentOt && !tied) otOnlyWhenTied = false;
      if (wentSo) {
        soCount += 1;
        assert.equal(
          tensor.team.homeByPeriod.so![i]! + tensor.team.awayByPeriod.so![i]!,
          1,
        );
      }
    }
    assert.equal(otOnlyWhenTied, true);
    assert.ok(soCount > 0);

    const finalsH = nhlFinalHomeSeries(tensor);
    assert.ok(finalsH[0]! >= tensor.team.homeFg[0]!);

    const markets = [
      buildHockeyMlMarket({ marketId: "ml", eventId: "nhl-d2", side: "home" }),
      buildHockeySpreadMarket({
        marketId: "pl",
        eventId: "nhl-d2",
        side: "home",
        postedSpread: -1.5,
      }),
      buildHockeyTotalMarket({ marketId: "tot", eventId: "nhl-d2", side: "over", line: 5.5 }),
      buildHockeyTeamTotalMarket({
        marketId: "tt",
        eventId: "nhl-d2",
        teamSide: "home",
        side: "over",
        line: 2.5,
      }),
      buildHockeyTotalMarket({
        marketId: "p1t",
        eventId: "nhl-d2",
        period: "p1",
        side: "under",
        line: 1.5,
        includeOtSo: false,
      }),
      buildHockeyPlayerPropMarket({
        marketId: "sog",
        eventId: "nhl-d2",
        playerId: "sk1",
        stat: "shots_on_goal",
        side: "over",
        line: 2.5,
        alternate: true,
      }),
      buildHockeyPlayerPropMarket({
        marketId: "sv",
        eventId: "nhl-d2",
        playerId: "g1",
        stat: "saves",
        side: "over",
        line: 24.5,
      }),
    ];
    for (const m of markets) {
      const r = settleMarket({ tensor, market: m, odds: od(m.marketId, -110) });
      assert.equal(r.status, "ok", `${m.marketId}:${r.reason}`);
      assert.equal(r.providerOddsAmerican, -110);
    }

    const prod = selectProductionSimResult({
      flags: DEFAULT_SIM_V2_FLAGS,
      sport: "nhl",
      family: "ml",
      v1SimHit: 0.5,
      v2: null,
    });
    assert.equal(prod.engine, "v1");
  });
});
