import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANYTIME_TD_OPP_MAX_NO_RZ,
  ANYTIME_TD_OPP_MAX_WITH_RZ,
  anytimeTdBinarySeries,
  anytimeTdShrunkScoreRate,
  capAnytimeTdOpportunityMult,
  isAnytimeTdMarket,
  poissonLambdaForAnytimeTd,
} from "../src/lib/anytimeTdModel.js";
import { buildProjectionMean, type PropSimulationContext } from "../src/lib/monteCarlo.js";
import { aggregateFamilyMultiplier } from "../src/lib/opportunityShift/aggregate.js";
import type { ChannelContribution } from "../src/lib/opportunityShift/types.js";

describe("anytimeTdModel", () => {
  it("detects NFL/NCAAF anytime TD markets", () => {
    assert.equal(isAnytimeTdMarket("player_anytime_td"), true);
    assert.equal(isAnytimeTdMarket("Anytime TD"), true);
    assert.equal(isAnytimeTdMarket("player_rush_yds"), false);
  });

  it("binary series collapses multi-TD games to one score event", () => {
    assert.deepEqual(anytimeTdBinarySeries([2, 0, 1, 0, 3]), [1, 0, 1, 0, 1]);
  });

  it("shrunk rate for 0/5 and 5/5", () => {
    const z = anytimeTdShrunkScoreRate([0, 0, 0, 0, 0])!;
    assert.ok(z > 0.05 && z < 0.12);
    const five = anytimeTdShrunkScoreRate([1, 1, 1, 1, 1])!;
    assert.ok(five < 0.75);
  });

  it("λ = −ln(1−p) grounds Poisson in scoring probability", () => {
    const p = 0.3;
    const lam = poissonLambdaForAnytimeTd(p);
    const back = 1 - Math.exp(-lam);
    assert.ok(Math.abs(back - p) < 1e-9);
  });

  it("opportunity mult capped tighter without RZ", () => {
    assert.equal(capAnytimeTdOpportunityMult(1.35, { hasRedZoneChannel: false }), ANYTIME_TD_OPP_MAX_NO_RZ);
    assert.equal(capAnytimeTdOpportunityMult(1.35, { hasRedZoneChannel: true }), ANYTIME_TD_OPP_MAX_WITH_RZ);
  });
});

describe("buildProjectionMean anytime TD", () => {
  it("matches exact shrink p=(hits+0.72)/(n+4) with no context", () => {
    for (const vals of [
      [0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 1, 1, 0, 0],
      [1, 1, 1, 1, 1],
      [2, 0, 0, 0, 0],
    ]) {
      const shrink = anytimeTdShrunkScoreRate(vals)!;
      const lam = buildProjectionMean({
        sport: "nfl",
        market: "player_anytime_td",
        line: 0.5,
        side: "Over",
        recentValues: vals,
        discrete: true,
      })!;
      const p = 1 - Math.exp(-lam);
      assert.ok(
        Math.abs(p - shrink) < 1e-9,
        `vals=${vals} shrink=${shrink} serverP=${p}`,
      );
    }
  });

  it("does not inflate from multi-TD count mean", () => {
    const base: PropSimulationContext = {
      sport: "nfl",
      market: "player_anytime_td",
      line: 0.5,
      side: "Over",
      recentValues: [2, 0, 0, 0, 0],
      discrete: true,
    };
    const mean = buildProjectionMean(base)!;
    // λ from exact shrink ~0.191 → not count-mean 0.4
    const p = 1 - Math.exp(-mean);
    assert.ok(Math.abs(p - anytimeTdShrunkScoreRate([2, 0, 0, 0, 0])!) < 1e-9);
    assert.ok(p < 0.25, `P(X>=1)=${p}`);
  });

  it("5/5 scoring stays at exact shrink (~63.6%), not form-inflated ~84%", () => {
    const shrink = anytimeTdShrunkScoreRate([1, 1, 1, 1, 1])!;
    const lam = buildProjectionMean({
      sport: "nfl",
      market: "player_anytime_td",
      line: 0.5,
      side: "Over",
      recentValues: [1, 1, 1, 1, 1],
      discrete: true,
    })!;
    const p = 1 - Math.exp(-lam);
    assert.ok(Math.abs(p - shrink) < 1e-9);
    assert.ok(p < 0.65, `p=${p}`);
  });

  it("NCAAF uses the same conversion", () => {
    const vals = [1, 1, 1, 0, 0];
    const shrink = anytimeTdShrunkScoreRate(vals)!;
    const mean = buildProjectionMean({
      sport: "ncaaf",
      market: "player_anytime_td",
      line: 0.5,
      side: "Over",
      recentValues: vals,
      discrete: true,
    })!;
    const p = 1 - Math.exp(-mean);
    assert.ok(Math.abs(p - shrink) < 1e-9, `p=${p} shrink=${shrink}`);
  });

  it("opportunity bump is capped and does not erase shrink base", () => {
    const vals = [1, 1, 1, 1, 1];
    const base = anytimeTdShrunkScoreRate(vals)!;
    const lam = buildProjectionMean({
      sport: "nfl",
      market: "player_anytime_td",
      line: 0.5,
      side: "Over",
      recentValues: vals,
      discrete: true,
      opportunityFamilyMult: 1.35,
    })!;
    const p = 1 - Math.exp(-lam);
    // Cap 1.10 with RZ default in buildProjectionMean path
    assert.ok(p <= base * 1.1 + 1e-9, `p=${p} base=${base}`);
    assert.ok(p < 0.75, "opp shift cannot mint ~98% from 5/5 alone");
  });
});

describe("aggregateFamilyMultiplier anytime_td caps", () => {
  it("caps without RZ channels below with-RZ", () => {
    const contribNoRz: ChannelContribution[] = [
      {
        channel: "targets",
        volumeDelta: 0.4,
        elasticity: 0.25,
        confidenceWeight: 1,
        pricedInFactor: 0,
        vacancyFingerprint: "x",
        kind: "E",
      },
    ];
    const contribRz: ChannelContribution[] = [
      {
        channel: "rz_carries",
        volumeDelta: 0.4,
        elasticity: 0.65,
        confidenceWeight: 1,
        pricedInFactor: 0,
        vacancyFingerprint: "x",
        kind: "E",
      },
    ];
    const noRz = aggregateFamilyMultiplier(contribNoRz, { family: "anytime_td" });
    const withRz = aggregateFamilyMultiplier(contribRz, { family: "anytime_td" });
    assert.ok(noRz.multiplier <= ANYTIME_TD_OPP_MAX_NO_RZ + 1e-9);
    assert.ok(withRz.multiplier <= ANYTIME_TD_OPP_MAX_WITH_RZ + 1e-9);
    assert.ok(noRz.multiplier <= withRz.multiplier + 1e-9);
  });
});
