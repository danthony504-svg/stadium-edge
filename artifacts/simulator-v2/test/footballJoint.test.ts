import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOOTBALL_JOINT_MODEL_ID,
  buildCalibrationReport,
  buildFootballMlMarket,
  buildFootballSpreadMarket,
  buildFootballTeamTotalMarket,
  buildFootballTotalMarket,
  buildJointFootballTensor,
  compareJointVsV1Frac,
  DEFAULT_SIM_V2_FLAGS,
  impliedProbFromAmerican,
  observeMarketSettlement,
  orientationSanity,
  selectProductionSimResult,
  settleAltLineBatch,
  settleMarket,
  summarizeJointFootballTensor,
  validateScenarioConsistency,
  type SimV2Odds,
} from "../src/index.js";

const now = new Date().toISOString();

function odds(marketId: string, american: number): SimV2Odds {
  return {
    marketId,
    american,
    book: "test",
    capturedAt: now,
    impliedProbRaw: impliedProbFromAmerican(american),
    provenance: { provider: "test", fetchedAt: now },
  };
}

/** Representative NFL form with distinct quarter profiles. */
function nflTensor(seed: string, nDraws = 2000) {
  return buildJointFootballTensor({
    sport: "nfl",
    eventId: "nfl-audit-1",
    seed,
    nDraws,
    home: {
      teamId: "home",
      scoredByQuarter: [4.5, 6.2, 5.0, 7.1],
      allowedByQuarter: [5.0, 5.8, 4.8, 6.5],
      ptsFor: 22.8,
      ptsAgainst: 22.1,
      recentFgScores: [17, 24, 27, 20, 31],
    },
    away: {
      teamId: "away",
      scoredByQuarter: [3.8, 5.5, 4.2, 6.0],
      allowedByQuarter: [4.2, 6.0, 5.1, 6.8],
      ptsFor: 19.5,
      ptsAgainst: 22.1,
      recentFgScores: [14, 21, 10, 28, 17],
    },
  });
}

describe("Phase B joint football model", () => {
  it("conserves Q1+Q2+Q3+Q4 = H1+H2 = FG on every draw", () => {
    const tensor = nflTensor("conserve-1", 5000);
    assert.equal(tensor.meta.modelId, FOOTBALL_JOINT_MODEL_ID);
    assert.equal(tensor.meta.isFixture, false);
    const qReport = validateScenarioConsistency(tensor, {
      periodSumGroup: ["q1", "q2", "q3", "q4"],
      checkDerivedHalves: true,
    });
    assert.equal(qReport.ok, true, JSON.stringify(qReport.issues));
    const hReport = validateScenarioConsistency(tensor, { periodSumGroup: ["h1", "h2"] });
    assert.equal(hReport.ok, true, JSON.stringify(hReport.issues));

    for (let i = 0; i < tensor.meta.nDraws; i++) {
      const hq =
        tensor.team.homeByPeriod.q1![i] +
        tensor.team.homeByPeriod.q2![i] +
        tensor.team.homeByPeriod.q3![i] +
        tensor.team.homeByPeriod.q4![i];
      const aq =
        tensor.team.awayByPeriod.q1![i] +
        tensor.team.awayByPeriod.q2![i] +
        tensor.team.awayByPeriod.q3![i] +
        tensor.team.awayByPeriod.q4![i];
      assert.equal(hq, tensor.team.homeFg[i]);
      assert.equal(aq, tensor.team.awayFg[i]);
      assert.equal(
        tensor.team.homeByPeriod.h1![i] + tensor.team.homeByPeriod.h2![i],
        tensor.team.homeFg[i],
      );
      assert.equal(
        tensor.team.homeByPeriod.q1![i] + tensor.team.homeByPeriod.q2![i],
        tensor.team.homeByPeriod.h1![i],
      );
    }
  });

  it("is deterministic for the same seed", () => {
    const a = nflTensor("det-seed", 800);
    const b = nflTensor("det-seed", 800);
    assert.equal(a.meta.dataFingerprint, b.meta.dataFingerprint);
    assert.deepEqual([...a.team.homeFg.slice(0, 20)], [...b.team.homeFg.slice(0, 20)]);
    assert.deepEqual(
      [...a.team.homeByPeriod.q2!.slice(0, 20)],
      [...b.team.homeByPeriod.q2!.slice(0, 20)],
    );
  });

  it("honors home/away orientation from stronger home offense", () => {
    const tensor = nflTensor("orient-1", 3000);
    const orient = orientationSanity(tensor);
    assert.equal(orient.ok, true);
    assert.equal(orient.homeStrongerThanAwayOnOffense, true);
    const summary = summarizeJointFootballTensor(tensor);
    assert.ok(summary.homeFgMean > summary.awayFgMean);
    // Joint FG total should be football-scale (~35–55), not V1 period-sum collapse.
    assert.ok(summary.totalFgMean > 30 && summary.totalFgMean < 70, String(summary.totalFgMean));
  });

  it("settles ML, spread, alt spread, totals, team totals from one joint tensor", () => {
    const tensor = nflTensor("settle-all", 4000);
    const markets = [
      buildFootballMlMarket({
        marketId: "ml-h",
        eventId: tensor.meta.eventId,
        sport: "nfl",
        side: "home",
      }),
      buildFootballSpreadMarket({
        marketId: "spr-h",
        eventId: tensor.meta.eventId,
        sport: "nfl",
        side: "home",
        postedSpread: -3.5,
      }),
      buildFootballSpreadMarket({
        marketId: "spr-alt",
        eventId: tensor.meta.eventId,
        sport: "nfl",
        side: "home",
        postedSpread: -7.5,
      }),
      buildFootballTotalMarket({
        marketId: "tot-o",
        eventId: tensor.meta.eventId,
        sport: "nfl",
        side: "over",
        line: 44.5,
      }),
      buildFootballTeamTotalMarket({
        marketId: "tt-h",
        eventId: tensor.meta.eventId,
        sport: "nfl",
        teamSide: "home",
        side: "over",
        line: 22.5,
      }),
      buildFootballSpreadMarket({
        marketId: "q2-spr",
        eventId: tensor.meta.eventId,
        sport: "nfl",
        period: "q2",
        side: "home",
        postedSpread: 3.5,
      }),
      buildFootballTotalMarket({
        marketId: "h1-tot",
        eventId: tensor.meta.eventId,
        sport: "nfl",
        period: "h1",
        side: "under",
        line: 20.5,
      }),
    ];

    for (const m of markets) {
      const r = settleMarket({
        tensor,
        market: m,
        odds: odds(m.marketId, -110),
      });
      assert.equal(r.status, "ok", `${m.marketId}: ${r.reason}`);
      assert.ok(r.simHit != null && r.simHit >= 0 && r.simHit <= 1);
      assert.equal(r.providerOddsAmerican, -110);
    }

    // Alt spreads: same path, higher |line| ⇒ lower home cover for favorites.
    const batch = settleAltLineBatch({
      tensor,
      markets: [
        buildFootballSpreadMarket({
          marketId: "a1",
          eventId: tensor.meta.eventId,
          sport: "nfl",
          side: "home",
          postedSpread: -1.5,
        }),
        buildFootballSpreadMarket({
          marketId: "a2",
          eventId: tensor.meta.eventId,
          sport: "nfl",
          side: "home",
          postedSpread: -3.5,
        }),
        buildFootballSpreadMarket({
          marketId: "a3",
          eventId: tensor.meta.eventId,
          sport: "nfl",
          side: "home",
          postedSpread: -10.5,
        }),
      ],
      oddsByMarketId: {
        a1: odds("a1", -110),
        a2: odds("a2", -110),
        a3: odds("a3", -110),
      },
    });
    assert.equal(batch.reusedSingleTensor, true);
    assert.ok(batch.results[0].simHit! >= batch.results[1].simHit!);
    assert.ok(batch.results[1].simHit! >= batch.results[2].simHit!);
  });

  it("period settlement uses period scores not FG (Q2 vs FG diverge)", () => {
    const tensor = nflTensor("period-scope", 5000);
    const fg = settleMarket({
      tensor,
      market: buildFootballSpreadMarket({
        marketId: "fg",
        eventId: tensor.meta.eventId,
        sport: "nfl",
        period: "fg",
        side: "home",
        postedSpread: 3.5,
      }),
      odds: odds("fg", -110),
    });
    const q2 = settleMarket({
      tensor,
      market: buildFootballSpreadMarket({
        marketId: "q2",
        eventId: tensor.meta.eventId,
        sport: "nfl",
        period: "q2",
        side: "home",
        postedSpread: 3.5,
      }),
      odds: odds("q2", -110),
    });
    assert.equal(fg.status, "ok");
    assert.equal(q2.status, "ok");
    // Same posted +3.5 dog line on FG vs Q2 must not collapse to identical hit%.
    assert.ok(Math.abs(fg.simHit! - q2.simHit!) > 0.02, `${fg.simHit} vs ${q2.simHit}`);
    // Q2 hit rate must not be absurdly inflated near 0.95 for a dog +3.5.
    assert.ok(q2.simHit! < 0.9, `q2 inflation ${q2.simHit}`);
  });

  it("NCAAF joint model also conserves periods", () => {
    const tensor = buildJointFootballTensor({
      sport: "ncaaf",
      eventId: "cfb-1",
      seed: "ncaaf-1",
      nDraws: 1500,
      home: { teamId: "h", ptsFor: 31, ptsAgainst: 24, scoredByQuarter: [7, 10, 7, 10] },
      away: { teamId: "a", ptsFor: 24, ptsAgainst: 28, scoredByQuarter: [3, 7, 7, 7] },
    });
    const report = validateScenarioConsistency(tensor, {
      periodSumGroup: ["q1", "q2", "q3", "q4"],
      checkDerivedHalves: true,
    });
    assert.equal(report.ok, true, JSON.stringify(report.issues));
  });

  it("never influences production under default flags", () => {
    const tensor = nflTensor("shadow", 200);
    const market = buildFootballMlMarket({
      marketId: "ml",
      eventId: tensor.meta.eventId,
      sport: "nfl",
      side: "home",
    });
    const v2 = settleMarket({ tensor, market, odds: odds("ml", -120) });
    const choice = selectProductionSimResult({
      flags: DEFAULT_SIM_V2_FLAGS,
      sport: "nfl",
      family: "ml",
      v1SimHit: 0.55,
      v2,
    });
    assert.equal(choice.engine, "v1");
    assert.equal(choice.simHit, 0.55);
    assert.equal(choice.influencedProduction, false);
  });

  it("reports calibration metrics and V1 frac divergence", () => {
    const tensor = nflTensor("cal-1", 2500);
    const market = buildFootballTotalMarket({
      marketId: "tot",
      eventId: tensor.meta.eventId,
      sport: "nfl",
      side: "over",
      line: 44.5,
    });
    // Synthetic historical outcomes for diagnostic plumbing (not production gate).
    const outcomes = [
      { home: 27, away: 20 },
      { home: 17, away: 24 },
      { home: 31, away: 28 },
      { home: 14, away: 17 },
      { home: 24, away: 21 },
    ];
    const rows = outcomes
      .map((o, i) =>
        observeMarketSettlement({
          tensor,
          market: { ...market, marketId: `tot-${i}`, eventId: `hist-${i}` },
          odds: odds(`tot-${i}`, -110),
          actualHome: o.home,
          actualAway: o.away,
        }),
      )
      .filter((r): r is NonNullable<typeof r> => r != null);
    assert.ok(rows.length === 5);
    const report = buildCalibrationReport(rows);
    assert.equal(report.n, 5);
    assert.ok(report.brier != null && report.brier >= 0 && report.brier <= 1);
    assert.ok(report.logLoss != null && report.logLoss > 0);
    assert.ok(report.ece != null);

    const cmp = compareJointVsV1Frac(tensor, "cmp-1");
    assert.ok(cmp.rows.length === 4);
    // V1 independent frac+noise breaks per-draw conservation; joint never does.
    assert.equal(cmp.jointPeriodSumBreakRate, 0);
    assert.ok(cmp.v1PeriodSumBreakRate > 0.9, `v1 break rate ${cmp.v1PeriodSumBreakRate}`);
    assert.ok(cmp.v1MeanAbsSumError > 0.5, `v1 abs sum err ${cmp.v1MeanAbsSumError}`);
    assert.ok(cmp.meanAbsDeltaPp > 0);
    assert.ok(cmp.jointTotalFgMean > 30 && cmp.jointTotalFgMean < 70);
  });

  it("preserves provider odds verbatim on settle", () => {
    const tensor = nflTensor("odds", 500);
    const market = buildFootballMlMarket({
      marketId: "ml",
      eventId: tensor.meta.eventId,
      sport: "nfl",
      side: "away",
    });
    const r = settleMarket({ tensor, market, odds: odds("ml", 185) });
    assert.equal(r.status, "ok");
    assert.equal(r.providerOddsAmerican, 185);
    assert.ok(Math.abs(r.impliedProbRaw! - impliedProbFromAmerican(185)) < 1e-12);
  });
});
